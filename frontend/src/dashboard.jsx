import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { encryptFile, decryptFile } from './utils/crypto';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const fileInputRef = useRef();

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const [storageUsed, setStorageUsed] = useState(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'name' | 'size'
  const [sortDir, setSortDir] = useState('desc');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareModal, setShareModal] = useState(null); // { id, name }
  const [shareExpiry, setShareExpiry] = useState('');
  const STORAGE_LIMIT = 5 * 1024 * 1024 * 1024;

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function fetchFiles() {
    try {
      const { data } = await api.get('/files');
      setFiles(data);
      setStorageUsed(data.reduce((acc, f) => acc + f.size, 0));
    } catch {
      showToast('Failed to load files', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchFiles(); }, []);

  // ── Upload (multi-file) ──────────────────────────────────────────────────
  async function handleUpload(fileList) {
    const picked = Array.from(fileList);
    if (!picked.length) return;
    setUploading(true);
    setProgress(5);

    try {
      const secure = window.isSecureContext && crypto.subtle;
      const formData = new FormData();
      const ivs = [];
      const encryptedKeys = [];

      for (let i = 0; i < picked.length; i++) {
        if (secure) {
          const { blob, iv, keyBase64 } = await encryptFile(picked[i]);
          formData.append('files', blob, picked[i].name);
          ivs.push(iv);
          encryptedKeys.push({ key: keyBase64, iv });
        } else {
          formData.append('files', picked[i]);
          ivs.push(null);
          encryptedKeys.push(null);
        }
        setProgress(5 + Math.round(((i + 1) / picked.length) * 35));
      }

      if (ivs.some(Boolean)) formData.append('encryption_ivs', JSON.stringify(ivs));

      const { data } = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => setProgress(40 + Math.round((e.loaded / e.total) * 55)),
      });

      // Persist decryption keys mapped by file id so download/share can find them reliably.
      if (Array.isArray(data?.uploaded) && encryptedKeys.some(Boolean)) {
        const keyStore = JSON.parse(localStorage.getItem('fileKeys') || '{}');
        for (let i = 0; i < data.uploaded.length; i++) {
          const rec = encryptedKeys[i];
          if (rec && data.uploaded[i]?.id) keyStore[data.uploaded[i].id] = rec;
        }
        localStorage.setItem('fileKeys', JSON.stringify(keyStore));
      }

      setProgress(100);
      showToast(`${picked.length} file${picked.length > 1 ? 's' : ''} uploaded${secure ? ' & encrypted' : ''}`);
      await fetchFiles();
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Download + decrypt ───────────────────────────────────────────────────
  async function handleDownload(f) {
    try {
      const { data } = await api.get(`/files/${f.id}/download`, { responseType: 'arraybuffer' });
      let blob;

      if (f.encryption_iv) {
        // Find the decryption key in localStorage
        const keyStore = JSON.parse(localStorage.getItem('fileKeys') || '{}');
        const legacyEntry = Object.entries(keyStore).find(([k]) => k.startsWith(`${f.original_name}_`));
        const record = keyStore[f.id] || legacyEntry?.[1];
        if (!record) {
          showToast('Decryption key not found in this browser — file may have been uploaded elsewhere', 'error');
          return;
        }
        const { key, iv } = record;
        const decrypted = await decryptFile(data, key, iv || f.encryption_iv);
        blob = new Blob([decrypted]);
      } else {
        blob = new Blob([data]);
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.original_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Download failed', 'error');
    }
  }

  // ── Rename ───────────────────────────────────────────────────────────────
  async function submitRename(id) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      await api.patch(`/files/${id}/rename`, { name: renameValue.trim() });
      showToast('Renamed');
      setRenamingId(null);
      await fetchFiles();
    } catch {
      showToast('Rename failed', 'error');
    }
  }

  // ── Share ────────────────────────────────────────────────────────────────
  async function handleShare(id) {
    try {
      const payload = shareExpiry ? { expires_in_hours: Number(shareExpiry) } : {};
      const { data } = await api.post(`/files/${id}/share`, payload);
      const file = files.find(f => f.id === id);
      let shareUrl = data.share_url;

      if (file?.encryption_iv) {
        const keyStore = JSON.parse(localStorage.getItem('fileKeys') || '{}');
        const legacyEntry = Object.entries(keyStore).find(([k]) => k.startsWith(`${file.original_name}_`));
        const rec = keyStore[id] || legacyEntry?.[1];
        if (rec?.key) {
          shareUrl = `${shareUrl}#key=${encodeURIComponent(rec.key)}`;
        } else {
          showToast('Link copied without key. Recipient will not be able to decrypt.', 'error');
        }
      }

      await navigator.clipboard.writeText(shareUrl);
      showToast(`Share link copied${data.expires_at ? ` · expires ${formatDate(data.expires_at)}` : ''}`);
      setShareModal(null);
      setShareExpiry('');
      await fetchFiles();
    } catch {
      showToast('Share failed', 'error');
    }
  }

  async function handleRevoke(id) {
    try {
      await api.delete(`/files/${id}/share`);
      showToast('Share link revoked');
      await fetchFiles();
    } catch {
      showToast('Revoke failed', 'error');
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await api.delete(`/files/${id}`);
      showToast(`${name} deleted`);
      await fetchFiles();
    } catch {
      showToast('Delete failed', 'error');
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  }

  // ── Sorting & filtering ──────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  const displayed = files
    .filter(f => f.original_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.original_name.localeCompare(b.original_name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      else cmp = new Date(a.created_at) - new Date(b.created_at);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const storagePercent = Math.min((storageUsed / STORAGE_LIMIT) * 100, 100).toFixed(1);
  const sortIndicator = dir => dir === sortDir ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="dash-layout">
      <header className="dash-header">
        <div className="dash-logo">safe/drop</div>
        <div className="dash-user">
          <span>{user.email}</span>
          <button className="btn-logout" onClick={handleLogout}>logout</button>
        </div>
      </header>

      <main className="dash-main">
        {/* Storage bar */}
        <div className="storage-info">
          <div className="storage-label">
            <span>storage used</span>
            <span>{formatBytes(storageUsed)} / 5 GB ({storagePercent}%)</span>
          </div>
          <div className="storage-track">
            <div className="storage-fill" style={{ width: `${storagePercent}%` }} />
          </div>
        </div>

        {/* Upload zone */}
        <div
          className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
          onClick={() => !uploading && fileInputRef.current.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={e => handleUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <div className="upload-icon">⬆</div>
          {uploading ? (
            <>
              <p><strong>Encrypting & uploading...</strong></p>
              <div className="progress-bar-wrap">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
            </>
          ) : (
            <p><strong>Drop files here</strong> or click to browse · multiple files supported</p>
          )}
          <p style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
            Files are AES-256 encrypted before leaving your browser · Max 500 MB per file
          </p>
        </div>

        {/* Search + file list */}
        <div className="section-header">
          <span className="section-title">your files ({files.length})</span>
          <input
            className="search-input"
            type="search"
            placeholder="Search files…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="empty-state"><span className="spinner" /> Loading...</div>
        ) : displayed.length === 0 ? (
          <div className="empty-state">
            {search ? 'No files match your search.' : 'No files yet. Drop something above to get started.'}
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortBy === 'name' ? sortIndicator('name') : ''}</th>
                <th onClick={() => toggleSort('size')} style={{ cursor: 'pointer' }}>Size{sortBy === 'size' ? sortIndicator('size') : ''}</th>
                <th onClick={() => toggleSort('date')} style={{ cursor: 'pointer' }}>Uploaded{sortBy === 'date' ? sortIndicator('date') : ''}</th>
                <th>Security</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(f => (
                <tr key={f.id}>
                  <td className="file-name" title={f.original_name}>
                    {renamingId === f.id ? (
                      <input
                        className="rename-input"
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(f.id)}
                        onKeyDown={e => { if (e.key === 'Enter') submitRename(f.id); if (e.key === 'Escape') setRenamingId(null); }}
                      />
                    ) : (
                      <span onDoubleClick={() => { setRenamingId(f.id); setRenameValue(f.original_name); }}>
                        {f.original_name}
                      </span>
                    )}
                  </td>
                  <td className="file-meta">{formatBytes(f.size)}</td>
                  <td className="file-meta">{formatDate(f.created_at)}</td>
                  <td>
                    {f.encryption_iv
                      ? <span className="badge-encrypted">AES-256</span>
                      : <span className="badge-plain">unencrypted</span>}
                  </td>
                  <td className="file-actions">
                    <button className="btn-action" onClick={() => handleDownload(f)} title="Download">
                      ↓ download
                    </button>
                    {f.is_public ? (
                      <>
                        <button className="btn-action" onClick={() => setShareModal(f)} title="Refresh share link">
                          share
                        </button>
                        <button className="btn-action danger" onClick={() => handleRevoke(f.id)} title="Revoke share link">
                          revoke
                        </button>
                      </>
                    ) : (
                      <button className="btn-action" onClick={() => setShareModal(f)} title="Create share link">
                        share
                      </button>
                    )}
                    <button className="btn-action" onClick={() => { setRenamingId(f.id); setRenameValue(f.original_name); }} title="Rename">
                      rename
                    </button>
                    <button className="btn-action danger" onClick={() => handleDelete(f.id, f.original_name)} title="Delete">
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {/* Share modal */}
      {shareModal && (
        <div className="modal-overlay" onClick={() => { setShareModal(null); setShareExpiry(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Share "{shareModal.original_name}"</h3>
            <label>
              Expires in (hours) — leave blank for no expiry
              <input
                className="modal-input"
                type="number"
                min="1"
                placeholder="e.g. 24"
                value={shareExpiry}
                onChange={e => setShareExpiry(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="btn-action" onClick={() => handleShare(shareModal.id)}>
                Copy link
              </button>
              <button className="btn-action danger" onClick={() => { setShareModal(null); setShareExpiry(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'error' : ''}`}>
          {toast.type === 'error' ? '⚠' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  );
}