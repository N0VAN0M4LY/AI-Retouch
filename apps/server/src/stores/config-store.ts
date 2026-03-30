import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ProviderWithDetails,
  ProviderApiKey,
  ProviderModel,
  AdvancedSettings,
} from '@ai-retouch/shared';
import { DEFAULT_ADVANCED_SETTINGS, DEFAULT_BACKEND_HOST, DEFAULT_BACKEND_PORT } from '@ai-retouch/shared';
import { getDataDir } from '../utils/paths.js';

const DATA_DIR = getDataDir();
const PROVIDERS_PATH = path.join(DATA_DIR, 'providers.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS: Record<string, unknown> = {
  cache_max_bytes: 2147483648,
  comfyui_address: 'localhost:8188',
  backend_address: `${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`,
  preview_mode: 'inWindow',
  thumbnail_quality: 60,
  font_size: 13,
  drawer_default: 'collapsed',
  max_image_resolution: 2048,
  preserve_bit_depth: false,
};

// ─── Atomic JSON file helpers ─────────────────────────

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Providers ────────────────────────────────────────

interface ProvidersFile {
  providers: ProviderWithDetails[];
}

let providersCache: ProviderWithDetails[] | null = null;

export function readProviders(): ProviderWithDetails[] {
  if (providersCache) return providersCache;
  const file = readJsonFile<ProvidersFile>(PROVIDERS_PATH, { providers: [] });
  providersCache = file.providers;
  return providersCache;
}

function writeProviders(providers: ProviderWithDetails[]): void {
  ensureDataDir();
  atomicWriteJson(PROVIDERS_PATH, { providers });
  providersCache = providers;
}

export function findProvider(id: string): ProviderWithDetails | null {
  return readProviders().find((p) => p.id === id) ?? null;
}

export function createProvider(provider: ProviderWithDetails): void {
  const providers = readProviders();
  providers.push(provider);
  writeProviders(providers);
}

export function updateProvider(id: string, updater: (p: ProviderWithDetails) => ProviderWithDetails): ProviderWithDetails | null {
  const providers = readProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  providers[idx] = updater(providers[idx]);
  writeProviders(providers);
  return providers[idx];
}

export function deleteProvider(id: string): boolean {
  const providers = readProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  providers.splice(idx, 1);
  writeProviders(providers);
  return true;
}

// ─── Provider API Keys helpers ────────────────────────

export function addApiKeyToProvider(providerId: string, apiKey: string, sortOrder?: number): ProviderApiKey | null {
  const providers = readProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;

  const maxOrder = provider.apiKeys.length > 0
    ? Math.max(...provider.apiKeys.map((k) => k.sortOrder))
    : -1;

  const newKey: ProviderApiKey = {
    id: uuidv4(),
    providerId,
    apiKey,
    sortOrder: sortOrder ?? maxOrder + 1,
    isActive: true,
  };

  provider.apiKeys.push(newKey);
  provider.updatedAt = Date.now();
  writeProviders(providers);
  return newKey;
}

export function deleteApiKeyFromProvider(providerId: string, keyId: string): boolean {
  const providers = readProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return false;

  const idx = provider.apiKeys.findIndex((k) => k.id === keyId);
  if (idx === -1) return false;

  provider.apiKeys.splice(idx, 1);
  provider.updatedAt = Date.now();
  writeProviders(providers);
  return true;
}

// ─── Provider Models helpers ──────────────────────────

export function addModelToProvider(providerId: string, model: ProviderModel): ProviderModel | null {
  const providers = readProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;

  if (provider.models.some((m) => m.id === model.id)) return null;

  provider.models.push(model);
  provider.updatedAt = Date.now();
  writeProviders(providers);
  return model;
}

export function updateModelInProvider(providerId: string, modelId: string, updater: (m: ProviderModel) => ProviderModel): ProviderModel | null {
  const providers = readProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;

  const idx = provider.models.findIndex((m) => m.id === modelId);
  if (idx === -1) return null;

  provider.models[idx] = updater(provider.models[idx]);
  provider.updatedAt = Date.now();
  writeProviders(providers);
  return provider.models[idx];
}

export function deleteModelFromProvider(providerId: string, modelId: string): boolean {
  const providers = readProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return false;

  const idx = provider.models.findIndex((m) => m.id === modelId);
  if (idx === -1) return false;

  provider.models.splice(idx, 1);
  provider.updatedAt = Date.now();
  writeProviders(providers);
  return true;
}

// ─── Settings ─────────────────────────────────────────

let settingsCache: Record<string, unknown> | null = null;

export function readAllSettings(): Record<string, unknown> {
  if (settingsCache) return settingsCache;
  settingsCache = readJsonFile<Record<string, unknown>>(SETTINGS_PATH, {});
  return settingsCache;
}

export function getSetting<T = unknown>(key: string): T | undefined {
  const settings = readAllSettings();
  return settings[key] as T | undefined;
}

export function putSetting(key: string, value: unknown): void {
  const settings = readAllSettings();
  settings[key] = value;
  ensureDataDir();
  atomicWriteJson(SETTINGS_PATH, settings);
  settingsCache = settings;
}

export function deleteSetting(key: string): boolean {
  const settings = readAllSettings();
  if (!(key in settings)) return false;
  delete settings[key];
  ensureDataDir();
  atomicWriteJson(SETTINGS_PATH, settings);
  settingsCache = settings;
  return true;
}

export function initSettings(): void {
  ensureDataDir();
  const settings = readAllSettings();
  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in settings)) {
      settings[key] = value;
      changed = true;
    }
  }
  if (changed) {
    atomicWriteJson(SETTINGS_PATH, settings);
    settingsCache = settings;
  }
}

// ─── Model Resolution (used by adapters) ──────────────

export function resolveModelRefFromConfig(modelRef: string): {
  provider: ProviderWithDetails;
  modelId: string;
  model: ProviderModel;
  apiKey: string;
} {
  const slashIdx = modelRef.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`Invalid modelRef format: "${modelRef}". Expected "providerId/modelId".`);
  }

  const providerId = modelRef.slice(0, slashIdx);
  const modelId = modelRef.slice(slashIdx + 1);

  const provider = findProvider(providerId);
  if (!provider) {
    throw new Error(`Provider not found: "${providerId}"`);
  }

  const activeKey = provider.apiKeys.find((k) => k.isActive);
  if (!activeKey) {
    throw new Error(`No active API key for provider "${provider.name}"`);
  }

  const model = provider.models.find((m) => m.modelId === modelId);
  if (!model) {
    throw new Error(`Model "${modelId}" not found in provider "${provider.name}"`);
  }

  return { provider, modelId, model, apiKey: activeKey.apiKey };
}
