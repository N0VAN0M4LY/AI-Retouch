import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ApiProtocol,
  ChatSession,
  ChatMessage,
  ExtraImage,
  GenerationResult,
  ProviderWithDetails,
  SessionWithMessages,
  SendMessageResponse,
  GeminiImageSize,
  ImageContext,
  SendPolicy,
  SourceMode,
  SelectionInfo,
  RequestConfig,
} from '@ai-retouch/shared';
import {
  DEFAULT_SEND_POLICY_NO_SELECTION,
  DEFAULT_SEND_POLICY_WITH_SELECTION,
  computeActivePath,
  findDefaultLeaf,
} from '@ai-retouch/shared';
import * as Icons from '../../components/Icons';
import ConfirmDialog from '../../components/ConfirmDialog';
import Dropdown from '../../components/Dropdown';
import Tooltip from '../../components/Tooltip';
import { t } from '../../i18n/setup';
import {
  getSessions,
  createSession,
  deleteSession,
  getSessionDetail,
  updateSessionActiveLeaf,
  updateSessionModelRef,
  updateSessionBinding,
  updateSessionTitle,
} from '../../api/sessions';
import {
  sendMessageStream,
  regenerateStream,
  deleteMessage,
  getContextPreviewUrl,
  getContextImageUrl,
} from '../../api/messages';
import {
  getResults,
  getResultPreviewUrl,
  updateResult,
} from '../../api/results';
import { getProviders } from '../../api/providers';
import { getSetting, putSetting } from '../../api/settings';
import type { StreamCallbacks } from '../../api/types';
import { useDataRefresh, emitDataChange } from '../../hooks/useDataEvents';
import { useSelectionPolling } from '../../hooks/useSelectionPolling';
import type { DropdownOption } from '../../components/Dropdown';
import ImagePreviewOverlay from '../../components/ImagePreviewOverlay';
import { usePlatform } from '../../platform/PlatformProvider';
import { usePSConnected } from '../../platform/usePSConnected';

// ─── Types & Helpers ─────────────────────────────────

interface ModelOption {
  modelRef: string;
  label: string;
  apiProtocol: ApiProtocol;
  providerImageSize: GeminiImageSize | null;
}

function buildModelOptions(providers: ProviderWithDetails[]): ModelOption[] {
  const opts: ModelOption[] = [];
  for (const p of providers) {
    const imgSize = p.advancedSettings?.imageSize;
    const providerImageSize: GeminiImageSize | null =
      imgSize?.enabled ? imgSize.value : null;
    for (const m of p.models) {
      if (m.enabled && m.capabilities.includes('image_generation')) {
        opts.push({
          modelRef: `${p.id}/${m.modelId}`,
          label: `${p.name}/${m.displayName}`,
          apiProtocol: p.apiProtocol,
          providerImageSize,
        });
      }
    }
  }
  return opts;
}

interface SentImageInfo {
  count: number;
  sourceMode: SourceMode;
}

type ChatEntry =
  | { type: 'message'; message: ChatMessage; results: GenerationResult[]; sentImages?: SentImageInfo; tempImagePreviews?: string[] }
  | { type: 'error'; id: string; content: string };

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return new Date(ts).toLocaleDateString();
}

function sessionOrderKey(docPath: string): string {
  let h = 0;
  for (let i = 0; i < docPath.length; i++) {
    h = ((h << 5) - h + docPath.charCodeAt(i)) | 0;
  }
  return `session_order_${(h >>> 0).toString(36)}`;
}

function resultThumb(r: GenerationResult, docPath?: string | null, sessionId?: string | null): string {
  if (r.thumbnailData) return `data:image/jpeg;base64,${r.thumbnailData}`;
  return getResultPreviewUrl(r.id, docPath ?? undefined, sessionId ?? undefined);
}

function resultHQ(r: GenerationResult, docPath?: string | null, sessionId?: string | null): string {
  return getResultPreviewUrl(r.id, docPath ?? undefined, sessionId ?? undefined);
}

// ─── Props ────────────────────────────────────────────

interface DirectChatProps {
  providersVersion?: number;
  documentPath: string | null;
  onActiveSessionChange?: (sessionId: string | null) => void;
  onNavigateToSettings?: () => void;
}

