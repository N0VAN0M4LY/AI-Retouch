import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { glass, T } from '../../lib/theme';
import { fetchAppInfo } from '../../lib/backend';
import { useBackendStatus } from '../../lib/backendConnection';

const STORAGE_KEY = 'ai_retouch_app_exe_path';

function getAIRetouchDir(): { dirUrl: string; sep: string } | null {
  const os = (globalThis as any).require?.('os');
  if (!os?.homedir) return null;
  const home: string = os.homedir();
  const sep = home.includes('\\') ? '\\' : '/';
  const dir =
    sep === '\\'
      ? `${home}${sep}AppData${sep}Roaming${sep}AIRetouch`
      : `${home}/Library/Application Support/AIRetouch`;
  return { dirUrl: 'file:/' + dir.replace(/\\/g, '/'), sep };
}

async function readDiscoveryFile(): Promise<string | null> {
  try {
    const uxpModule = (globalThis as any).require?.('uxp');
    const fs = uxpModule?.storage?.localFileSystem;
    const info = getAIRetouchDir();
    if (!info || !fs?.getEntryWithUrl) return null;

    const entry = await fs.getEntryWithUrl(`${info.dirUrl}/discovery.json`);
    const content = await entry.read({ format: uxpModule.storage.formats.utf8 });
    const data = JSON.parse(content);
    return data?.execPath || null;
  } catch {
    return null;
  }
}

async function writeLaunchPrefs(layout: 'v2' | 'classic'): Promise<void> {
  try {
    const uxpModule = (globalThis as any).require?.('uxp');
    const fs = uxpModule?.storage?.localFileSystem;
    const info = getAIRetouchDir();
    if (!info || !fs?.getEntryWithUrl) return;

    const dirEntry = await fs.getEntryWithUrl(info.dirUrl);
    const file = await dirEntry.createFile('launch-prefs.json', { overwrite: true });
    await file.write(JSON.stringify({ layout, updatedAt: new Date().toISOString() }), {
      format: uxpModule.storage.formats.utf8,
    });
  } catch {
    // non-critical
  }
}

interface Props {
  onSwitchToLauncher?: () => void;
  compact?: boolean;
}

