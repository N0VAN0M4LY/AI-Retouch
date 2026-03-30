import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlatformProvider, usePlatform } from '@ai-retouch/ui-core/platform';
import ChatTab from '@ai-retouch/ui-core/pages/ChatTab';
import ComfyUITabV2 from './pages/ComfyUITabV2';
import LibraryTab from '@ai-retouch/ui-core/pages/LibraryTab';
import BackendBanner from '@ai-retouch/ui-core/components/BackendBanner';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { t } from '@ai-retouch/ui-core/i18n';
import { useBackendStatus, startConnectionMonitor, stopConnectionMonitor } from '../../lib/backendConnection';
import { connectClientWS, disconnectClientWS, onBridgeEvent } from '../../lib/wsClient';
import { getBaseUrl, openDocument, closeDocument } from '../../lib/api';
import { emitDataChange } from '../../lib/dataEvents';
import { useTheme } from '../../lib/useTheme';
import { createElectronPlatform } from '../../platform';
import Titlebar from '../../components/Titlebar';
import SetupWizard, { isSetupWizardCompleted } from '../../components/SetupWizard';
import SettingsTab from './components/SettingsTab';
import './styles.css';

type TabId = 'chat' | 'comfyui' | 'library' | 'settings';

interface NavItem {
  id: TabId;
  icon: typeof Icons.Chat;
  label: string;
}

export default function V2Layout() {
  const platform = useMemo(() => createElectronPlatform(), []);
  return (
    <PlatformProvider platform={platform}>
      <V2LayoutInner />
    </PlatformProvider>
  );
}

function V2LayoutInner() {
  const platform = usePlatform();
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [providersVersion, setProvidersVersion] = useState(0);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const backendStatus = useBackendStatus();
  const theme = useTheme();
  const [showSetupWizard, setShowSetupWizard] = useState(() => !isSetupWizardCompleted());
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<string | undefined>(undefined);

  const NAV_ITEMS: NavItem[] = [
    { id: 'chat', icon: Icons.Chat, label: t('tab.chat') },
    { id: 'comfyui', icon: Icons.Zap, label: t('tab.comfyui') },
    { id: 'library', icon: Icons.Box, label: t('tab.library') },
    { id: 'settings', icon: Icons.Settings, label: t('tab.settings') },
  ];

  useEffect(() => {
    startConnectionMonitor();
    connectClientWS(getBaseUrl());
    const unsubData = onBridgeEvent('dataChanged', (evt) => {
      const scope = (evt.data as { scope?: string }).scope;
      if (scope === 'sessions' || scope === 'results' || scope === 'all') {
        emitDataChange(scope);
      }
    });
    return () => {
      stopConnectionMonitor();
      disconnectClientWS();
      unsubData();
    };
  }, []);

  useEffect(() => {
    const unsubs = [
      platform.events.onBridgeEvent('documentChanged', (e) => {
        setDocumentPath((e.data as any)?.document?.path ?? null);
      }),
      platform.events.onBridgeEvent('bridgeReady', () => {
        platform.ps.getDocument().then((d) => setDocumentPath(d?.path ?? null)).catch(() => {});
      }),
      platform.events.onBridgeEvent('bridgeDisconnecting', () => {
        setDocumentPath(null);
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [platform]);

  useEffect(() => {
    if (!documentPath) return;
    openDocument(documentPath)
      .catch((err) => console.warn('[V2Layout] openDocument failed:', err))
      .finally(() => emitDataChange('sessions'));
    return () => { closeDocument(documentPath).catch(() => {}); };
  }, [documentPath]);

  const handleProvidersChanged = useCallback(() => {
    setProvidersVersion((v) => v + 1);
  }, []);

  return (
    <div className="app-root">
      <Titlebar
        backendConnected={backendStatus === 'connected'}
      />
      {activeTab !== 'settings' && <BackendBanner variant="v2" />}

      <div className="v2-root">
        {/* Left icon sidebar */}
        <nav className="v2-sidebar">
          <div className="v2-sidebar-logo">
            <Icons.Layers size={16} color="white" />
          </div>

          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            const IconComp = item.icon;
            return (
              <div
                key={item.id}
                className={`v2-sidebar-item ${active ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <IconComp
                  size={17}
                  color={active ? 'var(--accent)' : 'var(--text3)'}
                />
                <span>{item.label}</span>
              </div>
            );
          })}

          <div style={{ flex: 1 }} />
          <div className="v2-sidebar-version">v2.0</div>
        </nav>

        {/* Main content */}
        <div className="v2-main">
          <div style={{ flex: 1, display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <ChatTab
              providersVersion={providersVersion}
              documentPath={documentPath}
              onActiveSessionChange={setActiveSessionId}
              onNavigateToSettings={() => setActiveTab('settings')}
            />
          </div>
          <div style={{ flex: 1, display: activeTab === 'comfyui' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <ComfyUITabV2 documentPath={documentPath} />
          </div>
          <div style={{ flex: 1, display: activeTab === 'library' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
            <LibraryTab documentPath={documentPath} />
          </div>
          {activeTab === 'settings' && (
            <SettingsTab
              onProvidersChanged={handleProvidersChanged}
              themeMode={theme.mode}
              onThemeChange={theme.setMode}
              onOpenSetupWizard={() => setShowSetupWizard(true)}
              initialCategory={settingsInitialCategory as any}
            />
          )}
        </div>
      </div>

      {showSetupWizard && (
        <SetupWizard
          onNavigateToSettings={() => {
            setSettingsInitialCategory('providers');
            setActiveTab('settings');
          }}
          onClose={() => setShowSetupWizard(false)}
        />
      )}
    </div>
  );
}
