import * as Icons from '../../components/Icons';
import { t } from '../../i18n/setup';
import type { ThemeMode } from '../../theme/useTheme';
import ConnectionSection from './ConnectionSection';
import ImageQualitySection from './ImageQualitySection';
import ProviderSection from './ProviderSection';

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

interface Props {
  onProvidersChanged?: () => void;
  themeMode?: ThemeMode;
  onThemeChange?: (mode: ThemeMode) => void;
  onOpenSetupWizard?: () => void;
  extraSections?: React.ReactNode;
}

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'set.theme_light' },
  { value: 'dark', labelKey: 'set.theme_dark' },
  { value: 'system', labelKey: 'set.theme_system' },
];

export default function SettingsMain({ onProvidersChanged, themeMode = 'light', onThemeChange, onOpenSetupWizard, extraSections }: Props) {
  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: 14,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, flexShrink: 0, color: 'var(--text)' }}>
        {t('set.title')}
      </div>

      {/* Theme */}
      <div style={{ ...glass, padding: '12px 14px', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: 8, display: 'flex' }}>
              <Icons.Eye color="var(--text3)" size={14} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{t('set.theme')}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.value;
              return (
                <div
                  key={opt.value}
                  onClick={() => onThemeChange?.(opt.value)}
                  className="btn-press"
                  style={{
                    padding: '4px 12px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    background: active ? 'var(--pill-active-bg)' : 'var(--pill-bg)',
                    border: `1px solid ${active ? 'var(--pill-active-border)' : 'var(--pill-border)'}`,
                    color: active ? 'var(--accent)' : 'var(--text3)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {t(opt.labelKey)}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Layout switch */}
      <div style={{ ...glass, padding: '12px 14px', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: 8, display: 'flex' }}>
              <Icons.Maximize color="var(--text3)" size={14} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{t('v2.layout')}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{
              padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'default',
              background: 'var(--pill-active-bg)', border: '1px solid var(--pill-active-border)', color: 'var(--accent)',
            }}>{t('v2.layout_classic')}</div>
            <div
              onClick={async () => {
                localStorage.setItem('ui-layout', 'v2');
                await (window as any).electronAPI?.window?.setLayoutSize?.('v2');
                window.location.reload();
              }}
              className="btn-press"
              style={{
                padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 400, cursor: 'pointer',
                background: 'var(--pill-bg)', border: '1px solid var(--pill-border)', color: 'var(--text3)',
                transition: 'all 0.2s ease',
              }}
            >{t('v2.layout_widescreen')}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}><ConnectionSection /></div>

      {/* Platform-specific sections injected by the host app (e.g. PluginInstallSection in electron) */}
      {extraSections}

      <div style={{ marginBottom: 10, flexShrink: 0 }}><ProviderSection onProvidersChanged={onProvidersChanged} /></div>

      <div style={{ marginBottom: 10, flexShrink: 0 }}><ImageQualitySection /></div>

      {/* Re-open setup wizard */}
      {onOpenSetupWizard && (
        <div
          className="btn-press"
          onClick={() => {
            onOpenSetupWizard();
          }}
          style={{
            ...glass,
            padding: '10px 14px',
            marginBottom: 10,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text3)',
            transition: 'all 0.2s ease',
          }}
        >
          <Icons.Layers color="var(--text3)" size={14} />
          {t('set.reopen_guide')}
        </div>
      )}
    </div>
  );
}