export default function ActionsSection({ onSwitchToLauncher, compact }: Props) {
  const { t } = useTranslation();
  const backendStatus = useBackendStatus();
  const isConnected = backendStatus === 'connected';

  const [appPath, setAppPath] = useState('');
  const [showPathEdit, setShowPathEdit] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setAppPath(saved);
      return;
    }
    readDiscoveryFile().then((path) => {
      if (path) {
        setAppPath(path);
        localStorage.setItem(STORAGE_KEY, path);
      }
    });
  }, []);

  useEffect(() => {
    if (!isConnected || appPath) return;
    autoDetect();
  }, [isConnected]);

  async function autoDetect() {
    setDetecting(true);
    try {
      const info = await fetchAppInfo();
      if (info.execPath && info.execPath.endsWith('.exe')) {
        setAppPath(info.execPath);
        localStorage.setItem(STORAGE_KEY, info.execPath);
        setDetecting(false);
        return;
      }
    } catch { /* backend not reachable */ }

    const discovered = await readDiscoveryFile();
    if (discovered) {
      setAppPath(discovered);
      localStorage.setItem(STORAGE_KEY, discovered);
    }
    setDetecting(false);
  }

  function savePath(value?: string) {
    const pathToSave = value ?? appPath;
    if (pathToSave) {
      localStorage.setItem(STORAGE_KEY, pathToSave);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async function browseFile() {
    try {
      const uxpModule = (globalThis as any).require?.('uxp');
      const storage = uxpModule?.storage;
      const fs = storage?.localFileSystem;
      if (!fs?.getFileForOpening) {
        setLaunchError('File picker not available in this UXP version');
        setTimeout(() => setLaunchError(null), 3000);
        return;
      }
      const file = await fs.getFileForOpening({ types: storage.fileTypes?.all ?? ['*'] });
      if (file?.nativePath) {
        setAppPath(file.nativePath);
        savePath(file.nativePath);
      }
    } catch (err: any) {
      if (err?.message?.includes('cancel') || err?.message?.includes('Cancel')) return;
      setLaunchError(err?.message || String(err));
      setTimeout(() => setLaunchError(null), 3000);
    }
  }

  async function launchApp(layout: 'v2' | 'classic') {
    if (!appPath) {
      setShowPathEdit(true);
      setLaunchError(t('settings.actions.path_empty_hint'));
      setTimeout(() => setLaunchError(null), 3000);
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      const uxp = (globalThis as any).require?.('uxp');
      const shell = uxp?.shell;
      if (!shell?.openPath) throw new Error('UXP shell.openPath not available');

      await writeLaunchPrefs(layout);

      const errMsg: string = await shell.openPath(appPath);
      if (errMsg) throw new Error(errMsg);
    } catch (err: any) {
      setLaunchError(err?.message || String(err));
      setTimeout(() => setLaunchError(null), 5000);
    }
    setTimeout(() => setLaunching(false), 2000);
  }

  const launchBtnStyle = (primary: boolean, disabled: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '9px 12px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    background: primary ? 'rgba(108,138,255,0.12)' : T.glass2,
    border: `1px solid ${primary ? 'rgba(108,138,255,0.3)' : T.border}`,
    color: primary ? T.accent : T.text2,
  });

  return (
    <div style={{ ...glass, padding: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, letterSpacing: 0.5 }}>
          {t('settings.actions.title')}
        </div>
        {isConnected && (
          <span style={{ fontSize: 10, color: T.green, display: 'flex', alignItems: 'center' }}>
            <Icons.Dot color={T.green} />
            <span style={{ marginLeft: 2 }}>{t('settings.actions.running')}</span>
          </span>
        )}
      </div>

      {/* v1 / v2 launch buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div
          onClick={() => !launching && launchApp('v2')}
          style={launchBtnStyle(true, launching)}
        >
          <Icons.Maximize color={launching ? T.text3 : T.accent} size={13} />
          <span style={{ marginLeft: 6 }}>
            {launching ? t('settings.actions.launching') : t('settings.actions.launch_v2')}
          </span>
        </div>
        <div
          onClick={() => !launching && launchApp('classic')}
          style={launchBtnStyle(false, launching)}
        >
          <Icons.Minimize color={launching ? T.text3 : T.text2} size={13} />
          <span style={{ marginLeft: 6 }}>
            {t('settings.actions.launch_v1')}
          </span>
        </div>
      </div>

      {launchError && (
        <div style={{
          fontSize: 10, color: T.red, marginBottom: 6,
          padding: '4px 8px', borderRadius: 4,
          background: 'rgba(255,107,107,0.08)',
        }}>
          {launchError}
        </div>
      )}

      {/* Switch to launcher (only in full panel) */}
      {!compact && onSwitchToLauncher && (
        <div
          onClick={() => onSwitchToLauncher()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 500,
            cursor: 'pointer', background: T.glass2,
            border: `1px solid ${T.border}`, color: T.text3, marginBottom: 8,
          }}
        >
          <Icons.Minimize color={T.orange} size={13} />
          <span style={{ marginLeft: 6 }}>{t('settings.actions.switch_launcher')}</span>
        </div>
      )}

      {/* Path configuration toggle */}
      <div
        onClick={() => setShowPathEdit(!showPathEdit)}
        style={{
          display: 'flex', alignItems: 'center', cursor: 'pointer',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: 10, color: T.text3 }}>
          {t('settings.actions.configure_paths')}
        </span>
        <span style={{ marginLeft: 4, display: 'flex' }}>
          {showPathEdit
            ? <Icons.ChevronUp color={T.text3} size={10} />
            : <Icons.ChevronDown color={T.text3} size={10} />}
        </span>
      </div>

      {showPathEdit && (
        <div style={{ marginTop: 6 }}>
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>
              {t('settings.actions.app_path')}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={appPath}
                onChange={(e) => setAppPath(e.target.value)}
                onBlur={() => savePath()}
                placeholder={t('settings.actions.path_placeholder')}
                style={{ fontSize: 11, flex: 1, minWidth: 0 }}
              />
              <div
                onClick={browseFile}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '4px 8px', borderRadius: 6,
                  background: T.glass2, border: `1px solid ${T.border}`,
                  color: T.text3, cursor: 'pointer', fontSize: 10, flexShrink: 0,
                }}
              >
                {t('settings.actions.browse')}
              </div>
              <div
                onClick={autoDetect}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '4px 8px', borderRadius: 6,
                  background: isConnected ? 'rgba(61,214,140,0.08)' : T.glass2,
                  border: `1px solid ${isConnected ? 'rgba(61,214,140,0.25)' : T.border}`,
                  color: isConnected ? T.green : T.text3,
                  cursor: isConnected ? 'pointer' : 'default',
                  opacity: isConnected ? 1 : 0.4,
                  fontSize: 10, flexShrink: 0,
                }}
              >
                {detecting ? '...' : t('settings.actions.auto_detect')}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: T.text3, lineHeight: 1.4 }}>
            {t('settings.actions.path_hint')}
          </div>
        </div>
      )}
    </div>
  );
}
