import { encode as pngEncode } from 'fast-png';
import type { ImageContext, SelectionInfo, SendPolicy, SourceMode } from '@ai-retouch/shared';

export const SELECTION_ALPHA_CHANNEL = 'AI Retouch Selection';

export interface ExtractOptions {
  /** Use this selection instead of reading doc.selection (for session-locked selection). */
  overrideSelection?: SelectionInfo;
  /** When true, save the current live PS selection to an alpha channel for later mask use. */
  saveSelectionAlphaChannel?: boolean;
  /** Max long-edge resolution. 0 = no limit. Default read from settings (2048). */
  maxResolution?: number;
  /** When true, preserve 16-bit as 16-bit PNG; 32-bit as 16-bit PNG (or raw float for ComfyUI). */
  preserveBitDepth?: boolean;
  /** When true, return raw Float32 data instead of PNG (for backend TIFF encoding). */
  rawFloat32?: boolean;
}

// UXP Photoshop modules – accessed via the runtime require injected by UXP.
// In Vite dev mode (browser) these will be undefined.
const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

function getPhotoshop() {
  const ps = psRequire?.('photoshop');
  if (!ps) throw new Error('Photoshop API not available (running outside UXP?)');
  return ps;
}

const DEFAULT_MAX_LONG_EDGE = 2048;
const PREVIEW_MAX_LONG_EDGE = 512;

// All pixels extracted for AI consumption are converted to sRGB by Photoshop's
// ICC engine, since PNG (like JPEG) has no embedded ICC profile in our pipeline,
// and all downstream consumers interpret untagged images as sRGB.
const SRGB_PROFILE = 'sRGB IEC61966-2.1';

function targetSizeForBounds(
  w: number,
  h: number,
  maxLongEdge: number,
): { width: number; height: number } | undefined {
  if (maxLongEdge <= 0) return undefined;
  const longEdge = Math.max(w, h);
  if (longEdge <= maxLongEdge) return undefined;
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  };
}

// ─── Base64 helper (no atob/btoa dependency on typed arrays) ──

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
  }
  return btoa(binary);
}

// ─── Pixel data helpers ──────────────────────────────

async function getDataAs8bit(imageData: any): Promise<Uint8Array> {
  const componentSize: number = imageData.componentSize;

  if (componentSize === 8) {
    return imageData.getData({ chunky: true }) as Promise<Uint8Array>;
  }

  if (componentSize === 16) {
    const raw: Uint16Array = await imageData.getData({ chunky: true, fullRange: true });
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = ((raw[i] + 128) / 257) | 0;
    }
    return out;
  }

  if (componentSize === 32) {
    const raw: Float32Array = await imageData.getData({ chunky: true });
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const clamped = raw[i] < 0 ? 0 : raw[i] > 1 ? 1 : raw[i];
      out[i] = (clamped * 255 + 0.5) | 0;
    }
    return out;
  }

  throw new Error(`Unsupported componentSize: ${componentSize}`);
}

async function getDataAs16bit(imageData: any): Promise<Uint16Array> {
  const componentSize: number = imageData.componentSize;

  if (componentSize === 16) {
    return imageData.getData({ chunky: true, fullRange: true }) as Promise<Uint16Array>;
  }

  if (componentSize === 8) {
    const raw: Uint8Array = await imageData.getData({ chunky: true });
    const out = new Uint16Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = raw[i] * 257;
    }
    return out;
  }

  if (componentSize === 32) {
    const raw: Float32Array = await imageData.getData({ chunky: true });
    const out = new Uint16Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i] < 0 ? 0 : raw[i] > 1 ? 1 : raw[i];
      out[i] = Math.round(v * 65535);
    }
    return out;
  }

  throw new Error(`Unsupported componentSize: ${componentSize}`);
}

// ─── PNG encoding via fast-png ───────────────────────

interface EncodeResult {
  base64: string;
  mimeType: 'image/png';
}

/**
 * Encode image data to PNG base64 using fast-png.
 * Replaces the old JPEG-based encodeToBase64.
 */
