import { useTranslation } from 'react-i18next';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import Tooltip from '@ai-retouch/ui-core/components/Tooltip';
import { T } from '../../../lib/theme';
import ConnectionSection from '@ai-retouch/ui-core/pages/settings/ConnectionSection';
import ActionsSection from '../../../pages/settings/ActionsSection';

interface LauncherPanelProps {
  onSwitchToFull: () => void;
}

export default function LauncherPanel({ onSwitchToFull }: LauncherPanelProps) {
  const { t } = useTranslation();

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: T.bg,
      display: 'flex',
      flexDirection: 'column',
      padding: 12,
      color: T.text,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Icons.Palette color={T.accent} size={16} />
          <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 600, color: T.text }}>AI Retouch</span>
        </div>
        <Tooltip text={t('launcher.switch_to_full')} position="bottom">
          <div
            onClick={onSwitchToFull}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: T.glass2,
              border: `1px solid ${T.border}`,
              cursor: 'pointer',
              fontSize: 10,
              color: T.text3,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Icons.Maximize color={T.text3} size={10} />
            <span style={{ marginLeft: 4 }}>{t('launcher.full_panel')}</span>
          </div>
        </Tooltip>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ConnectionSection />
        <ActionsSection compact />
      </div>

      {/* Bottom: switch to full panel */}
      <div style={{ flexShrink: 0, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          onClick={onSwitchToFull}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 10,
            background: 'rgba(108,138,255,0.08)',
            border: `1px solid rgba(108,138,255,0.2)`,
            cursor: 'pointer', fontSize: 12, fontWeight: 500, color: T.accent,
          }}
        >
          <Icons.Maximize color={T.accent} size={14} />
          {t('launcher.switch_to_full')}
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 9, color: T.text3, lineHeight: 1.5, opacity: 0.6 }}>
            {t('launcher.hint')}
          </span>
        </div>
      </div>
    </div>
  );
}
