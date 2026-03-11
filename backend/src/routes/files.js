import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import pool from '../db/pool.js';
import auth from '../middleware/auth.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Store files under UUID names — never the original filename on disk
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, uuidv4()),
});

const ALLOWED_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf','text/plain','application/zip',
  'video/mp4','audio/mpeg',
  'application/octet-stream',  
];

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB per file
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const router = Router();

// Upload one or more files (up to 20 at once)
router.post('/upload', auth, upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

  const { rows: userRows } = await pool.query(
    'SELECT storage_used, storage_limit FROM users WHERE id = $1', [req.user.id]
  );
  let used = BigInt(userRows[0].storage_used);
  const limit = BigInt(userRows[0].storage_limit);

  // Parse per-file encryption IVs sent as JSON array or single value
  let ivs = [];
  try { ivs = JSON.parse(req.body.encryption_ivs || '[]'); } catch { ivs = []; }

  const inserted = [];
  const toCleanup = [];

  for (let i = 0; i < req.files.length; i++) {
    const { originalname, mimetype, size, filename } = req.files[i];
    const incoming = BigInt(size);

    if (used + incoming > limit) {
      toCleanup.push(filename);
      continue; // skip files that exceed quota
    }

    const { rows } = await pool.query(
      `INSERT INTO files (owner_id, filename, original_name, mime_type, size, encryption_iv)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, filename, originalname, mimetype, size, ivs[i] || null]
    );
    await pool.query('UPDATE users SET storage_used = storage_used + $1 WHERE id = $2', [size, req.user.id]);
    used += incoming;
    inserted.push({ id: rows[0].id, original_name: originalname });
  }

  // Clean up files that were rejected due to quota
  for (const f of toCleanup) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {}
  }

  if (!inserted.length) return res.status(413).json({ error: 'Storage quota exceeded' });
  res.status(201).json({ uploaded: inserted, quota_exceeded: toCleanup.length > 0 });
});

router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, original_name, mime_type, size, is_public, share_token, encryption_iv, created_at
     FROM files WHERE owner_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Download own file
router.get('/:id/download', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT filename, original_name, mime_type FROM files WHERE id = $1 AND owner_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rows[0].original_name)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(path.join(UPLOAD_DIR, rows[0].filename));
});

// Rename file
router.patch('/:id/rename', auth, async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const { rows } = await pool.query(
    'UPDATE files SET original_name = $1 WHERE id = $2 AND owner_id = $3 RETURNING id',
    [name.trim().slice(0, 255), req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/:id', auth, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM files WHERE id = $1 AND owner_id = $2 RETURNING filename, size',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, rows[0].filename)); } catch {}
  await pool.query('UPDATE users SET storage_used = storage_used - $1 WHERE id = $2', [rows[0].size, req.user.id]);
  res.json({ ok: true });
});

// Create/refresh share link with optional expiry (hours)
router.post('/:id/share', auth, async (req, res) => {
  const { expires_in_hours } = req.body; // optional, e.g. 24
  const token = uuidv4();
  const expiresAt = expires_in_hours
    ? new Date(Date.now() + Number(expires_in_hours) * 3600 * 1000)
    : null;
  const { rows } = await pool.query(
    `UPDATE files SET is_public = TRUE, share_token = $1, expires_at = $2
     WHERE id = $3 AND owner_id = $4 RETURNING id`,
    [token, expiresAt, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ share_url: `${process.env.FRONTEND_URL}/share/${token}`, expires_at: expiresAt });
});

// Revoke share link
router.delete('/:id/share', auth, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE files SET is_public = FALSE, share_token = NULL, expires_at = NULL
     WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Public share download (checks expiry)
router.get('/share/:token', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT filename, original_name, mime_type, encryption_iv, expires_at
     FROM files WHERE share_token = $1 AND is_public = TRUE`,
    [req.params.token]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) {
    return res.status(410).json({ error: 'Share link has expired' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rows[0].original_name)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  if (rows[0].encryption_iv) res.setHeader('X-Encryption-IV', rows[0].encryption_iv);
  res.sendFile(path.join(UPLOAD_DIR, rows[0].filename));
});

export default router;