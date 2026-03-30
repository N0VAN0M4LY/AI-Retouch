import type { ExposedParam, WorkflowNodeInfo, GenerationResult, SendMessageResponse } from '@ai-retouch/shared';

// ─── Stream Types ────────────────────────────────────────

export interface StreamCallbacks {
  onThinkingDelta: (text: string) => void;
  onTextDelta: (text: string) => void;
  onImageResult: (result: GenerationResult) => void;
  onDone: (response: SendMessageResponse) => void;
  onError: (error: string) => void;
}

export interface StreamHandle {
  promise: Promise<void>;
  abort: () => void;
}

// ─── ComfyUI Types ──────────────────────────────────────

export interface ComfyUISSECallbacks {
  onProgress?: (data: { promptId: string; node: string; value: number; max: number; percentage: number }) => void;
  onExecuting?: (data: { promptId: string; node: string }) => void;
  onExecuted?: (data: { promptId: string; node: string; output: unknown }) => void;
  onComplete?: (data: { promptId: string; images: Array<{ filename: string; subfolder: string; type: string }> }) => void;
  onError?: (data: { promptId: string; message: string }) => void;
  onQueue?: (data: { queueRemaining: number }) => void;
  onStatus?: (data: { wsConnected: boolean }) => void;
}

export interface RemoteWorkflowEntry {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export interface ParsedWorkflow {
  exposedParams: ExposedParam[];
  imageInputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  outputNodes: Array<{ nodeId: string; nodeType: string; title: string }>;
  allNodes: WorkflowNodeInfo[];
  exposedNodeIds: string[];
  nodeOrder: string[];
}

export interface PromptResult {
  promptId: string;
  status: 'completed' | 'failed';
  outputs: Array<{
    nodeId: string;
    images: Array<{ filename: string; subfolder: string; type: string }>;
  }>;
}

export interface CuiHistoryEntry {
  promptId: string;
  filename: string;
  subfolder: string;
  type: string;
  thumbnailUrl: string;
  timestamp: number;
}

export interface ComfyUITasksData {
  active: {
    promptId: string;
    status: string;
    currentNode?: string;
    progress?: { value: number; max: number };
  } | null;
  queued: Array<{ promptId: string; status: string }>;
  recent: Array<{ promptId: string; status: string; completedAt?: number }>;
}
