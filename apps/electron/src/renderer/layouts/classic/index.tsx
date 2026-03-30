import { useCallback, useEffect, useMemo, useState } from 'react';
import { PlatformProvider, usePlatform } from '@ai-retouch/ui-core/platform';
import ChatTab from '@ai-retouch/ui-core/pages/ChatTab';
import ComfyUITab from '@ai-retouch/ui-core/pages/ComfyUITab';
import LibraryTab from '@ai-retouch/ui-core/pages/LibraryTab';
import SettingsMain from '@ai-retouch/ui-core/pages/settings/SettingsMain';
import BackendBanner from '@ai-retouch/ui-core/components/BackendBanner';
import ResultDrawer from '@ai-retouch/ui-core/components/ResultDrawer';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import { useBackendStatus, startConnectionMonitor, stopConnectionMonitor } from '../../lib/backendConnection';
import { connectClientWS, disconnectClientWS } from '../../lib/wsClient';
import { getBaseUrl, openDocument, closeDocument } from '../../lib/api';
import { emitDataChange } from '../../lib/dataEvents';
import { useTheme } from '../../lib/useTheme';
import { createElectronPlatform } from '../../platform';
import Titlebar from '../../components/Titlebar';
import SetupWizard, { isSetupWizardCompleted } from '../../components/SetupWizard';
import PluginInstallSection from '../../pages/settings/PluginInstallSection';
import './styles.css';

type TabId = 'chat' | 'comfyui' | 'library' | 'settings';

const ICON_ACTIVE = 'var(--text)';
const ICON_INACTIVE = 'var(--text3)';

const TABS: { id: TabId; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { id: 'chat', label: '对话', icon: (a) => <Icons.Chat size={15} color={a ? ICON_ACTIVE : ICON_INACTIVE} /> },
  { id: 'comfyui', label: 'ComfyUI', icon: (a) => <Icons.Zap size={15} color={a ? ICON_ACTIVE : ICON_INACTIVE} /> },
  { id: 'library', label: '结果库', icon: (a) => <Icons.Box size={15} color={a ? ICON_ACTIVE : ICON_INACTIVE} /> },
  { id: 'settings', label: '设置', icon: (a) => <Icons.Settings size={15} color={a ? ICON_ACTIVE : ICON_INACTIVE} /> },
];

export default function ClassicLayout() {
  const platform = useMemo(() => createElectronPlatform(), []);
  return (
    <PlatformProvider platform={platform}>
      <ClassicLayoutInner />
    </PlatformProvider>
  );
}

function ClassicLayoutInner() {
  const platform = usePlatform();
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [providersVersion, setProvidersVersion] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const backendStatus = useBackendStatus();
  const theme = useTheme();
  const [showSetupWizard, setShowSetupWizard] = useState(() => !isSetupWizardCompleted());

  useEffect(() => {
    startConnectionMonitor();
    connectClientWS(getBaseUrl());
    return () => {
      stopConnectionMonitor();
      disconnectClientWS();
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
      .catch((err) => console.warn('[ClassicLayout] openDocument failed:', err))
      .finally(() => emitDataChange('sessions'));
    return () => { closeDocument(documentPath).catch(() => {}); };
  }, [documentPath]);

  const handleProvidersChanged = useCallback(() => {
    setProvidersVersion((v) => v + 1);
  }, []);

  return (
    <div className="app-root">
      <Titlebar backendConnected={backendStatus === 'connected'} />
      <BackendBanner variant="classic" />

      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon(activeTab === tab.id)}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        <div style={{ flex: 1, display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatTab
            providersVersion={providersVersion}
            documentPath={documentPath}
            onActiveSessionChange={setActiveSessionId}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        </div>
        <div style={{ flex: 1, display: activeTab === 'comfyui' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <ComfyUITab documentPath={documentPath} />
        </div>
        <div className="tab-page" style={{ display: activeTab === 'library' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <LibraryTab documentPath={documentPath} />
        </div>
        {activeTab === 'settings' && (
          <div className="tab-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SettingsMain
              onProvidersChanged={handleProvidersChanged}
              themeMode={theme.mode}
              onThemeChange={theme.setMode}
              onOpenSetupWizard={() => setShowSetupWizard(true)}
              extraSections={<PluginInstallSection />}
            />
          </div>
        )}
      </main>

      {(activeTab === 'chat' || activeTab === 'comfyui') && (
        <ResultDrawer
          activeSessionId={activeSessionId}
          documentPath={documentPath}
        />
      )}

      {showSetupWizard && (
        <SetupWizard
          onNavigateToSettings={() => setActiveTab('settings')}
          onClose={() => setShowSetupWizard(false)}
        />
      )}
    </div>
  );
}
