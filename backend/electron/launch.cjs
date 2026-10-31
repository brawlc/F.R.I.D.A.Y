const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['backend/electron/main.cjs'], {
  cwd: require('node:path').resolve(__dirname, '..', '..'),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', error => {
  console.error('Could not launch FRIDAY desktop:', error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
