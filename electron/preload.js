'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),

  // resume
  pickResume: () => ipcRenderer.invoke('resume:pick'),

  // audio transcription (Whisper)
  transcribe: (audioBytes) => ipcRenderer.invoke('ai:transcribe', audioBytes),

  // window controls
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:always-on-top', v),
  setStealth: (v) => ipcRenderer.invoke('win:stealth', v),

  // OpenAI (ChatGPT) streaming
  ask: (payload) => ipcRenderer.send('ai:ask', payload),
  stop: () => ipcRenderer.send('ai:stop'),
  onChunk: (cb) => ipcRenderer.on('ai:chunk', (_e, t) => cb(t)),
  onDone: (cb) => ipcRenderer.on('ai:done', () => cb()),
  onError: (cb) => ipcRenderer.on('ai:error', (_e, t) => cb(t)),
});
