const { spawn } = require('node:child_process');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [require('node:path').join(__dirname, 'test-studio-preview.cjs')], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => process.exit(code ?? 1));
