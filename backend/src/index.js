import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';

const app = express();

app.use(helmet());
app.use(morgan('combined'));
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth/', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);

app.listen(process.env.PORT || 4000, () => console.log('API running'));