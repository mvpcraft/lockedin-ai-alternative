'use strict';

// Cross-platform launcher. Strips ELECTRON_RUN_AS_NODE (which, if set in the
// environment, makes Electron run as plain Node and break the app), then spawns
// Electron normally.

const { spawn } = require('child_process');
const electronPath = require('electron'); // resolves to the electron binary path

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { env, stdio: 'inherit' });
child.on('close', (code) => process.exit(code == null ? 0 : code));
