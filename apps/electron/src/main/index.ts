import { app, BrowserWindow, ipcMain, shell, session } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { DEFAULT_BACKEND_PORT, DEFAULT_BACKEND_HOST } from '@ai-retouch/shared';
let mainWindow: BrowserWindow | null = null;

// ─── Shared discovery file (for UXP plugin auto-detection) ──

function getAIRetouchDataDir(): string {
  const appData = process.env['APPDATA'] || join(require('os').homedir(), 'AppData', 'Roaming');
  return join(appData, 'AIRetouch');
}

function getDiscoveryPath(): string {
  return join(getAIRetouchDataDir(), 'discovery.json');
}

function writeDiscoveryFile(): void {
  try {
    const dir = getAIRetouchDataDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'discovery.json'), JSON.stringify({
      execPath: process.execPath,
      version: app.getVersion(),
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* non-critical */ }
}

function readLaunchPrefs(): 'v2' | 'classic' | null {
  try {
    const prefsPath = join(getAIRetouchDataDir(), 'launch-prefs.json');
    if (!existsSync(prefsPath)) return null;
    const data = JSON.parse(readFileSync(prefsPath, 'utf-8'));
    if (data?.layout === 'classic' || data?.layout === 'v2') return data.layout;
    return null;
  } catch {
    return null;
  }
}

// ─── Embedded backend server ─────────────────────────

const isDev = !!process.env['ELECTRON_RENDERER_URL'];
const MAX_RESTART_ATTEMPTS = 3;

let serverProcess: ChildProcess | null = null;
let serverRestartCount = 0;
let serverStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';

const MAX_LOG_LINES = 500;
const serverLogs: string[] = [];

function pushLog(line: string): void {
  const ts = new Date().toLocaleTimeString();
  const entry = `[${ts}] ${line}`;
  serverLogs.push(entry);
  if (serverLogs.length > MAX_LOG_LINES) serverLogs.shift();
  mainWindow?.webContents.send('backend:log', entry);
}

function getBackendPort(): number {
  const prefs = loadPrefs();
  return Number(prefs.backendPort) || DEFAULT_BACKEND_PORT;
}

function getBackendHost(): string {
  const prefs = loadPrefs();
  return (prefs.backendHost as string) || DEFAULT_BACKEND_HOST;
}

function getServerPath(): string {
  if (isDev) return '';
  return join(process.resourcesPath, 'server', 'dist', 'index.js');
}

function getDataDir(): string {
  return join(app.getPath('userData'), 'data');
}

function healthCheck(): Promise<boolean> {
  const port = getBackendPort();
  const host = getBackendHost();
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/api/health`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function startServer(): void {
  if (isDev) {
    pushLog('[Backend] Dev mode — assuming server is started externally');
    serverStatus = 'running';
    return;
  }

  const serverPath = getServerPath();
  pushLog(`[Backend] Server entry: ${serverPath}`);
  pushLog(`[Backend] Entry exists: ${existsSync(serverPath)}`);

  if (!existsSync(serverPath)) {
    pushLog(`[Backend] ERROR: Server entry not found!`);
    serverStatus = 'error';
    return;
  }

  serverStatus = 'starting';
  const dataDir = getDataDir();
  const port = getBackendPort();
  const host = getBackendHost();
  mkdirSync(dataDir, { recursive: true });

  pushLog(`[Backend] Starting on ${host}:${port}`);
  pushLog(`[Backend] Data directory: ${dataDir}`);
  pushLog(`[Backend] CWD: ${join(process.resourcesPath, 'server')}`);
  pushLog(`[Backend] execPath: ${process.execPath}`);

  try {
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AI_RETOUCH_DATA_DIR: dataDir,
        PORT: String(port),
        HOST: host,
        NODE_ENV: 'production',
      },
      cwd: join(process.resourcesPath, 'server'),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    pushLog(`[Backend] Process spawned, pid=${serverProcess.pid}`);
  } catch (err: any) {
    pushLog(`[Backend] FORK FAILED: ${err.message}`);
    serverStatus = 'error';
    return;
  }

  serverProcess.stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().trimEnd().split('\n')) {
      pushLog(`[Server] ${line}`);
    }
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().trimEnd().split('\n')) {
      pushLog(`[Server:err] ${line}`);
    }
  });

  serverProcess.on('error', (err) => {
    pushLog(`[Backend] Process error: ${err.message}`);
    serverStatus = 'error';
  });

  serverProcess.on('exit', (code, signal) => {
    pushLog(`[Backend] Server exited: code=${code} signal=${signal}`);
    serverProcess = null;

    if (serverStatus === 'stopped') return;

    if (serverRestartCount < MAX_RESTART_ATTEMPTS) {
      serverRestartCount++;
      pushLog(`[Backend] Restarting (attempt ${serverRestartCount}/${MAX_RESTART_ATTEMPTS})...`);
      setTimeout(() => startServer(), 1000);
    } else {
      serverStatus = 'error';
      pushLog('[Backend] Max restart attempts reached');
    }
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    serverStatus = 'stopped';
    if (!serverProcess) { resolve(); return; }

    const timeout = setTimeout(() => {
      console.log('[Backend] Force killing server...');
      serverProcess?.kill('SIGKILL');
      serverProcess = null;
      resolve();
    }, 5000);

    serverProcess.once('exit', () => {
      clearTimeout(timeout);
      serverProcess = null;
      resolve();
    });

    // Use IPC message for reliable shutdown on Windows;
    // SIGTERM doesn't trigger process.on('SIGTERM') on Windows.
    if (serverProcess.connected) {
      serverProcess.send({ type: 'shutdown' });
    } else {
      serverProcess.kill('SIGTERM');
    }
  });
}

async function restartServer(): Promise<{ success: boolean; port: number; host: string }> {
  pushLog('[Backend] Manual restart requested');
  await stopServer();
  serverRestartCount = 0;
  startServer();
  const ok = await waitForServer();
  if (ok) {
    serverStatus = 'running';
    serverRestartCount = 0;
    pushLog('[Backend] Restart successful');
  } else {
    pushLog('[Backend] Restart: server did not respond in time');
  }
  return { success: ok, port: getBackendPort(), host: getBackendHost() };
}

// ─── Simple preferences persistence ─────────────────

function getPrefsPath(): string {
  return join(app.getPath('userData'), 'preferences.json');
}

function loadPrefs(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(getPrefsPath(), 'utf-8')); } catch { return {}; }
}

function savePrefs(prefs: Record<string, unknown>): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(getPrefsPath(), JSON.stringify(prefs, null, 2));
  } catch { /* ignore */ }
}

const LAYOUT_SIZES = {
  classic: { width: 480, height: 860, minWidth: 400, minHeight: 600, bg: '#F2F2F7' },
  v2:      { width: 800, height: 900, minWidth: 600, minHeight: 600, bg: '#f2ece4' },
};

// ─── Always-on-top with PS focus detection ───────────

type PinMode = 'auto' | 'always' | 'never';
let pinMode: PinMode = (loadPrefs().pinMode as PinMode) || 'auto';
let focusPollTimer: ReturnType<typeof setInterval> | null = null;

const PS_PROCESS_NAMES = ['photoshop', 'adobe photoshop'];

function getForegroundProcessName(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(''); return; }
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class FGW {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        }
"@
      $hwnd = [FGW]::GetForegroundWindow()
      $pid = 0
      [void][FGW]::GetWindowThreadProcessId($hwnd, [ref]$pid)
      if ($pid -gt 0) { (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName }
    `;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2000 }, (err, stdout) => {
      if (err) { resolve(''); return; }
      resolve(stdout.trim().toLowerCase());
    });
  });
}

