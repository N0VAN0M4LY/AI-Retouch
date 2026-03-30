import {
  type ProviderWithDetails,
  type CreateProviderRequest,
  type UpdateProviderRequest,
  type ProviderApiKey,
  type CreateApiKeyInput,
  type ProviderModel,
  type CreateModelInput,
  type UpdateModelInput,
  type FetchedRemoteModel,
} from '@ai-retouch/shared';
import { request } from './client';

// ─── Providers ───────────────────────────────────────────

export async function getProviders(): Promise<ProviderWithDetails[]> {
  return request<ProviderWithDetails[]>('/api/providers');
}

export async function getProvider(id: string): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>(`/api/providers/${encodeURIComponent(id)}`);
}

export async function createProvider(data: CreateProviderRequest): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProvider(id: string, data: UpdateProviderRequest): Promise<ProviderWithDetails> {
  return request<ProviderWithDetails>(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await request<void>(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── API Keys ────────────────────────────────────────────

export async function addApiKey(providerId: string, data: CreateApiKeyInput): Promise<ProviderApiKey> {
  return request<ProviderApiKey>(`/api/providers/${encodeURIComponent(providerId)}/api-keys`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteApiKey(providerId: string, keyId: string): Promise<void> {
  await request<void>(
    `/api/providers/${encodeURIComponent(providerId)}/api-keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  );
}

// ─── Fetch Remote Models ─────────────────────────────────

export async function fetchRemoteModels(providerId: string): Promise<FetchedRemoteModel[]> {
  return request<FetchedRemoteModel[]>(
    `/api/providers/${encodeURIComponent(providerId)}/fetch-models`,
    { method: 'POST' },
  );
}

export async function fetchRemoteModelsDirect(params: {
  baseUrl: string;
  apiProtocol: string;
  urlMode: string;
  useAuthorizationFormat: boolean;
  apiKey: string;
}): Promise<FetchedRemoteModel[]> {
  return request<FetchedRemoteModel[]>('/api/fetch-models-direct', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ─── Models ──────────────────────────────────────────────

export async function addModel(providerId: string, data: CreateModelInput): Promise<ProviderModel> {
  return request<ProviderModel>(`/api/providers/${encodeURIComponent(providerId)}/models`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModel(
  providerId: string,
  modelId: string,
  data: UpdateModelInput,
): Promise<ProviderModel> {
  return request<ProviderModel>(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'PUT', body: JSON.stringify(data) },
  );
}

export async function deleteModel(providerId: string, modelId: string): Promise<void> {
  await request<void>(
    `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    { method: 'DELETE' },
  );
}
