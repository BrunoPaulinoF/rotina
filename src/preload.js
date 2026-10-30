'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['status', 'config', 'alert', 'alert:dismiss', 'navigate', 'audio:play', 'popup:data', 'update', 'history', 'summary:data']);

contextBridge.exposeInMainWorld('rotina', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getDayPlan: (dateKey) => ipcRenderer.invoke('plan:day', dateKey),
  getWeek: (dateKey) => ipcRenderer.invoke('plan:week', dateKey),
  info: () => ipcRenderer.invoke('app:info'),
  action: (name, payload) => ipcRenderer.invoke('action', name, payload),
  on: (channel, callback) => {
    if (!CHANNELS.has(channel)) throw new Error('Canal não permitido: ' + channel);
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
