import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { AdvancedSettings, GeminiImageSize, GeminiThinkingLevel, ModelCapability } from '@ai-retouch/shared';
import { resolveImageUrlsFromText } from './image-url-resolver.js';
import type {
  AdapterRequest,
  AdapterResponse,
  AdapterResultImage,
  AdapterStreamCallbacks,
  ConversationTurn,
  ResolvedProvider,
  ResponsePartMeta,
} from './types.js';
import type { Content, GenerateContentConfig, Part } from '@google/genai';

// ─── Helpers ───────────────────────────────────────────

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com';

const FALLBACK_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

const THINKING_LEVEL_MAP: Record<GeminiThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function createClient(provider: ResolvedProvider): GoogleGenAI {
  const isCustomBase =
    provider.urlMode === 'full' ||
    (provider.baseUrl && !provider.baseUrl.startsWith(DEFAULT_GEMINI_BASE));

  return new GoogleGenAI({
    apiKey: provider.apiKey,
    // TODO: When useAuthorizationFormat is true (proxy/Vertex), the SDK's
    // apiKey auth may not suffice. Consider using httpOptions.headers with
    // a custom Authorization header, or Vertex-specific auth options.
    httpOptions: isCustomBase
      ? { baseUrl: provider.baseUrl.replace(/\/+$/, '') }
      : undefined,
  });
}

function getThoughtSignature(part: Part): string | undefined {
  return (part as Record<string, unknown>).thoughtSignature as string | undefined;
}

function setThoughtSignature(part: Part, sig: string): void {
  (part as Record<string, unknown>).thoughtSignature = sig;
}

function buildHistory(history?: ConversationTurn[]): Content[] {
  if (!history?.length) return [];

  return history.map((turn) => {
    if (turn.role === 'assistant' && turn.responsePartsMeta?.length) {
      return buildContentFromMeta(turn);
    }
    return buildContentFallback(turn);
  });
}

/**
 * Rebuild a Content from saved response parts metadata (has real signatures).
 */
function buildContentFromMeta(turn: ConversationTurn): Content {
  const parts: Part[] = [];
  let imageIndex = 0;

  for (const meta of turn.responsePartsMeta!) {
    if (meta.type === 'thinking') continue;

    if (meta.type === 'text') {
      const part: Part = { text: meta.text ?? '' };
      if (meta.thoughtSignature) {
        setThoughtSignature(part, meta.thoughtSignature);
      }
      parts.push(part);
    }

    if (meta.type === 'image') {
      const img = turn.images?.[imageIndex++];
      if (!img) continue;
      const part: Part = { inlineData: { mimeType: img.mimeType, data: img.data } };
      if (meta.thoughtSignature) {
        setThoughtSignature(part, meta.thoughtSignature);
      } else {
        console.warn(
          `[Gemini] ⚠ FALLBACK: Image part (resultIndex=${meta.resultIndex}) has no stored thought_signature, injecting dummy signature to avoid 400 error`,
        );
        setThoughtSignature(part, FALLBACK_THOUGHT_SIGNATURE);
      }
      parts.push(part);
    }
  }

  if (parts.length === 0) {
    parts.push({ text: turn.content || '' });
  }
  return { parts, role: 'model' } as Content;
}

/**
 * Fallback for turns without saved response parts metadata (legacy messages).
 * Injects dummy thought signatures on assistant image parts to prevent 400 errors.
 */
function buildContentFallback(turn: ConversationTurn): Content {
  const parts: Part[] = [];

  if (turn.images?.length) {
    for (const img of turn.images) {
      const part: Part = { inlineData: { mimeType: img.mimeType, data: img.data } };
      if (turn.role === 'assistant') {
        console.warn(
          '[Gemini] ⚠ FALLBACK: No response_parts_json for assistant message, injecting dummy thought_signature for image part',
        );
        setThoughtSignature(part, FALLBACK_THOUGHT_SIGNATURE);
      }
      parts.push(part);
    }
  }

  if (turn.content) {
    parts.push({ text: turn.content });
  } else if (parts.length === 0) {
    parts.push({ text: '' });
  }

  return { parts, role: turn.role === 'assistant' ? 'model' : 'user' } as Content;
}

