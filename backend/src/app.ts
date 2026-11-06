import cors from 'cors';
import express, { type Express } from 'express';
import { getConnection } from './lib/solana';
import { Store } from './lib/store';
import { registerApiRoutes } from './routes/api';

export function createApp(): Express {
  const app = express();
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  registerApiRoutes(app, { conn: getConnection(), store: new Store() });
  // JSON 404 for unknown API paths.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'unknown endpoint' }));
  return app;
}