async function encodeToPng(
  imageData: any,
  preserveBitDepth: boolean,
): Promise<EncodeResult> {
  const componentSize: number = imageData.componentSize;
  const isGrayscale = imageData.colorSpace === 'Grayscale';
  const w: number = imageData.width;
  const h: number = imageData.height;
  const hasAlpha: boolean = imageData.hasAlpha;

  const use16bit = preserveBitDepth && componentSize >= 16;

  let rgbData: Uint8Array | Uint16Array;
  let depth: 8 | 16;

  if (use16bit) {
    const pixels = await getDataAs16bit(imageData);
    depth = 16;
    if (isGrayscale) {
      const srcComponents = hasAlpha ? 2 : 1;
      rgbData = new Uint16Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const g = pixels[i * srcComponents];
        rgbData[i * 3] = g;
        rgbData[i * 3 + 1] = g;
        rgbData[i * 3 + 2] = g;
      }
    } else if (hasAlpha) {
      rgbData = new Uint16Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        rgbData[i * 3] = pixels[i * 4];
        rgbData[i * 3 + 1] = pixels[i * 4 + 1];
        rgbData[i * 3 + 2] = pixels[i * 4 + 2];
      }
    } else {
      rgbData = pixels;
    }
  } else {
    const pixels = await getDataAs8bit(imageData);
    depth = 8;
    if (isGrayscale) {
      const srcComponents = hasAlpha ? 2 : 1;
      rgbData = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const g = pixels[i * srcComponents];
        rgbData[i * 3] = g;
        rgbData[i * 3 + 1] = g;
        rgbData[i * 3 + 2] = g;
      }
    } else if (hasAlpha) {
      rgbData = new Uint8Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        rgbData[i * 3] = pixels[i * 4];
        rgbData[i * 3 + 1] = pixels[i * 4 + 1];
        rgbData[i * 3 + 2] = pixels[i * 4 + 2];
      }
    } else {
      rgbData = pixels;
    }
  }

  const pngBytes = pngEncode({ width: w, height: h, data: rgbData, channels: 3, depth });
  return { base64: uint8ArrayToBase64(new Uint8Array(pngBytes)), mimeType: 'image/png' };
}

/**
 * Extract raw Float32 pixel data for backend TIFF encoding.
 * Only used for 32-bit documents + ComfyUI + preserveBitDepth.
 */
async function extractRawFloat32(imageData: any): Promise<{
  base64: string;
  width: number;
  height: number;
  channels: number;
}> {
  const w: number = imageData.width;
  const h: number = imageData.height;
  const hasAlpha: boolean = imageData.hasAlpha;
  const isGrayscale = imageData.colorSpace === 'Grayscale';
  const raw: Float32Array = await imageData.getData({ chunky: true });

  let rgb: Float32Array;
  if (isGrayscale) {
    const srcComponents = hasAlpha ? 2 : 1;
    rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const g = raw[i * srcComponents];
      rgb[i * 3] = g;
      rgb[i * 3 + 1] = g;
      rgb[i * 3 + 2] = g;
    }
  } else if (hasAlpha) {
    rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = raw[i * 4];
      rgb[i * 3 + 1] = raw[i * 4 + 1];
      rgb[i * 3 + 2] = raw[i * 4 + 2];
    }
  } else {
    rgb = raw;
  }

  const bytes = new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.byteLength);
  return { base64: uint8ArrayToBase64(bytes), width: w, height: h, channels: 3 };
}

/**
 * Check whether PS has an active selection. Returns bounds or null.
 */
