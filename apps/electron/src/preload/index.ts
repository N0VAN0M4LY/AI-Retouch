import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setLayoutSize: (layout: 'classic' | 'v2') => ipcRenderer.invoke('window:setLayoutSize', layout),
  },
  pin: {
    getMode: () => ipcRenderer.invoke('pin:getMode') as Promise<'auto' | 'always' | 'never'>,
    setMode: (mode: 'auto' | 'always' | 'never') => ipcRenderer.invoke('pin:setMode', mode),
  },
  backend: {
    getStatus: () => ipcRenderer.invoke('backend:getStatus') as Promise<string>,
    getPort: () => ipcRenderer.invoke('backend:getPort') as Promise<number>,
    getHost: () => ipcRenderer.invoke('backend:getHost') as Promise<string>,
    restart: () => ipcRenderer.invoke('backend:restart') as Promise<{ success: boolean; port: number; host: string }>,
    setPortHost: (port: number, host: string) => ipcRenderer.invoke('backend:setPortHost', port, host),
    getLogs: () => ipcRenderer.invoke('backend:getLogs') as Promise<string[]>,
    onLog: (callback: (line: string) => void) => {
      const handler = (_event: any, line: string) => callback(line);
      ipcRenderer.on('backend:log', handler);
      return () => ipcRenderer.removeListener('backend:log', handler);
    },
  },
  plugin: {
    getCcxPath: () => ipcRenderer.invoke('plugin:getCcxPath') as Promise<string | null>,
    installToPS: () => ipcRenderer.invoke('plugin:installToPS') as Promise<{
      success: boolean;
      method: string;
      message?: string;
      error?: string;
    }>,
  },
});
