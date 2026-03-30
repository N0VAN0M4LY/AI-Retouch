import { useEffect, useState } from 'react';

import type {
  AdvancedSettings,
  ApiProtocol,
  FcMode,
  FetchedRemoteModel,
  GeminiImageSize,
  GeminiThinkingLevel,
  ImageHistoryStrategy,
  KeyStrategy,
  ModelCapability,
  OaiReasoningEffort,
  OaiReasoningSummary,
  ProviderApiKey,
  ProviderModel,
  UrlMode,
} from '@ai-retouch/shared';
import { DEFAULT_ADVANCED_SETTINGS, DEFAULT_BASE_URLS } from '@ai-retouch/shared';

import * as Icons from '../../components/Icons';
import {
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  addApiKey,
  deleteApiKey,
  addModel,
  updateModel,
  deleteModel,
  fetchRemoteModels,
  fetchRemoteModelsDirect,
} from '../../api/providers';
import { t } from '../../i18n/setup';

interface Props {
  providerId: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

const T = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  orange: 'var(--orange)',
  red: 'var(--red)',
  purple: '#AF52DE',
  border: 'var(--border)',
  glass: 'var(--glass)',
};

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--pill-bg)',
  border: '1px solid var(--pill-border)',
  cursor: 'pointer',
  padding: '3px 8px',
  fontSize: 10,
  color: 'var(--text)',
};

const pillActive: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--pill-active-bg)',
  border: '1px solid var(--pill-active-border)',
  color: 'var(--accent)',
  cursor: 'pointer',
  padding: '3px 8px',
  fontSize: 10,
};

const btnSuccess: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--accent)',
  border: '1px solid transparent',
  color: '#FFFFFF',
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'rgba(255,59,48,0.10)',
  border: '1px solid transparent',
  color: 'var(--red)',
  cursor: 'pointer',
  padding: '3px 8px',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--glass-inset)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 8px',
  color: 'var(--text)',
  outline: 'none',
  fontSize: 12,
  width: '100%',
};

const EMPTY_PROVIDER = {
  name: '',
  baseUrl: DEFAULT_BASE_URLS.openai,
  urlMode: 'auto' as UrlMode,
  apiProtocol: 'openai' as ApiProtocol,
  keyStrategy: 'round_robin' as KeyStrategy,
  streamEnabled: true,
  maxContextTokens: 128000,
  useAuthorizationFormat: false,
  advancedSettings: { ...DEFAULT_ADVANCED_SETTINGS },
};

type PendingModel = {
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  fcMode: FcMode;
};

