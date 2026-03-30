import { useEffect, useState } from 'react';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { t } from '../../lib/i18n';

const api = (window as any).electronAPI;

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

type InstallState = 'idle' | 'installing' | 'success' | 'error';

export default function PluginInstallSection() {
  const [ccxAvailable, setCcxAvailable] = useState(false);
  const [state, setState] = useState<InstallState>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api?.plugin?.getCcxPath?.().then((p: string | null) => setCcxAvailable(!!p));
  }, []);

  async function handleInstall() {
    if (state === 'installing') return;
    setState('installing');
    setMessage('');

    try {
      const result = await api.plugin.installToPS();
      if (result.success) {
        setState('success');
        setMessage(
          result.method === 'upia'
            ? t('set.plugin_installed_upia')
            : t('set.plugin_installed_shell'),
        );
      } else {
        setState('error');
        setMessage(result.error || t('set.plugin_install_failed'));
      }
    } catch (err: any) {
      setState('error');
      setMessage(err.message || t('set.plugin_install_failed'));
    }

    setTimeout(() => {
      setState((s) => (s === 'installing' ? 'idle' : s));
    }, 8000);
  }

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    cursor: state === 'installing' ? 'default' : 'pointer',
    opacity: state === 'installing' ? 0.6 : 1,
    background: 'rgba(0, 122, 255, 0.10)',
    border: '1px solid rgba(0, 122, 255, 0.25)',
    color: 'var(--accent, #007AFF)',
    transition: 'all 0.2s ease',
  };

  const msgColor =
    state === 'success' ? 'var(--green)' :
    state === 'error' ? 'var(--red)' :
    'var(--text3)';

  return (
    <div style={{ ...glass, padding: 14 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text2)',
        marginBottom: 10, letterSpacing: 0.5,
      }}>
        {t('set.ps_plugin')}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>
        {t('set.install_plugin_desc')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ccxAvailable ? (
          <div className="btn-press" onClick={handleInstall} style={btnStyle}>
            <Icons.Download color="var(--accent, #007AFF)" size={13} />
            {state === 'installing' ? t('set.installing_plugin') : t('set.install_plugin')}
          </div>
        ) : (
          <div style={{
            ...btnStyle,
            opacity: 0.4,
            cursor: 'not-allowed',
            background: 'var(--glass-hover)',
            border: '1px solid var(--border)',
            color: 'var(--text3)',
          }}>
            {t('set.plugin_not_found')}
          </div>
        )}
      </div>

      {message && (
        <div style={{ marginTop: 8, fontSize: 11, color: msgColor, lineHeight: 1.5 }}>
          {message}
          {state === 'success' && (
            <div style={{ marginTop: 4, opacity: 0.7 }}>
              {t('set.plugin_restart_ps')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