function setOnTop(flag: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (flag) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
}

function applyPinMode(): void {
  if (!mainWindow) return;
  if (pinMode === 'always') {
    setOnTop(true);
  } else if (pinMode === 'never') {
    setOnTop(false);
  }
}

let alwaysReassertTimer: ReturnType<typeof setInterval> | null = null;

function startAlwaysReassert(): void {
  stopAlwaysReassert();
  alwaysReassertTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (pinMode !== 'always') return;
    if (!mainWindow.isAlwaysOnTop()) {
      setOnTop(true);
    }
  }, 300);
}

function stopAlwaysReassert(): void {
  if (alwaysReassertTimer) {
    clearInterval(alwaysReassertTimer);
    alwaysReassertTimer = null;
  }
}

function startFocusPolling(): void {
  stopFocusPolling();
  if (process.platform !== 'win32') return;

  focusPollTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (pinMode !== 'auto') return;

    if (mainWindow.isFocused()) return;

    const fgName = await getForegroundProcessName();
    if (!fgName) return;

    const isPS = PS_PROCESS_NAMES.some((n) => fgName.includes(n));
    const currentlyOnTop = mainWindow.isAlwaysOnTop();

    if (isPS && !currentlyOnTop) {
      setOnTop(true);
    } else if (!isPS && currentlyOnTop) {
      setOnTop(false);
    }
  }, 600);
}

function stopFocusPolling(): void {
  if (focusPollTimer) {
    clearInterval(focusPollTimer);
    focusPollTimer = null;
  }
}

// ─── Window creation ─────────────────────────────────

function createWindow(): void {
  const cfg = LAYOUT_SIZES.v2;
  mainWindow = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    minWidth: cfg.minWidth,
    minHeight: cfg.minHeight,
    frame: false,
    backgroundColor: cfg.bg,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    applyPinMode();
    startFocusPolling();
    if (pinMode === 'always') startAlwaysReassert();
  });

  mainWindow.on('focus', () => {
    if (mainWindow && (pinMode === 'always' || pinMode === 'auto') && !mainWindow.isAlwaysOnTop()) {
      setOnTop(true);
    }
  });

  mainWindow.on('blur', () => {
    if (mainWindow && pinMode === 'always') {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && pinMode === 'always') {
          setOnTop(true);
        }
      }, 50);
    }
  });

  mainWindow.on('closed', () => {
    stopFocusPolling();
    stopAlwaysReassert();
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  const launchLayout = readLaunchPrefs();
  const layoutQuery = launchLayout ? `?preferLayout=${launchLayout}` : '';

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + layoutQuery);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: launchLayout ? { preferLayout: launchLayout } : undefined,
    });
  }
}

