import cors from 'cors';
import express, { type Express } from 'express';
import { getConnection } from './lib/solana';
import { Store } from './lib/store';
import { registerApiRoutes } from './routes/api';

export function createApp(): Express {
  const app = express();
  // Netlify Functions invoke the app at /.netlify/functions/<name>/... —
  // strip that prefix so the /api routes match when called directly (the
  // /api redirect proxy drops POST bodies, so production calls the
  // function URL). Note: strip ONLY '/.netlify/functions' — the function
  // is named 'api', so '/api/chat' must survive the strip.
  app.use((req, _res, next) => {
    const prefix = '/.netlify/functions';
    if (req.url.startsWith(prefix)) {
      req.url = req.url.slice(prefix.length) || '/';
    }
    next();
  });
  // Allowed browser origins: CORS_ORIGINS env (comma-separated) for the
  // deployed frontend, else local dev only.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = corsOrigins.length > 0
    ? corsOrigins
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.use(cors({ origin: allowedOrigins, credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  registerApiRoutes(app, { conn: getConnection(), store: new Store() });
  // JSON 404 for unknown API paths.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'unknown endpoint' }));
  return app;
}
