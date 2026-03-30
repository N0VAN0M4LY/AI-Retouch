import ConnectionSection from '@ai-retouch/ui-core/pages/settings/ConnectionSection';
import ImageQualitySection from '@ai-retouch/ui-core/pages/settings/ImageQualitySection';
import ProviderSection from '@ai-retouch/ui-core/pages/settings/ProviderSection';
import ActionsSection from '../../../pages/settings/ActionsSection';
import { t } from '@ai-retouch/ui-core/i18n';

interface Props {
  onProvidersChanged?: () => void;
  onSwitchToLauncher?: () => void;
}

export default function SettingsTab({ onProvidersChanged, onSwitchToLauncher }: Props) {
  return (
    <div style={{
      flex: 1, overflowY: 'scroll', padding: 14,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, flexShrink: 0, color: 'var(--text)' }}>
        {t('set.title')}
      </div>

      <div style={{ marginBottom: 10, flexShrink: 0 }}><ConnectionSection /></div>

      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        <ActionsSection onSwitchToLauncher={onSwitchToLauncher} />
      </div>

      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        <ProviderSection onProvidersChanged={onProvidersChanged} />
      </div>

      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        <ImageQualitySection />
      </div>
    </div>
  );
}
