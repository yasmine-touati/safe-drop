import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

const router = Router();

router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, hash]
      );
      const token = jwt.sign({ id: rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.status(201).json({ token, user: rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: rows[0].id, email: rows[0].email } });
  }
);

export default router;