// ─── App lifecycle ───────────────────────────────────

app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });

  writeDiscoveryFile();

  // Start embedded backend
  startServer();
  if (!isDev) {
    const ok = await waitForServer();
    if (ok) {
      serverStatus = 'running';
      serverRestartCount = 0;
      pushLog('[Backend] Server is ready');
    } else {
      pushLog('[Backend] Server did not respond to health check in time');
    }
  }

  // Window control IPC
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:setLayoutSize', (_event, layout: 'classic' | 'v2') => {
    if (!mainWindow) return;
    const cfg = LAYOUT_SIZES[layout] ?? LAYOUT_SIZES.v2;
    mainWindow.setMinimumSize(cfg.minWidth, cfg.minHeight);
    mainWindow.setSize(cfg.width, cfg.height);
    mainWindow.center();
  });

  // Pin mode IPC
  ipcMain.handle('pin:getMode', () => pinMode);
  ipcMain.handle('pin:setMode', (_event, mode: PinMode) => {
    if (!['auto', 'always', 'never'].includes(mode)) return;
    pinMode = mode;
    applyPinMode();
    if (mode === 'auto') {
      startFocusPolling();
      stopAlwaysReassert();
    } else if (mode === 'always') {
      startAlwaysReassert();
    } else {
      stopAlwaysReassert();
    }
    const prefs = loadPrefs();
    prefs.pinMode = mode;
    savePrefs(prefs);
  });

  // Backend IPC
  ipcMain.handle('backend:getStatus', () => serverStatus);
  ipcMain.handle('backend:getPort', () => getBackendPort());
  ipcMain.handle('backend:getHost', () => getBackendHost());
  ipcMain.handle('backend:restart', async () => restartServer());
  ipcMain.handle('backend:setPortHost', (_event, port: number, host: string) => {
    const prefs = loadPrefs();
    prefs.backendPort = port;
    prefs.backendHost = host;
    savePrefs(prefs);
  });
  ipcMain.handle('backend:getLogs', () => [...serverLogs]);

  // ─── PS Plugin installation IPC ──────────────────────

  ipcMain.handle('plugin:getCcxPath', () => {
    const ccxPath = isDev
      ? join(__dirname, '..', '..', '..', '..', '..', 'apps', 'plugin', 'release', 'ai-retouch-plugin.ccx')
      : join(process.resourcesPath, 'plugin', 'ai-retouch-plugin.ccx');
    return existsSync(ccxPath) ? ccxPath : null;
  });

  ipcMain.handle('plugin:installToPS', async () => {
    const ccxPath = isDev
      ? join(__dirname, '..', '..', '..', '..', '..', 'apps', 'plugin', 'release', 'ai-retouch-plugin.ccx')
      : join(process.resourcesPath, 'plugin', 'ai-retouch-plugin.ccx');

    if (!existsSync(ccxPath)) {
      return { success: false, method: 'none', error: 'CCX file not found' };
    }

    // Try UPIA first (silent install via Adobe's command-line tool)
    const upiaPath = join(
      process.env['COMMONPROGRAMFILES'] || 'C:\\Program Files\\Common Files',
      'Adobe', 'Adobe Desktop Common', 'RemoteComponents', 'UPI',
      'UnifiedPluginInstallerAgent', 'UnifiedPluginInstallerAgent.exe',
    );

    if (existsSync(upiaPath)) {
      try {
        const result = await new Promise<{ success: boolean; stdout: string; stderr: string }>((resolve) => {
          execFile(upiaPath, ['/install', ccxPath], { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
              resolve({ success: false, stdout, stderr: stderr || err.message });
            } else {
              resolve({ success: true, stdout, stderr });
            }
          });
        });

        if (result.success && !result.stdout.includes('Failed')) {
          writeDiscoveryFile();
          return { success: true, method: 'upia', message: result.stdout.trim() };
        }
        // UPIA returned error in stdout or non-zero exit
        console.log('[Plugin] UPIA failed, falling back to shell.openPath:', result.stdout || result.stderr);
      } catch {
        // UPIA threw — fall through
      }
    }

    // Fallback: copy .ccx to a user-friendly temp location and open it
    // (double-click triggers Creative Cloud installation dialog)
    const tempCcx = join(app.getPath('temp'), 'ai-retouch-plugin.ccx');
    try {
      copyFileSync(ccxPath, tempCcx);
      const openResult = await shell.openPath(tempCcx);
      if (openResult) {
        return { success: false, method: 'shell', error: openResult };
      }
      return { success: true, method: 'shell' };
    } catch (err: any) {
      return { success: false, method: 'shell', error: err.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopFocusPolling();
  stopAlwaysReassert();
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;

app.on('will-quit', async (e) => {
  if (isQuitting) return;
  if (serverProcess) {
    isQuitting = true;
    e.preventDefault();
    await stopServer();
    app.quit();
  }
});