function buildCurrentParts(request: AdapterRequest): Part[] {
  const parts: Part[] = [];
  if (request.images?.length) {
    for (const img of request.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }
  parts.push({ text: request.prompt });
  return parts;
}

function buildConfig(
  settings: AdvancedSettings,
  capabilities?: ModelCapability[],
  imageSizeOverride?: GeminiImageSize,
): GenerateContentConfig {
  const hasImageGen = capabilities?.includes('image_generation') ?? false;
  const config: GenerateContentConfig = {
    responseModalities: hasImageGen ? ['TEXT', 'IMAGE'] : ['TEXT'],
  };

  if (settings.temperature?.enabled) config.temperature = settings.temperature.value;
  if (settings.maxOutputTokens?.enabled) config.maxOutputTokens = settings.maxOutputTokens.value;
  if (settings.topP?.enabled) config.topP = settings.topP.value;
  if (settings.topK?.enabled) config.topK = settings.topK.value;

  // Image size: per-request override takes priority, then provider-level setting
  const effectiveImageSize = imageSizeOverride ?? (settings.imageSize?.enabled ? settings.imageSize.value : undefined);
  if (hasImageGen && effectiveImageSize) {
    config.imageConfig = { imageSize: effectiveImageSize };
    console.log(`[Gemini] imageConfig.imageSize = ${effectiveImageSize}`);
  }

  const tk = settings.thinking;
  if (tk?.thinkingBudget?.enabled || tk?.includeThoughts?.enabled || tk?.thinkingLevel?.enabled) {
    const thinkingConfig: GenerateContentConfig['thinkingConfig'] = {};
    if (tk.thinkingBudget?.enabled && tk.thinkingBudget.value >= 0) {
      thinkingConfig.thinkingBudget = tk.thinkingBudget.value;
    }
    if (tk.includeThoughts?.enabled) {
      thinkingConfig.includeThoughts = tk.includeThoughts.value;
    }
    if (tk.thinkingLevel?.enabled) {
      thinkingConfig.thinkingLevel = THINKING_LEVEL_MAP[tk.thinkingLevel.value];
    }
    config.thinkingConfig = thinkingConfig;
  }

  return config;
}

interface ExtractedPart {
  text?: string;
  thinking?: string;
  image?: AdapterResultImage;
  thoughtSignature?: string;
}

function extractPart(part: Part): ExtractedPart {
  let text: string | undefined;
  let thinking: string | undefined;
  let image: AdapterResultImage | undefined;
  const thoughtSignature = getThoughtSignature(part);

  if (part.text) {
    if (part.thought) {
      thinking = part.text;
    } else {
      text = part.text;
    }
  }

  if (part.inlineData?.data) {
    image = {
      data: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: part.inlineData.mimeType ?? 'image/png',
    };
  }

  return { text, thinking, image, thoughtSignature };
}

// ─── Non-streaming call ────────────────────────────────

export async function callGemini(
  provider: ResolvedProvider,
  request: AdapterRequest,
): Promise<AdapterResponse> {
  const ai = createClient(provider);
  const history = buildHistory(request.history);
  const currentParts = buildCurrentParts(request);
  const config = buildConfig(provider.advancedSettings, request.capabilities, request.imageSize);
  const start = Date.now();

  console.log(`[Gemini] Chat API sendMessage model=${request.modelId} history=${history.length} turns images=${request.images?.length ?? 0}`);

  try {
    const chat = ai.chats.create({
      model: request.modelId,
      config,
      history,
    });

    const response = await chat.sendMessage({ message: currentParts });

    const elapsedMs = Date.now() - start;
    const candidate = response.candidates?.[0];

    if (!candidate) {
      console.warn('[Gemini] No candidates in response. Raw:', JSON.stringify(response).slice(0, 500));
      throw new Error('Gemini returned no candidates');
    }

    let text: string | undefined;
    let thinking: string | undefined;
    const images: AdapterResultImage[] = [];
    const partsMeta: ResponsePartMeta[] = [];
    let imageIndex = 0;

    for (const part of candidate.content?.parts ?? []) {
      const extracted = extractPart(part);

      if (extracted.thinking) {
        thinking = (thinking ?? '') + extracted.thinking;
        partsMeta.push({ type: 'thinking', text: extracted.thinking });
      } else if (extracted.image) {
        images.push(extracted.image);
        partsMeta.push({
          type: 'image',
          resultIndex: imageIndex++,
          mimeType: extracted.image.mimeType,
          thoughtSignature: extracted.thoughtSignature,
        });
      } else if (extracted.text) {
        text = (text ?? '') + extracted.text;
        partsMeta.push({
          type: 'text',
          text: extracted.text,
          thoughtSignature: extracted.thoughtSignature,
        });
      } else if (extracted.thoughtSignature) {
        // Signature-only part (empty text) — attach to nearest text meta
        const lastText = [...partsMeta].reverse().find(m => m.type === 'text');
        if (lastText && !lastText.thoughtSignature) {
          lastText.thoughtSignature = extracted.thoughtSignature;
        }
      }
    }

    const resolved = await resolveImageUrlsFromText(text);
    if (resolved.images.length > 0) {
      text = resolved.cleanText || undefined;
      for (const img of resolved.images) {
        images.push(img);
        partsMeta.push({ type: 'image', resultIndex: imageIndex++, mimeType: img.mimeType });
      }
    }

    console.log(
      `[Gemini] Done: elapsed=${elapsedMs}ms text=${text ? text.length + ' chars' : 'none'} thinking=${thinking ? thinking.length + ' chars' : 'none'} images=${images.length} signatures=${partsMeta.filter(m => m.thoughtSignature).length}`,
    );

    return { text, thinking, images, elapsedMs, responsePartsMeta: partsMeta };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Gemini] Error after ${elapsedMs}ms:`, msg);
    throw err;
  }
}

// ─── Streaming call ────────────────────────────────────

export async function callGeminiStream(
  provider: ResolvedProvider,
  request: AdapterRequest,
  callbacks: AdapterStreamCallbacks,
): Promise<AdapterResponse> {
  const ai = createClient(provider);
  const history = buildHistory(request.history);
  const currentParts = buildCurrentParts(request);
  const config = buildConfig(provider.advancedSettings, request.capabilities, request.imageSize);
  const start = Date.now();

  console.log(`[Gemini/Stream] Chat API sendMessageStream model=${request.modelId} history=${history.length} turns images=${request.images?.length ?? 0}`);

  let accumulatedText: string | undefined;
  let accumulatedThinking: string | undefined;
  const accumulatedImages: AdapterResultImage[] = [];

  // Track part ordering and thought signatures during streaming.
  // Text arrives across many chunks; images arrive in single chunks.
  type StreamPartType = 'text' | 'thinking' | 'image';
  interface StreamPartEntry {
    type: StreamPartType;
    thoughtSignature?: string;
    text?: string;
    imageIndex?: number;
    mimeType?: string;
  }
  const orderedParts: StreamPartEntry[] = [];
  let lastPartType: StreamPartType | null = null;

  try {
    const chat = ai.chats.create({
      model: request.modelId,
      config,
      history,
    });

    const stream = await chat.sendMessageStream({ message: currentParts });

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;

      for (const part of parts) {
        const extracted = extractPart(part);

        if (extracted.thinking) {
          if (lastPartType === 'thinking' && orderedParts.length > 0) {
            orderedParts[orderedParts.length - 1].text! += extracted.thinking;
          } else {
            orderedParts.push({ type: 'thinking', text: extracted.thinking });
            lastPartType = 'thinking';
          }
          accumulatedThinking = (accumulatedThinking ?? '') + extracted.thinking;
          callbacks.onThinking(extracted.thinking);
        }

        if (extracted.text) {
          if (lastPartType === 'text' && orderedParts.length > 0) {
            orderedParts[orderedParts.length - 1].text! += extracted.text;
            if (extracted.thoughtSignature) {
              orderedParts[orderedParts.length - 1].thoughtSignature = extracted.thoughtSignature;
            }
          } else {
            orderedParts.push({ type: 'text', text: extracted.text, thoughtSignature: extracted.thoughtSignature });
            lastPartType = 'text';
          }
          accumulatedText = (accumulatedText ?? '') + extracted.text;
          callbacks.onText(extracted.text);
        }

        // Signature-only part (empty text with thoughtSignature)
        if (!extracted.text && !extracted.thinking && !extracted.image && extracted.thoughtSignature) {
          const lastText = [...orderedParts].reverse().find(p => p.type === 'text');
          if (lastText && !lastText.thoughtSignature) {
            lastText.thoughtSignature = extracted.thoughtSignature;
          }
        }

        if (extracted.image) {
          const imgIdx = accumulatedImages.length;
          orderedParts.push({
            type: 'image',
            imageIndex: imgIdx,
            mimeType: extracted.image.mimeType,
            thoughtSignature: extracted.thoughtSignature,
          });
          lastPartType = 'image';
          accumulatedImages.push(extracted.image);
          await callbacks.onImage(extracted.image);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Gemini/Stream] Error:', msg);
    callbacks.onError(msg);
    throw err;
  }

  const resolved = await resolveImageUrlsFromText(accumulatedText);
  if (resolved.images.length > 0) {
    accumulatedText = resolved.cleanText || undefined;
    for (const img of resolved.images) {
      orderedParts.push({ type: 'image', imageIndex: accumulatedImages.length, mimeType: img.mimeType });
      accumulatedImages.push(img);
      await callbacks.onImage(img);
    }
  }

  // Convert tracked parts to ResponsePartMeta
  let metaImageIndex = 0;
  const partsMeta: ResponsePartMeta[] = orderedParts.map((p) => ({
    type: p.type,
    text: p.type !== 'image' ? p.text : undefined,
    resultIndex: p.type === 'image' ? metaImageIndex++ : undefined,
    mimeType: p.mimeType,
    thoughtSignature: p.thoughtSignature,
  }));

  const elapsedMs = Date.now() - start;
  console.log(
    `[Gemini/Stream] Done: elapsed=${elapsedMs}ms text=${accumulatedText ? accumulatedText.length + ' chars' : 'none'} thinking=${accumulatedThinking ? accumulatedThinking.length + ' chars' : 'none'} images=${accumulatedImages.length} signatures=${partsMeta.filter(m => m.thoughtSignature).length}`,
  );

  return { text: accumulatedText, thinking: accumulatedThinking, images: accumulatedImages, elapsedMs, responsePartsMeta: partsMeta };
}
