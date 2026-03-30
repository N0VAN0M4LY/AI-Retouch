import { useState } from 'react';
import * as Icons from '../components/Icons';
import Tooltip from '../components/Tooltip';
import { t } from '../i18n/setup';
import DirectChat from './chat/DirectChat';

interface Props {
  providersVersion?: number;
  documentPath: string | null;
  
  onActiveSessionChange?: (sessionId: string | null) => void;
  onNavigateToSettings?: () => void;
}

export default function ChatTab({ providersVersion, documentPath, onActiveSessionChange, onNavigateToSettings }: Props) {
  const [chatMode, setChatMode] = useState<'direct' | 'agent'>('direct');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px 8px', flexShrink: 0 }}>
        <div style={{
          display: 'inline-flex', borderRadius: 10, overflow: 'hidden',
          border: '1px solid var(--border)', background: 'var(--glass)',
        }}>
          {([
            { id: 'direct' as const, icon: 'palette', label: t('chat.direct') },
            { id: 'agent' as const, icon: 'bot', label: 'Agent' },
          ]).map((m) => {
            const isActive = chatMode === m.id;
            const color = isActive ? 'var(--accent)' : 'var(--text-muted)';
            return (
              <Tooltip key={m.id} text={m.label} position="bottom">
                <div
                  onClick={() => setChatMode(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '6px 16px',
                    fontSize: 12, cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400, color,
                    background: isActive ? 'var(--pill-active-bg)' : 'transparent',
                  }}
                >
                  <span style={{ marginRight: 5, display: 'flex' }}>
                    {m.icon === 'palette' ? <Icons.Palette color={color} /> : <Icons.Bot color={color} />}
                  </span>
                  {m.label}
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: chatMode === 'direct' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <DirectChat
          providersVersion={providersVersion}
          documentPath={documentPath}
          onActiveSessionChange={onActiveSessionChange}
          onNavigateToSettings={onNavigateToSettings}
        />
      </div>
      {chatMode === 'agent' && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          {t('chat.agent_soon')}
        </div>
      )}
    </div>
  );
}
