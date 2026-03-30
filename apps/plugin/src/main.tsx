import './polyfills';
import React from 'react';
import { createRoot } from 'react-dom/client';

import PluginLayout from './layouts/plugin/index';
import './i18n';
import './index.css';
import { startBridge, stopBridge } from './bridge/bridgeAgent';
import { registerAllHandlers } from './bridge/commandHandlers';
import { startEventForwarder, stopEventForwarder } from './bridge/psEventForwarder';
import { getBaseUrl } from './lib/backend';

type UxpModule = {
  entrypoints?: {
    setup: (config: {
      panels?: Record<string, {
        show?: () => void;
      }>;
    }) => void;
  };
};

const globalWithRequire = globalThis as typeof globalThis & {
  require?: (moduleName: string) => UxpModule;
};

let hasRendered = false;

function debugLog(message: string, payload?: unknown) {
  console.log(`[AI Retouch bootstrap] ${message}`, payload ?? '');
}

function renderApp() {
  debugLog('renderApp invoked');

  if (hasRendered) {
    debugLog('render skipped because app has already rendered');
    return;
  }

  const rootElement = document.getElementById('root');
  debugLog('root lookup result', { found: Boolean(rootElement) });

  if (!rootElement) {
    throw new Error('Missing #root mount element for UXP panel');
  }

  try {
    createRoot(rootElement).render(<PluginLayout />);

    debugLog('createRoot().render completed');
  } catch (error) {
    console.error('[AI Retouch bootstrap] render failed', error);
    rootElement.textContent = `Render failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    throw error;
  }

  hasRendered = true;
}

debugLog('main.tsx evaluated');

let uxpModule: UxpModule | undefined;

try {
  uxpModule = globalWithRequire.require?.('uxp');
  debugLog('uxp module lookup finished', {
    hasRequire: Boolean(globalWithRequire.require),
    hasEntrypoints: Boolean(uxpModule?.entrypoints?.setup),
  });
} catch (error) {
  console.error('[AI Retouch bootstrap] require("uxp") failed', error);
}

registerAllHandlers();

function initBridge(): void {
  try {
    startBridge(getBaseUrl());
    startEventForwarder();
    debugLog('Bridge agent started');
  } catch (err) {
    console.warn('[AI Retouch bootstrap] Bridge start failed:', err);
  }
}

if (uxpModule?.entrypoints?.setup) {
  debugLog('registering entrypoints.setup for panel ai-retouch-panel');
  uxpModule.entrypoints.setup({
    panels: {
      'ai-retouch-panel': {
        show() {
          debugLog('panel show handler called');
          initBridge();
          renderApp();
        },
      },
    },
  });
} else {
  debugLog('entrypoints.setup unavailable, falling back to immediate render');
  initBridge();
  renderApp();
}

