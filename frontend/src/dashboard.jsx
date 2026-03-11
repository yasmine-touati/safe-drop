import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import { encryptFile } from './utils/crypto';

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
  const STORAGE_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function fetchFiles() {
    try {
      const { data } = await api.get('/files');
      setFiles(data);
      const used = data.reduce((acc, f) => acc + f.size, 0);
      setStorageUsed(used);
    } catch {
      showToast('Failed to load files', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchFiles(); }, []);

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    setProgress(10);

    try {
      // Encrypt before upload
      const { blob, iv, keyBase64 } = await encryptFile(file);
      setProgress(40);

      const formData = new FormData();
      formData.append('file', blob, file.name);
      formData.append('encryption_iv', iv);

      await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          setProgress(40 + Math.round((e.loaded / e.total) * 55));
        },
      });

      setProgress(100);

      // Store decryption key locally (keyed by filename + timestamp)
      const keyStore = JSON.parse(localStorage.getItem('fileKeys') || '{}');
      keyStore[`${file.name}_${Date.now()}`] = keyBase64;
      localStorage.setItem('fileKeys', JSON.stringify(keyStore));

      showToast(`${file.name} uploaded & encrypted`);
      await fetchFiles();
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

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

  async function handleShare(id) {
    try {
      const { data } = await api.post(`/files/${id}/share`);
      await navigator.clipboard.writeText(data.share_url);
      showToast('Share link copied to clipboard');
    } catch {
      showToast('Share failed', 'error');
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  }

  const storagePercent = Math.min((storageUsed / STORAGE_LIMIT) * 100, 100).toFixed(1);

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
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            handleUpload(e.dataTransfer.files[0]);
          }}
          onClick={() => !uploading && fileInputRef.current.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={e => handleUpload(e.target.files[0])}
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
            <p><strong>Drop a file here</strong> or click to browse</p>
          )}
          <p style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
            Files are AES-256 encrypted before leaving your browser · Max 500MB
          </p>
        </div>

        {/* File list */}
        <div className="section-header">
          <span className="section-title">your files ({files.length})</span>
        </div>

        {loading ? (
          <div className="empty-state"><span className="spinner" /> Loading...</div>
        ) : files.length === 0 ? (
          <div className="empty-state">
            No files yet. Drop something above to get started.
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Security</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id}>
                  <td className="file-name" title={f.original_name}>{f.original_name}</td>
                  <td className="file-meta">{formatBytes(f.size)}</td>
                  <td className="file-meta">{formatDate(f.created_at)}</td>
                  <td>
                    <span className="badge-encrypted">AES-256</span>
                  </td>
                  <td className="file-actions">
                    <button className="btn-action" onClick={() => handleShare(f.id)}>
                      share
                    </button>
                    <button className="btn-action danger" onClick={() => handleDelete(f.id, f.original_name)}>
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'error' : ''}`}>
          {toast.type === 'error' ? '⚠' : '✓'} {toast.msg}
        </div>
      )}
    </div>
  );
}