import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type {
  ApiResponse,
  ApiProtocol,
  CreateApiKeyInput,
  CreateModelInput,
  CreateProviderRequest,
  ProviderApiKey,
  ProviderModel,
  ProviderWithDetails,
  UpdateModelInput,
  UpdateProviderRequest,
  FetchedRemoteModel,
  UrlMode,
} from '@ai-retouch/shared';

import { DEFAULT_ADVANCED_SETTINGS } from '@ai-retouch/shared';
import { inferModelCapabilities } from '../adapters/known-models.js';

import {
  readProviders,
  findProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  addApiKeyToProvider,
  deleteApiKeyFromProvider,
  addModelToProvider,
  updateModelInProvider,
  deleteModelFromProvider,
} from '../stores/config-store.js';

const router = Router();

// ─── Provider CRUD ───────────────────────────────────────

// GET /api/providers
router.get('/api/providers', (_req, res) => {
  const providers = readProviders();
  const body: ApiResponse<ProviderWithDetails[]> = { success: true, data: providers };
  res.json(body);
});

// POST /api/providers
router.post('/api/providers', (req, res) => {
  const input = req.body as CreateProviderRequest;

  if (!input.name || !input.baseUrl || !input.apiProtocol) {
    const body: ApiResponse = {
      success: false,
      error: '"name", "baseUrl", and "apiProtocol" are required',
    };
    res.status(400).json(body);
    return;
  }

  const now = Date.now();
  const providerId = uuidv4();
  const defaultStrategy = input.apiProtocol === 'openai_responses' ? 'native_server_state' : 'attach_to_user';

  const provider: ProviderWithDetails = {
    id: providerId,
    name: input.name,
    baseUrl: input.baseUrl,
    urlMode: input.urlMode ?? 'auto',
    apiProtocol: input.apiProtocol,
    keyStrategy: input.keyStrategy ?? 'round_robin',
    streamEnabled: input.streamEnabled !== false,
    maxContextTokens: input.maxContextTokens ?? 128000,
    useAuthorizationFormat: input.useAuthorizationFormat ?? false,
    imageHistoryStrategy: input.imageHistoryStrategy ?? defaultStrategy,
    advancedSettings: input.advancedSettings ?? DEFAULT_ADVANCED_SETTINGS,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    apiKeys: (input.apiKeys ?? []).map((key, i) => ({
      id: uuidv4(),
      providerId,
      apiKey: key,
      sortOrder: i,
      isActive: true,
    })),
    models: (input.models ?? []).map((m, i) => {
      const inferred = inferModelCapabilities(m.modelId);
      return {
        id: `${providerId}/${m.modelId}`,
        providerId,
        modelId: m.modelId,
        displayName: m.displayName,
        source: m.source ?? 'manual',
        capabilities: (m.capabilities && m.capabilities.length > 0) ? m.capabilities : inferred.capabilities,
        fcMode: (m.fcMode && m.fcMode !== 'none') ? m.fcMode : inferred.fcMode,
        enabled: m.enabled !== false,
        sortOrder: m.sortOrder ?? i,
      };
    }),
  };

  createProvider(provider);

  const body: ApiResponse<ProviderWithDetails> = { success: true, data: provider };
  res.status(201).json(body);
});

// GET /api/providers/:id
router.get('/api/providers/:id', (req, res) => {
  const provider = findProvider(req.params.id);
  if (!provider) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<ProviderWithDetails> = { success: true, data: provider };
  res.json(body);
});

// PUT /api/providers/:id
router.put('/api/providers/:id', (req, res) => {
  const input = req.body as UpdateProviderRequest;

  const hasFields = input.name !== undefined
    || input.baseUrl !== undefined
    || input.urlMode !== undefined
    || input.apiProtocol !== undefined
    || input.keyStrategy !== undefined
    || input.streamEnabled !== undefined
    || input.maxContextTokens !== undefined
    || input.useAuthorizationFormat !== undefined
    || input.imageHistoryStrategy !== undefined
    || input.advancedSettings !== undefined
    || input.sortOrder !== undefined;

  if (!hasFields) {
    const body: ApiResponse = { success: false, error: 'No fields to update' };
    res.status(400).json(body);
    return;
  }

  const updated = updateProvider(req.params.id, (p) => {
    const result = { ...p };
    if (input.name !== undefined) result.name = input.name;
    if (input.baseUrl !== undefined) result.baseUrl = input.baseUrl;
    if (input.urlMode !== undefined) result.urlMode = input.urlMode;
    if (input.apiProtocol !== undefined) result.apiProtocol = input.apiProtocol;
    if (input.keyStrategy !== undefined) result.keyStrategy = input.keyStrategy;
    if (input.streamEnabled !== undefined) result.streamEnabled = input.streamEnabled;
    if (input.maxContextTokens !== undefined) result.maxContextTokens = input.maxContextTokens;
    if (input.useAuthorizationFormat !== undefined) result.useAuthorizationFormat = input.useAuthorizationFormat;
    if (input.imageHistoryStrategy !== undefined) result.imageHistoryStrategy = input.imageHistoryStrategy;
    if (input.advancedSettings !== undefined) result.advancedSettings = input.advancedSettings;
    if (input.sortOrder !== undefined) result.sortOrder = input.sortOrder;
    result.updatedAt = Date.now();
    return result;
  });

  if (!updated) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<ProviderWithDetails> = { success: true, data: updated };
  res.json(body);
});

