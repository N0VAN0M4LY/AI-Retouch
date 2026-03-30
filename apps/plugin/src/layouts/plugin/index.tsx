import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlatformProvider } from '@ai-retouch/ui-core/platform';
import ChatTab from '@ai-retouch/ui-core/pages/ChatTab';
import ComfyUITab from '@ai-retouch/ui-core/pages/ComfyUITab';
import LibraryTab from '@ai-retouch/ui-core/pages/LibraryTab';
import ResultDrawer from '@ai-retouch/ui-core/components/ResultDrawer';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import Tooltip from '@ai-retouch/ui-core/components/Tooltip';
import { t } from '@ai-retouch/ui-core/i18n';
import { createPluginPlatform } from '../../platform';
import { getActiveDocumentInfo, startDocumentTracking, stopDocumentTracking } from '../../ps/documentTracker';
import { openDocument, closeDocument, putSetting } from '../../lib/backend';
import { startConnectionMonitor, stopConnectionMonitor } from '../../lib/backendConnection';
import { emitDataChange } from '../../lib/dataEvents';
import { onBridgeEvent } from '../../bridge/bridgeAgent';
import { T } from '../../lib/theme';
import LauncherPanel from './components/LauncherPanel';
import SettingsTab from './components/SettingsTab';
import './styles.css';

type TabId = 'chat' | 'comfyui' | 'library' | 'settings';

export default function PluginLayout() {
  const platform = useMemo(() => createPluginPlatform(), []);
  return (
    <PlatformProvider platform={platform}>
      <PluginLayoutInner />
    </PlatformProvider>
  );
}

function PluginLayoutInner() {
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [providersVersion, setProvidersVersion] = useState(0);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<'full' | 'launcher'>(() => {
    const saved = localStorage.getItem('ai_retouch_panel_mode');
    return saved === 'full' ? 'full' : 'launcher';
  });

  function switchMode(mode: 'full' | 'launcher') {
    setPanelMode(mode);
    localStorage.setItem('ai_retouch_panel_mode', mode);
    putSetting('panel_mode', mode).catch(() => {});
  }

  useEffect(() => {
    startConnectionMonitor();
    const info = getActiveDocumentInfo();
    setActiveDocumentPath(info?.path || null);
    startDocumentTracking((doc) => {
      setActiveDocumentPath(doc?.path || null);
    });
    const unsubData = onBridgeEvent('dataChanged', (evt) => {
      const scope = (evt.data as { scope?: string }).scope;
      if (scope === 'sessions' || scope === 'results' || scope === 'all') {
        emitDataChange(scope);
      }
    });
    return () => {
      stopDocumentTracking();
      stopConnectionMonitor();
      unsubData();
    };
  }, []);

  useEffect(() => {
    if (!activeDocumentPath) return;
    const currentPath = activeDocumentPath;
    openDocument(currentPath)
      .then(() => emitDataChange('sessions'))
      .catch((err) => console.warn('[PluginLayout] openDocument failed:', err));
    return () => { closeDocument(currentPath).catch(() => {}); };
  }, [activeDocumentPath]);

  const handleProvidersChanged = useCallback(() => {
    setProvidersVersion((v) => v + 1);
  }, []);

  const tabs: Array<{ id: TabId; iconId: string; label: string }> = [
    { id: 'chat', iconId: 'chat', label: t('tab.chat') },
    { id: 'comfyui', iconId: 'zap', label: t('tab.comfyui') },
    { id: 'library', iconId: 'box', label: t('tab.library') },
    { id: 'settings', iconId: 'settings', label: t('tab.settings') },
  ];

  function renderTabIcon(iconId: string, color: string) {
    switch (iconId) {
      case 'chat': return <Icons.Chat color={color} />;
      case 'zap': return <Icons.Zap color={color} />;
      case 'box': return <Icons.Box color={color} />;
      case 'settings': return <Icons.Settings color={color} />;
      default: return null;
    }
  }

  if (panelMode === 'launcher') {
    return <LauncherPanel onSwitchToFull={() => switchMode('full')} />;
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: T.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      color: T.text,
    }}>
      {/* Top navigation */}
      <div style={{
        padding: '10px 12px 0',
        borderBottom: `1px solid ${T.border}`,
        background: 'rgba(255,255,255,0.02)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex' }}>
          {tabs.map((tab) => (
            <Tooltip key={tab.id} text={tab.label} position="bottom">
              <div
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderRadius: '10px 10px 0 0',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: activeTab === tab.id ? T.text : T.text3,
                  background: activeTab === tab.id ? T.glass2 : 'transparent',
                  borderBottom: activeTab === tab.id
                    ? `2px solid ${T.accent}`
                    : '2px solid transparent',
                }}
              >
                <span style={{ marginRight: 5, display: 'flex' }}>{renderTabIcon(tab.iconId, activeTab === tab.id ? T.text : T.text3)}</span>
                {tab.label && <span>{tab.label}</span>}
              </div>
            </Tooltip>
          ))}
          <Tooltip text={panelMode === 'full' ? t('app.switch_to_launcher') : t('app.switch_to_full')} position="bottom">
            <div
              onClick={() => switchMode(panelMode === 'full' ? 'launcher' : 'full')}
              style={{
                marginLeft: 'auto',
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 6,
                background: T.glass2,
                border: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 9, color: T.text3, whiteSpace: 'nowrap' }}>
                {t('app.full_mode')}
              </span>
              <div style={{
                width: 28,
                height: 14,
                borderRadius: 7,
                background: 'rgba(108,138,255,0.25)',
                border: '1px solid rgba(108,138,255,0.35)',
                position: 'relative',
                flexShrink: 0,
              }}>
                <div style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: T.accent,
                  position: 'absolute',
                  top: 1,
                  left: 15,
                }} />
              </div>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatTab
            providersVersion={providersVersion}
            documentPath={activeDocumentPath}
            onActiveSessionChange={setActiveSessionId}
          />
        </div>
        <div style={{ flex: 1, display: activeTab === 'comfyui' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <ComfyUITab documentPath={activeDocumentPath} />
        </div>
        <div style={{ flex: 1, display: activeTab === 'library' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <LibraryTab documentPath={activeDocumentPath} />
        </div>
        {activeTab === 'settings' && (
          <SettingsTab
            onProvidersChanged={handleProvidersChanged}
            onSwitchToLauncher={() => switchMode('launcher')}
          />
        )}

        {/* Result drawer — only on chat & comfyui tabs */}
        {(activeTab === 'chat' || activeTab === 'comfyui') && (
          <ResultDrawer activeSessionId={activeSessionId} documentPath={activeDocumentPath} />
        )}
      </div>
    </div>
  );
}
