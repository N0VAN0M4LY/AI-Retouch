import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExposedParam, WorkflowNodeInfo, SelectionInfo, SendPolicy, RequestConfig } from '@ai-retouch/shared';
import { useComfyUIEvents, type ComfyUIProgress } from './useComfyUIEvents';
import { useSelectionPolling } from './useSelectionPolling';
import { usePlatform } from '../platform/PlatformProvider';
import { usePSConnected } from '../platform/usePSConnected';
import {
  getComfyUIStatus, testComfyUIConnection, listRemoteWorkflows,
  parseRemoteWorkflow, executeWorkflow, pollWorkflowResult,
  getComfyUIViewUrl, uploadImageToComfyUI, sendImagesOnlyWorkflow,
  getComfyUIRecentHistory, saveComfyUIResultToLibrary,
  cancelComfyUIExecution,
  setExposedNodeIds as apiSetExposedNodeIds,
  setNodeOrder as apiSetNodeOrder,
} from '../api/comfyui';
import type { RemoteWorkflowEntry, ParsedWorkflow } from '../api/types';
import { getSetting } from '../api/settings';
import { emitDataChange } from './useDataEvents';
import { t } from '../i18n/setup';

// ─── Exported types ──────────────────────────────────

export interface PsImageSource {
  id: string;
  name: string;
  thumbnail: string | null;
  width: number;
  height: number;
}

export interface CuiOutput {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
  nodeId: string;
}

export type ParamValues = Record<string, unknown>;
export type NodeViewMode = 'selected' | 'all';

export interface ImageAssignment {
  sourceId: string;
  sourceName: string;
  thumbnail: string | null;
  width: number;
  height: number;
}

interface CanvasSnapshot {
  timestamp: number;
  canvasSize: { width: number; height: number };
  hasSelection: boolean;
  selectionBounds?: SelectionInfo;
  sourceMode: string;
  imageSource: 'ps_full' | 'ps_selection' | null;
  workflowName: string;
  promptId?: string;
}

// ─── Helpers ─────────────────────────────────────────

