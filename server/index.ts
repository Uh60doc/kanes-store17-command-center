import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from './app.ts';
import { API_HOST, API_PORT } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(repoRoot);
const config = loadConfig(repoRoot);
const server = listen(config);

server.on('listening', () => {
  console.log(`Google API listening on http://${API_HOST}:${config.apiPort}`);
  if (config.missing.length > 0) {
    console.log(`OAuth is not configured yet. Missing ${config.missing.join(', ')}.`);
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${API_PORT} is already in use.`);
  } else {
    console.error('The Google API server failed to start.');
  }
  process.exit(1);
});
