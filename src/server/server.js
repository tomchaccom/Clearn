import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { exec } from 'node:child_process';
import * as store from '../main/store.js';
import * as agent from '../main/agent.js';
import { createRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// claude CLI PATH 보완 — spawn ENOTDIR 방지
process.env.PATH = [
  path.join(os.homedir(), '.claude', 'local', 'node_modules', '.bin'),
  path.join(os.homedir(), '.local', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  process.env.PATH ?? '',
].join(':');

const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'Learn with Claude');

store.init(DATA_DIR);
agent.setModel(store.getSettings().model);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'renderer')));
app.use('/api', createRouter({ store, agent }));

const server = app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Clearn → ${url}`);
  exec(`open ${url}`);
});

const shutdown = () => {
  store.flush();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { store.flush(); } catch { /* 종료 중 */ } });