function toDataUri(raw: string): string {
  if (raw.startsWith('data:')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function buildInitialValues(params: ExposedParam[]): ParamValues {
  const vals: ParamValues = {};
  for (const p of params) {
    if (p.type === 'image') continue;
    vals[`${p.nodeId}:${p.paramName}`] = p.default;
  }
  return vals;
}

const PARAM_STORAGE_PREFIX = 'comfyui_params_';
const PARAM_SAVE_DEBOUNCE = 300;

function loadSavedParams(workflowPath: string): ParamValues | null {
  try {
    const raw = localStorage.getItem(PARAM_STORAGE_PREFIX + workflowPath);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveParamsToStorage(workflowPath: string, values: ParamValues) {
  try {
    localStorage.setItem(PARAM_STORAGE_PREFIX + workflowPath, JSON.stringify(values));
  } catch { /* quota exceeded — silently ignore */ }
}

// ─── Hook options & return type ──────────────────────

interface UseComfyUIWorkflowOptions {
  documentPath: string | null;
}

export interface UseComfyUIWorkflowReturn {
  // Connection
  status: { state: string; address?: string } | null;
  connected: boolean;
  wsConnected: boolean;
  handleTestConnection: () => Promise<void>;

  // Workflow list
  remoteFiles: RemoteWorkflowEntry[];
  remoteLoading: boolean;
  remoteError: string | null;
  refreshRemote: () => Promise<void>;

  // Parsing
  selectedPath: string | null;
  parsed: ParsedWorkflow | null;
  parsing: boolean;
  parseError: string | null;
  handleSelect: (entry: RemoteWorkflowEntry) => Promise<void>;
  handleSelectFromDropdown: (path: string) => void;

  // Node view mode & exposed management
  nodeViewMode: NodeViewMode;
  setNodeViewMode: (mode: NodeViewMode) => void;
  exposedNodeIds: Set<string>;
  handleToggleExposed: (nodeId: string) => void;
  visibleImageNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  visibleNonImageParams: ExposedParam[];
  visibleParamsByNode: Map<string, ExposedParam[]>;
  allNodes: WorkflowNodeInfo[];
  nodeOrder: string[];
  handleReorder: (fromIndex: number, toIndex: number) => void;

  // Params
  paramValues: ParamValues;
  nonImageParams: ExposedParam[];
  paramsByNode: Map<string, ExposedParam[]>;
  handleParamChange: (key: string, value: unknown) => void;

  // Image sources
  psSources: PsImageSource[];
  selectedSourceId: string | null;
  setSelectedSourceId: (id: string | null) => void;
  canvasSize: { width: number; height: number } | null;

  // Image assignments
  imageAssignments: Record<string, ImageAssignment>;
  hasAssignedImages: boolean;
  handleAssignImage: (nodeId: string) => void;
  handleRemoveAssignment: (nodeId: string) => void;
  hintMessage: string | null;

  // Execution
  executing: boolean;
  executeError: string | null;
  executeResult: string | null;
  executeStatus: string | null;
  handleSendAndExecute: () => Promise<void>;
  handleSendImagesOnly: () => Promise<void>;

  // Progress
  progressInfo: ComfyUIProgress | null;
  executingNode: string | null;
  queueRemaining: number;
  pollingResult: boolean;
  currentPromptId: string | null;

  // Results
  cuiOutputs: CuiOutput[];
  selectedOutputIdx: number | null;
  setSelectedOutputIdx: (idx: number | null) => void;
  resultError: string | null;
  setResultError: (err: string | null) => void;
  handleApplyToCanvas: (output: CuiOutput) => Promise<void>;
  handleSaveToLibrary: (output: CuiOutput) => Promise<void>;
  applyingImage: string | null;
  appliedImages: Set<string>;

  // History
  handleRefreshOutputs: () => Promise<void>;
  refreshingOutputs: boolean;

  // Cancel
  handleCancelExecution: () => Promise<void>;

  // Selection
  hasSelection: boolean;
  effectiveSelection: SelectionInfo | null;
  isLocked: boolean;

  // Derived
  workflowReady: boolean;
}

// ─── Main Hook ───────────────────────────────────────

export function useComfyUIWorkflow({
  documentPath,
}: UseComfyUIWorkflowOptions): UseComfyUIWorkflowReturn {
  const platform = usePlatform();
  const bridgeConnected = usePSConnected();

  // Connection
  const [status, setStatus] = useState<{ state: string; address?: string } | null>(null);
  const connected = status?.state === 'connected';

  // Workflow list
  const [remoteFiles, setRemoteFiles] = useState<RemoteWorkflowEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // Selected workflow
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkflow | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Node view mode & exposed management
  const [nodeViewMode, setNodeViewMode] = useState<NodeViewMode>('selected');
  const [exposedNodeIds, setExposedNodeIds] = useState<Set<string>>(new Set());
  const exposedSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Node order
  const [nodeOrder, setNodeOrderState] = useState<string[]>([]);
  const orderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Params
  const [paramValues, setParamValues] = useState<ParamValues>({});

  // Image transfer
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>('ps_full');
  const [imageAssignments, setImageAssignments] = useState<Record<string, ImageAssignment>>({});
  const [psFullThumb, setPsFullThumb] = useState<string | null>(null);
  const [psSelThumb, setPsSelThumb] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [hintMessage, setHintMessage] = useState<string | null>(null);

  // Execution
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeResult, setExecuteResult] = useState<string | null>(null);
  const [executeStatus, setExecuteStatus] = useState<string | null>(null);

  // Results
  const [cuiOutputs, setCuiOutputs] = useState<CuiOutput[]>([]);
  const [selectedOutputIdx, setSelectedOutputIdx] = useState<number | null>(null);
  const [pollingResult, setPollingResult] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [applyingImage, setApplyingImage] = useState<string | null>(null);
  const [appliedImages, setAppliedImages] = useState<Set<string>>(new Set());
  const [refreshingOutputs, setRefreshingOutputs] = useState(false);

  // Sub-hooks
  const { hasSelection, effectiveSelection, lock, unlock, isLocked, refreshToken } = useSelectionPolling({
    enabled: bridgeConnected,
    getSelection: platform.ps.getSelection,
    subscribeToEvents: useCallback(
      (handler: (sel: SelectionInfo | null) => void) =>
        platform.events.onBridgeEvent('selectionChanged', (e) => handler((e.data as any)?.selection ?? null)),
      [platform.events],
    ),
  });
  const { wsConnected, progressInfo, executingNode, queueRemaining, waitForResult, clearProgress } =
    useComfyUIEvents(platform.events);
  const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);
  const paramSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef<CanvasSnapshot | null>(null);

  // ─── Effects ───────────────────────────────────────

  useEffect(() => {
    getComfyUIStatus().then((s) => {
      setStatus(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (wsConnected && !connected) {
      getComfyUIStatus().then((s) => setStatus(s)).catch(() => {});
    } else if (!wsConnected && connected) {
      setStatus((prev) => prev ? { ...prev, state: 'disconnected' } : prev);
    }
  }, [wsConnected, connected]);

  const refreshRemote = useCallback(async () => {
    setRemoteLoading(true);
    setRemoteError(null);
    setSelectedPath(null);
    setParsed(null);
    setParseError(null);
    setImageAssignments({});
    try {
      const files = await listRemoteWorkflows();
      setRemoteFiles(files);
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : t('cui.load_workflows_failed'));
    } finally {
      setRemoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) refreshRemote();
  }, [connected, refreshRemote]);

  // PS thumbnail generation — initial + periodic refresh
  useEffect(() => {
    if (!bridgeConnected) return;
    let cancelled = false;

    async function refresh() {
      try {
        const doc = await platform.ps.getDocument();
        if (doc && !cancelled) {
          setCanvasSize({ width: doc.width, height: doc.height });
        }
      } catch { /* bridge may be disconnected */ }

      try {
        const ctx = await platform.ps.extractImage({
          sourceMode: 'visibleMerged',
          sendPolicy: { sendFullImage: true, sendRegionImage: false, sendHighlightImage: false, sendMask: false },
        });
        if (!cancelled && ctx.fullImage) setPsFullThumb(toDataUri(ctx.fullImage));
        if (!cancelled && ctx.canvasSize) setCanvasSize(ctx.canvasSize);
      } catch (e) {
        console.warn('[ComfyUI] PS Full thumbnail failed:', e);
      }

      if (hasSelection) {
        try {
          const ctx = await platform.ps.extractImage({
            sourceMode: 'visibleMerged',
            sendPolicy: { sendFullImage: false, sendRegionImage: true, sendHighlightImage: false, sendMask: false },
          });
          if (!cancelled && ctx.regionImage) setPsSelThumb(toDataUri(ctx.regionImage));
        } catch (e) {
          console.warn('[ComfyUI] PS Selection thumbnail failed:', e);
        }
      } else {
        if (!cancelled) setPsSelThumb(null);
      }
    }

    refresh();
    const interval = setInterval(() => { if (!cancelled) refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [bridgeConnected, refreshToken, hasSelection, platform.ps]);

  // ─── Derived values ────────────────────────────────

  const psSources = useMemo<PsImageSource[]>(() => {
    const sources: PsImageSource[] = [{
      id: 'ps_full',
      name: t('cui.ps_full'),
      thumbnail: psFullThumb,
      width: canvasSize?.width ?? 0,
      height: canvasSize?.height ?? 0,
    }];
    if (hasSelection && effectiveSelection) {
      sources.push({
        id: 'ps_selection',
        name: t('cui.ps_selection'),
        thumbnail: psSelThumb,
        width: effectiveSelection.width,
        height: effectiveSelection.height,
      });
    }
    return sources;
  }, [psFullThumb, psSelThumb, canvasSize, hasSelection, effectiveSelection]);

  const nonImageParams = useMemo<ExposedParam[]>(
    () => (parsed?.exposedParams ?? []).filter((p) => p.type !== 'image'),
    [parsed],
  );

  const paramsByNode = useMemo(() => {
    const map = new Map<string, ExposedParam[]>();
    for (const p of nonImageParams) {
      if (!map.has(p.nodeId)) map.set(p.nodeId, []);
      map.get(p.nodeId)!.push(p);
    }
    return map;
  }, [nonImageParams]);

  const hasAssignedImages = Object.keys(imageAssignments).length > 0;
  const workflowReady = !!(parsed && selectedPath && !parsing);

  const allNodes = useMemo<WorkflowNodeInfo[]>(() => {
    const raw: WorkflowNodeInfo[] = parsed?.allNodes ?? [];
    if (nodeOrder.length === 0) return raw;
    const orderMap = new Map(nodeOrder.map((id, i) => [id, i]));
    return [...raw].sort((a, b) => {
      const ai = orderMap.get(a.nodeId) ?? Infinity;
      const bi = orderMap.get(b.nodeId) ?? Infinity;
      return ai - bi;
    });
  }, [parsed, nodeOrder]);

  // Filtered views based on nodeViewMode + exposedNodeIds
  const visibleImageNodes = useMemo(() => {
    if (!parsed) return [];
    if (nodeViewMode === 'all') {
      return allNodes
        .filter(n => n.isImageInput)
        .map(n => ({ nodeId: n.nodeId, nodeType: n.nodeType, title: n.title }));
    }
    return allNodes
      .filter(n => n.isImageInput && exposedNodeIds.has(n.nodeId))
      .map(n => ({ nodeId: n.nodeId, nodeType: n.nodeType, title: n.title }));
  }, [parsed, allNodes, nodeViewMode, exposedNodeIds]);

  const visibleNonImageParams = useMemo(() => {
    if (!parsed) return [];
    if (nodeViewMode === 'all') {
      return allNodes.flatMap(n => n.params.filter(p => p.type !== 'image'));
    }
    return allNodes
      .filter(n => exposedNodeIds.has(n.nodeId))
      .flatMap(n => n.params.filter(p => p.type !== 'image'));
  }, [parsed, allNodes, nodeViewMode, exposedNodeIds]);

  const visibleParamsByNode = useMemo(() => {
    const map = new Map<string, ExposedParam[]>();
    for (const p of visibleNonImageParams) {
      if (!map.has(p.nodeId)) map.set(p.nodeId, []);
      map.get(p.nodeId)!.push(p);
    }
    return map;
  }, [visibleNonImageParams]);

  // ─── Auto-assign images to LoadImage nodes on workflow load ─

  const autoAssignDoneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workflowReady || !parsed || !selectedSourceId) return;
    if (autoAssignDoneRef.current === selectedPath) return;
    autoAssignDoneRef.current = selectedPath;

    const source = psSources.find(s => s.id === selectedSourceId);
    if (!source || source.width <= 0) return;

    const targetImageNodes = visibleImageNodes;
    if (targetImageNodes.length === 0) return;

    const newAssignments: Record<string, ImageAssignment> = {};
    for (const node of targetImageNodes) {
      newAssignments[node.nodeId] = {
        sourceId: source.id,
        sourceName: source.name,
        thumbnail: source.thumbnail,
        width: source.width,
        height: source.height,
      };
    }
    setImageAssignments(newAssignments);
  }, [workflowReady, parsed, selectedPath, selectedSourceId, psSources, visibleImageNodes]);

  // ─── Handlers ──────────────────────────────────────

  function handleToggleExposed(nodeId: string) {
    setExposedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);

      if (selectedPath) {
        if (exposedSaveTimerRef.current) clearTimeout(exposedSaveTimerRef.current);
        exposedSaveTimerRef.current = setTimeout(() => {
          apiSetExposedNodeIds(selectedPath!, Array.from(next)).catch(console.error);
        }, 500);
      }
      return next;
    });
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    const currentIds = allNodes.map(n => n.nodeId);
    const [moved] = currentIds.splice(fromIndex, 1);
    currentIds.splice(toIndex, 0, moved);
    setNodeOrderState(currentIds);

    if (selectedPath) {
      if (orderSaveTimerRef.current) clearTimeout(orderSaveTimerRef.current);
      orderSaveTimerRef.current = setTimeout(() => {
        apiSetNodeOrder(selectedPath!, currentIds).catch(console.error);
      }, 300);
    }
  }

  async function handleSelect(entry: RemoteWorkflowEntry) {
    setSelectedPath(entry.path);
    setParsed(null);
    setParsing(true);
    setParseError(null);
    setExecuteError(null);
    setExecuteResult(null);
    setCuiOutputs([]);
    setResultError(null);
    setAppliedImages(new Set());
    setImageAssignments({});
    setSelectedOutputIdx(null);

    try {
      const result = await parseRemoteWorkflow(entry.path);
      setParsed(result);

      const serverExposed = new Set(result.exposedNodeIds ?? []);
      setExposedNodeIds(serverExposed);
      setNodeOrderState(result.nodeOrder ?? []);

      const allParamValues: ParamValues = {};
      if (result.allNodes) {
        for (const node of result.allNodes) {
          for (const p of node.params) {
            if (p.type === 'image') continue;
            allParamValues[`${p.nodeId}:${p.paramName}`] = p.default;
          }
        }
      }
      const exposedValues = buildInitialValues(result.exposedParams);
      Object.assign(allParamValues, exposedValues);

      const saved = loadSavedParams(entry.path);
      if (saved) {
        for (const key of Object.keys(allParamValues)) {
          if (key in saved) allParamValues[key] = saved[key];
        }
      }
      setParamValues(allParamValues);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : t('cui.parse_failed'));
    } finally {
      setParsing(false);
    }
  }

  function handleSelectFromDropdown(path: string) {
    const entry = remoteFiles.find((f) => f.path === path);
    if (entry) handleSelect(entry);
  }

  function handleAssignImage(nodeId: string) {
    if (!selectedSourceId) {
      setHintMessage(t('cui.no_image_source'));
      setTimeout(() => setHintMessage(null), 3000);
      return;
    }
    const source = psSources.find((s) => s.id === selectedSourceId);
    if (!source) {
      setHintMessage(t('cui.no_image_source'));
      setTimeout(() => setHintMessage(null), 3000);
      return;
    }
    setImageAssignments((prev) => ({
      ...prev,
      [nodeId]: {
        sourceId: source.id,
        sourceName: source.name,
        thumbnail: source.thumbnail,
        width: source.width,
        height: source.height,
      },
    }));
  }

  function handleRemoveAssignment(nodeId: string) {
    setImageAssignments((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }

  async function handleSendAndExecute() {
    if (!selectedPath || executing || pollingResult) return;
    setExecuting(true);
    setExecuteError(null);
    setExecuteResult(null);
    setExecuteStatus(null);
    setCuiOutputs([]);
    setResultError(null);
    setAppliedImages(new Set());
    setSelectedOutputIdx(null);
    setCurrentPromptId(null);

    if (hasSelection) lock();

    const workflowEntry = remoteFiles.find((f) => f.path === selectedPath);
    const assignmentValues = Object.values(imageAssignments);
    const imageSource = assignmentValues.some(a => a.sourceId === 'ps_full')
      ? 'ps_full' as const
      : assignmentValues.some(a => a.sourceId === 'ps_selection')
        ? 'ps_selection' as const
        : null;
    const snapshot: CanvasSnapshot = {
      timestamp: Date.now(),
      canvasSize: canvasSize ?? { width: 0, height: 0 },
      hasSelection,
      selectionBounds: effectiveSelection ?? undefined,
      sourceMode: 'visibleMerged',
      imageSource,
      workflowName: workflowEntry?.name ?? selectedPath,
    };
    snapshotRef.current = snapshot;

    let promptId: string | null = null;
    const needsSelAlpha = hasSelection && !!effectiveSelection;
    let selAlphaSaved = false;

    try {
      const inputImages: Array<{ nodeId: string; imageData: string; filename?: string }> = [];

      if (bridgeConnected && Object.keys(imageAssignments).length > 0) {
        setExecuteStatus(t('cui.extracting'));
        let maxRes: number | undefined;
        let preserveDepth: boolean | undefined;
        try {
          [maxRes, preserveDepth] = await Promise.all([
            getSetting<number>('max_image_resolution').catch(() => undefined),
            getSetting<boolean>('preserve_bit_depth').catch(() => undefined),
          ]);
        } catch { /* use defaults */ }

        for (const [nodeId, assignment] of Object.entries(imageAssignments)) {
          try {
            let imageData: string | undefined;
            let rawFloat32Meta: { width: number; height: number; channels: number } | undefined;
            const saveAlpha = needsSelAlpha && !selAlphaSaved;
            const baseParams = {
              sourceMode: 'visibleMerged' as const,
              saveSelectionAlphaChannel: saveAlpha || undefined,
              maxResolution: maxRes,
              preserveBitDepth: true,
              rawFloat32: preserveDepth ?? false,
            };
            if (assignment.sourceId === 'ps_full') {
              const ctx = await platform.ps.extractImage({
                ...baseParams,
                sendPolicy: { sendFullImage: true, sendRegionImage: false, sendHighlightImage: false, sendMask: false },
              });
              imageData = ctx.fullImage;
              rawFloat32Meta = ctx.rawFloat32;
            } else if (assignment.sourceId === 'ps_selection') {
              const ctx = await platform.ps.extractImage({
                ...baseParams,
                sendPolicy: { sendFullImage: false, sendRegionImage: true, sendHighlightImage: false, sendMask: false },
              });
              imageData = ctx.regionImage;
              rawFloat32Meta = ctx.rawFloat32;
            }
            if (imageData) {
              const entry: any = { nodeId, imageData, filename: `ps_input_${nodeId}.png` };
              if (rawFloat32Meta) entry.rawFloat32 = rawFloat32Meta;
              inputImages.push(entry);
            }
            if (saveAlpha) selAlphaSaved = true;
          } catch (err) {
            throw new Error(`Image extraction failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else if (needsSelAlpha && bridgeConnected) {
        try {
          await platform.ps.extractImage({
            sourceMode: 'visibleMerged',
            sendPolicy: { sendFullImage: false, sendRegionImage: false, sendHighlightImage: false, sendMask: false },
            saveSelectionAlphaChannel: true,
          });
        } catch (err) {
          console.warn('[ComfyUI] Failed to save selection alpha:', err);
        }
      }

      setExecuteStatus(null);
      const result = await executeWorkflow({
        workflowPath: selectedPath,
        paramOverrides: paramValues,
        inputImages: inputImages.length > 0 ? inputImages : undefined,
      } as any);
      promptId = result.promptId;
      snapshot.promptId = promptId;
      setCurrentPromptId(promptId);
      setExecuteResult(t('cui.queued'));
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
      setExecuteStatus(null);
    }

    if (!promptId) {
      if (isLocked) unlock();
      return;
    }

    setPollingResult(true);
    let completedImages: Array<{ filename: string; subfolder: string; type: string }> | null = null;

    try {
      completedImages = await waitForResult(promptId);
    } catch (sseErr) {
      const sseMsg = sseErr instanceof Error ? sseErr.message : String(sseErr);
      if (sseMsg === 'timeout' || sseMsg === 'ComfyUI events disconnected') {
        console.warn('[ComfyUI] WS wait failed, falling back to polling');
        try {
          const pollResult = await pollWorkflowResult(promptId, 120000);
          if (pollResult.status === 'completed') {
            completedImages = [];
            for (const output of pollResult.outputs) {
              for (const img of output.images) completedImages.push(img);
            }
          } else {
            setResultError(t('cui.workflow_failed'));
          }
        } catch (pollErr) {
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          setResultError(msg.toLowerCase().includes('timeout') ? t('cui.polling_timeout') : msg);
        }
      } else {
        setResultError(sseMsg);
      }
    }

    if (completedImages && completedImages.length > 0) {
      const images: CuiOutput[] = completedImages.map((img) => ({
        filename: img.filename,
        subfolder: img.subfolder,
        type: img.type,
        url: getComfyUIViewUrl(img.filename, img.subfolder, img.type),
        nodeId: '',
      }));
      setCuiOutputs(images);
      setSelectedOutputIdx(0);

      if (bridgeConnected && documentPath) {
        try {
          setExecuteStatus(t('cui.auto_applying'));
          const firstImage = images[0];
          const saved = await saveComfyUIResultToLibrary({
            docPath: documentPath,
            filename: firstImage.filename,
            subfolder: firstImage.subfolder,
            type: firstImage.type,
            workflowName: snapshot.workflowName,
            workflowPath: selectedPath ?? undefined,
            promptId: snapshot.promptId,
          });
          const sendPolicy: SendPolicy = snapshot.imageSource === 'ps_selection'
            ? { sendFullImage: false, sendRegionImage: true, sendHighlightImage: false, sendMask: false }
            : { sendFullImage: true, sendRegionImage: false, sendHighlightImage: false, sendMask: false };
          await platform.ps.applyResult({
            resultId: saved.resultId,
            width: snapshot.canvasSize.width,
            height: snapshot.canvasSize.height,
            documentPath,
            requestConfig: snapshot.hasSelection && snapshot.selectionBounds ? {
              selectionBounds: snapshot.selectionBounds,
              sendPolicy,
            } : undefined,
          });
          setAppliedImages(new Set([firstImage.filename]));
          setExecuteResult(t('cui.auto_applied'));
          emitDataChange('results');
        } catch (err) {
          console.error('[ComfyUI] Auto-apply failed:', err);
        } finally {
          setExecuteStatus(null);
        }
      }
    } else if (completedImages && completedImages.length === 0) {
      setResultError(t('cui.no_output'));
    }

    setPollingResult(false);
    setCurrentPromptId(null);
    clearProgress();
    if (isLocked) unlock();
  }

  async function handleSendImagesOnly() {
    if (!selectedPath || executing || !hasAssignedImages) return;
    setExecuting(true);
    setExecuteStatus(t('cui.extracting'));
    setExecuteError(null);
    setExecuteResult(null);

    try {
      const mappings: Array<{ nodeId: string; uploadedFilename: string }> = [];

      for (const [nodeId, assignment] of Object.entries(imageAssignments)) {
        let imageData: string | undefined;
        if (assignment.sourceId === 'ps_full') {
          const ctx = await platform.ps.extractImage({
            sourceMode: 'visibleMerged',
            sendPolicy: { sendFullImage: true, sendRegionImage: false, sendHighlightImage: false, sendMask: false },
          });
          imageData = ctx.fullImage;
        } else if (assignment.sourceId === 'ps_selection') {
          const ctx = await platform.ps.extractImage({
            sourceMode: 'visibleMerged',
            sendPolicy: { sendFullImage: false, sendRegionImage: true, sendHighlightImage: false, sendMask: false },
          });
          imageData = ctx.regionImage;
        }
        if (imageData) {
          setExecuteStatus(t('cui.uploading'));
          const uploaded = await uploadImageToComfyUI(imageData, `ps_input_${nodeId}.png`);
          mappings.push({ nodeId, uploadedFilename: uploaded.name });
        }
      }

      if (mappings.length > 0) {
        setExecuteStatus(t('cui.saving_workflow'));
        await sendImagesOnlyWorkflow({
          workflowPath: selectedPath,
          imageNodeMappings: mappings,
        });
      }

      window.open('http://localhost:8188/', '_blank');
      setExecuteResult(t('cui.images_sent'));
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
      setExecuteStatus(null);
    }
  }

  async function handleTestConnection() {
    try {
      const s = await testComfyUIConnection();
      setStatus(s);
    } catch { /* ignore */ }
  }

  async function handleApplyToCanvas(output: CuiOutput) {
    if (!bridgeConnected || applyingImage || !documentPath) return;
    setApplyingImage(output.filename);
    try {
      const saved = await saveComfyUIResultToLibrary({
        docPath: documentPath,
        filename: output.filename,
        subfolder: output.subfolder,
        type: output.type,
        workflowPath: selectedPath ?? undefined,
        promptId: currentPromptId ?? undefined,
      });
      const snap = snapshotRef.current;
      const sel = snap?.selectionBounds ?? (hasSelection ? effectiveSelection : null);
      let requestConfig: RequestConfig | undefined;
      if (sel) {
        const policy: SendPolicy = snap?.imageSource === 'ps_selection'
          ? { sendFullImage: false, sendRegionImage: true, sendHighlightImage: false, sendMask: false }
          : { sendFullImage: true, sendRegionImage: false, sendHighlightImage: false, sendMask: false };
        requestConfig = { selectionBounds: sel, sendPolicy: policy };
      }
      await platform.ps.applyResult({
        resultId: saved.resultId,
        width: canvasSize?.width ?? 0,
        height: canvasSize?.height ?? 0,
        documentPath,
        requestConfig,
      });
      setAppliedImages((prev) => new Set(prev).add(output.filename));
      emitDataChange('results');
    } catch (err) {
      console.error('[ComfyUI] Failed to apply image:', err);
    } finally {
      setApplyingImage(null);
    }
  }

  function handleParamChange(key: string, value: unknown) {
    setParamValues((prev) => {
      const next = { ...prev, [key]: value };
      if (selectedPath) {
        if (paramSaveTimerRef.current) clearTimeout(paramSaveTimerRef.current);
        paramSaveTimerRef.current = setTimeout(() => {
          saveParamsToStorage(selectedPath!, next);
        }, PARAM_SAVE_DEBOUNCE);
      }
      return next;
    });
  }

  async function handleRefreshOutputs() {
    setRefreshingOutputs(true);
    try {
      const entries = await getComfyUIRecentHistory(10);
      const outputs: CuiOutput[] = entries.map((e) => ({
        filename: e.filename,
        subfolder: e.subfolder,
        type: e.type,
        url: getComfyUIViewUrl(e.filename, e.subfolder, e.type),
        nodeId: '',
      }));
      setCuiOutputs(outputs);
      if (outputs.length > 0 && selectedOutputIdx === null) setSelectedOutputIdx(0);
    } catch (err) {
      console.error('[ComfyUI] Failed to fetch history:', err);
    } finally {
      setRefreshingOutputs(false);
    }
  }

  async function handleCancelExecution() {
    if (!currentPromptId) return;
    try {
      await cancelComfyUIExecution(currentPromptId);
    } catch (err) {
      console.error('[ComfyUI] Cancel failed:', err);
    }
  }

  async function handleSaveToLibrary(output: CuiOutput) {
    try {
      if (!documentPath) {
        setHintMessage(t('cui.no_document'));
        setTimeout(() => setHintMessage(null), 3000);
        return;
      }
      const workflowEntry = remoteFiles.find((f) => f.path === selectedPath);
      await saveComfyUIResultToLibrary({
        docPath: documentPath,
        filename: output.filename,
        subfolder: output.subfolder,
        type: output.type,
        workflowName: workflowEntry?.name,
        workflowPath: selectedPath ?? undefined,
        promptId: currentPromptId ?? undefined,
      });
      setHintMessage(t('cui.saved'));
      setTimeout(() => setHintMessage(null), 3000);
      emitDataChange('results');
    } catch (err) {
      console.error('[ComfyUI] Save to library failed:', err);
      setHintMessage(t('cui.save_failed'));
      setTimeout(() => setHintMessage(null), 3000);
    }
  }

  // ─── Return ────────────────────────────────────────

  return {
    status, connected, wsConnected, handleTestConnection,
    remoteFiles, remoteLoading, remoteError, refreshRemote,
    selectedPath, parsed, parsing, parseError, handleSelect, handleSelectFromDropdown,
    nodeViewMode, setNodeViewMode, exposedNodeIds, handleToggleExposed,
    visibleImageNodes, visibleNonImageParams, visibleParamsByNode, allNodes, nodeOrder, handleReorder,
    paramValues, nonImageParams, paramsByNode, handleParamChange,
    psSources, selectedSourceId, setSelectedSourceId, canvasSize,
    imageAssignments, hasAssignedImages, handleAssignImage, handleRemoveAssignment, hintMessage,
    executing, executeError, executeResult, executeStatus, handleSendAndExecute, handleSendImagesOnly,
    progressInfo, executingNode, queueRemaining, pollingResult, currentPromptId,
    cuiOutputs, selectedOutputIdx, setSelectedOutputIdx, resultError, setResultError,
    handleApplyToCanvas, handleSaveToLibrary, applyingImage, appliedImages,
    handleRefreshOutputs, refreshingOutputs,
    handleCancelExecution,
    hasSelection, effectiveSelection, isLocked,
    workflowReady,
  };
}