export default function DirectChat({ providersVersion, documentPath, onActiveSessionChange, onNavigateToSettings }: DirectChatProps) {
  const platform = usePlatform();
  const bridgeConnected = usePSConnected();

  const [chatMode, setChatMode] = useState<'direct' | 'agent'>('direct');
  const [sessionOpen, setSessionOpen] = useState(true);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;
  const lastStreamResultRef = useRef<GenerationResult | null>(null);

  const [dragSessionId, setDragSessionId] = useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // --- entries (tree-aware) ---
  const allMessagesRef = useRef<ChatMessage[]>([]);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [sessionResults, setSessionResults] = useState<GenerationResult[]>([]);

  const LAST_MODEL_KEY = 'last_selected_model_v2';

  const [providers, setProviders] = useState<ProviderWithDetails[]>([]);
  const [modelRef, setModelRefRaw] = useState('');
  const setModelRef = useCallback((ref: string) => {
    setModelRefRaw(ref);
    if (ref) putSetting(LAST_MODEL_KEY, ref).catch(() => {});
  }, []);
  const models = buildModelOptions(providers);
  const modelDropdownOptions: DropdownOption[] = models.map((m) => ({
    value: m.modelRef,
    label: m.label,
  }));
  const selectedModelOption = models.find((m) => m.modelRef === modelRef);
  const selectedProtocol = selectedModelOption?.apiProtocol;
  const maskUnsupported = selectedProtocol === 'gemini';

  function resolveModelLabel(ref?: string | null): string | undefined {
    if (!ref) return undefined;
    return models.find((m) => m.modelRef === ref)?.label ?? ref.split('/').pop() ?? ref;
  }

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streamingResults, setStreamingResults] = useState<GenerationResult[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const [sendStartTime, setSendStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [recentResults, setRecentResults] = useState<GenerationResult[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [resultsExpanded, setResultsExpanded] = useState(false);

  // --- image size (gemini) ---
  const [imageSize, setImageSize] = useState<GeminiImageSize | null>('2K');

  // Dialog state for replacing system alert()/confirm()
  const [dialogConfig, setDialogConfig] = useState<{
    open: boolean;
    message: string;
    title?: string;
    variant?: 'default' | 'danger';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({ open: false, message: '', onConfirm: () => {} });

  function closeDialog() {
    setDialogConfig((prev) => ({ ...prev, open: false }));
  }

  // --- source mode & send policy ---
  const [sourceMode, setSourceModeRaw] = useState<SourceMode>('visibleMerged');
  const policySelRef = useRef<SendPolicy>({ ...DEFAULT_SEND_POLICY_WITH_SELECTION });
  const policyNoSelRef = useRef<SendPolicy>({ ...DEFAULT_SEND_POLICY_NO_SELECTION });
  const [sendPolicy, setSendPolicyRaw] = useState<SendPolicy>(
    () => ({ ...DEFAULT_SEND_POLICY_NO_SELECTION }),
  );

  const {
    effectiveSelection,
    hasSelection,
    isLocked: sessionLocked,
    lock: lockSelection,
    unlock: unlockSelection,
  } = useSelectionPolling({
    enabled: bridgeConnected,
    getSelection: platform.ps.getSelection,
    subscribeToEvents: useCallback(
      (handler: (sel: import('@ai-retouch/shared').SelectionInfo | null) => void) => platform.events.onBridgeEvent('selectionChanged', (e) => handler((e.data as any)?.selection ?? null)),
      [platform.events]
    ),
    onSelectionChange: (_newSel, prevSel) => {
      const hadSel = !!prevSel;
      const hasSel = !!_newSel;
      if (hadSel !== hasSel) {
        setSendPolicyRaw(hasSel ? policySelRef.current : policyNoSelRef.current);
      }
    },
  });

  function setSendPolicy(policy: SendPolicy) {
    setSendPolicyRaw(policy);
    if (hasSelection) {
      policySelRef.current = policy;
      putSetting('send_policy_selection', policy).catch(() => {});
    } else {
      policyNoSelRef.current = policy;
      putSetting('send_policy_no_selection', policy).catch(() => {});
    }
  }

  function togglePolicyField(field: keyof SendPolicy) {
    const next = { ...sendPolicy };
    if (hasSelection && (field === 'sendFullImage' || field === 'sendRegionImage')) {
      next.sendFullImage = field === 'sendFullImage';
      next.sendRegionImage = field === 'sendRegionImage';
    } else {
      next[field] = !next[field];
    }
    setSendPolicy(next);
  }

  function setSourceMode(mode: SourceMode) {
    setSourceModeRaw(mode);
    putSetting('last_source_mode', mode).catch(() => {});
  }

  // --- send preview (lazy mode: only on new session, manual refresh, or send) ---
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEnlarged, setPreviewEnlarged] = useState(false);
  const previewVersionRef = useRef(0);
  const [previewStale, setPreviewStale] = useState(false);

  // --- extra user-uploaded images ---
  interface LocalExtraImage { id: string; file: File; dataUrl: string }
  const [extraImages, setExtraImages] = useState<LocalExtraImage[]>([]);
  const [attachmentsCollapsed, setAttachmentsCollapsed] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewExtractingRef = useRef(false);
  const previewPendingRef = useRef(false);

  async function refreshPreview() {
    if (!bridgeConnected || sessionLocked) return;
    if (previewExtractingRef.current) {
      previewPendingRef.current = true;
      return;
    }
    previewExtractingRef.current = true;
    const version = ++previewVersionRef.current;
    setPreviewLoading(true);
    try {
      const sel = effectiveSelection;
      const showFullCanvas = sendPolicy.sendFullImage || !sel;
      const result = await platform.ps.extractImage({
        sourceMode,
        sendPolicy: {
          sendFullImage: showFullCanvas,
          sendRegionImage: !showFullCanvas,
          sendHighlightImage: false,
          sendMask: false,
        },
        overrideSelection: sel ?? undefined,
        maxResolution: 512,
      });
      if (previewVersionRef.current !== version) return;
      const imgData = result.fullImage || result.regionImage;
      if (imgData) {
        setPreviewSrc(`data:image/png;base64,${imgData}`);
      } else {
        setPreviewSrc(null);
      }
      setPreviewStale(false);
    } catch {
      if (previewVersionRef.current === version) setPreviewSrc(null);
    } finally {
      if (previewVersionRef.current === version) setPreviewLoading(false);
      previewExtractingRef.current = false;
      if (previewPendingRef.current) {
        previewPendingRef.current = false;
        refreshPreview();
      }
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setExtraImages((prev) => [
          ...prev,
          { id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, dataUrl: reader.result as string },
        ]);
        setAttachmentsCollapsed(false);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function removeExtraImage(id: string) {
    setExtraImages((prev) => prev.filter((img) => img.id !== id));
  }

  // --- result image preview overlay ---
  const [previewResultId, setPreviewResultId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Sync imageSize with provider ──────────────────
  useEffect(() => {
    if (!selectedModelOption) return;
    if (selectedModelOption.providerImageSize) {
      setImageSize(selectedModelOption.providerImageSize);
    } else {
      setImageSize('2K');
    }
  }, [modelRef]);

  // ─── Data fetching ─────────────────────────────────

  const sessionOrderLoaded = useRef(false);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getSessions(documentPath, chatMode);
      const sorted = [...data].sort((a, b) => b.createdAt - a.createdAt);
      setSessions(sorted);

      if (!sessionOrderLoaded.current && documentPath) {
        sessionOrderLoaded.current = true;
        try {
          const saved = await getSetting<string[]>(sessionOrderKey(documentPath));
          if (Array.isArray(saved) && saved.length > 0) {
            const ids = new Set(sorted.map((s) => s.id));
            const kept = saved.filter((id) => ids.has(id));
            const newIds = sorted.map((s) => s.id).filter((id) => !kept.includes(id));
            setSessionOrder([...newIds, ...kept]);
            return;
          }
        } catch { /* no saved order yet */ }
      }

      setSessionOrder((prev) => {
        const ids = new Set(sorted.map((s) => s.id));
        const kept = prev.filter((id) => ids.has(id));
        const newIds = sorted.map((s) => s.id).filter((id) => !kept.includes(id));
        return newIds.length > 0 || kept.length !== prev.length
          ? [...newIds, ...kept]
          : prev;
      });
    } catch { /* ignore */ }
  }, [documentPath, chatMode]);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await getProviders();
      setProviders(data);
      const opts = buildModelOptions(data);
      if (opts.length > 0 && !modelRef) {
        try {
          const saved = await getSetting<string>(LAST_MODEL_KEY);
          if (saved && opts.find((m) => m.modelRef === saved)) {
            setModelRefRaw(saved);
            return;
          }
        } catch { /* no saved model */ }
        setModelRefRaw(opts[0].modelRef);
      }
    } catch { /* ignore */ }
  }, [modelRef]);

  const loadSessionEntries = useCallback(async (sessionId: string, restoreSelection = true) => {
    if (!documentPath) return;
    try {
      const detail: SessionWithMessages = await getSessionDetail(sessionId, documentPath);
      if (activeSessionIdRef.current !== sessionId) return;

      allMessagesRef.current = detail.messages;
      const activeLeaf = detail.activeLeafId ?? null;
      const pathMessages = computeActivePath(detail.messages, activeLeaf);
      const loaded: ChatEntry[] = pathMessages.map((msg) => ({
        type: 'message' as const,
        message: msg,
        results: detail.results.filter((r) => r.messageId === msg.id),
        ...(msg.metadata?.sentImages ? { sentImages: msg.metadata.sentImages as SentImageInfo } : {}),
      }));
      setEntries(loaded);
      setSessionResults(detail.results);

      if (restoreSelection) {
        if (detail.modelRef && models.length > 0) {
          const match = models.find((m) => m.modelRef === detail.modelRef);
          if (match) setModelRef(detail.modelRef);
        }

        const hasMessages = pathMessages.length > 0;
        setAttachmentsCollapsed(hasMessages);
        if (hasMessages) {
          const lastUserMsg = pathMessages.filter((m) => m.role === 'user').pop();
          const firstUserMsg = pathMessages.find((m) => m.role === 'user');
          const reqConfig = lastUserMsg?.requestConfig;
          lockSelection(reqConfig?.selectionBounds ?? null);
          if (reqConfig?.sendPolicy) {
            setSendPolicyRaw(reqConfig.sendPolicy);
          }
          if (reqConfig?.sourceMode) {
            setSourceModeRaw(reqConfig.sourceMode);
          }
          if (firstUserMsg) {
            setPreviewSrc(getContextPreviewUrl(firstUserMsg.id, documentPath!, sessionId));
          }
        } else {
          unlockSelection();
          setSourceModeRaw('visibleMerged');
          setSendPolicyRaw({ ...DEFAULT_SEND_POLICY_NO_SELECTION });
          setPreviewSrc(null);
          setPreviewStale(false);
          if (bridgeConnected) {
            setTimeout(() => refreshPreview(), 100);
          }
        }
      }

      if (detail.results.length > 0 && !selectedResultId) {
        setSelectedResultId(detail.results[detail.results.length - 1].id);
      }
    } catch { /* ignore */ }
  }, [documentPath, selectedResultId]);

  const fetchRecentResults = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const data = await getResults({ sessionId: activeSessionId, limit: 20, docPath: documentPath ?? undefined });
      if (data) setRecentResults(data.items);
    } catch { /* ignore */ }
  }, [activeSessionId, documentPath]);

  useEffect(() => {
    sessionOrderLoaded.current = false;
    setSessions([]);
    setSessionOrder([]);
    setActiveSessionId(null);
    allMessagesRef.current = [];
    setEntries([]);
    setSessionResults([]);
    setRecentResults([]);
    setStreamingText('');
    setStreamingResults([]);
    setSending(false);
    unlockSelection();
    setPreviewSrc(null);
    fetchSessions();
  }, [fetchSessions]);
  useEffect(() => { fetchProviders(); }, [providersVersion]);
  useEffect(() => {
    if (activeSessionId) {
      loadSessionEntries(activeSessionId, true);
      fetchRecentResults();
    } else {
      allMessagesRef.current = [];
      setEntries([]);
      setSessionResults([]);
      setRecentResults([]);
      unlockSelection();
      setPreviewSrc(null);
    }
  }, [activeSessionId]);

  useEffect(() => {
    onActiveSessionChange?.(activeSessionId);
  }, [activeSessionId, onActiveSessionChange]);

  useDataRefresh('sessions', fetchSessions);
  useDataRefresh('results', () => {
    if (activeSessionId) {
      loadSessionEntries(activeSessionId, false);
      fetchRecentResults();
    }
  });

  const orderedSessions = (() => {
    if (sessionOrder.length === 0) return sessions;
    const map = new Map(sessions.map((s) => [s.id, s]));
    const result: ChatSession[] = [];
    for (const id of sessionOrder) {
      const s = map.get(id);
      if (s) result.push(s);
    }
    return result;
  })();

  useEffect(() => {
    if (!activeSessionId && orderedSessions.length > 0) {
      setActiveSessionId(orderedSessions[0].id);
    }
  }, [orderedSessions, activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, streamingText]);

  useEffect(() => {
    if (!sessionLocked && previewSrc) setPreviewStale(true);
  }, [sourceMode, sendPolicy.sendFullImage, sendPolicy.sendRegionImage]);

  useEffect(() => {
    if (!sendStartTime) { setElapsedSec(0); return; }
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - sendStartTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [sendStartTime]);

  // ─── Session management ────────────────────────────

  async function handleDeleteSession(sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!documentPath) return;
    setDialogConfig({
      open: true,
      title: t('v2.delete_session'),
      message: t('v2.delete_session_confirm'),
      variant: 'danger',
      onConfirm: async () => {
        closeDialog();
        try {
          await deleteSession(sessionId, documentPath!);
          if (activeSessionId === sessionId) {
            const remaining = orderedSessions.filter((s) => s.id !== sessionId);
            setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
          }
          const newOrder = sessionOrder.filter((id) => id !== sessionId);
          setSessionOrder(newOrder);
          putSetting(sessionOrderKey(documentPath!), newOrder).catch(() => {});
          emitDataChange('sessions');
        } catch (err) {
          console.warn('[DirectChat] deleteSession failed:', err);
        }
      },
      onCancel: closeDialog,
    });
  }

  function handleStartRenameSession(sessionId: string, currentTitle: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingSessionId(sessionId);
    setEditingTitle(currentTitle);
  }

  async function handleFinishRenameSession() {
    if (!editingSessionId || !documentPath) return;
    const trimmed = editingTitle.trim();
    if (trimmed) {
      await updateSessionTitle(editingSessionId, documentPath, trimmed).catch(() => {});
      setSessions(prev => prev.map(s => s.id === editingSessionId ? { ...s, title: trimmed } : s));
    }
    setEditingSessionId(null);
    setEditingTitle('');
  }

  function handleDragStart(sessionId: string) {
    setDragSessionId(sessionId);
  }

  function handleDragOver(e: React.DragEvent, sessionId: string) {
    e.preventDefault();
    if (dragSessionId && dragSessionId !== sessionId) {
      setDragOverSessionId(sessionId);
    }
  }

  function handleDrop(targetId: string) {
    if (!dragSessionId || dragSessionId === targetId) {
      setDragSessionId(null);
      setDragOverSessionId(null);
      return;
    }
    setSessionOrder((prev) => {
      const order = prev.length > 0 ? [...prev] : orderedSessions.map((s) => s.id);
      const fromIdx = order.indexOf(dragSessionId!);
      const toIdx = order.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragSessionId!);
      if (documentPath) {
        putSetting(sessionOrderKey(documentPath), order).catch(() => {});
      }
      return order;
    });
    setDragSessionId(null);
    setDragOverSessionId(null);
  }

  function handleDragEnd() {
    setDragSessionId(null);
    setDragOverSessionId(null);
  }

  // ─── Branch navigation ─────────────────────────────

  function handleSwitchBranch(targetSiblingId: string) {
    if (!activeSessionId || !documentPath) return;
    const leafId = findDefaultLeaf(allMessagesRef.current, targetSiblingId);
    updateSessionActiveLeaf(activeSessionId, documentPath, leafId)
      .then(() => loadSessionEntries(activeSessionId!, false))
      .catch(() => {});
  }

  // ─── Actions ───────────────────────────────────────

  const handleNewSession = async () => {
    try {
      const session = await createSession({
        mode: chatMode,
        modelRef: modelRef || undefined,
        documentPath: documentPath ?? undefined,
      });
      if (session) {
        setActiveSessionId(session.id);
        emitDataChange('sessions');
      }
    } catch { /* ignore */ }
  };

  const ensureSession = async (): Promise<string | null> => {
    if (!documentPath) return null;
    if (activeSessionId) {
      try {
        const detail = await getSessionDetail(activeSessionId, documentPath);
        if (detail) return activeSessionId;
      } catch { /* session gone, fall through to create */ }
    }
    try {
      const session = await createSession({
        mode: chatMode,
        modelRef: modelRef || undefined,
        documentPath,
      });
      if (!session) return null;
      setActiveSessionId(session.id);
      emitDataChange('sessions');
      return session.id;
    } catch { return null; }
  };

  const handleSend = async () => {
    if (sending) return;
    if (!documentPath) {
      setValidationHint(t('v2.no_document') ?? '请先在 Photoshop 中打开一个文档');
      return;
    }
    if (!modelRef) {
      setValidationHint(t('chat.error_no_model') ?? '请先选择一个模型');
      return;
    }
    if (!inputText.trim()) {
      setValidationHint(t('chat.error_empty') ?? '请输入内容');
      return;
    }

    const sessionId = await ensureSession();
    if (!sessionId) return;

    const isFirstSendInSession = !sessionLocked;
    const selectionToUse = effectiveSelection;
    if (isFirstSendInSession) {
      lockSelection(selectionToUse);
    }

    const effectivePolicy = maskUnsupported
      ? { ...sendPolicy, sendMask: false }
      : sendPolicy;

    setSending(true);
    setSendStartTime(Date.now());
    setStreamingThinking('');
    setStreamingText('');
    setStreamingResults([]);
    setValidationHint(null);
    const text = inputText.trim();
    setInputText('');
    const pendingExtraImages = [...extraImages];
    setExtraImages([]);

    let imageContext: ImageContext | undefined;
    if (isFirstSendInSession && bridgeConnected) {
      const anySendEnabled = effectivePolicy.sendFullImage || effectivePolicy.sendRegionImage
        || effectivePolicy.sendHighlightImage || effectivePolicy.sendMask;
      if (anySendEnabled) {
        try {
          setExtracting(true);
          imageContext = await platform.ps.extractImage({
            sourceMode,
            sendPolicy: effectivePolicy,
            overrideSelection: selectionToUse ?? undefined,
            saveSelectionAlphaChannel: !!selectionToUse,
          });
          setExtracting(false);
        } catch (err) {
          setExtracting(false);
          const msg = err instanceof Error ? err.message : String(err);
          setValidationHint(`图像提取失败：${msg}`);
          setSending(false);
          setSendStartTime(null);
          setExtraImages(pendingExtraImages);
          return;
        }
      }
    }

    if (pendingExtraImages.length > 0) {
      const extras: ExtraImage[] = pendingExtraImages.map((img) => {
        const raw = img.dataUrl.replace(/^data:[^;]+;base64,/, '');
        return { data: raw, mimeType: img.file.type || 'image/png', name: img.file.name };
      });
      if (!imageContext) {
        imageContext = {
          canvasSize: { width: 0, height: 0 },
          sourceMode,
          extraImages: extras,
        };
      } else {
        imageContext.extraImages = extras;
      }
    }

    const tempId = `temp-${Date.now()}`;
    let sentImagesInfo: SentImageInfo | undefined;
    const extraCount = pendingExtraImages.length;
    if (imageContext) {
      const count = [imageContext.fullImage, imageContext.regionImage, imageContext.mask]
        .filter(Boolean).length
        + (sendPolicy.sendHighlightImage && imageContext.fullImage && imageContext.selection ? 1 : 0)
        + extraCount;
      if (count > 0) {
        sentImagesInfo = { count, sourceMode };
      }
    }

    const tempPreviews: string[] = [];
    if (previewSrc && isFirstSendInSession) tempPreviews.push(previewSrc);
    for (const img of pendingExtraImages) tempPreviews.push(img.dataUrl);

    setEntries((prev) => [
      ...prev,
      {
        type: 'message',
        message: {
          id: tempId,
          sessionId: sessionId!,
          parentId: null,
          childIds: [],
          role: 'user',
          content: text,
          thinking: '',
          timestamp: Date.now(),
        },
        results: [],
        sentImages: sentImagesInfo,
        tempImagePreviews: tempPreviews.length > 0 ? tempPreviews : undefined,
      },
    ]);

    const userMetadata = sentImagesInfo ? { sentImages: sentImagesInfo } : undefined;
    const requestConfig = {
      sourceMode,
      sendPolicy: effectivePolicy,
      modelRef,
      selectionBounds: selectionToUse ?? undefined,
      canvasSize: imageContext?.canvasSize,
    };

    const sid = sessionId;
    const callbacks: StreamCallbacks = {
      onThinkingDelta: (delta: string) => {
        setStreamingThinking((prev) => prev + delta);
      },
      onTextDelta: (delta: string) => {
        setStreamingText((prev) => prev + delta);
      },
      onImageResult: (result: GenerationResult) => {
        setStreamingResults((prev) => [...prev, result]);
        setSelectedResultId(result.id);
        setResultsExpanded(true);
      },
      onDone: (_resp: SendMessageResponse) => {
        abortRef.current = null;
        if (_resp.results && _resp.results.length > 0) {
          lastStreamResultRef.current = _resp.results[_resp.results.length - 1];
        }
        setSending(false);
        setSendStartTime(null);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        loadSessionEntries(sid, false);
        fetchRecentResults();
        emitDataChange('results');
        emitDataChange('sessions');

        const lastResult = lastStreamResultRef.current;
        if (lastResult && bridgeConnected && lastResult.width && lastResult.height) {
          platform.ps.applyResult({
            resultId: lastResult.id,
            width: lastResult.width,
            height: lastResult.height,
            sessionId: sid ?? undefined,
            documentPath: documentPath ?? undefined,
            requestConfig,
          }).then(() => {
            updateResult(lastResult.id, { appliedToCanvas: true }).catch(() => {});
            if (sid && documentPath) {
              updateSessionBinding(sid, documentPath, {
                layerName: 'AI Result',
                lastResultId: lastResult.id,
              }).catch(() => {});
            }
            emitDataChange('results');
          }).catch(() => {});
        }
        lastStreamResultRef.current = null;
      },
      onError: (err: string) => {
        abortRef.current = null;
        console.error('[DirectChat] send failed:', err);
        setSending(false);
        setSendStartTime(null);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        loadSessionEntries(sid, false);
      },
    };

    const handle = sendMessageStream(sid, documentPath, {
      content: text,
      modelRef,
      imageContext,
      userMetadata,
      requestConfig,
      imageSize: selectedProtocol === 'gemini' && imageSize ? imageSize : undefined,
      previewImageData: isFirstSendInSession && previewSrc ? previewSrc : undefined,
    }, callbacks);
    abortRef.current = handle.abort;
  };

  function handleAbort() {
    abortRef.current?.();
    abortRef.current = null;
    setSending(false);
    setSendStartTime(null);
    setStreamingThinking('');
    setStreamingText('');
    setStreamingResults([]);
  }

  function findRequestConfigForResult(resultId: string): RequestConfig | undefined {
    for (const e of entries) {
      if (e.type !== 'message') continue;
      if (e.results.some((r) => r.id === resultId)) {
        if (e.message.role === 'user' && e.message.requestConfig) {
          return e.message.requestConfig;
        }
        if (e.message.role === 'assistant') {
          const idx = entries.indexOf(e);
          for (let i = idx - 1; i >= 0; i--) {
            const prev = entries[i];
            if (prev.type === 'message' && prev.message.role === 'user' && prev.message.requestConfig) {
              return prev.message.requestConfig;
            }
          }
        }
      }
    }
    return undefined;
  }

  const handleApply = async (resultId: string, passedConfig?: RequestConfig) => {
    if (!bridgeConnected) return;
    try {
      const result = [...recentResults, ...sessionResults].find((r) => r.id === resultId);
      const reqConfig = passedConfig ?? result?.requestConfig ?? findRequestConfigForResult(resultId);
      await platform.ps.applyResult({
        resultId,
        width: result?.width ?? 1024,
        height: result?.height ?? 1024,
        sessionId: activeSessionId ?? undefined,
        documentPath: documentPath ?? undefined,
        requestConfig: reqConfig,
      });
      await updateResult(resultId, { appliedToCanvas: true });
      if (activeSessionId && documentPath) {
        updateSessionBinding(activeSessionId, documentPath, {
          layerName: 'AI Result',
          lastResultId: resultId,
        }).catch(() => {});
      }
      emitDataChange('results');
    } catch { /* ignore */ }
  };

  const handleToggleBookmark = async (resultId: string) => {
    const all = [...sessionResults, ...recentResults];
    const r = all.find((x) => x.id === resultId);
    if (!r) return;
    try {
      await updateResult(resultId, { bookmarked: !r.bookmarked });
      updateLocalResult(resultId, { bookmarked: !r.bookmarked });
      emitDataChange('results');
    } catch { /* ignore */ }
  };

  function updateLocalResult(resultId: string, patch: Partial<GenerationResult>) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.type !== 'message') return e;
        const updatedResults = e.results.map((r) =>
          r.id === resultId ? { ...r, ...patch } : r,
        );
        return { ...e, results: updatedResults };
      }),
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!activeSessionId || !documentPath) return;
    setDialogConfig({
      open: true,
      title: t('v2.delete_confirm'),
      message: t('v2.delete_confirm'),
      variant: 'danger',
      onConfirm: async () => {
        closeDialog();
        try {
          await deleteMessage(activeSessionId!, msgId, documentPath!);
          await loadSessionEntries(activeSessionId!, false);
          emitDataChange('results');
        } catch { /* ignore */ }
      },
      onCancel: closeDialog,
    });
  };

  const handleResendUser = (userMsg: ChatMessage) => {
    if (sending || !modelRef || !documentPath) return;
    handleRegenerate(userMsg.id);
  };

  const handleRegenerate = (userMsgId: string) => {
    if (sending || !activeSessionId || !documentPath || !modelRef) return;

    const userEntry = entries.find(
      (e) => e.type === 'message' && e.message.id === userMsgId,
    );
    const regenRequestConfig = userEntry?.type === 'message' ? userEntry.message.requestConfig : undefined;

    setEntries((prev) => {
      const userIdx = prev.findIndex(
        (e) => e.type === 'message' && e.message.id === userMsgId,
      );
      return userIdx >= 0 ? prev.slice(0, userIdx + 1) : prev;
    });

    setSending(true);
    setSendStartTime(Date.now());
    setStreamingThinking('');
    setStreamingText('');
    setStreamingResults([]);

    const callbacks: StreamCallbacks = {
      onThinkingDelta: (delta: string) => setStreamingThinking((p) => p + delta),
      onTextDelta: (delta: string) => setStreamingText((p) => p + delta),
      onImageResult: (result: GenerationResult) => {
        setStreamingResults((p) => [...p, result]);
        setSelectedResultId(result.id);
        setResultsExpanded(true);
      },
      onDone: (_resp: SendMessageResponse) => {
        abortRef.current = null;
        if (_resp.results && _resp.results.length > 0) {
          lastStreamResultRef.current = _resp.results[_resp.results.length - 1];
        }
        setSending(false);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        loadSessionEntries(activeSessionId!, false);
        fetchRecentResults();
        emitDataChange('results');
        emitDataChange('sessions');

        const lastResult = lastStreamResultRef.current;
        if (lastResult && bridgeConnected && lastResult.width && lastResult.height) {
          platform.ps.applyResult({
            resultId: lastResult.id,
            width: lastResult.width,
            height: lastResult.height,
            sessionId: activeSessionId ?? undefined,
            documentPath: documentPath ?? undefined,
            requestConfig: regenRequestConfig,
          }).then(() => {
            updateResult(lastResult.id, { appliedToCanvas: true }).catch(() => {});
            if (activeSessionId && documentPath) {
              updateSessionBinding(activeSessionId, documentPath, {
                layerName: 'AI Result',
                lastResultId: lastResult.id,
              }).catch(() => {});
            }
            emitDataChange('results');
          }).catch(() => {});
        }
        lastStreamResultRef.current = null;
      },
      onError: (err: string) => {
        abortRef.current = null;
        console.error('[DirectChat] regenerate failed:', err);
        setSending(false);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        if (activeSessionId) loadSessionEntries(activeSessionId, false);
      },
    };

    const handle = regenerateStream(activeSessionId, userMsgId, documentPath, { modelRef, imageSize: selectedProtocol === 'gemini' && imageSize ? imageSize : undefined }, callbacks);
    abortRef.current = handle.abort;
  };

  const handleEditMessage = async (msgId: string, parentId: string | null, newContent: string) => {
    if (sending || !documentPath || !modelRef || !activeSessionId) return;

    const originalEntry = entries.find(
      (e) => e.type === 'message' && e.message.id === msgId,
    );
    const editRequestConfig = originalEntry?.type === 'message' ? originalEntry.message.requestConfig : undefined;

    const sid = activeSessionId;
    setSending(true);
    setSendStartTime(Date.now());
    setStreamingThinking('');
    setStreamingText('');
    setStreamingResults([]);

    setEntries((prev) => [
      ...prev,
      {
        type: 'message',
        message: {
          id: `temp-edit-${Date.now()}`,
          sessionId: sid,
          parentId: parentId,
          childIds: [],
          role: 'user',
          content: newContent,
          thinking: '',
          timestamp: Date.now(),
        },
        results: [],
      },
    ]);

    const callbacks: StreamCallbacks = {
      onThinkingDelta: (delta: string) => {
        setStreamingThinking((prev) => prev + delta);
      },
      onTextDelta: (delta: string) => {
        setStreamingText((prev) => prev + delta);
      },
      onImageResult: (result: GenerationResult) => {
        setStreamingResults((prev) => [...prev, result]);
        setSelectedResultId(result.id);
        setResultsExpanded(true);
      },
      onDone: (_resp: SendMessageResponse) => {
        abortRef.current = null;
        if (_resp.results && _resp.results.length > 0) {
          lastStreamResultRef.current = _resp.results[_resp.results.length - 1];
        }
        setSending(false);
        setSendStartTime(null);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        loadSessionEntries(sid, false);
        fetchRecentResults();
        emitDataChange('results');
        emitDataChange('sessions');

        const lastResult = lastStreamResultRef.current;
        if (lastResult && bridgeConnected && lastResult.width && lastResult.height) {
          platform.ps.applyResult({
            resultId: lastResult.id,
            width: lastResult.width,
            height: lastResult.height,
            sessionId: sid ?? undefined,
            documentPath: documentPath ?? undefined,
            requestConfig: editRequestConfig,
          }).then(() => {
            updateResult(lastResult.id, { appliedToCanvas: true }).catch(() => {});
            if (sid && documentPath) {
              updateSessionBinding(sid, documentPath, {
                layerName: 'AI Result',
                lastResultId: lastResult.id,
              }).catch(() => {});
            }
            emitDataChange('results');
          }).catch(() => {});
        }
        lastStreamResultRef.current = null;
      },
      onError: (err: string) => {
        abortRef.current = null;
        console.error('[DirectChat] edit send failed:', err);
        setSending(false);
        setSendStartTime(null);
        setStreamingThinking('');
        setStreamingText('');
        setStreamingResults([]);
        loadSessionEntries(sid, false);
      },
    };

    const handle = sendMessageStream(sid, documentPath, {
      content: newContent,
      modelRef,
      parentId: parentId,
      reuseContextFrom: msgId,
    }, callbacks);
    abortRef.current = handle.abort;
  };

  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const { selectionStart, selectionEnd } = target;
      const before = inputText.slice(0, selectionStart);
      const after = inputText.slice(selectionEnd);
      setInputText(before + '\n' + after);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 1;
      });
    }
  };

  // ─── Derived ───────────────────────────────────────

  const allResults = [...sessionResults, ...recentResults.filter((r) => !sessionResults.find((sr) => sr.id === r.id))];
  const selectedResult = allResults.find((r) => r.id === selectedResultId) ?? allResults[allResults.length - 1];

  // ─── Render ────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', gap: 10, overflow: 'hidden' }}>

      {/* ── Session sidebar ── */}
      <div className={`chat-session-sidebar ${sessionOpen ? '' : 'collapsed'}`}>
        <div className="glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, width: 190 }}>
          <div className="chat-session-header">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{t('v2.sessions')}</span>
            <Tooltip text={t('chat.new_session')}>
              <div className="pill" style={{ padding: '3px 8px', fontSize: 10 }} onClick={handleNewSession}>
                <Icons.Plus size={11} />
              </div>
            </Tooltip>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
            {orderedSessions.map((s) => (
              <div
                key={s.id}
                className={`chat-session-item ${activeSessionId === s.id ? 'active' : ''}`}
                draggable
                onDragStart={() => handleDragStart(s.id)}
                onDragOver={(e) => handleDragOver(e, s.id)}
                onDrop={() => handleDrop(s.id)}
                onDragEnd={handleDragEnd}
                onClick={() => { setActiveSessionId(s.id); setSelectedResultId(null); }}
                style={{
                  opacity: dragSessionId === s.id ? 0.4 : 1,
                  borderTop: dragOverSessionId === s.id && dragSessionId !== s.id
                    ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingSessionId === s.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={handleFinishRenameSession}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRenameSession();
                          if (e.key === 'Escape') { setEditingSessionId(null); setEditingTitle(''); }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text1)',
                          background: 'var(--bg2)',
                          border: '1px solid var(--accent)',
                          borderRadius: 3,
                          padding: '1px 4px',
                          width: '100%',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <div
                        onDoubleClick={(e) => handleStartRenameSession(s.id, s.title || '', e)}
                        style={{
                          fontSize: 12,
                          fontWeight: activeSessionId === s.id ? 600 : 400,
                          color: activeSessionId === s.id ? 'var(--accent)' : 'var(--text2)',
                          marginBottom: 2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          cursor: 'default',
                        }}
                      >{s.title || t('v2.new_session')}</div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{timeAgo(s.updatedAt)}</div>
                  </div>
                  <Tooltip text={t('v2.delete_session')}>
                    <div
                      className="pill"
                      style={{ padding: '2px 4px', cursor: 'pointer', flexShrink: 0, opacity: 0.5, marginTop: 2 }}
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.5'; }}
                    >
                      <Icons.Trash size={10} color="var(--text3)" />
                    </div>
                  </Tooltip>
                </div>
              </div>
            ))}
            {orderedSessions.length === 0 && (
              <div style={{ padding: 16, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                {t('chat.empty_hint')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat main column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        <div className="glass-card" style={{ padding: '9px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0, position: 'relative', zIndex: 10 }}>
          <Tooltip text={sessionOpen ? t('v2.collapse_sessions') : t('v2.expand_sessions')}>
            <div
              className={`pill ${sessionOpen ? 'active' : ''}`}
              style={{ padding: '5px 8px' }}
              onClick={() => setSessionOpen(!sessionOpen)}
            >
              <Icons.Chat size={13} />
            </div>
          </Tooltip>

          <div className="mode-toggle">
            <button
              className={`mode-toggle-item ${chatMode === 'direct' ? 'active' : ''}`}
              onClick={() => setChatMode('direct')}
            >
              <Icons.Palette size={12} /> {t('chat.direct')}
            </button>
            <button
              className={`mode-toggle-item ${chatMode === 'agent' ? 'active' : ''}`}
              onClick={() => setChatMode('agent')}
            >
              <Icons.Bot size={12} /> {t('chat.agent')}
            </button>
          </div>

          {chatMode === 'direct' && (
            <>
              <div className="divider" style={{ height: 18 }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t('v2.model')}</span>
                <Dropdown
                  value={modelRef}
                  options={modelDropdownOptions}
                  onChange={(ref) => {
                    setModelRef(ref);
                    if (activeSessionId && documentPath) {
                      updateSessionModelRef(activeSessionId, documentPath, ref).catch(() => {});
                    }
                  }}
                  width={180}
                  accent
                  placeholder={t('chat.select_model')}
                />
              </div>
            </>
          )}
        </div>

        {/* Chat content card */}
        <div className="glass-card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {chatMode === 'agent' ? (
            <div className="chat-placeholder" style={{ flex: 1 }}>
              <div className="chat-placeholder-icon">
                <Icons.Bot size={28} color="var(--text3)" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text2)' }}>
                {t('chat.agent')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6, textAlign: 'center', maxWidth: 280 }}>
                {t('chat.agent_soon')}
              </div>
            </div>
          ) : (
          <>
          {/* Messages area */}
          <div className="chat-messages">
            {entries.length === 0 && !sending && (
              <div className="chat-placeholder" style={{ flex: 1 }}>
                <div className="chat-placeholder-icon">
                  <Icons.Chat size={22} color="var(--text3)" />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)' }}>
                  {t('chat.direct')}
                </div>
                <div style={{ fontSize: 12 }}>{t('chat.empty_hint')}</div>
              </div>
            )}

            {entries.map((entry, idx) => {
              if (entry.type === 'error') {
                return (
                  <div key={entry.id} style={{ padding: '8px 16px' }}>
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,59,48,0.1)', color: 'var(--orange)', fontSize: 12 }}>
                      {entry.content}
                    </div>
                  </div>
                );
              }

              const msg = entry.message;
              const msgResults = entry.results;
              const isTemp = msg.id.startsWith('temp-');
              const ctxFiles = msg.contextImageFiles ?? [];
              const sourceModeLabel = entry.sentImages?.sourceMode === 'activeLayer'
                ? t('chat.source_active')
                : t('chat.source_visible');

              // Branch info for assistant bubbles
              let parentUserMsg: ChatMessage | undefined;
              if (msg.role === 'assistant') {
                for (let i = idx - 1; i >= 0; i--) {
                  const prev = entries[i];
                  if (prev.type === 'message' && prev.message.role === 'user') {
                    parentUserMsg = prev.message;
                    break;
                  }
                }
              }

              const assistantSiblingIds = parentUserMsg?.childIds ?? [];
              const assistantSiblingCount = assistantSiblingIds.length;
              const assistantSiblingIndex = assistantSiblingIds.indexOf(msg.id);

              let userSiblingIds: string[] = [];
              let userSiblingIndex = -1;
              if (msg.role === 'user') {
                if (msg.parentId) {
                  const parentAssistant = allMessagesRef.current.find((m) => m.id === msg.parentId);
                  userSiblingIds = parentAssistant?.childIds ?? [];
                } else {
                  userSiblingIds = allMessagesRef.current.filter((m) => m.parentId === null).map((m) => m.id);
                }
                userSiblingIndex = userSiblingIds.indexOf(msg.id);
              }

              return (
                <div key={msg.id}>
                  {msg.role === 'user' ? (
                    <div className="chat-user-msg" style={{ position: 'relative' }}>
                      {/* Header: label + right-corner edit/delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <div className="chat-msg-label" style={{ color: 'var(--green)' }}>{t('v2.you')}</div>
                        <div style={{ flex: 1 }} />
                        {!isTemp && !sending && (
                          <div style={{ display: 'flex', gap: 3 }}>
                            <Tooltip text={t('chat.edit')}>
                              <div className="pill" style={{ padding: '2px 5px', cursor: 'pointer' }}
                                onClick={() => {
                                  if (editingMsgId === msg.id) {
                                    setEditingMsgId(null);
                                  } else {
                                    setEditingMsgId(msg.id);
                                    setEditText(msg.content);
                                  }
                                }}
                              ><Icons.Pencil size={10} color="var(--text3)" /></div>
                            </Tooltip>
                            <Tooltip text={t('chat.delete_branch')}>
                              <div className="pill" style={{ padding: '2px 5px', cursor: 'pointer' }}
                                onClick={() => handleDeleteMessage(msg.id)}
                              ><Icons.Trash size={10} color="var(--text3)" /></div>
                            </Tooltip>
                          </div>
                        )}
                      </div>

                      {/* Content or edit mode */}
                      {editingMsgId === msg.id ? (
                        <div style={{ marginBottom: 6 }}>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            style={{
                              width: '100%', minHeight: 50, fontSize: 12, lineHeight: 1.5,
                              background: 'var(--glass3)', border: '1px solid var(--border-subtle)',
                              borderRadius: 8, padding: '6px 8px', color: 'var(--text)',
                              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <div className="pill green" style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                              onClick={() => {
                                setEditingMsgId(null);
                                handleEditMessage(msg.id, msg.parentId, editText);
                              }}
                            >{t('chat.edit_save')}</div>
                            <div className="pill" style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                              onClick={() => setEditingMsgId(null)}
                            ><Icons.X size={10} /></div>
                          </div>
                        </div>
                      ) : (
                        <div className="chat-msg-text" style={{ marginBottom: 6 }}>{msg.content}</div>
                      )}

                      {/* Bottom action bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text3)', flexWrap: 'wrap' }}>
                        {userSiblingIds.length > 1 && (
                          <BranchNav
                            index={userSiblingIndex}
                            count={userSiblingIds.length}
                            onSwitch={(dir) => {
                              const ni = userSiblingIndex + dir;
                              if (ni >= 0 && ni < userSiblingIds.length) handleSwitchBranch(userSiblingIds[ni]);
                            }}
                          />
                        )}
                        {entry.sentImages && (
                          <span style={{ opacity: 0.7 }}>{t('v2.source_label')}: {sourceModeLabel}</span>
                        )}
                        <div style={{ flex: 1 }} />
                        {!isTemp && !sending && parentUserMsg === undefined && (
                          <Tooltip text={t('v2.retry')}>
                            <div className="pill" style={{ padding: '2px 6px', cursor: 'pointer' }}
                              onClick={() => handleResendUser(msg)}
                            ><Icons.RefreshCw size={10} color="var(--text3)" /></div>
                          </Tooltip>
                        )}
                        <Tooltip text={t('v2.copy')}>
                          <div className="pill" style={{ padding: '2px 6px', cursor: 'pointer' }}
                            onClick={() => handleCopy(msg.content)}
                          ><Icons.Download size={10} color="var(--text3)" /></div>
                        </Tooltip>
                      </div>

                      {/* Context images (from backend, available after save) */}
                      {ctxFiles.length > 0 && documentPath && activeSessionId && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {ctxFiles.map((f) => {
                            const url = getContextImageUrl(msg.id, f, documentPath!, activeSessionId!);
                            return (
                              <div
                                key={f}
                                className="thumb"
                                style={{ width: 56, height: 56, cursor: 'pointer' }}
                                onClick={() => setPreviewImageUrl(url)}
                              >
                                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Temp image previews (shown during generation before backend saves context files) */}
                      {ctxFiles.length === 0 && entry.tempImagePreviews && entry.tempImagePreviews.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {entry.tempImagePreviews.map((src, i) => (
                            <div
                              key={`temp-img-${i}`}
                              className="thumb"
                              style={{ width: 56, height: 56, cursor: 'pointer' }}
                              onClick={() => setPreviewImageUrl(src)}
                            >
                              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '12px 16px', position: 'relative' }}>
                      {/* Header: AI label + model name + delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        {msg.metadata?.isError ? (
                          <div className="chat-msg-label" style={{ color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icons.AlertCircle size={13} /> {t('v2.error_label') ?? '错误'}
                          </div>
                        ) : (
                          <div className="chat-msg-label" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icons.Palette size={13} /> {resolveModelLabel(msgResults[0]?.modelRef) ?? 'AI'}
                          </div>
                        )}
                        <div style={{ flex: 1 }} />
                        {!isTemp && !sending && (
                          <Tooltip text={t('chat.delete_branch')}>
                            <div className="pill" style={{ padding: '2px 5px', cursor: 'pointer' }}
                              onClick={() => handleDeleteMessage(msg.id)}
                            ><Icons.Trash size={10} color="var(--text3)" /></div>
                          </Tooltip>
                        )}
                      </div>

                      {/* Thinking */}
                      {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}

                      {/* Content */}
                      {msg.metadata?.isError ? (
                        <div style={{
                          marginBottom: 10,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: 'rgba(255,59,48,0.08)',
                          border: '1px solid rgba(255,59,48,0.2)',
                          color: 'var(--orange)',
                          fontSize: 12,
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {msg.content}
                        </div>
                      ) : (
                        msg.content && <div className="chat-msg-text" style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      )}

                      {/* Result images */}
                      {msgResults.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                          {msgResults.map((r) => {
                            const reqCfg = parentUserMsg?.requestConfig;
                            return (
                              <ResultImageV2
                                key={r.id}
                                result={r}
                                imgSrc={resultHQ(r, documentPath, activeSessionId)}
                                isSelected={selectedResultId === r.id}
                                onClick={() => setPreviewResultId(r.id)}
                                selectionBounds={reqCfg?.selectionBounds}
                                canvasSize={reqCfg?.canvasSize}
                                showFullImage={reqCfg?.sendPolicy?.sendFullImage}
                              />
                            );
                          })}
                        </div>
                      )}

                      {/* Bottom action bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text3)', marginTop: 6, flexWrap: 'wrap' }}>
                        {assistantSiblingCount > 1 && (
                          <BranchNav
                            index={assistantSiblingIndex}
                            count={assistantSiblingCount}
                            onSwitch={(dir) => {
                              const ni = assistantSiblingIndex + dir;
                              if (ni >= 0 && ni < assistantSiblingCount) handleSwitchBranch(assistantSiblingIds[ni]);
                            }}
                          />
                        )}
                        <div style={{ flex: 1 }} />
                        {msgResults.length > 0 && (
                          <>
                            <Tooltip text={t('chat.apply')}>
                              <div className="pill green" style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                                onClick={() => handleApply(msgResults[0].id, parentUserMsg?.requestConfig)}
                              ><Icons.Check size={10} /> {t('chat.apply')}</div>
                            </Tooltip>
                            <div
                              className={`pill ${msgResults[0].bookmarked ? 'active' : ''}`}
                              style={{ fontSize: 10, padding: '3px 6px', cursor: 'pointer' }}
                              onClick={() => handleToggleBookmark(msgResults[0].id)}
                            ><Icons.Star size={10} /></div>
                          </>
                        )}
                        {!isTemp && !sending && parentUserMsg && (
                          <Tooltip text={msg.metadata?.isError ? (t('v2.retry') ?? '重试') : (t('v2.retry') ?? '重新生成')}>
                            <div className="pill" style={{ padding: '2px 6px', cursor: 'pointer' }}
                              onClick={() => handleRegenerate(parentUserMsg!.id)}
                            ><Icons.RefreshCw size={10} color="var(--text3)" /></div>
                          </Tooltip>
                        )}
                        <Tooltip text={t('v2.copy')}>
                          <div className="pill" style={{ padding: '2px 6px', cursor: 'pointer' }}
                            onClick={() => handleCopy(msg.content)}
                          ><Icons.Download size={10} color="var(--text3)" /></div>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming indicator */}
            {(sending || streamingText || streamingResults.length > 0) && (
              <div style={{ padding: '12px 16px' }}>
                <div className="chat-msg-label" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="anim-spin" style={{ display: 'inline-flex' }}><Icons.Loader size={13} color="var(--accent)" /></span> {resolveModelLabel(modelRef) ?? 'AI'}
                  {sending && (
                    <Tooltip text={t('tooltip.stop') ?? '停止'}>
                      <div
                        className="pill"
                        style={{ marginLeft: 'auto', padding: '3px 8px', cursor: 'pointer', fontSize: 10 }}
                        onClick={handleAbort}
                      >
                        <Icons.Square size={10} color="var(--orange)" />
                      </div>
                    </Tooltip>
                  )}
                </div>
                {streamingThinking && <ThinkingBlock thinking={streamingThinking} isStreaming={!streamingText && !streamingResults.length} />}
                {streamingText ? (
                  <div className="chat-msg-text" style={{ whiteSpace: 'pre-wrap' }}>{streamingText}</div>
                ) : !streamingThinking ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{extracting ? t('cui.extracting') : t('chat.generating')}</span>
                    {elapsedSec > 0 && <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text4)' }}>{elapsedSec}s</span>}
                  </div>
                ) : null}
                {streamingResults.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {streamingResults.map((r) => (
                      <div
                        key={r.id}
                        className="thumb"
                        style={{ width: 80, height: 80, cursor: 'pointer' }}
                        onClick={() => setPreviewResultId(r.id)}
                      >
                        <img
                          src={resultThumb(r, documentPath, activeSessionId)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input area ── */}
          <div className="chat-input-area">
            {/* Policy controls + Gemini resolution */}
            {bridgeConnected && (
              <div style={{ marginBottom: 6, padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 2, flexShrink: 0 }}>
                    {t('chat.source')}
                  </span>
                  <Dropdown
                    value={sourceMode}
                    options={[
                      { value: 'visibleMerged', label: t('chat.source_visible') },
                      { value: 'activeLayer', label: t('chat.source_active') },
                    ]}
                    onChange={(v) => setSourceMode(v as SourceMode)}
                    width={110}
                    disabled={sessionLocked}
                  />
                  {selectedProtocol === 'gemini' && (
                    <div style={{
                      marginLeft: 'auto',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: '3px 6px',
                      background: 'var(--glass)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                    }}>
                      {(['1K', '2K', '4K'] as GeminiImageSize[]).map((size) => (
                        <Tooltip key={size} text={`${t('chat.image_size')} ${size}`} position="top">
                          <div
                            className={`pill ${imageSize === size ? 'active' : ''}`}
                            onClick={() => setImageSize(imageSize === size ? null : size)}
                            style={{ fontSize: 9, padding: '2px 6px', cursor: 'pointer' }}
                          >
                            {size}
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <PolicyToggle
                    icon={<Icons.Image size={11} />}
                    label={t('chat.send_full')}
                    active={sendPolicy.sendFullImage}
                    disabled={sessionLocked}
                    onClick={() => togglePolicyField('sendFullImage')}
                  />
                  <PolicyToggle
                    icon={<Icons.Crop size={11} />}
                    label={t('chat.send_crop')}
                    active={sendPolicy.sendRegionImage}
                    disabled={!hasSelection || sessionLocked}
                    onClick={() => togglePolicyField('sendRegionImage')}
                    unsupported={!hasSelection}
                    tooltip={!hasSelection ? t('chat.no_selection') : undefined}
                  />
                  <PolicyToggle
                    icon={<Icons.Scan size={11} />}
                    label={t('chat.send_highlight')}
                    active={sendPolicy.sendHighlightImage}
                    disabled={!hasSelection || sessionLocked}
                    onClick={() => togglePolicyField('sendHighlightImage')}
                    unsupported={!hasSelection}
                    tooltip={!hasSelection ? t('chat.no_selection') : undefined}
                  />
                  <PolicyToggle
                    icon={<Icons.CircleDashed size={11} />}
                    label={t('chat.send_mask')}
                    active={sendPolicy.sendMask && !maskUnsupported}
                    disabled={!hasSelection || maskUnsupported || sessionLocked}
                    onClick={() => togglePolicyField('sendMask')}
                    unsupported={!hasSelection || maskUnsupported}
                    tooltip={maskUnsupported ? t('chat.mask_unsupported') : !hasSelection ? t('chat.no_selection') : undefined}
                  />
                </div>
              </div>
            )}

            {/* Input box with inline attachment preview */}
            <div className="chat-input-box" style={{ flex: 1, flexDirection: 'column', alignItems: 'stretch', position: 'relative' }}>
              {/* No-model banner overlay */}
              {models.length === 0 && providers.length === 0 && (
                <div
                  className="anim-fade-in"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.35)',
                    backdropFilter: 'blur(2px)',
                    borderRadius: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 5,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <Icons.AlertCircle color="var(--accent)" size={20} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 8 }}>
                    {t('chat.no_provider_hint')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, lineHeight: 1.4 }}>
                    {t('chat.setup_provider_hint')}
                  </div>
                  {onNavigateToSettings && (
                    <div
                      className="btn-press"
                      onClick={onNavigateToSettings}
                      style={{
                        marginTop: 10,
                        padding: '6px 16px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                        color: '#fff',
                        border: 'none',
                      }}
                    >
                      {t('chat.go_to_settings')}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <textarea
                  className="chat-input-textarea"
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    if (validationHint) setValidationHint(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('chat.input_placeholder')}
                  rows={3}
                  style={{ height: 66, overflowY: 'auto' }}
                  disabled={sending || models.length === 0}
                />
                <Tooltip text={
                  !documentPath ? (t('v2.no_document') ?? '请先在 Photoshop 中打开一个文档')
                    : !modelRef ? (t('chat.error_no_model') ?? '请先选择一个模型')
                    : sending ? (t('tooltip.stop') ?? '停止')
                    : (t('tooltip.send') ?? '发送')
                } position="top">
                  <button className="chat-send-btn" disabled={sending || !inputText.trim() || !modelRef || !documentPath} onClick={handleSend}>
                    {sending
                      ? <Icons.Square size={14} color="white" />
                      : <Icons.Send size={16} color="white" />}
                  </button>
                </Tooltip>
              </div>

              {/* Inline attachment preview area (collapsible) */}
              {(bridgeConnected || extraImages.length > 0) && (() => {
                const hasAnySendPolicy = bridgeConnected && !sessionLocked && (
                  sendPolicy.sendFullImage || sendPolicy.sendRegionImage
                  || (sendPolicy.sendHighlightImage && hasSelection)
                  || (sendPolicy.sendMask && hasSelection && !maskUnsupported)
                );
                const hasAttachments = hasAnySendPolicy || extraImages.length > 0;
                if (!hasAttachments) return null;

                const psImageCount = hasAnySendPolicy
                  ? (sendPolicy.sendFullImage || sendPolicy.sendRegionImage ? 1 : 0)
                    + (sendPolicy.sendHighlightImage && hasSelection ? 1 : 0)
                    + (sendPolicy.sendMask && !maskUnsupported && hasSelection ? 1 : 0)
                  : 0;
                const totalCount = psImageCount + extraImages.length;
                const firstThumbSrc = previewSrc && hasAnySendPolicy
                  ? previewSrc
                  : extraImages.length > 0 ? extraImages[0].dataUrl : null;

                if (attachmentsCollapsed) {
                  return (
                    <div style={{
                      borderTop: '1px solid var(--border-subtle)',
                      margin: '6px 0 0',
                      padding: '4px 0 2px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      {firstThumbSrc && (
                        <div
                          onClick={() => setAttachmentsCollapsed(false)}
                          style={{
                            width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                            border: '1px solid var(--border-subtle)',
                            overflow: 'hidden', cursor: 'pointer',
                          }}
                        >
                          <img src={firstThumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </div>
                      )}
                      <span
                        onClick={() => setAttachmentsCollapsed(false)}
                        style={{ fontSize: 10, color: 'var(--text3)', cursor: 'pointer' }}
                      >
                        {totalCount > 0 ? `${totalCount} ${t('v2.images_attached') ?? '张图片'}` : ''}
                      </span>
                      <Tooltip text={t('v2.add_image') ?? '添加图片'} position="top">
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                            border: '1px dashed var(--border-subtle)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0.6,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                        >
                          <Icons.Plus color="var(--text3)" size={11} />
                        </div>
                      </Tooltip>
                      <div style={{ flex: 1 }} />
                      <div
                        onClick={() => setAttachmentsCollapsed(false)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.5 }}
                      >
                        <Icons.ChevronDown size={12} color="var(--text3)" />
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
                    </div>
                  );
                }

                return (
                  <>
                    <div style={{
                      borderTop: '1px solid var(--border-subtle)',
                      margin: '6px 0 0',
                      padding: '8px 0 2px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}>
                      {/* PS preview image */}
                      {bridgeConnected && hasAnySendPolicy && !sessionLocked && (
                        <Tooltip text={previewStale ? t('chat.preview_stale') : t('chat.preview_refresh')} position="top">
                          <div
                            onClick={previewSrc && !previewStale ? () => setPreviewEnlarged(true) : refreshPreview}
                            style={{
                              width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                              border: `1.5px solid ${previewStale ? 'var(--text3)' : 'var(--accent)'}`,
                              background: 'var(--glass)',
                              overflow: 'hidden', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              position: 'relative',
                              opacity: previewStale ? 0.6 : 1,
                            }}
                          >
                            {previewLoading && <Icons.Loader color="var(--text3)" size={14} />}
                            {!previewLoading && previewSrc && (
                              <img src={previewSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            )}
                            {!previewLoading && !previewSrc && (
                              <Icons.Eye color="var(--text3)" size={14} />
                            )}
                            <div style={{
                              position: 'absolute', bottom: 1, left: 0, right: 0,
                              fontSize: 7, textAlign: 'center',
                              background: 'rgba(0,0,0,0.55)', color: '#fff',
                              padding: '1px 0', lineHeight: 1,
                            }}>
                              {sendPolicy.sendFullImage ? t('chat.send_full') : t('chat.send_crop')}
                            </div>
                          </div>
                        </Tooltip>
                      )}

                      {/* Highlight indicator */}
                      {bridgeConnected && !sessionLocked && sendPolicy.sendHighlightImage && hasSelection && (
                        <Tooltip text={t('chat.send_highlight')} position="top">
                          <div style={{
                            width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--glass)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexDirection: 'column', gap: 2,
                            position: 'relative',
                          }}>
                            <Icons.Scan size={16} color="var(--text3)" />
                            <div style={{
                              position: 'absolute', bottom: 1, left: 0, right: 0,
                              fontSize: 7, textAlign: 'center',
                              background: 'rgba(0,0,0,0.55)', color: '#fff',
                              padding: '1px 0', lineHeight: 1,
                            }}>{t('chat.send_highlight')}</div>
                          </div>
                        </Tooltip>
                      )}

                      {/* Mask indicator */}
                      {bridgeConnected && !sessionLocked && sendPolicy.sendMask && !maskUnsupported && hasSelection && (
                        <Tooltip text={t('chat.send_mask')} position="top">
                          <div style={{
                            width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--glass)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            position: 'relative',
                          }}>
                            <Icons.CircleDashed size={16} color="var(--text3)" />
                            <div style={{
                              position: 'absolute', bottom: 1, left: 0, right: 0,
                              fontSize: 7, textAlign: 'center',
                              background: 'rgba(0,0,0,0.55)', color: '#fff',
                              padding: '1px 0', lineHeight: 1,
                            }}>{t('chat.send_mask')}</div>
                          </div>
                        </Tooltip>
                      )}

                      {/* User-uploaded extra images */}
                      {extraImages.map((img) => (
                        <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}>
                          <div
                            onClick={() => setPreviewImageUrl(img.dataUrl)}
                            style={{
                              width: 48, height: 48, borderRadius: 8,
                              border: '1px solid var(--border-subtle)',
                              overflow: 'hidden', cursor: 'pointer',
                            }}
                          >
                            <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </div>
                          <div
                            onClick={(e) => { e.stopPropagation(); removeExtraImage(img.id); }}
                            style={{
                              position: 'absolute', top: -5, right: -5,
                              width: 16, height: 16, borderRadius: '50%',
                              background: 'var(--orange)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <Icons.X color="#fff" size={10} />
                          </div>
                        </div>
                      ))}

                      {/* Add image button */}
                      <Tooltip text={t('v2.add_image') ?? '添加图片'} position="top">
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                            border: '1px dashed var(--border-subtle)',
                            background: 'transparent', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: 0.6,
                            transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                        >
                          <Icons.Plus color="var(--text3)" size={18} />
                        </div>
                      </Tooltip>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />

                      {/* Collapse + refresh buttons */}
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {bridgeConnected && hasAnySendPolicy && !sessionLocked && (
                          <Tooltip text={t('chat.preview_refresh')} position="top">
                            <div
                              onClick={refreshPreview}
                              style={{
                                width: 20, height: 20, borderRadius: 4,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', opacity: 0.6,
                              }}
                            >
                              <Icons.RefreshCw color="var(--text3)" size={10} />
                            </div>
                          </Tooltip>
                        )}
                        <div
                          onClick={() => setAttachmentsCollapsed(true)}
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: 0.5 }}
                        >
                          <Icons.ChevronUp size={12} color="var(--text3)" />
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', marginTop: 4, gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', opacity: 0.6 }}>
                Enter {t('chat.send')}，Ctrl+Enter {t('v2.newline')}
              </span>
              <div style={{ flex: 1 }} />
              {extracting && (
                <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                  {t('cui.extracting')}
                </span>
              )}
              {validationHint && (
                <span style={{ fontSize: 11, color: 'var(--orange)' }}>
                  {validationHint}
                </span>
              )}
            </div>
          </div>
          </>
          )}
        </div>

        {/* ── Bottom results strip (compact drawer style) ── */}
        {chatMode === 'direct' && allResults.length > 0 && (
          <div className="glass-card" style={{ marginTop: 10, flexShrink: 0, overflow: 'hidden' }}>
            {/* Header row — compact like ResultDrawer */}
            <div
              style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setResultsExpanded(!resultsExpanded)}
            >
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text3)' }}>
                <span style={{ marginRight: 6, display: 'flex' }}><Icons.Box size={12} color="var(--text3)" /></span>
                <span>{t('v2.recent_results')} ({allResults.length}{t('v2.results_count')})</span>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {!resultsExpanded && allResults.length > 0 && (
                  <div style={{ display: 'flex', marginRight: 6 }}>
                    {allResults.slice(-4).reverse().map((r) => (
                      <div key={r.id} style={{
                        width: 24, height: 24, borderRadius: 4, overflow: 'hidden',
                        border: '1px solid var(--border-subtle)', background: '#000', marginLeft: 3, flexShrink: 0,
                      }}>
                        <img src={resultThumb(r, documentPath, activeSessionId)} alt=""
                          style={{ width: 24, height: 24, objectFit: 'cover', display: 'block' }} />
                      </div>
                    ))}
                  </div>
                )}
                <span style={{
                  display: 'flex', color: 'var(--text3)',
                  transition: 'transform 0.25s ease',
                  transform: resultsExpanded ? 'rotate(0deg)' : 'rotate(180deg)',
                }}>
                  <Icons.ChevronDown size={12} color="var(--text3)" />
                </span>
              </div>
            </div>

            {/* Expanded body */}
            {resultsExpanded && (
              <div style={{ padding: '0 12px 10px' }}>
                {/* Thumbs row */}
                <div style={{ display: 'flex', overflowX: 'auto', paddingBottom: 6, gap: 5 }}>
                  {allResults.slice(-20).reverse().map((r) => (
                    <div
                      key={r.id}
                      style={{
                        width: 52, height: 52, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                        border: selectedResultId === r.id ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: '#000', flexShrink: 0, position: 'relative',
                      }}
                      onClick={() => setSelectedResultId(r.id)}
                      onDoubleClick={() => setPreviewResultId(r.id)}
                    >
                      <img
                        src={resultThumb(r, documentPath, activeSessionId)}
                        alt=""
                        style={{ width: 52, height: 52, objectFit: 'cover', display: 'block' }}
                      />
                      {(r.appliedToCanvas || r.bookmarked) && (
                        <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 1 }}>
                          {r.appliedToCanvas && (
                            <div style={{ width: 12, height: 12, borderRadius: 6, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Icons.Check size={7} color="#fff" />
                            </div>
                          )}
                          {r.bookmarked && (
                            <div style={{ width: 12, height: 12, borderRadius: 6, background: 'var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Icons.Star size={7} color="#fff" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Action buttons for selected result */}
                {selectedResult && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 2, gap: 5 }}>
                    {bridgeConnected && (
                      <div
                        className="pill green"
                        style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                        onClick={() => handleApply(selectedResult.id)}
                      >
                        <Icons.Check size={10} /> {t('chat.apply')}
                      </div>
                    )}
                    <div
                      className={`pill ${selectedResult.bookmarked ? 'active' : ''}`}
                      style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                      onClick={() => handleToggleBookmark(selectedResult.id)}
                    >
                      <Icons.Star size={10} /> {selectedResult.bookmarked ? t('chat.bookmarked') : t('chat.bookmark')}
                    </div>
                    <div
                      className="pill"
                      style={{ fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
                      onClick={() => setPreviewResultId(selectedResult.id)}
                    >
                      <Icons.Eye size={10} /> {t('chat.preview') ?? '预览'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Image preview overlay ── */}
      {previewResultId && (
        <ImagePreviewOverlay
          resultId={previewResultId}
          docPath={documentPath ?? undefined}
          sessionId={activeSessionId ?? undefined}
          onClose={() => setPreviewResultId(null)}
        />
      )}

      {/* ── Send preview enlarged overlay ── */}
      {previewEnlarged && previewSrc && (
        <FullscreenImageOverlay src={previewSrc} onClose={() => setPreviewEnlarged(false)} />
      )}

      {/* Context image preview overlay */}
      {previewImageUrl && (
        <FullscreenImageOverlay src={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      )}
      <ConfirmDialog
        open={dialogConfig.open}
        title={dialogConfig.title}
        message={dialogConfig.message}
        variant={dialogConfig.variant}
        onConfirm={dialogConfig.onConfirm}
        onCancel={dialogConfig.onCancel}
      />
    </div>
  );
}

// ─── PolicyToggle sub-component ──────────────────────

function PolicyToggle({
  icon,
  label,
  active,
  disabled,
  onClick,
  unsupported,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  unsupported?: boolean;
  tooltip?: string;
}) {
  const inner = (
    <div
      className={`pill ${active && !disabled ? 'active' : ''}`}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '3px 7px',
        fontSize: 10,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        position: 'relative',
      }}
    >
      <span style={{ marginRight: 3, display: 'flex', opacity: unsupported ? 0.35 : 1 }}>{icon}</span>
      <span style={{ opacity: unsupported ? 0.35 : 1 }}>{label}</span>
      {unsupported && (
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <line x1="5" y1="5" x2="95" y2="95" stroke="rgba(255,59,48,0.75)" strokeWidth={8} strokeLinecap="round" />
        </svg>
      )}
    </div>
  );

  if (!tooltip) return inner;
  return <Tooltip text={tooltip} position="top">{inner}</Tooltip>;
}

// ─── ThinkingBlock sub-component ─────────────────────

function ThinkingBlock({ thinking, isStreaming }: { thinking: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!thinking) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, color: 'var(--text3)', cursor: 'pointer',
          padding: '3px 8px', borderRadius: 6,
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        {isStreaming && <span className="anim-spin" style={{ display: 'inline-flex' }}><Icons.Loader size={10} /></span>}
        <span>{t('chat.thinking')}{isStreaming ? ' ...' : ''}</span>
        <span style={{ fontSize: 9, opacity: 0.5 }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{
          marginTop: 4, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)',
          fontSize: 11, color: 'var(--text3)', whiteSpace: 'pre-wrap', lineHeight: 1.5,
          maxHeight: 200, overflowY: 'auto',
        }}>
          {thinking}
        </div>
      )}
    </div>
  );
}

// ─── BranchNav sub-component ─────────────────────────

function BranchNav({ index, count, onSwitch }: {
  index: number;
  count: number;
  onSwitch: (dir: -1 | 1) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text3)' }}>
      <span
        style={{ cursor: index > 0 ? 'pointer' : 'default', opacity: index > 0 ? 1 : 0.3 }}
        onClick={() => index > 0 && onSwitch(-1)}
      >
        <Icons.ChevronLeft size={11} color="var(--text3)" />
      </span>
      <span>{index + 1}/{count}</span>
      <span
        style={{ cursor: index < count - 1 ? 'pointer' : 'default', opacity: index < count - 1 ? 1 : 0.3 }}
        onClick={() => index < count - 1 && onSwitch(1)}
      >
        <Icons.ChevronRight size={11} color="var(--text3)" />
      </span>
    </div>
  );
}

// ─── ResultImageV2 sub-component (crop / full toggle) ────

function ResultImageV2({
  result: r,
  onClick,
  imgSrc,
  isSelected,
  selectionBounds,
  canvasSize,
  showFullImage,
}: {
  result: GenerationResult;
  onClick: () => void;
  imgSrc: string;
  isSelected: boolean;
  selectionBounds?: SelectionInfo;
  canvasSize?: { width: number; height: number };
  showFullImage?: boolean;
}) {
  const hasCropToggle = !!showFullImage && !!selectionBounds && !!canvasSize && !!r.width && !!r.height;
  const [viewMode, setViewMode] = useState<'crop' | 'full'>(hasCropToggle ? 'crop' : 'full');

  const showCropped = hasCropToggle && viewMode === 'crop';

  let cropStyle: React.CSSProperties | undefined;
  let containerStyle: React.CSSProperties | undefined;
  if (showCropped && canvasSize && selectionBounds && r.width && r.height) {
    const scaleX = r.width / canvasSize.width;
    const scaleY = r.height / canvasSize.height;
    const cropX = selectionBounds.x * scaleX;
    const cropY = selectionBounds.y * scaleY;
    const cropW = selectionBounds.width * scaleX;
    const cropH = selectionBounds.height * scaleY;

    containerStyle = {
      width: '100%',
      height: 0,
      paddingBottom: `${(cropH / cropW) * 100}%`,
      position: 'relative' as const,
      borderRadius: 10,
      overflow: 'hidden',
      cursor: 'pointer',
    };
    cropStyle = {
      display: 'block',
      width: `${(r.width / cropW) * 100}%`,
      height: `${(r.height / cropH) * 100}%`,
      position: 'absolute' as const,
      left: `${(-cropX / cropW) * 100}%`,
      top: `${(-cropY / cropH) * 100}%`,
    };
  }

  let displayWidth = r.width ?? 0;
  let displayHeight = r.height ?? 0;
  if (showCropped && canvasSize && selectionBounds && r.width && r.height) {
    displayWidth = Math.round(selectionBounds.width * (r.width / canvasSize.width));
    displayHeight = Math.round(selectionBounds.height * (r.height / canvasSize.height));
  }

  return (
    <div>
      {hasCropToggle && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 3 }}>
          <Tooltip text={t('chat.view_crop')}>
            <div
              onClick={() => setViewMode('crop')}
              className="pill"
              style={{
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: 10,
                background: viewMode === 'crop' ? 'rgba(0,122,255,0.12)' : undefined,
                borderColor: viewMode === 'crop' ? 'rgba(0,122,255,0.28)' : undefined,
                color: viewMode === 'crop' ? 'var(--accent)' : 'var(--text3)',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <Icons.Minimize size={9} /> {t('chat.view_crop')}
            </div>
          </Tooltip>
          <Tooltip text={t('chat.view_full')}>
            <div
              onClick={() => setViewMode('full')}
              className="pill"
              style={{
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: 10,
                background: viewMode === 'full' ? 'rgba(0,122,255,0.12)' : undefined,
                borderColor: viewMode === 'full' ? 'rgba(0,122,255,0.28)' : undefined,
                color: viewMode === 'full' ? 'var(--accent)' : 'var(--text3)',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <Icons.Maximize size={9} /> {t('chat.view_full')}
            </div>
          </Tooltip>
        </div>
      )}
      <div
        className={`thumb ${isSelected ? 'active' : ''}`}
        style={containerStyle ?? { width: '100%', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', position: 'relative' }}
        onClick={onClick}
      >
        <img
          src={imgSrc}
          alt=""
          style={cropStyle ?? { width: '100%', height: 'auto', display: 'block' }}
        />
        {r.width != null && r.height != null && (
          <div style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.55)',
            color: 'rgba(255,255,255,0.8)',
            fontSize: 10,
          }}>
            {displayWidth}×{displayHeight}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FullscreenImageOverlay sub-component ────────────

function FullscreenImageOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute', top: 12, right: 12,
          padding: 6, borderRadius: 8,
          background: 'rgba(255,255,255,0.1)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icons.X color="rgba(255,255,255,0.8)" size={18} />
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95%', maxHeight: '90%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src={src}
          style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 12, objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}
