import type { ModelCapability, FcMode } from '@ai-retouch/shared';

interface KnownModelInfo {
  capabilities: ModelCapability[];
  fcMode: FcMode;
}

// Key: substring to match against modelId (case-insensitive)
// Sorted by specificity (longer keys first during matching)
const KNOWN_MODELS: Record<string, KnownModelInfo> = {
  // ── OpenAI ────────────────────────────────────────────
  'gpt-4.1-mini':             { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-4.1-nano':             { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-4.1':                  { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-4o-mini':              { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-4o':                   { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  'gpt-4-turbo':              { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-5':                    { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gpt-image':                { capabilities: ['vision', 'image_generation'], fcMode: 'none' },
  'dall-e':                   { capabilities: ['image_generation'], fcMode: 'none' },
  'o1-mini':                  { capabilities: ['function_calling'], fcMode: 'native' },
  'o1':                       { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'o3-mini':                  { capabilities: ['function_calling'], fcMode: 'native' },
  'o3-pro':                   { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'o3':                       { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'o4-mini':                  { capabilities: ['vision', 'function_calling'], fcMode: 'native' },

  // ── Google Gemini ─────────────────────────────────────
  // image-generation variants (longer keys → matched first)
  'gemini-3.1-flash-image':   { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  'gemini-3-pro-image':       { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  'nano-banana-pro':          { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  'gemini-2.5-flash-image':   { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  'gemini-2.0-flash-image':   { capabilities: ['vision', 'function_calling', 'image_generation'], fcMode: 'native' },
  // standard variants
  'gemini-3.1-pro':           { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-3.1-flash':         { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-3-pro':             { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-3-flash':           { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.5-pro':           { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.5-flash-lite':    { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.5-flash':         { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.0-flash-lite':    { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.0-pro':           { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'gemini-2.0-flash':         { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'imagen':                   { capabilities: ['image_generation'], fcMode: 'none' },

  // ── Anthropic ─────────────────────────────────────────
  'claude-sonnet':            { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'claude-opus':              { capabilities: ['vision', 'function_calling'], fcMode: 'native' },
  'claude-haiku':             { capabilities: ['vision', 'function_calling'], fcMode: 'native' },

  // ── DeepSeek ──────────────────────────────────────────
  'deepseek-chat':            { capabilities: ['function_calling'], fcMode: 'native' },
  'deepseek-reasoner':        { capabilities: ['function_calling'], fcMode: 'native' },

  // ── Qwen ──────────────────────────────────────────────
  'qwen-vl':                  { capabilities: ['vision'], fcMode: 'none' },
  'qwen-turbo':               { capabilities: ['function_calling'], fcMode: 'native' },
  'qwen-plus':                { capabilities: ['function_calling'], fcMode: 'native' },
  'qwen-max':                 { capabilities: ['function_calling'], fcMode: 'native' },
};

// Default for unknown models: assume image generation capability
const DEFAULT_MODEL_INFO: KnownModelInfo = {
  capabilities: ['image_generation'],
  fcMode: 'none',
};

/**
 * Fuzzy-match a model ID against the known models database.
 * Matches by checking if the modelId contains a known key (case-insensitive).
 * Longer keys are checked first for specificity.
 * Returns default capabilities for unknown models (image_generation).
 */
export function inferModelCapabilities(modelId: string): KnownModelInfo {
  const lower = modelId.toLowerCase();
  const sortedKeys = Object.keys(KNOWN_MODELS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key.toLowerCase())) {
      return KNOWN_MODELS[key];
    }
  }
  return DEFAULT_MODEL_INFO;
}