export default function ProviderEdit({ providerId, onSaved, onCancel }: Props) {
  const isNew = providerId === null;

  const [name, setName] = useState(EMPTY_PROVIDER.name);
  const [baseUrl, setBaseUrl] = useState(EMPTY_PROVIDER.baseUrl);
  const [urlMode, setUrlMode] = useState<UrlMode>(EMPTY_PROVIDER.urlMode);
  const [apiProtocol, setApiProtocol] = useState<ApiProtocol>(EMPTY_PROVIDER.apiProtocol);
  const [keyStrategy, setKeyStrategy] = useState<KeyStrategy>(EMPTY_PROVIDER.keyStrategy);
  const [streamEnabled, setStreamEnabled] = useState(EMPTY_PROVIDER.streamEnabled);
  const [maxContextTokens, setMaxContextTokens] = useState(EMPTY_PROVIDER.maxContextTokens);
  const [useAuthorizationFormat, setUseAuthorizationFormat] = useState(EMPTY_PROVIDER.useAuthorizationFormat);
  const [imageHistoryStrategy, setImageHistoryStrategy] = useState<ImageHistoryStrategy>('attach_to_user');
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>({ ...DEFAULT_ADVANCED_SETTINGS });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [apiKeys, setApiKeys] = useState<ProviderApiKey[]>([]);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [pendingModels, setPendingModels] = useState<PendingModel[]>([]);

  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelCaps, setNewModelCaps] = useState<ModelCapability[]>([]);
  const [newModelFc, setNewModelFc] = useState<FcMode>('none');

  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);
  const [editModelName, setEditModelName] = useState('');
  const [editModelCaps, setEditModelCaps] = useState<ModelCapability[]>([]);
  const [editModelFc, setEditModelFc] = useState<FcMode>('none');

  const [showFetchModal, setShowFetchModal] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedRemoteModel[]>([]);
  const [selectedFetchIds, setSelectedFetchIds] = useState<Set<string>>(new Set());
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isNew && providerId) {
      loadProvider(providerId);
    }
  }, [providerId]);

  async function loadProvider(id: string) {
    setLoading(true);
    try {
      const p = await getProvider(id);
      setName(p.name);
      setBaseUrl(p.baseUrl);
      setUrlMode(p.urlMode);
      setApiProtocol(p.apiProtocol);
      setKeyStrategy(p.keyStrategy);
      setStreamEnabled(p.streamEnabled);
      setMaxContextTokens(p.maxContextTokens);
      setUseAuthorizationFormat(p.useAuthorizationFormat);
      setImageHistoryStrategy(p.imageHistoryStrategy ?? 'attach_to_user');
      setAdvancedSettings(p.advancedSettings ?? { ...DEFAULT_ADVANCED_SETTINGS });
      setApiKeys(p.apiKeys);
      setModels(p.models);
    } catch (err) {
      console.error('[ProviderEdit] Failed to load provider', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !baseUrl.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await createProvider({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          urlMode,
          apiProtocol,
          keyStrategy,
          streamEnabled,
          maxContextTokens,
          useAuthorizationFormat,
          imageHistoryStrategy,
          advancedSettings,
          apiKeys: pendingKeys,
          models: pendingModels.map((m) => ({
            modelId: m.modelId,
            displayName: m.displayName,
            capabilities: m.capabilities,
            fcMode: m.fcMode,
          })),
        });
      } else if (providerId) {
        await updateProvider(providerId, {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          urlMode,
          apiProtocol,
          keyStrategy,
          streamEnabled,
          maxContextTokens,
          useAuthorizationFormat,
          imageHistoryStrategy,
          advancedSettings,
        });
      }
      onSaved();
    } catch (err) {
      console.error('[ProviderEdit] Save failed', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!providerId) return;
    try {
      await deleteProvider(providerId);
      onSaved();
    } catch (err) {
      console.error('[ProviderEdit] Delete failed', err);
    }
  }

  async function handleAddKey() {
    if (!newKeyValue.trim()) return;
    if (isNew) {
      setPendingKeys([...pendingKeys, newKeyValue.trim()]);
      setNewKeyValue('');
      return;
    }
    if (!providerId) return;
    try {
      const key = await addApiKey(providerId, { apiKey: newKeyValue.trim() });
      setApiKeys([...apiKeys, key]);
      setNewKeyValue('');
    } catch (err) {
      console.error('[ProviderEdit] Add key failed', err);
    }
  }

  async function handleDeleteKey(keyId: string, index: number) {
    if (isNew) {
      setPendingKeys(pendingKeys.filter((_, i) => i !== index));
      return;
    }
    if (!providerId) return;
    try {
      await deleteApiKey(providerId, keyId);
      setApiKeys(apiKeys.filter((k) => k.id !== keyId));
    } catch (err) {
      console.error('[ProviderEdit] Delete key failed', err);
    }
  }

  function toggleCap(cap: ModelCapability, setter: React.Dispatch<React.SetStateAction<ModelCapability[]>>) {
    setter((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
  }

  async function handleAddModel() {
    if (!newModelId.trim() || !newModelName.trim()) return;
    const modelData: PendingModel = {
      modelId: newModelId.trim(),
      displayName: newModelName.trim(),
      capabilities: newModelCaps,
      fcMode: newModelFc,
    };

    if (isNew) {
      setPendingModels([...pendingModels, modelData]);
      resetModelForm();
      return;
    }
    if (!providerId) return;
    try {
      const model = await addModel(providerId, modelData);
      setModels([...models, model]);
      resetModelForm();
    } catch (err) {
      console.error('[ProviderEdit] Add model failed', err);
    }
  }

  async function handleToggleModel(model: ProviderModel) {
    if (!providerId) return;
    try {
      const updated = await updateModel(providerId, model.modelId, { enabled: !model.enabled });
      setModels(models.map((m) => (m.id === model.id ? updated : m)));
    } catch (err) {
      console.error('[ProviderEdit] Toggle model failed', err);
    }
  }

  async function handleDeleteModel(model: ProviderModel, index: number) {
    if (isNew) {
      setPendingModels(pendingModels.filter((_, i) => i !== index));
      return;
    }
    if (!providerId) return;
    try {
      await deleteModel(providerId, model.modelId);
      setModels(models.filter((m) => m.id !== model.id));
    } catch (err) {
      console.error('[ProviderEdit] Delete model failed', err);
    }
  }

  function startEditModel(index: number) {
    const allModels = isNew ? pendingModels : models;
    const m = allModels[index];
    const dn = 'displayName' in m ? m.displayName : (m as PendingModel).displayName;
    const caps = 'capabilities' in m ? m.capabilities : (m as PendingModel).capabilities;
    const fc = 'fcMode' in m ? m.fcMode : (m as PendingModel).fcMode;
    setEditingModelIndex(index);
    setEditModelName(dn);
    setEditModelCaps([...caps]);
    setEditModelFc(fc);
  }

  async function handleSaveEditModel() {
    if (editingModelIndex === null || !editModelName.trim()) return;

    if (isNew) {
      setPendingModels(pendingModels.map((m, i) =>
        i === editingModelIndex
          ? { ...m, displayName: editModelName.trim(), capabilities: editModelCaps, fcMode: editModelFc }
          : m,
      ));
      setEditingModelIndex(null);
      return;
    }
    if (!providerId) return;
    const model = models[editingModelIndex];
    try {
      const updated = await updateModel(providerId, model.modelId, {
        displayName: editModelName.trim(),
        capabilities: editModelCaps,
        fcMode: editModelFc,
      });
      setModels(models.map((m, i) => (i === editingModelIndex ? updated : m)));
      setEditingModelIndex(null);
    } catch (err) {
      console.error('[ProviderEdit] Edit model failed', err);
    }
  }

  function resetModelForm() {
    setNewModelId('');
    setNewModelName('');
    setNewModelCaps([]);
    setNewModelFc('none');
    setShowAddModel(false);
  }

  async function handleFetchModels() {
    setFetchLoading(true);
    setFetchError('');
    setShowFetchModal(true);
    try {
      let result: FetchedRemoteModel[];
      if (isNew) {
        const key = pendingKeys[0];
        if (!key) { setFetchError('Please add an API key first'); setFetchLoading(false); return; }
        result = await fetchRemoteModelsDirect({
          baseUrl, apiProtocol, urlMode, useAuthorizationFormat, apiKey: key,
        });
      } else {
        if (!providerId) return;
        result = await fetchRemoteModels(providerId);
      }
      setFetchedModels(result);
      setSelectedFetchIds(new Set());
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setFetchLoading(false);
    }
  }

  function toggleFetchSelection(id: string) {
    setSelectedFetchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleAddFetchedModels() {
    const existingIds = new Set(
      isNew ? pendingModels.map((m) => m.modelId) : models.map((m) => m.modelId),
    );
    const toAdd = fetchedModels.filter((m) => selectedFetchIds.has(m.id) && !existingIds.has(m.id));

    if (isNew) {
      const newPending = toAdd.map((m) => ({
        modelId: m.id,
        displayName: m.name ?? m.id,
        capabilities: [] as ModelCapability[],
        fcMode: 'none' as FcMode,
      }));
      setPendingModels((prev) => [...prev, ...newPending]);
    } else {
      if (!providerId) return;
      for (const m of toAdd) {
        try {
          const model = await addModel(providerId, {
            modelId: m.id,
            displayName: m.name ?? m.id,
            source: 'fetched',
            capabilities: [],
            fcMode: 'none',
          });
          setModels((prev) => [...prev, model]);
        } catch (err) {
          console.error(`[ProviderEdit] Failed to add fetched model ${m.id}`, err);
        }
      }
    }
    setShowFetchModal(false);
  }

  function updateAdv<K extends keyof AdvancedSettings>(key: K, patch: Partial<AdvancedSettings[K]>) {
    setAdvancedSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function updateThinking<K extends keyof AdvancedSettings['thinking']>(key: K, patch: Partial<AdvancedSettings['thinking'][K]>) {
    setAdvancedSettings((prev) => ({
      ...prev,
      thinking: { ...prev.thinking, [key]: { ...prev.thinking[key], ...patch } },
    }));
  }

  function maskKey(key: string): string {
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••' + key.slice(-4);
  }

  const displayKeys = isNew ? pendingKeys : apiKeys;
  const displayModels: Array<ProviderModel | PendingModel> = isNew ? pendingModels : models;

  const divider: React.CSSProperties = { borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 10 };
  const itemCard: React.CSSProperties = { ...glass, borderRadius: 8, padding: '6px 10px', marginBottom: 4 };
  const label: React.CSSProperties = { fontSize: 11, color: T.text3, marginBottom: 2 };
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: T.text2, marginBottom: 8, letterSpacing: 0.5 };

  if (loading) {
    return (
      <div style={{ padding: 12, textAlign: 'center', color: T.text3, fontSize: 11 }}>
        {t('loading')}
      </div>
    );
  }

  function capBadge(cap: ModelCapability) {
    const colors: Record<string, { bg: string; clr: string; bdr: string }> = {
      image_generation: { bg: 'rgba(175,82,222,0.15)', clr: T.purple, bdr: 'rgba(175,82,222,0.3)' },
      image_generation_tool: { bg: 'rgba(255,149,0,0.15)', clr: T.orange, bdr: 'rgba(255,149,0,0.3)' },
      vision: { bg: 'rgba(0,122,255,0.15)', clr: T.accent, bdr: 'rgba(0,122,255,0.3)' },
      function_calling: { bg: 'rgba(52,199,89,0.15)', clr: T.green, bdr: 'rgba(52,199,89,0.3)' },
    };
    const { bg, clr, bdr } = colors[cap] ?? colors.function_calling;
    const lbl = capLabels[cap] ?? cap;
    return (
      <span key={cap} style={{ marginRight: 4, marginBottom: 2, fontSize: 9, padding: '1px 6px', borderRadius: 4, background: bg, color: clr, border: `1px solid ${bdr}` }}>
        {lbl}
      </span>
    );
  }

  function ToggleSwitch({ value, onChange, label: lbl }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
    return (
      <div onClick={() => onChange(!value)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ marginRight: 6, display: 'flex' }}>
          {value ? <Icons.ToggleRight color={T.green} size={20} /> : <Icons.ToggleLeft color={T.text3} size={20} />}
        </span>
        {lbl && <span style={{ fontSize: 11, color: value ? T.text : T.text3 }}>{lbl}</span>}
      </div>
    );
  }

  function ParamRow({ checked, onCheck, label: lbl, desc, children }: {
    checked: boolean;
    onCheck: (v: boolean) => void;
    label: string;
    desc?: string;
    children: React.ReactNode;
  }) {
    return (
      <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: checked ? 'var(--pill-active-bg)' : 'transparent', border: `1px solid ${checked ? 'var(--pill-active-border)' : T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: checked ? 6 : 0 }}>
          <div onClick={() => onCheck(!checked)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <span style={{ marginRight: 8, display: 'flex' }}>
              {checked ? <Icons.Check color={T.accent} size={14} /> : <span style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${T.text3}`, display: 'inline-block' }} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: checked ? T.text : T.text2 }}>{lbl}</div>
              {desc && <div style={{ fontSize: 9, color: T.text3, marginTop: 1 }}>{desc}</div>}
            </div>
          </div>
        </div>
        {checked && <div style={{ paddingLeft: 22 }}>{children}</div>}
      </div>
    );
  }

  const capLabels: Record<string, string> = {
    image_generation: t('set.cap_image_gen'),
    image_generation_tool: t('set.cap_image_gen_tool'),
    vision: t('set.cap_vision'),
    function_calling: t('set.cap_fc'),
  };

  const fcLabels: Record<string, string> = {
    native: t('set.fc_native'),
    xml_prompt: t('set.fc_xml'),
    json_prompt: t('set.fc_json'),
    none: t('set.fc_none'),
  };

  const thinkingLevelLabels: Record<string, string> = {
    minimal: t('set.level_minimal'),
    low: t('set.level_low'),
    medium: t('set.level_medium'),
    high: t('set.level_high'),
    auto: t('set.level_auto'),
    concise: t('set.level_concise'),
    detailed: t('set.level_detailed'),
  };

  const protocolDescs: Record<string, string> = {
    openai: t('set.protocol_desc_openai'),
    openai_responses: t('set.protocol_desc_responses'),
    gemini: t('set.protocol_desc_gemini'),
  };

  const imageHistoryLabels: Record<string, string> = {
    native_server_state: t('set.history_native'),
    attach_to_user: t('set.history_attach'),
    embed_in_assistant: t('set.history_embed'),
  };

  const imageHistoryDescs: Record<string, string> = {
    native_server_state: t('set.history_desc_native'),
    attach_to_user: t('set.history_desc_attach'),
    embed_in_assistant: t('set.history_desc_embed'),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 10 }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.name')}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OpenAI, Gemini..." style={inputStyle} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.base_url')}</div>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.url_mode')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {(['auto', 'full'] as UrlMode[]).map((mode) => (
              <div key={mode} onClick={() => setUrlMode(mode)} style={{ ...(urlMode === mode ? pillActive : pill), marginRight: 6, marginBottom: 2 }}>
                {mode === 'auto' ? t('set.url_mode_auto') : t('set.url_mode_full')}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.api_protocol')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {([
              { value: 'openai' as ApiProtocol, label: t('set.protocol_openai') },
              { value: 'openai_responses' as ApiProtocol, label: t('set.protocol_responses') },
              { value: 'gemini' as ApiProtocol, label: t('set.protocol_gemini') },
            ]).map((opt) => (
              <div key={opt.value} onClick={() => {
                setApiProtocol(opt.value);
                if (opt.value === 'openai_responses') setImageHistoryStrategy('native_server_state');
                else if (opt.value === 'openai') setImageHistoryStrategy('attach_to_user');
                const allDefaults = Object.values(DEFAULT_BASE_URLS);
                if (!baseUrl || allDefaults.includes(baseUrl)) {
                  setBaseUrl(DEFAULT_BASE_URLS[opt.value]);
                }
              }} style={{ ...(apiProtocol === opt.value ? pillActive : pill), marginRight: 6, marginBottom: 2 }}>
                {opt.label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: T.text3, marginTop: 4, padding: '3px 6px', borderRadius: 4, background: 'var(--pill-active-bg)' }}>
            {protocolDescs[apiProtocol]}
          </div>
        </div>

        {apiProtocol !== 'gemini' && (
          <div style={{ marginBottom: 8 }}>
            <div style={label}>{t('set.image_history_label')}</div>
            <div style={{ fontSize: 9, color: T.text3, marginBottom: 4 }}>
              {t('set.image_history_desc')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {(apiProtocol === 'openai'
                ? (['attach_to_user', 'embed_in_assistant'] as ImageHistoryStrategy[])
                : (['native_server_state', 'attach_to_user', 'embed_in_assistant'] as ImageHistoryStrategy[])
              ).map((strategy) => (
                <div
                  key={strategy}
                  onClick={() => setImageHistoryStrategy(strategy)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: imageHistoryStrategy === strategy ? 'var(--pill-active-bg)' : 'transparent',
                    border: `1px solid ${imageHistoryStrategy === strategy ? 'var(--pill-active-border)' : T.border}`,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 500, color: imageHistoryStrategy === strategy ? T.accent : T.text2 }}>
                    {imageHistoryLabels[strategy]}
                  </div>
                  <div style={{ fontSize: 9, color: T.text3, marginTop: 1 }}>
                    {imageHistoryDescs[strategy]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.key_strategy_label')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {([
              { value: 'round_robin' as KeyStrategy, label: t('set.round_robin') },
              { value: 'fallback' as KeyStrategy, label: t('set.fallback') },
            ]).map((opt) => (
              <div key={opt.value} onClick={() => setKeyStrategy(opt.value)} style={{ ...(keyStrategy === opt.value ? pillActive : pill), marginRight: 6, marginBottom: 2 }}>
                {opt.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
            <div style={{ fontSize: 11, color: T.text2, fontWeight: 500 }}>{t('set.stream_label')}</div>
            <div style={{ fontSize: 9, color: T.text3 }}>{t('set.stream_desc')}</div>
          </div>
          <ToggleSwitch value={streamEnabled} onChange={setStreamEnabled} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={label}>{t('set.max_context_label')}</div>
          <div style={{ fontSize: 9, color: T.text3, marginBottom: 3 }}>{t('set.max_context_desc')}</div>
          <input
            type="number"
            value={maxContextTokens}
            onChange={(e) => setMaxContextTokens(Number(e.target.value) || 0)}
            style={{ ...inputStyle, width: 140 }}
          />
        </div>
      </div>

      {/* API Keys */}
      <div style={divider}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('set.api_keys')}</span>
        </div>

        {displayKeys.map((keyItem, index) => {
          const keyStr = typeof keyItem === 'string' ? keyItem : (keyItem as ProviderApiKey).apiKey;
          const keyId = typeof keyItem === 'string' ? '' : (keyItem as ProviderApiKey).id;
          return (
            <div key={isNew ? index : keyId} style={{ ...itemCard, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: T.text2, fontFamily: 'monospace', fontSize: 11 }}>{maskKey(keyStr)}</span>
              <div onClick={() => handleDeleteKey(keyId, index)} style={{ cursor: 'pointer', color: T.red, display: 'flex' }}>
                <Icons.Trash color={T.red} />
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', marginTop: 6 }}>
          <input value={newKeyValue} onChange={(e) => setNewKeyValue(e.target.value)} placeholder="sk-..." onKeyDown={(e) => e.key === 'Enter' && handleAddKey()} style={{ ...inputStyle, flex: 1, marginRight: 6 }} />
          <div onClick={handleAddKey} style={{ ...pill, fontSize: 10, color: T.accent }}>
            <span style={{ marginRight: 4, display: 'flex' }}><Icons.Plus color={T.accent} /></span> {t('set.add_key')}
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, color: T.text2, fontWeight: 500 }}>{t('set.auth_format')}</div>
              <div style={{ fontSize: 9, color: T.text3, maxWidth: 240 }}>{t('set.auth_format_desc')}</div>
            </div>
            <ToggleSwitch value={useAuthorizationFormat} onChange={setUseAuthorizationFormat} />
          </div>
          <div style={{ fontSize: 9, color: useAuthorizationFormat ? T.accent : T.text3, marginTop: 4, fontFamily: 'monospace', padding: '3px 6px', borderRadius: 4, background: 'var(--pill-active-bg)' }}>
            {apiProtocol === 'gemini'
              ? (useAuthorizationFormat ? 'Authorization: Bearer <key>' : '?key=<key>')
              : (useAuthorizationFormat ? 'Authorization: Bearer <key>' : 'Authorization: Bearer <key>')}
          </div>
        </div>
      </div>

      {/* Models */}
      <div style={divider}>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('set.models')}</span>
          <div style={{ display: 'flex' }}>
            {(
              <div onClick={handleFetchModels} style={{ ...pill, fontSize: 10, color: T.accent, marginRight: 6 }}>
                <span style={{ marginRight: 4, display: 'flex' }}><Icons.Download color={T.accent} /></span> {t('set.fetch_models')}
              </div>
            )}
            <div onClick={() => setShowAddModel(!showAddModel)} style={{ ...pill, fontSize: 10 }}>
              <span style={{ marginRight: 4, display: 'flex' }}><Icons.Plus color={T.text2} /></span> {t('set.add_model')}
            </div>
          </div>
        </div>

        {displayModels.map((model, index) => {
          const isPersisted = 'id' in model;
          const modelId = isPersisted ? (model as ProviderModel).modelId : (model as PendingModel).modelId;
          const displayName = isPersisted ? (model as ProviderModel).displayName : (model as PendingModel).displayName;
          const caps = isPersisted ? (model as ProviderModel).capabilities : (model as PendingModel).capabilities;
          const fc = isPersisted ? (model as ProviderModel).fcMode : (model as PendingModel).fcMode;
          const enabled = isPersisted ? (model as ProviderModel).enabled : true;
          const isEditing = editingModelIndex === index;

          if (isEditing) {
            return (
              <div key={isPersisted ? (model as ProviderModel).id : index} style={{ ...glass, borderRadius: 8, padding: 12, marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace', marginBottom: 6 }}>{modelId}</div>
                <div style={{ marginBottom: 8 }}>
                  <div style={label}>{t('set.display_name')}</div>
                  <input value={editModelName} onChange={(e) => setEditModelName(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={label}>{t('set.capabilities')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {(['image_generation', 'image_generation_tool', 'vision', 'function_calling'] as ModelCapability[]).map((cap) => (
                      <div key={cap} onClick={() => toggleCap(cap, setEditModelCaps)} style={{ ...(editModelCaps.includes(cap) ? pillActive : pill), marginRight: 4, marginBottom: 2 }}>
                        {capLabels[cap]}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={label}>{t('set.fc_mode')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {(['native', 'xml_prompt', 'json_prompt', 'none'] as FcMode[]).map((opt) => (
                      <div key={opt} onClick={() => setEditModelFc(opt)} style={{ ...(editModelFc === opt ? pillActive : pill), marginRight: 4, marginBottom: 2 }}>
                        {fcLabels[opt]}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div onClick={() => setEditingModelIndex(null)} style={{ ...pill, fontSize: 10, marginRight: 6 }}>{t('cancel')}</div>
                  <div onClick={handleSaveEditModel} style={{ ...pill, fontSize: 10, color: T.accent }}>
                    <span style={{ marginRight: 4, display: 'flex' }}><Icons.Save color={T.accent} /></span> {t('confirm')}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={isPersisted ? (model as ProviderModel).id : index} style={{ ...itemCard, padding: '8px 10px', marginBottom: 6, opacity: enabled ? 1 : 0.5, display: 'flex' }}>
              <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{displayName}</div>
                <div style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace', marginBottom: 4 }}>{modelId}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  {caps.map(capBadge)}
                  <span style={{ marginRight: 4, marginBottom: 2, fontSize: 9, padding: '1px 6px', borderRadius: 4, background: T.glass, color: T.text3, border: `1px solid ${T.border}` }}>
                    {t('set.fc_mode')}: {fcLabels[fc] ?? fc}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                <div style={{ display: 'flex', marginBottom: 4 }}>
                  <div onClick={() => startEditModel(index)} style={{ cursor: 'pointer', color: T.accent, display: 'flex', padding: 2, marginRight: 6 }}>
                    <Icons.Pencil color={T.accent} size={12} />
                  </div>
                  <div onClick={() => handleDeleteModel(model as ProviderModel, index)} style={{ cursor: 'pointer', color: T.red, display: 'flex', padding: 2 }}>
                    <Icons.Trash color={T.red} size={12} />
                  </div>
                </div>
                {isPersisted && !isNew && (
                  <div onClick={() => handleToggleModel(model as ProviderModel)} style={{
                    display: 'flex', alignItems: 'center', padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 10,
                    background: enabled ? 'rgba(52,199,89,0.10)' : 'var(--glass)',
                    border: `1px solid ${enabled ? 'rgba(52,199,89,0.25)' : T.border}`,
                    color: enabled ? T.green : T.text3, whiteSpace: 'nowrap',
                  }}>
                    <span style={{ marginRight: 5, display: 'flex' }}>
                      {enabled ? <Icons.ToggleRight color={T.green} size={18} /> : <Icons.ToggleLeft color={T.text3} size={18} />}
                    </span>
                    {enabled ? t('set.enabled') : t('set.disabled')}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {showAddModel && (
          <div style={{ ...glass, borderRadius: 8, padding: 12, marginTop: 4, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>{t('set.model_id')}</div>
              <input value={newModelId} onChange={(e) => setNewModelId(e.target.value)} placeholder="gpt-4o, gemini-2.5-pro..." style={inputStyle} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>{t('set.display_name')}</div>
              <input value={newModelName} onChange={(e) => setNewModelName(e.target.value)} placeholder="GPT-4o" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>{t('set.capabilities')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {(['image_generation', 'image_generation_tool', 'vision', 'function_calling'] as ModelCapability[]).map((cap) => (
                  <div key={cap} onClick={() => toggleCap(cap, setNewModelCaps)} style={{ ...(newModelCaps.includes(cap) ? pillActive : pill), marginRight: 4, marginBottom: 2 }}>
                    {capLabels[cap]}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>{t('set.fc_mode')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {(['native', 'xml_prompt', 'json_prompt', 'none'] as FcMode[]).map((opt) => (
                  <div key={opt} onClick={() => setNewModelFc(opt)} style={{ ...(newModelFc === opt ? pillActive : pill), marginRight: 4, marginBottom: 2 }}>
                    {fcLabels[opt]}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div onClick={resetModelForm} style={{ ...pill, fontSize: 10, marginRight: 6 }}>{t('cancel')}</div>
              <div onClick={handleAddModel} style={{ ...pill, fontSize: 10, color: T.accent }}>
                <span style={{ marginRight: 4, display: 'flex' }}><Icons.Plus color={T.accent} /></span> {t('set.add_model')}
              </div>
            </div>
          </div>
        )}

        {showFetchModal && (
          <div style={{ ...glass, borderRadius: 8, padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 8 }}>
              {t('set.fetch_models')}
            </div>
            {fetchLoading && <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: 12 }}>{t('set.fetching')}</div>}
            {fetchError && <div style={{ fontSize: 11, color: T.red, padding: 8 }}>{t('error')}: {fetchError}</div>}
            {!fetchLoading && !fetchError && fetchedModels.length === 0 && (
              <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: 12 }}>{t('set.no_models_found')}</div>
            )}
            {!fetchLoading && fetchedModels.length > 0 && (
              <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
                {fetchedModels.map((m) => {
                  const existsAlready = models.some((em) => em.modelId === m.id);
                  const selected = selectedFetchIds.has(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => !existsAlready && toggleFetchSelection(m.id)}
                      style={{
                        padding: '5px 8px', borderRadius: 6, marginBottom: 3, cursor: existsAlready ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center',
                        background: selected ? 'var(--pill-active-bg)' : 'transparent',
                        border: `1px solid ${selected ? 'var(--pill-active-border)' : 'transparent'}`,
                        opacity: existsAlready ? 0.4 : 1,
                      }}
                    >
                      <span style={{ marginRight: 8, display: 'flex' }}>
                        {selected ? <Icons.Check color={T.accent} size={12} /> : <span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${T.text3}`, display: 'inline-block' }} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name ?? m.id}</div>
                        {m.name !== m.id && <div style={{ fontSize: 9, color: T.text3, fontFamily: 'monospace' }}>{m.id}</div>}
                      </div>
                      {existsAlready && <span style={{ fontSize: 9, color: T.text3, marginLeft: 4 }}>{t('set.already_added')}</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div onClick={() => setShowFetchModal(false)} style={{ ...pill, fontSize: 10, marginRight: 6 }}>{t('cancel')}</div>
              {fetchedModels.length > 0 && (
                <div onClick={handleAddFetchedModels} style={{ ...pill, fontSize: 10, color: T.accent, opacity: selectedFetchIds.size === 0 ? 0.4 : 1 }}>
                  {t('set.add_selected')} ({selectedFetchIds.size})
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Advanced Settings */}
      <div style={divider}>
        <div
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: showAdvanced ? 8 : 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: 6, display: 'flex' }}><Icons.SlidersHorizontal color={T.text2} size={13} /></span>
            <span>{t('set.advanced')}</span>
          </div>
          {showAdvanced ? <Icons.ChevronUp color={T.text3} /> : <Icons.ChevronDown color={T.text3} />}
        </div>

        {showAdvanced && (
          <div>
            <div style={{ fontSize: 9, color: T.text3, marginBottom: 10 }}>{t('set.adv_hint')}</div>

            <ParamRow checked={advancedSettings.temperature.enabled} onCheck={(v) => updateAdv('temperature', { enabled: v })} label={t('set.param_temperature')} desc={t('set.param_temperature_desc')}>
              <input type="number" step="0.1" min="0" max="2" value={advancedSettings.temperature.value} onChange={(e) => updateAdv('temperature', { value: parseFloat(e.target.value) || 0 })} style={{ ...inputStyle, width: 100 }} />
            </ParamRow>

            <ParamRow checked={advancedSettings.maxOutputTokens.enabled} onCheck={(v) => updateAdv('maxOutputTokens', { enabled: v })} label={t('set.param_max_output')} desc={t('set.param_max_output_desc')}>
              <input type="number" min="1" value={advancedSettings.maxOutputTokens.value} onChange={(e) => updateAdv('maxOutputTokens', { value: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, width: 120 }} />
            </ParamRow>

            <ParamRow checked={advancedSettings.topP.enabled} onCheck={(v) => updateAdv('topP', { enabled: v })} label={t('set.param_top_p')} desc={t('set.param_top_p_desc')}>
              <input type="number" step="0.05" min="0" max="1" value={advancedSettings.topP.value} onChange={(e) => updateAdv('topP', { value: parseFloat(e.target.value) || 0 })} style={{ ...inputStyle, width: 100 }} />
            </ParamRow>

            <ParamRow checked={advancedSettings.topK.enabled} onCheck={(v) => updateAdv('topK', { enabled: v })} label={t('set.param_top_k')} desc={t('set.param_top_k_desc')}>
              <input type="number" min="1" value={advancedSettings.topK.value} onChange={(e) => updateAdv('topK', { value: parseInt(e.target.value) || 1 })} style={{ ...inputStyle, width: 100 }} />
            </ParamRow>

            {/* Thinking / Reasoning Config */}
            <div style={{ ...glass, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.text2, marginBottom: 4 }}>
                {t('set.thinking_title')}
              </div>
              <div style={{ fontSize: 9, color: T.text3, marginBottom: 10 }}>
                {t('set.thinking_desc')}
              </div>

              {apiProtocol === 'gemini' && (
                <>
                  <ParamRow checked={advancedSettings.thinking.thinkingLevel.enabled} onCheck={(v) => updateThinking('thinkingLevel', { enabled: v })} label={t('set.thinking_level')} desc={t('set.thinking_level_desc')}>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {(['minimal', 'low', 'medium', 'high'] as GeminiThinkingLevel[]).map((level) => (
                        <div key={level} onClick={() => updateThinking('thinkingLevel', { value: level })} style={{ ...(advancedSettings.thinking.thinkingLevel.value === level ? pillActive : pill), fontSize: 10, marginRight: 4, marginBottom: 2 }}>
                          {thinkingLevelLabels[level] ?? level}
                        </div>
                      ))}
                    </div>
                  </ParamRow>

                  <ParamRow checked={advancedSettings.thinking.thinkingBudget.enabled} onCheck={(v) => updateThinking('thinkingBudget', { enabled: v })} label={t('set.thinking_budget')} desc={t('set.thinking_budget_desc')}>
                    <input type="number" min="-1" max="32768" value={advancedSettings.thinking.thinkingBudget.value} onChange={(e) => updateThinking('thinkingBudget', { value: parseInt(e.target.value) ?? -1 })} style={{ ...inputStyle, width: 120 }} />
                  </ParamRow>

                  <ParamRow checked={advancedSettings.thinking.includeThoughts.enabled} onCheck={(v) => updateThinking('includeThoughts', { enabled: v })} label={t('set.include_thoughts')} desc={t('set.include_thoughts_desc')}>
                    <ToggleSwitch value={advancedSettings.thinking.includeThoughts.value} onChange={(v) => updateThinking('includeThoughts', { value: v })} />
                  </ParamRow>
                </>
              )}

              {(apiProtocol === 'openai' || apiProtocol === 'openai_responses') && (
                <>
                  <ParamRow checked={advancedSettings.thinking.reasoningEffort.enabled} onCheck={(v) => updateThinking('reasoningEffort', { enabled: v })} label={t('set.reasoning_effort')} desc={t('set.reasoning_effort_desc')}>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {(['low', 'medium', 'high'] as OaiReasoningEffort[]).map((level) => (
                        <div key={level} onClick={() => updateThinking('reasoningEffort', { value: level })} style={{ ...(advancedSettings.thinking.reasoningEffort.value === level ? pillActive : pill), fontSize: 10, marginRight: 4, marginBottom: 2 }}>
                          {thinkingLevelLabels[level] ?? level}
                        </div>
                      ))}
                    </div>
                  </ParamRow>

                  <ParamRow checked={advancedSettings.thinking.reasoningSummary.enabled} onCheck={(v) => updateThinking('reasoningSummary', { enabled: v })} label={t('set.reasoning_summary')} desc={t('set.reasoning_summary_desc')}>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {(['auto', 'concise', 'detailed'] as OaiReasoningSummary[]).map((level) => (
                        <div key={level} onClick={() => updateThinking('reasoningSummary', { value: level })} style={{ ...(advancedSettings.thinking.reasoningSummary.value === level ? pillActive : pill), fontSize: 10, marginRight: 4, marginBottom: 2 }}>
                          {thinkingLevelLabels[level] ?? level}
                        </div>
                      ))}
                    </div>
                  </ParamRow>
                </>
              )}
            </div>

            {/* Image Generation Config (Gemini only) */}
            {apiProtocol === 'gemini' && (
              <div style={{ ...glass, borderRadius: 8, padding: 10, marginTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text2, marginBottom: 4 }}>
                  {t('set.image_gen_title')}
                </div>
                <div style={{ fontSize: 9, color: T.text3, marginBottom: 10 }}>
                  {t('set.image_gen_desc')}
                </div>

                <ParamRow checked={advancedSettings.imageSize.enabled} onCheck={(v) => updateAdv('imageSize', { enabled: v })} label={t('set.image_size_label')} desc={t('set.image_size_desc')}>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {(['1K', '2K', '4K'] as GeminiImageSize[]).map((size) => (
                      <div key={size} onClick={() => updateAdv('imageSize', { value: size })} style={{ ...(advancedSettings.imageSize.value === size ? pillActive : pill), fontSize: 10, marginRight: 4, marginBottom: 2 }}>
                        {size}
                      </div>
                    ))}
                  </div>
                </ParamRow>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ ...divider, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 4 }}>
        <div>
          {!isNew && (
            confirmDelete ? (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: T.red, marginRight: 6 }}>{t('set.confirm_delete_ask')}</span>
                <div className="btn-press" onClick={handleDelete} style={{ ...btnDanger, fontSize: 10, marginRight: 6 }}>{t('confirm')}</div>
                <div onClick={() => setConfirmDelete(false)} style={{ ...pill, fontSize: 10 }}>{t('cancel')}</div>
              </div>
            ) : (
              <div className="btn-press" onClick={() => setConfirmDelete(true)} style={{ ...btnDanger, fontSize: 10 }}>
                <span style={{ marginRight: 4, display: 'flex' }}><Icons.Trash color={T.red} /></span> {t('set.delete_provider')}
              </div>
            )
          )}
        </div>
        <div style={{ display: 'flex', marginLeft: 'auto' }}>
          <div onClick={onCancel} style={{ ...pill, fontSize: 11, marginRight: 6 }}>{t('cancel')}</div>
          <div className="btn-press" onClick={handleSave} style={{ ...btnSuccess, padding: '5px 16px', fontSize: 11, fontWeight: 500, opacity: saving ? 0.6 : 1 }}>
            <span style={{ marginRight: 4, display: 'flex' }}><Icons.Save color="#FFFFFF" /></span>
            {isNew ? t('set.create_provider') : t('set.save_provider')}
          </div>
        </div>
      </div>
    </div>
  );
}
