import { useState, useEffect } from 'react';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { t } from '../lib/i18n';

const STORAGE_KEY = 'setup_wizard_completed';

interface SetupWizardProps {
  onNavigateToSettings?: () => void;
  onClose: () => void;
}

const api = (window as any).electronAPI;

type InstallState = 'idle' | 'installing' | 'success' | 'error';

export default function SetupWizard({ onNavigateToSettings, onClose }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [ccxAvailable, setCcxAvailable] = useState(false);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [installMsg, setInstallMsg] = useState('');

  useEffect(() => {
    api?.plugin?.getCcxPath?.().then((p: string | null) => setCcxAvailable(!!p));
  }, []);

  function handleComplete() {
    localStorage.setItem(STORAGE_KEY, 'true');
    onClose();
  }

  function handleSkip() {
    localStorage.setItem(STORAGE_KEY, 'true');
    onClose();
  }

  function handleGoSettings() {
    localStorage.setItem(STORAGE_KEY, 'true');
    onClose();
    onNavigateToSettings?.();
  }

  async function handleInstallPlugin() {
    if (installState === 'installing') return;
    setInstallState('installing');
    setInstallMsg('');
    try {
      const result = await api.plugin.installToPS();
      if (result.success) {
        setInstallState('success');
        setInstallMsg(
          result.method === 'upia'
            ? t('set.plugin_installed_upia')
            : t('set.plugin_installed_shell'),
        );
      } else {
        setInstallState('error');
        setInstallMsg(result.error || t('set.plugin_install_failed'));
      }
    } catch (err: any) {
      setInstallState('error');
      setInstallMsg(err.message || t('set.plugin_install_failed'));
    }
  }

  const STEPS = [
    // Step 0 — Welcome
    () => (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <Icons.Layers size={28} color="#fff" />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          {t('onboard.welcome_title')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
          {t('onboard.welcome_desc')}
        </div>
      </div>
    ),

    // Step 1 — Install PS Plugin
    () => (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(0, 122, 255, 0.12)', border: '1px solid rgba(0, 122, 255, 0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px',
        }}>
          <Icons.Download size={22} color="var(--accent)" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          {t('onboard.step_plugin_title')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, maxWidth: 340, margin: '0 auto 16px' }}>
          {t('onboard.step_plugin_desc')}
        </div>

        {ccxAvailable ? (
          <div
            className="btn-press"
            onClick={handleInstallPlugin}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: installState === 'installing' ? 'default' : 'pointer',
              opacity: installState === 'installing' ? 0.6 : 1,
              background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
              color: '#fff', border: 'none',
            }}
          >
            <Icons.Download size={14} color="#fff" />
            {installState === 'installing' ? t('set.installing_plugin') : t('set.install_plugin')}
          </div>
        ) : (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            opacity: 0.5, color: 'var(--text3)',
            background: 'var(--glass-hover)', border: '1px solid var(--border)',
          }}>
            {t('set.plugin_not_found')}
          </div>
        )}

        {installMsg && (
          <div style={{
            marginTop: 10, fontSize: 11, lineHeight: 1.5,
            color: installState === 'success' ? 'var(--green)' : installState === 'error' ? 'var(--red)' : 'var(--text3)',
          }}>
            {installMsg}
            {installState === 'success' && (
              <div style={{ marginTop: 4, opacity: 0.7 }}>{t('set.plugin_restart_ps')}</div>
            )}
          </div>
        )}
      </div>
    ),

    // Step 2 — Configure Model Provider
    () => (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(0, 122, 255, 0.12)', border: '1px solid rgba(0, 122, 255, 0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 14px',
        }}>
          <Icons.Cpu size={22} color="var(--accent)" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          {t('onboard.step_provider_title')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, maxWidth: 340, margin: '0 auto 16px' }}>
          {t('onboard.step_provider_desc')}
        </div>
        <div
          className="btn-press"
          onClick={handleGoSettings}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: '#fff', border: 'none',
          }}
        >
          <Icons.Settings size={14} color="#fff" />
          {t('onboard.go_settings')}
        </div>
      </div>
    ),
  ];

  const totalSteps = STEPS.length;
  const isLast = step === totalSteps - 1;
  const StepContent = STEPS[step];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        className="anim-fade-in"
        style={{
          width: 420,
          maxWidth: '92vw',
          background: 'var(--glass2)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '32px 28px 24px',
          position: 'relative',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {/* Close button */}
        <div
          className="btn-press"
          onClick={handleSkip}
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 28, height: 28, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            background: 'var(--glass-hover)',
          }}
        >
          <Icons.X size={14} color="var(--text3)" />
        </div>

        {/* Step indicator dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step
                  ? 'var(--accent)'
                  : i < step
                    ? 'var(--accent)'
                    : 'var(--border)',
                opacity: i <= step ? 1 : 0.4,
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>

        {/* Step content */}
        <div style={{ minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <StepContent />
        </div>

        {/* Navigation buttons */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 24, paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <div>
            {step > 0 ? (
              <div
                className="btn-press"
                onClick={() => setStep(step - 1)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', color: 'var(--text3)',
                  background: 'var(--glass)', border: '1px solid var(--border)',
                }}
              >
                {t('onboard.prev')}
              </div>
            ) : (
              <div
                className="btn-press"
                onClick={handleSkip}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', color: 'var(--text3)',
                  background: 'transparent', border: 'none',
                }}
              >
                {t('onboard.skip')}
              </div>
            )}
          </div>

          <div>
            {isLast ? (
              <div
                className="btn-press"
                onClick={handleComplete}
                style={{
                  padding: '6px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', color: '#fff',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  border: 'none',
                }}
              >
                {t('onboard.done')}
              </div>
            ) : (
              <div
                className="btn-press"
                onClick={() => setStep(step + 1)}
                style={{
                  padding: '6px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', color: '#fff',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  border: 'none',
                }}
              >
                {t('onboard.next')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Check if the setup wizard has been completed before */
export function isSetupWizardCompleted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

/** Reset the setup wizard completion state so it shows again */
export function resetSetupWizard(): void {
  localStorage.removeItem(STORAGE_KEY);
}
