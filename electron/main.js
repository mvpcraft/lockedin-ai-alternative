'use strict';

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, desktopCapturer, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Load .env from the project root (and from the app dir when packaged).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Keep the app fully alive while it's in the background / unfocused, so audio
// capture and the live transcript keep updating even when the user is clicking
// inside Zoom/Teams. Without these, Chromium throttles timers and rendering in
// backgrounded windows and the transcript only refreshes when the app is focused.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// API key + model resolved from the environment (.env takes priority over the
// key saved in the UI config).
const envApiKey = () => (process.env.OPENAI_API_KEY || '').trim();
const envModel = () => (process.env.OPENAI_MODEL || '').trim();
const envTranscribeModel = () => (process.env.OPENAI_TRANSCRIBE_MODEL || '').trim();

// pdf-parse is loaded lazily inside the handler so a missing/odd install
// doesn't crash app startup.
let pdfParse = null;

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'gpt-4o-mini',
  jobTitle: '',
  company: '',
  note: '',
  jobDescription: '',
  resumeText: '',
  resumeFileName: '',
  alwaysOnTop: true,
  stealth: true,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(cfg) {
  const merged = { ...readConfig(), ...cfg };
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

let mainWindow = null;
let tray = null;
let currentController = null; // AbortController for the in-flight OpenAI request
const ICON_PATH = () => path.join(__dirname, '..', 'assets', 'icon.png');

/* ---------------------- window helpers ------------------- */

// Bring the window to the front and focus it (works even when it's hidden
// behind other windows or was hidden via the hotkey/tray).
function summonWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  // Briefly force-top so it pops above the focused app, then relax to the
  // user's saved always-on-top preference.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.focus();
  if (!readConfig().alwaysOnTop) {
    setTimeout(() => { if (mainWindow) mainWindow.setAlwaysOnTop(false); }, 400);
  }
}

function toggleWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else summonWindow();
}

function applyAlwaysOnTop(value) {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(!!value, 'screen-saver');
  writeConfig({ alwaysOnTop: !!value });
}

function createTray() {
  if (tray) return;
  let img = nativeImage.createFromPath(ICON_PATH());
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Interview Copilot — click to show/hide');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide  (Ctrl+\\)', click: toggleWindow },
    { label: 'Bring to front', click: summonWindow },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: !!readConfig().alwaysOnTop,
      click: (item) => applyAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', summonWindow);
  tray.on('double-click', summonWindow);
}

function createWindow() {
  const cfg = readConfig();

  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1115',
    alwaysOnTop: !!cfg.alwaysOnTop,
    skipTaskbar: true,
    icon: ICON_PATH(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep timers/rendering running when unfocused
    },
  });

  // Hide the window from screen-share / screen-recording when stealth is on.
  // (Works on Windows and macOS; the window still shows on the local display.)
  mainWindow.setContentProtection(!!cfg.stealth);

  if (cfg.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Allow the renderer to capture system/loopback audio without an OS picker.
  // When the renderer calls getDisplayMedia, we auto-grant the primary screen
  // plus 'loopback' audio (what is playing through the speakers).
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });

  // Global hotkeys (work even when the app is in the background):
  //  - Ctrl+\        : show/hide toggle (brings to front when showing)
  //  - Ctrl+Shift+\  : always bring to front + focus (find it again)
  globalShortcut.register('CommandOrControl+\\', toggleWindow);
  globalShortcut.register('CommandOrControl+Shift+\\', summonWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------------- IPC: config ---------------------- */

ipcMain.handle('config:get', () => {
  const cfg = readConfig();
  const fromEnv = !!envApiKey();
  return {
    ...cfg,
    apiKey: fromEnv ? envApiKey() : cfg.apiKey,
    model: envModel() || cfg.model,
    apiKeyFromEnv: fromEnv,
    modelFromEnv: !!envModel(),
  };
});
// Never persist an env-provided key into config.json.
ipcMain.handle('config:set', (_e, cfg) => {
  const clean = { ...cfg };
  if (envApiKey()) delete clean.apiKey;
  return writeConfig(clean);
});

/* ---------------------- IPC: window controls ------------- */

ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('win:close', () => mainWindow && mainWindow.close());

ipcMain.handle('win:always-on-top', (_e, value) => applyAlwaysOnTop(value));

ipcMain.handle('win:stealth', (_e, value) => {
  if (!mainWindow) return;
  mainWindow.setContentProtection(!!value);
  writeConfig({ stealth: !!value });
});

/* ---------------------- IPC: resume PDF ------------------ */

ipcMain.handle('resume:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your resume (PDF)',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    if (!pdfParse) pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = (data.text || '').replace(/\n{3,}/g, '\n\n').trim();
    return { fileName: path.basename(filePath), text };
  } catch (err) {
    return { fileName: path.basename(filePath), text: '', error: String(err && err.message || err) };
  }
});

/* ---------------------- IPC: OpenAI transcription -------- */

ipcMain.handle('ai:transcribe', async (_e, audioBytes) => {
  const cfg = readConfig();
  const apiKey = envApiKey() || cfg.apiKey;
  if (!apiKey) return { error: 'No OpenAI API key set.' };

  try {
    const buf = Buffer.from(audioBytes);
    if (buf.length < 1200) return { text: '' }; // basically silence

    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', envTranscribeModel() || 'whisper-1');
    form.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { error: `Transcribe ${res.status}: ${t.slice(0, 200)}` };
    }
    const json = await res.json();
    return { text: (json.text || '').trim() };
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
});

/* ---------------------- IPC: OpenAI (ChatGPT) streaming -- */

ipcMain.on('ai:stop', () => {
  if (currentController) {
    try { currentController.abort(); } catch {}
    currentController = null;
  }
});

ipcMain.on('ai:ask', async (event, payload) => {
  const cfg = readConfig();
  const apiKey = envApiKey() || (payload && payload.apiKey) || cfg.apiKey;

  if (!apiKey) {
    event.sender.send('ai:error', 'No OpenAI API key found. Add OPENAI_API_KEY to your .env file (or paste a key in Setup).');
    return;
  }

  // Abort any previous request still streaming.
  if (currentController) {
    try { currentController.abort(); } catch {}
  }
  const controller = new AbortController();
  currentController = controller;

  // OpenAI puts the system prompt as the first message in the array.
  const messages = [];
  if (payload && payload.system) messages.push({ role: 'system', content: payload.system });
  if (payload && Array.isArray(payload.messages)) messages.push(...payload.messages);

  const body = {
    model: envModel() || (payload && payload.model) || cfg.model || 'gpt-4o-mini',
    max_tokens: (payload && payload.maxTokens) || 200,
    temperature: (payload && typeof payload.temperature === 'number') ? payload.temperature : 0.5,
    stream: true,
    messages,
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      event.sender.send('ai:error', `API ${res.status}: ${errText.slice(0, 500)}`);
      currentController = null;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop(); // keep the last partial line

      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && typeof delta.content === 'string' && delta.content) {
            event.sender.send('ai:chunk', delta.content);
          }
        } catch {
          /* ignore keep-alive / non-JSON lines */
        }
      }
    }

    event.sender.send('ai:done');
  } catch (err) {
    if (err && err.name === 'AbortError') {
      event.sender.send('ai:done');
    } else {
      event.sender.send('ai:error', String(err && err.message || err));
    }
  } finally {
    if (currentController === controller) currentController = null;
  }
});
