import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT } from '@ai-retouch/shared';

import * as Icons from '../../components/Icons';
import { fetchBackendHealth } from '../../api/health';
import { fetchBridgeStatus } from '../../api/bridge';
import { testComfyUIConnection } from '../../api/comfyui';
import { putSetting } from '../../api/settings';
import { getBaseUrl, setBaseUrl } from '../../api/baseUrl';
import { t } from '../../i18n/setup';

type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'fail';

const api = (window as any).electronAPI;

const T = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  green: 'var(--green)',
  red: 'var(--red)',
  orange: 'var(--orange, #f5a623)',
  border: 'var(--border)',
  glass2: 'var(--glass-hover)',
};

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

const btnSuccess: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'rgba(52,199,89,0.10)',
  border: '1px solid rgba(52,199,89,0.25)',
  color: 'var(--green)',
  cursor: 'pointer',
};

const btnWarning: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'rgba(245,166,35,0.10)',
  border: '1px solid rgba(245,166,35,0.25)',
  color: T.orange,
  cursor: 'pointer',
};

const btnMuted: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--glass-hover)',
  border: '1px solid var(--border)',
  color: 'var(--text3)',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--glass-inset)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 8px',
  color: 'var(--text)',
  outline: 'none',
  fontSize: 12,
};

export default function ConnectionSection() {
  const [backendAddr, setBackendAddr] = useState(getBaseUrl().replace(/^https?:\/\//, ''));
  const [comfyAddr, setComfyAddr] = useState('localhost:8188');
  const [backendStatus, setBackendStatus] = useState<ConnectionStatus>('idle');
  const [bridgeStatus, setBridgeStatus] = useState<ConnectionStatus>('idle');
  const [bridgeClients, setBridgeClients] = useState(0);
  const [comfyStatus, setComfyStatus] = useState<ConnectionStatus>('idle');
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!(window as any).electronAPI?.backend?.getLogs) return;
    (window as any).electronAPI.backend.getLogs().then((initial: string[]) => setLogs(initial));
    const unsub = (window as any).electronAPI.backend.onLog?.((line: string) => {
      setLogs((prev: string[]) => {
        const next = [...prev, line];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, showLogs]);

  const checkBridge = useCallback(async () => {
    try {
      const s = await fetchBridgeStatus();
      setBridgeStatus(s.uxpConnected ? 'ok' : 'fail');
      setBridgeClients(s.clientCount);
    } catch {
      setBridgeStatus('fail');
      setBridgeClients(0);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if ((window as any).electronAPI?.backend) {
        const [port, host] = await Promise.all([
          (window as any).electronAPI.backend.getPort(),
          (window as any).electronAPI.backend.getHost(),
        ]);
        const addr = `${host}:${port}`;
        setBackendAddr(addr);
        setBaseUrl(`http://${addr}`);
      }
      testBackend();
    })();
    checkBridge();
    const timer = setInterval(checkBridge, 5000);
    return () => clearInterval(timer);
  }, [checkBridge]);

  async function testBackend() {
    setBackendStatus('testing');
    try {
      const url = backendAddr.startsWith('http') ? backendAddr : `http://${backendAddr}`;
      await fetchBackendHealth(url);
      setBaseUrl(url);
      setBackendStatus('ok');
    } catch {
      setBackendStatus('fail');
    }
  }

  async function testComfy() {
    setComfyStatus('testing');
    try {
      await putSetting('comfyui_address', comfyAddr);
      const status = await testComfyUIConnection();
      setComfyStatus(status.state === 'connected' ? 'ok' : 'fail');
    } catch {
      setComfyStatus('fail');
    }
  }

  async function handleSave() {
    const url = backendAddr.startsWith('http') ? backendAddr : `http://${backendAddr}`;
    setBaseUrl(url);

    if ((window as any).electronAPI?.backend) {
      const parts = backendAddr.replace(/^https?:\/\//, '').split(':');
      const host = parts[0] || DEFAULT_BACKEND_HOST;
      const port = Number(parts[1]) || DEFAULT_BACKEND_PORT;
      await (window as any).electronAPI.backend.setPortHost(port, host);
    }

    try {
      await putSetting('backend_address', backendAddr);
      await putSetting('comfyui_address', comfyAddr);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // backend may not be reachable
    }
  }

  async function handleRestart() {
    if (!(window as any).electronAPI?.backend?.restart || restarting) return;
    setRestarting(true);
    setBackendStatus('testing');
    try {
      const result = await (window as any).electronAPI.backend.restart();
      if (result.success) {
        const addr = `${result.host}:${result.port}`;
        setBackendAddr(addr);
        setBaseUrl(`http://${addr}`);
        setBackendStatus('ok');
      } else {
        setBackendStatus('fail');
      }
    } catch {
      setBackendStatus('fail');
    } finally {
      setRestarting(false);
    }
  }

  function handleResetDefault() {
    const addr = `${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;
    setBackendAddr(addr);
  }

  function statusBadge(status: ConnectionStatus) {
    const color =
      status === 'ok' ? T.green
      : status === 'fail' ? T.red
      : T.text3;
    const label =
      status === 'testing' ? t('set.testing')
      : status === 'ok' ? t('set.connected')
      : status === 'fail' ? t('set.fail')
      : t('set.idle');

    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 6,
        fontSize: 10,
        background: status === 'ok' ? 'rgba(52,199,89,0.12)' : status === 'fail' ? 'rgba(255,59,48,0.12)' : T.glass2,
        border: `1px solid ${status === 'ok' ? 'rgba(52,199,89,0.25)' : status === 'fail' ? 'rgba(255,59,48,0.25)' : T.border}`,
        color,
      }}>
        <span style={{ marginRight: 4, display: 'flex' }}><Icons.Dot color={color} /></span> {label}
      </div>
    );
  }

  return (
    <div style={{ ...glass, padding: 14 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: T.text2,
        marginBottom: 10, letterSpacing: 0.5,
      }}>
        {t('set.connection')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: T.text3, width: 80, flexShrink: 0, marginRight: 8 }}>
            {t('set.backend')}
          </span>
          <input
            value={backendAddr}
            onChange={(e) => setBackendAddr(e.target.value)}
            placeholder={`${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`}
            style={{ ...inputStyle, flex: 1, minWidth: 0, marginRight: 8 }}
          />
          <div
            className="btn-press"
            onClick={testBackend}
            style={{ ...btnSuccess, padding: '4px 10px', fontSize: 10 }}
          >
            {t('set.test')}
          </div>
          <span style={{ marginLeft: 8 }}>{statusBadge(backendStatus)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: T.text3, width: 80, flexShrink: 0, marginRight: 8 }}>
            {t('set.ps_bridge')}
          </span>
          <div style={{ flex: 1, minWidth: 0, marginRight: 8, fontSize: 11, color: T.text3 }}>
            {bridgeStatus === 'ok'
              ? t('set.bridge_uxp_connected')
              : t('set.bridge_uxp_disconnected')}
          </div>
          <div
            onClick={checkBridge}
            style={{ ...btnSuccess, padding: '4px 10px', fontSize: 10 }}
          >
            {t('refresh')}
          </div>
          <span style={{ marginLeft: 8 }}>
            {statusBadge(bridgeStatus)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: T.text3, width: 80, flexShrink: 0, marginRight: 8 }}>
            {t('set.comfyui')}
          </span>
          <input
            value={comfyAddr}
            onChange={(e) => setComfyAddr(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 0, marginRight: 8 }}
          />
          <div
            className="btn-press"
            onClick={testComfy}
            style={{ ...btnSuccess, padding: '4px 10px', fontSize: 10 }}
          >
            {t('set.test')}
          </div>
          <span style={{ marginLeft: 8 }}>{statusBadge(comfyStatus)}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <div
            className="btn-press"
            onClick={handleResetDefault}
            style={{ ...btnMuted, padding: '5px 12px', fontSize: 11 }}
          >
            {t('set.reset_default')}
          </div>
          {(window as any).electronAPI?.backend?.restart && (
            <div
              className="btn-press"
              onClick={handleRestart}
              style={{ ...btnWarning, padding: '5px 12px', fontSize: 11, opacity: restarting ? 0.6 : 1 }}
            >
              {restarting ? t('set.restarting') : t('set.restart_backend')}
            </div>
          )}
          <div
            className="btn-press"
            onClick={handleSave}
            style={{ ...btnSuccess, padding: '5px 16px', fontSize: 11, fontWeight: 500 }}
          >
            <span style={{ marginRight: 4, display: 'flex' }}><Icons.Check color={T.green} /></span>
            {saved ? t('set.saved') : t('set.save')}
          </div>
        </div>

        {(window as any).electronAPI?.backend?.getLogs && (
          <div style={{ marginTop: 10 }}>
            <div
              className="btn-press"
              onClick={() => setShowLogs(!showLogs)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: T.text3, cursor: 'pointer',
                padding: '4px 0', userSelect: 'none',
              }}
            >
              <span style={{ transform: showLogs ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-flex' }}>
                ▶
              </span>
              {t('set.server_log')}
              <span style={{ fontSize: 10, opacity: 0.6 }}>({logs.length})</span>
            </div>
            {showLogs && (
              <div style={{
                marginTop: 6,
                background: 'var(--glass-inset)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
                minHeight: 100,
                maxHeight: 500,
                overflowY: 'auto',
                fontFamily: 'Consolas, "Courier New", monospace',
                fontSize: 10,
                lineHeight: 1.6,
                color: T.text3,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {logs.length === 0 ? (
                  <span style={{ opacity: 0.5 }}>{t('set.no_logs')}</span>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} style={{
                      color: line.includes('ERROR') || line.includes('err]') ? T.red
                        : line.includes('ready') || line.includes('successful') ? T.green
                        : T.text3,
                    }}>
                      {line}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