function getSelectionBounds(doc: any): SelectionInfo | null {
  try {
    const bounds = doc.selection?.bounds;
    if (!bounds) return null;
    const x = bounds.left;
    const y = bounds.top;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

/**
 * Main extraction function.
 * Extracts image data from the active Photoshop document according to
 * the specified SourceMode and SendPolicy.
 *
 * Must be called from within the UXP environment.
 */
export async function extractImageContext(
  sourceMode: SourceMode,
  sendPolicy: SendPolicy,
  extractOpts?: ExtractOptions,
): Promise<ImageContext> {
  const ps = getPhotoshop();
  const { app, imaging, core, action } = ps;

  const doc = app.activeDocument;
  if (!doc) throw new Error('No active document');

  const canvasSize = { width: doc.width, height: doc.height };
  const selectionInfo = extractOpts?.overrideSelection ?? getSelectionBounds(doc);
  const maxRes = extractOpts?.maxResolution ?? DEFAULT_MAX_LONG_EDGE;
  const preserve = extractOpts?.preserveBitDepth ?? false;
  const wantRawFloat = extractOpts?.rawFloat32 ?? false;

  const context: ImageContext = {
    canvasSize,
    sourceMode,
    selection: selectionInfo ?? undefined,
    mimeType: 'image/png',
  };

  const needsSelection = sendPolicy.sendRegionImage || sendPolicy.sendMask || sendPolicy.sendHighlightImage;
  if (needsSelection && !selectionInfo) {
    console.warn('[ImageExtractor] Selection-dependent policies requested but no active selection');
  }

  await core.executeAsModal(
    async () => {
      const docId = doc.id;

      if (extractOpts?.saveSelectionAlphaChannel && getSelectionBounds(doc)) {
        try {
          try {
            await action.batchPlay([{
              _obj: 'delete',
              _target: [{ _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL }],
            }], { modalBehavior: 'execute' });
          } catch { /* channel doesn't exist yet */ }

          await action.batchPlay([{
            _obj: 'duplicate',
            _target: [{ _ref: 'channel', _property: 'selection' }],
            name: SELECTION_ALPHA_CHANNEL,
          }], { modalBehavior: 'execute' });
          console.log('[ImageExtractor] Saved selection to alpha channel');
        } catch (e) {
          console.warn('[ImageExtractor] Failed to save selection alpha channel:', e);
        }
      }

      const basePixelOpts: Record<string, any> = { documentID: docId };
      if (sourceMode === 'activeLayer') {
        const layer = doc.activeLayers?.[0];
        if (layer) {
          basePixelOpts.layerID = layer.id;
        }
      }

      // --- fullImage ---
      if (sendPolicy.sendFullImage) {
        const ts = targetSizeForBounds(canvasSize.width, canvasSize.height, maxRes);
        const pixelResult = await imaging.getPixels({
          ...basePixelOpts,
          colorProfile: SRGB_PROFILE,
          ...(ts ? { targetSize: ts } : {}),
        });
        try {
          const componentSize: number = pixelResult.imageData.componentSize;

          if (wantRawFloat && componentSize === 32 && preserve) {
            const raw = await extractRawFloat32(pixelResult.imageData);
            context.fullImage = raw.base64;
            context.mimeType = 'image/tiff';
            context.rawFloat32 = { width: raw.width, height: raw.height, channels: raw.channels };
          } else {
            const result = await encodeToPng(pixelResult.imageData, preserve);
            context.fullImage = result.base64;
            context.mimeType = result.mimeType;
          }
        } finally {
          pixelResult.imageData.dispose();
        }
      }

      // --- regionImage (requires selection) ---
      if (sendPolicy.sendRegionImage && selectionInfo) {
        const bounds = {
          left: selectionInfo.x,
          top: selectionInfo.y,
          right: selectionInfo.x + selectionInfo.width,
          bottom: selectionInfo.y + selectionInfo.height,
        };
        const ts = targetSizeForBounds(selectionInfo.width, selectionInfo.height, maxRes);
        const pixelResult = await imaging.getPixels({
          ...basePixelOpts,
          colorProfile: SRGB_PROFILE,
          sourceBounds: bounds,
          ...(ts ? { targetSize: ts } : {}),
        });
        try {
          const componentSize: number = pixelResult.imageData.componentSize;

          if (wantRawFloat && componentSize === 32 && preserve) {
            const raw = await extractRawFloat32(pixelResult.imageData);
            context.regionImage = raw.base64;
            context.mimeType = 'image/tiff';
            context.rawFloat32 = { width: raw.width, height: raw.height, channels: raw.channels };
          } else {
            const result = await encodeToPng(pixelResult.imageData, preserve);
            context.regionImage = result.base64;
            context.mimeType = result.mimeType;
          }
        } finally {
          pixelResult.imageData.dispose();
        }
      }

      // --- mask (selection mask, grayscale) ---
      if (sendPolicy.sendMask && selectionInfo) {
        try {
          const selResult = await imaging.getSelection({ documentID: docId });
          try {
            const result = await encodeToPng(selResult.imageData, false);
            context.mask = result.base64;
          } finally {
            selResult.imageData.dispose();
          }
        } catch (e) {
          console.warn('[ImageExtractor] Failed to get selection mask:', e);
        }
      }
    },
    { commandName: 'AI Retouch: Extract Images' },
  );

  return context;
}

async function encodeToJpegDataUrl(
  imageData: any,
  quality = 0.75,
): Promise<string> {
  const pixels = await getDataAs8bit(imageData);
  const w: number = imageData.width;
  const h: number = imageData.height;
  const hasAlpha: boolean = imageData.hasAlpha;
  const isGrayscale = imageData.colorSpace === 'Grayscale';
  const srcComponents = isGrayscale ? (hasAlpha ? 2 : 1) : (hasAlpha ? 4 : 3);

  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (isGrayscale) {
      const g = pixels[i * srcComponents];
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
    } else {
      rgba[i * 4] = pixels[i * srcComponents];
      rgba[i * 4 + 1] = pixels[i * srcComponents + 1];
      rgba[i * 4 + 2] = pixels[i * srcComponents + 2];
    }
    rgba[i * 4 + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface PreviewOptions {
  /** When true, always show the full canvas even if a selection exists. */
  showFullCanvas?: boolean;
  /** Use this selection instead of reading doc.selection. */
  overrideSelection?: SelectionInfo;
  /** Max long-edge resolution for preview. Defaults to PREVIEW_MAX_LONG_EDGE (512). */
  maxResolution?: number;
  /** Preserve bit depth for preview (mirrors actual extraction). */
  preserveBitDepth?: boolean;
}

/**
 * Extract a lightweight preview image (JPEG data URL) of what will be sent.
 * Uses a much lower resolution than actual extraction for fast feedback.
 */
export async function extractPreviewImage(
  sourceMode: SourceMode,
  options?: PreviewOptions,
): Promise<string | null> {
  const ps = getPhotoshop();
  const { app, imaging, core } = ps;
  const doc = app.activeDocument;
  if (!doc) return null;

  const maxRes = options?.maxResolution ?? PREVIEW_MAX_LONG_EDGE;
  let result: string | null = null;

  await core.executeAsModal(
    async () => {
      const baseOpts: Record<string, any> = { documentID: doc.id };
      if (sourceMode === 'activeLayer') {
        const layer = doc.activeLayers?.[0];
        if (layer) baseOpts.layerID = layer.id;
      }

      const selInfo = options?.overrideSelection ?? getSelectionBounds(doc);
      const showFull = options?.showFullCanvas ?? false;
      let w: number;
      let h: number;

      if (selInfo && !showFull) {
        baseOpts.sourceBounds = {
          left: selInfo.x,
          top: selInfo.y,
          right: selInfo.x + selInfo.width,
          bottom: selInfo.y + selInfo.height,
        };
        w = selInfo.width;
        h = selInfo.height;
      } else {
        w = doc.width;
        h = doc.height;
      }

      const ts = targetSizeForBounds(w, h, maxRes);
      const pixelResult = await imaging.getPixels({
        ...baseOpts,
        colorProfile: SRGB_PROFILE,
        ...(ts ? { targetSize: ts } : {}),
      });
      try {
        try {
          result = await encodeToJpegDataUrl(pixelResult.imageData, 0.75);
        } catch {
          const encoded = await encodeToPng(pixelResult.imageData, false);
          result = `data:image/png;base64,${encoded.base64}`;
        }
      } finally {
        pixelResult.imageData.dispose();
      }
    },
    { commandName: 'AI Retouch: Preview' },
  );

  return result;
}

/**
 * Quick check if the PS environment is available (for UI to show/hide controls).
 */
export function isPhotoshopAvailable(): boolean {
  try {
    const ps = psRequire?.('photoshop');
    return !!ps?.app;
  } catch {
    return false;
  }
}

/**
 * Get current selection info without entering modal.
 */
export function getActiveSelectionInfo(): SelectionInfo | null {
  try {
    const ps = getPhotoshop();
    const doc = ps.app.activeDocument;
    if (!doc) return null;
    return getSelectionBounds(doc);
  } catch {
    return null;
  }
}
