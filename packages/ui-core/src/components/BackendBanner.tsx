import { useBackendStatus, useRetryCountdown } from '../hooks/useBackendConnection';
import { useSpinner } from '../hooks/useAnimations';
import { t } from '../i18n/setup';

interface BackendBannerProps {
  variant?: 'classic' | 'v2';
}

/* Shared wrapper style — fixed overlay just below the titlebar */
const wrapperBase: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  display: 'flex',
  justifyContent: 'center',
  padding: '8px 16px 0',
  zIndex: 50,
  pointerEvents: 'none',
};

export default function BackendBanner({ variant = 'v2' }: BackendBannerProps) {
  const backendStatus = useBackendStatus();
  const retryCountdown = useRetryCountdown();
  const spinner = useSpinner();

  if (backendStatus === 'connected') return null;

  const isChecking = backendStatus === 'checking';

  if (variant === 'v2') {
    return (
      <div style={{ ...wrapperBase, top: 'var(--titlebar-h, 38px)' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 16px',
          borderRadius: 20,
          fontSize: 12,
          lineHeight: 1.4,
          border: `1px solid ${isChecking ? 'rgba(255,180,60,0.30)' : 'rgba(220,60,60,0.30)'}`,
          background: isChecking ? 'rgba(255,180,60,0.08)' : 'rgba(220,60,60,0.08)',
          color: isChecking ? 'var(--warning, rgba(255,200,100,0.95))' : 'var(--error, rgba(255,130,130,0.95))',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
        }}>
          {isChecking && (
            <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{spinner}</span>
          )}
          <span>
            {isChecking ? t('chat.backend_checking') : t('chat.backend_disconnected')}
          </span>
          {!isChecking && retryCountdown !== null && (
            <span style={{ opacity: 0.7 }}>
              {`${retryCountdown}${t('chat.backend_retry')}`}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* classic variant */
  return (
    <div style={{
      ...wrapperBase,
      top: 'calc(var(--titlebar-h, 42px) + var(--tab-nav-h, 46px))',
    }}>
      <div style={{
        borderRadius: 10,
        border: `1px solid ${isChecking ? 'rgba(255,180,60,0.35)' : 'rgba(220,60,60,0.35)'}`,
        background: isChecking ? 'rgba(255,180,60,0.10)' : 'rgba(220,60,60,0.12)',
        color: isChecking ? 'rgba(255,200,100,0.95)' : 'rgba(255,130,130,0.95)',
        fontSize: 11,
        lineHeight: 1.4,
        padding: '8px 12px',
        pointerEvents: 'auto',
      }}>
        {isChecking && (
          <span style={{ marginRight: 6, fontSize: 13 }}>{spinner}</span>
        )}
        {isChecking ? t('chat.backend_checking') : t('chat.backend_disconnected')}
        {!isChecking && retryCountdown !== null && (
          <span style={{ marginLeft: 6, opacity: 0.75 }}>
            {`${retryCountdown}${t('chat.backend_retry')}`}
          </span>
        )}
      </div>
    </div>
  );
}
