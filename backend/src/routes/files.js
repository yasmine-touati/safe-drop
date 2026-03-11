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

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  const { originalname, mimetype, size, filename } = req.file;
  const { encryption_iv } = req.body; // optional if client encrypts

  const { rows: user } = await pool.query(
    'SELECT storage_used, storage_limit FROM users WHERE id = $1', [req.user.id]
  );
  const used = BigInt(user[0].storage_used);
const limit = BigInt(user[0].storage_limit);
const incoming = BigInt(size);

if (used + incoming > limit) {
  fs.unlinkSync(path.join(UPLOAD_DIR, filename));
  return res.status(413).json({ error: 'Storage quota exceeded' });
}

  const { rows } = await pool.query(
    `INSERT INTO files (owner_id, filename, original_name, mime_type, size, encryption_iv)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.user.id, filename, originalname, mimetype, size, encryption_iv || null]
  );
  await pool.query('UPDATE users SET storage_used = storage_used + $1 WHERE id = $2', [size, req.user.id]);
  res.status(201).json({ id: rows[0].id });
});

router.get('/', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, original_name, mime_type, size, is_public, share_token, created_at FROM files WHERE owner_id = $1',
    [req.user.id]
  );
  res.json(rows);
});

router.delete('/:id', auth, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM files WHERE id = $1 AND owner_id = $2 RETURNING filename, size',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(path.join(UPLOAD_DIR, rows[0].filename));
  await pool.query('UPDATE users SET storage_used = storage_used - $1 WHERE id = $2', [rows[0].size, req.user.id]);
  res.json({ ok: true });
});

router.post('/:id/share', auth, async (req, res) => {
  const token = uuidv4();
  await pool.query(
    'UPDATE files SET is_public = TRUE, share_token = $1 WHERE id = $2 AND owner_id = $3',
    [token, req.params.id, req.user.id]
  );
  res.json({ share_url: `${process.env.FRONTEND_URL}/share/${token}` });
});

router.get('/share/:token', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT filename, original_name, mime_type FROM files WHERE share_token = $1 AND is_public = TRUE',
    [req.params.token]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found or expired' });
  res.download(path.join(UPLOAD_DIR, rows[0].filename), rows[0].original_name);
});

export default router;