import { zh } from './zh';

/**
 * Unified i18n for all UI surfaces.
 *
 * Uses a simple synchronous dictionary lookup — no React hooks required.
 * Both Electron and Plugin call initI18n() at their entry point to allow
 * future locale extension (currently only zh).
 */

let translations: Record<string, string> = zh;

export function initI18n(overrides?: Record<string, string>): void {
  if (overrides) {
    translations = { ...zh, ...overrides };
  }
}

/**
 * Translate a key to its display string.
 * Positional placeholders: {0}, {1}, …
 *
 * @example
 *   t('set.models_count_fmt', '3')  // '3 个模型'
 *   t('chat.images_sent', '2')       // '2 张图片已发送'
 */
export function t(key: string, ...args: string[]): string {
  let text = translations[key] ?? key;
  for (let i = 0; i < args.length; i++) {
    text = text.replace(`{${i}}`, args[i]);
  }
  return text;
}