// DELETE /api/providers/:id
router.delete('/api/providers/:id', (req, res) => {
  const ok = deleteProvider(req.params.id);
  if (!ok) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse = { success: true };
  res.json(body);
});

// ─── Fetch Remote Models ─────────────────────────────────

router.post('/api/providers/:id/fetch-models', async (req, res) => {
  const provider = findProvider(req.params.id);

  if (!provider) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const activeKey = provider.apiKeys.find((k) => k.isActive);
  if (!activeKey) {
    const body: ApiResponse = { success: false, error: 'No active API key for this provider' };
    res.status(400).json(body);
    return;
  }

  try {
    let models: FetchedRemoteModel[] = [];

    if (provider.apiProtocol === 'openai' || provider.apiProtocol === 'openai_responses') {
      let url = provider.baseUrl.replace(/\/$/, '');
      if (provider.urlMode === 'auto') {
        url += '/v1/models';
      } else {
        url += '/models';
      }

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${activeKey.apiKey}` },
      });
      if (!resp.ok) throw new Error(`Remote API returned ${resp.status}: ${await resp.text()}`);
      const json = await resp.json() as { data?: Array<{ id: string; owned_by?: string }> };
      models = (json.data ?? []).map((m) => ({ id: m.id, name: m.id, owned_by: m.owned_by }));

    } else if (provider.apiProtocol === 'gemini') {
      let url = provider.baseUrl.replace(/\/$/, '');
      if (provider.urlMode === 'auto') {
        url += '/v1beta/models';
      } else {
        url += '/models';
      }

      const useBearer = provider.useAuthorizationFormat;
      const headers: Record<string, string> = useBearer
        ? { 'Authorization': `Bearer ${activeKey.apiKey}` }
        : { 'x-goog-api-key': activeKey.apiKey };

      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`Remote API returned ${resp.status}: ${await resp.text()}`);
      const json = await resp.json() as { models?: Array<{ name: string; displayName?: string }> };
      models = (json.models ?? []).map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, name: m.displayName ?? id };
      });
    }

    const body: ApiResponse<FetchedRemoteModel[]> = { success: true, data: models };
    res.json(body);
  } catch (err) {
    const body: ApiResponse = { success: false, error: `Failed to fetch models: ${(err as Error).message}` };
    res.status(502).json(body);
  }
});

// ─── API Keys ────────────────────────────────────────────

// POST /api/providers/:id/api-keys
router.post('/api/providers/:id/api-keys', (req, res) => {
  const input = req.body as CreateApiKeyInput;
  if (!input.apiKey) {
    const body: ApiResponse = { success: false, error: '"apiKey" is required' };
    res.status(400).json(body);
    return;
  }

  const newKey = addApiKeyToProvider(req.params.id, input.apiKey, input.sortOrder);
  if (!newKey) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<ProviderApiKey> = { success: true, data: newKey };
  res.status(201).json(body);
});

// DELETE /api/providers/:id/api-keys/:keyId
router.delete('/api/providers/:id/api-keys/:keyId', (req, res) => {
  const ok = deleteApiKeyFromProvider(req.params.id, req.params.keyId);
  if (!ok) {
    const body: ApiResponse = { success: false, error: 'API key not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse = { success: true };
  res.json(body);
});

// ─── Models ──────────────────────────────────────────────

// POST /api/providers/:id/models
router.post('/api/providers/:id/models', (req, res) => {
  const provider = findProvider(req.params.id);
  if (!provider) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const input = req.body as CreateModelInput;
  if (!input.modelId || !input.displayName) {
    const body: ApiResponse = { success: false, error: '"modelId" and "displayName" are required' };
    res.status(400).json(body);
    return;
  }

  const compositeId = `${req.params.id}/${input.modelId}`;
  if (provider.models.some((m) => m.id === compositeId)) {
    const body: ApiResponse = {
      success: false,
      error: `Model "${input.modelId}" already exists for this provider`,
    };
    res.status(409).json(body);
    return;
  }

  const maxOrder = provider.models.length > 0
    ? Math.max(...provider.models.map((m) => m.sortOrder))
    : -1;

  const inferred = inferModelCapabilities(input.modelId);
  const model: ProviderModel = {
    id: compositeId,
    providerId: req.params.id,
    modelId: input.modelId,
    displayName: input.displayName,
    source: input.source ?? 'manual',
    capabilities: (input.capabilities && input.capabilities.length > 0) ? input.capabilities : inferred.capabilities,
    fcMode: (input.fcMode && input.fcMode !== 'none') ? input.fcMode : inferred.fcMode,
    enabled: input.enabled !== false,
    sortOrder: input.sortOrder ?? maxOrder + 1,
  };

  const added = addModelToProvider(req.params.id, model);
  if (!added) {
    const body: ApiResponse = { success: false, error: 'Provider not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<ProviderModel> = { success: true, data: model };
  res.status(201).json(body);
});

// PUT /api/providers/:id/models/:modelId
router.put('/api/providers/:id/models/:modelId', (req, res) => {
  const compositeId = `${req.params.id}/${req.params.modelId}`;
  const input = req.body as UpdateModelInput;

  const hasFields = input.displayName !== undefined
    || input.capabilities !== undefined
    || input.fcMode !== undefined
    || input.enabled !== undefined
    || input.sortOrder !== undefined;

  if (!hasFields) {
    const body: ApiResponse = { success: false, error: 'No fields to update' };
    res.status(400).json(body);
    return;
  }

  const updated = updateModelInProvider(req.params.id, compositeId, (m) => {
    const result = { ...m };
    if (input.displayName !== undefined) result.displayName = input.displayName;
    if (input.capabilities !== undefined) result.capabilities = input.capabilities;
    if (input.fcMode !== undefined) result.fcMode = input.fcMode;
    if (input.enabled !== undefined) result.enabled = input.enabled;
    if (input.sortOrder !== undefined) result.sortOrder = input.sortOrder;
    return result;
  });

  if (!updated) {
    const body: ApiResponse = { success: false, error: 'Model not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse<ProviderModel> = { success: true, data: updated };
  res.json(body);
});

// DELETE /api/providers/:id/models/:modelId
router.delete('/api/providers/:id/models/:modelId', (req, res) => {
  const compositeId = `${req.params.id}/${req.params.modelId}`;
  const ok = deleteModelFromProvider(req.params.id, compositeId);

  if (!ok) {
    const body: ApiResponse = { success: false, error: 'Model not found' };
    res.status(404).json(body);
    return;
  }

  const body: ApiResponse = { success: true };
  res.json(body);
});

// ─── Fetch Remote Models (Direct — no saved provider required) ───

interface FetchModelsDirectRequest {
  baseUrl: string;
  apiProtocol: ApiProtocol;
  urlMode: UrlMode;
  useAuthorizationFormat: boolean;
  apiKey: string;
}

router.post('/api/fetch-models-direct', async (req, res) => {
  const input = req.body as FetchModelsDirectRequest;

  if (!input.baseUrl || !input.apiProtocol || !input.apiKey) {
    const body: ApiResponse = { success: false, error: '"baseUrl", "apiProtocol", and "apiKey" are required' };
    res.status(400).json(body);
    return;
  }

  try {
    let models: FetchedRemoteModel[] = [];
    const urlMode = input.urlMode ?? 'auto';

    if (input.apiProtocol === 'openai' || input.apiProtocol === 'openai_responses') {
      let url = input.baseUrl.replace(/\/$/, '');
      url += urlMode === 'auto' ? '/v1/models' : '/models';

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${input.apiKey}` },
      });
      if (!resp.ok) throw new Error(`Remote API returned ${resp.status}: ${await resp.text()}`);
      const json = await resp.json() as { data?: Array<{ id: string; owned_by?: string }> };
      models = (json.data ?? []).map((m) => ({ id: m.id, name: m.id, owned_by: m.owned_by }));

    } else if (input.apiProtocol === 'gemini') {
      let url = input.baseUrl.replace(/\/$/, '');
      url += urlMode === 'auto' ? '/v1beta/models' : '/models';

      const useBearer = input.useAuthorizationFormat;
      const headers: Record<string, string> = useBearer
        ? { 'Authorization': `Bearer ${input.apiKey}` }
        : { 'x-goog-api-key': input.apiKey };

      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`Remote API returned ${resp.status}: ${await resp.text()}`);
      const json = await resp.json() as { models?: Array<{ name: string; displayName?: string }> };
      models = (json.models ?? []).map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, name: m.displayName ?? id };
      });
    }

    const body: ApiResponse<FetchedRemoteModel[]> = { success: true, data: models };
    res.json(body);
  } catch (err) {
    const body: ApiResponse = { success: false, error: `Failed to fetch models: ${(err as Error).message}` };
    res.status(502).json(body);
  }
});

export default router;
