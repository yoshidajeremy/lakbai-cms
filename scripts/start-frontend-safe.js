#!/usr/bin/env node
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_ATTEMPTS = 10; // try DEFAULT_PORT .. DEFAULT_PORT+9

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function findFreePort(base, attempts) {
  for (let i = 0; i < attempts; i++) {
    const p = base + i;
    // eslint-disable-next-line no-await-in-loop
    const free = await checkPort(p);
    if (free) return p;
  }
  return null;
}

(async () => {
  const port = await findFreePort(DEFAULT_PORT, MAX_ATTEMPTS);
  if (!port) {
    console.error(`No available ports in range ${DEFAULT_PORT}-${DEFAULT_PORT + MAX_ATTEMPTS - 1}`);
    process.exit(1);
  }

  process.env.PORT = String(port);
  console.log(`Starting frontend on port ${port}`);

  const child = spawn('npx', ['react-scripts', 'start'], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    env: process.env,
  });

  child.on('close', (code) => process.exit(code));
})();
