import type { ApiProtocol, ImageHistoryStrategy, ModelCapability } from '@ai-retouch/shared';
import { DEFAULT_ADVANCED_SETTINGS } from '@ai-retouch/shared';
import { resolveModelRefFromConfig } from '../stores/config-store.js';
import { callGemini, callGeminiStream } from './gemini.js';
import { callOpenAI, callOpenAIStream } from './openai.js';
import { callOpenAIResponses, callOpenAIResponsesStream } from './openai-responses.js';
import type {
  AdapterRequest,
  AdapterResponse,
  AdapterStreamCallbacks,
  ResolvedProvider,
} from './types.js';

export type { AdapterRequest, AdapterResponse, AdapterStreamCallbacks } from './types.js';

export function resolveModelRef(modelRef: string): {
  provider: ResolvedProvider;
  modelId: string;
  capabilities: ModelCapability[];
} {
  const { provider, modelId, model, apiKey } = resolveModelRefFromConfig(modelRef);

  const resolved: ResolvedProvider = {
    baseUrl: provider.baseUrl,
    urlMode: provider.urlMode as 'auto' | 'full',
    apiProtocol: provider.apiProtocol as ApiProtocol,
    apiKey,
    streamEnabled: provider.streamEnabled,
    useAuthorizationFormat: provider.useAuthorizationFormat,
    imageHistoryStrategy: (provider.imageHistoryStrategy || 'attach_to_user') as ImageHistoryStrategy,
    advancedSettings: provider.advancedSettings ?? DEFAULT_ADVANCED_SETTINGS,
  };

  return {
    provider: resolved,
    modelId,
    capabilities: model.capabilities as ModelCapability[],
  };
}

// Dispatcher map
const dispatchNonStream: Record<
  ApiProtocol,
  (p: ResolvedProvider, r: AdapterRequest) => Promise<AdapterResponse>
> = {
  gemini: callGemini,
  openai: callOpenAI,
  openai_responses: callOpenAIResponses,
};

const dispatchStream: Record<
  ApiProtocol,
  (p: ResolvedProvider, r: AdapterRequest, cb: AdapterStreamCallbacks) => Promise<AdapterResponse>
> = {
  gemini: callGeminiStream,
  openai: callOpenAIStream,
  openai_responses: callOpenAIResponsesStream,
};

/**
 * Non-streaming model call. Returns the complete response.
 * If the provider has streamEnabled, internally delegates to the streaming
 * adapter with silent collectors to support providers that require streaming.
 */
export async function callModel(
  modelRef: string,
  request: Omit<AdapterRequest, 'modelId' | 'capabilities'>,
): Promise<AdapterResponse> {
  const { provider, modelId, capabilities } = resolveModelRef(modelRef);
  const fullRequest: AdapterRequest = { ...request, modelId, capabilities };

  if (provider.streamEnabled) {
    const handler = dispatchStream[provider.apiProtocol];
    if (!handler) {
      throw new Error(`Unsupported API protocol: "${provider.apiProtocol}"`);
    }
    return handler(provider, fullRequest, {
      onText: () => {},
      onThinking: () => {},
      onImage: () => {},
      onError: (err) => console.warn('[Adapter] Upstream stream error (silent):', err),
    });
  }

  const handler = dispatchNonStream[provider.apiProtocol];
  if (!handler) {
    throw new Error(`Unsupported API protocol: "${provider.apiProtocol}"`);
  }

  return handler(provider, fullRequest);
}

/**
 * Streaming model call. Invokes callbacks as data arrives, then returns
 * the accumulated response.
 */
export async function callModelStream(
  modelRef: string,
  request: Omit<AdapterRequest, 'modelId' | 'capabilities'>,
  callbacks: AdapterStreamCallbacks,
): Promise<AdapterResponse> {
  const { provider, modelId, capabilities } = resolveModelRef(modelRef);
  const fullRequest: AdapterRequest = { ...request, modelId, capabilities };

  const handler = dispatchStream[provider.apiProtocol];
  if (!handler) {
    throw new Error(`Unsupported API protocol: "${provider.apiProtocol}"`);
  }

  return handler(provider, fullRequest, callbacks);
}
