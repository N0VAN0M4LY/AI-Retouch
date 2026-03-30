import { useState, useEffect } from 'react';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { t } from '@ai-retouch/ui-core/i18n';
import type { ThemeMode } from '../../../lib/useTheme';
import ConnectionSection from '@ai-retouch/ui-core/pages/settings/ConnectionSection';
import ImageQualitySection from '@ai-retouch/ui-core/pages/settings/ImageQualitySection';
import ProviderSection from '@ai-retouch/ui-core/pages/settings/ProviderSection';
import PluginInstallSection from '../../../pages/settings/PluginInstallSection';

interface Props {
  onProvidersChanged: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onOpenSetupWizard?: () => void;
  initialCategory?: SettingsCategory;
}

type SettingsCategory = 'connection' | 'ps_plugin' | 'providers' | 'image_quality' | 'interface';

interface CategoryDef {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'connection', label: t('set.connection'), icon: <Icons.Globe size={14} color="var(--text2)" /> },
  { id: 'ps_plugin', label: t('set.ps_plugin'), icon: <Icons.Download size={14} color="var(--text2)" /> },
  { id: 'providers', label: t('set.providers'), icon: <Icons.Cpu size={14} color="var(--text2)" /> },
  { id: 'image_quality', label: t('set.iq_title'), icon: <Icons.Image size={14} color="var(--text2)" /> },
  { id: 'interface', label: t('v2.interface'), icon: <Icons.SlidersHorizontal size={14} color="var(--text2)" /> },
];

export default function SettingsTab({ onProvidersChanged, themeMode, onThemeChange, onOpenSetupWizard, initialCategory }: Props) {
  const [activeCat, setActiveCat] = useState<SettingsCategory>(initialCategory ?? 'connection');

  useEffect(() => {
    if (initialCategory) setActiveCat(initialCategory);
  }, [initialCategory]);

  return (
    <div className="glass-card" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      {/* Left nav */}
      <div className="v2-settings-nav">
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', padding: '0 16px 14px' }}>
          {t('set.title')}
        </div>
        {CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className={`v2-settings-item ${activeCat === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCat(cat.id)}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>{cat.icon}</span>
            <span>{cat.label}</span>
          </div>
        ))}
      </div>

      {/* Right content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {activeCat === 'connection' && <ConnectionSection />}

        {activeCat === 'ps_plugin' && <PluginInstallSection />}

        {activeCat === 'providers' && <ProviderSection onProvidersChanged={onProvidersChanged} />}

        {activeCat === 'image_quality' && <ImageQualitySection />}

        {activeCat === 'interface' && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>{t('v2.interface')}</div>
            <div style={{
              background: 'var(--glass-inset)', borderRadius: 12, padding: '14px 16px',
              border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              {/* Theme selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', width: 100 }}>{t('set.theme')}</span>
                <div className="mode-toggle">
                  {([
                    { id: 'light' as ThemeMode, label: t('set.theme_light') },
                    { id: 'dark' as ThemeMode, label: t('set.theme_dark') },
                    { id: 'system' as ThemeMode, label: t('set.theme_system') },
                  ]).map((opt) => (
                    <button
                      key={opt.id}
                      className={`mode-toggle-item ${themeMode === opt.id ? 'active' : ''}`}
                      onClick={() => onThemeChange(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Layout selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', width: 100 }}>{t('v2.layout')}</span>
                <div className="mode-toggle">
                  <button className="mode-toggle-item active">{t('v2.layout_widescreen')}</button>
                  <button
                    className="mode-toggle-item"
                    onClick={async () => {
                      localStorage.setItem('ui-layout', 'classic');
                      await (window as any).electronAPI?.window.setLayoutSize?.('classic');
                      window.location.reload();
                    }}
                  >
                    {t('v2.layout_classic')}
                  </button>
                </div>
              </div>

              {/* Re-open setup wizard */}
              {onOpenSetupWizard && (
                <div style={{ marginTop: 14 }}>
                  <div
                    className="btn-press"
                    onClick={onOpenSetupWizard}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      borderRadius: 8,
                      fontSize: 11,
                      cursor: 'pointer',
                      color: 'var(--text3)',
                      background: 'var(--glass)',
                      border: '1px solid var(--border)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Icons.Layers color="var(--text3)" size={13} />
                    {t('set.reopen_guide')}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
