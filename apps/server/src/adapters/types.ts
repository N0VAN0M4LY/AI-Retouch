import type { AdvancedSettings, GeminiImageSize, ImageHistoryStrategy, ModelCapability } from '@ai-retouch/shared';

/**
 * Metadata for a single Part in a Gemini response, used to faithfully
 * reconstruct history with thought signatures on subsequent turns.
 */
export interface ResponsePartMeta {
  type: 'text' | 'thinking' | 'image';
  text?: string;
  resultIndex?: number;
  mimeType?: string;
  thoughtSignature?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: AdapterImage[];
  responsePartsMeta?: ResponsePartMeta[];
}

export interface AdapterRequest {
  prompt: string;
  modelId: string;
  images?: AdapterImage[];
  capabilities?: ModelCapability[];
  history?: ConversationTurn[];
  mask?: AdapterImage;
  previousResponseId?: string;
  imageSize?: GeminiImageSize;
}

export interface AdapterImage {
  data: string;
  mimeType: string;
}

export interface AdapterResponse {
  text?: string;
  thinking?: string;
  images: AdapterResultImage[];
  elapsedMs: number;
  responsePartsMeta?: ResponsePartMeta[];
  providerResponseId?: string;
}

export interface AdapterResultImage {
  data: Buffer;
  mimeType: string;
}

export interface ResolvedProvider {
  baseUrl: string;
  urlMode: 'auto' | 'full';
  apiProtocol: 'openai' | 'openai_responses' | 'gemini';
  apiKey: string;
  streamEnabled: boolean;
  useAuthorizationFormat: boolean;
  imageHistoryStrategy: ImageHistoryStrategy;
  advancedSettings: AdvancedSettings;
}

export interface AdapterStreamCallbacks {
  onText: (text: string) => void;
  onThinking: (text: string) => void;
  onImage: (image: AdapterResultImage) => void | Promise<void>;
  onError: (error: string) => void;
}
