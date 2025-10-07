#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const BASE_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_ATTEMPTS = 10; // try BASE_PORT .. BASE_PORT+9

function tryStart(port) {
  return new Promise((resolve) => {
    console.log(`Attempting to start frontend on port ${port}...`);
    const child = spawn('npx', ['react-scripts', 'start'], {
      env: { ...process.env, PORT: String(port) },
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let rejected = false;

    function handleData(chunk) {
      const text = chunk.toString();
      process.stdout.write(text);
      if (text.includes('Something is already running on port') || text.includes('EADDRINUSE')) {
        rejected = true;
        // kill the child and resolve as false to try next port
        try { child.kill(); } catch (e) {}
      }
    }

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    // If neither 'in use' message nor exit happens within the grace window, assume success
    const GRACE_MS = 6000;
    const grace = setTimeout(() => {
      if (!rejected) {
        // success: pipe remaining output directly
        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
        child.on('exit', (code) => process.exit(code));
        resolve(true);
      }
    }, GRACE_MS);

    child.on('exit', (code) => {
      clearTimeout(grace);
      if (rejected) {
        resolve(false);
      } else {
        // If the process exited quickly but not due to port-in-use, forward the exit
        process.exit(code);
      }
    });
  });
}

(async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = BASE_PORT + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryStart(port);
    if (ok) return; // child is running and will keep the process alive
  }
  console.error(`No available ports in range ${BASE_PORT}-${BASE_PORT + MAX_ATTEMPTS - 1}`);
  process.exit(1);
})();
