import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createApp } from './server/createApp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Keep SQLite and app data on a mounted persistent directory in production.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

async function startServer() {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const { app } = createApp({ dataDir: DATA_DIR });

  // Vite Dev Middleware / Production Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Mock Interview Platform running on http://localhost:${PORT}`);
  });
}

startServer();
