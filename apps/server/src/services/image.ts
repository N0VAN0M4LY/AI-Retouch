import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import type { SelectionInfo } from '@ai-retouch/shared';

const PREVIEW_MAX_W = 3840;
const PREVIEW_MAX_H = 2160;
const PREVIEW_QUALITY = 90;
const THUMB_LONG_EDGE = 480;
const THUMB_QUALITY = 75;

export interface SavedImage {
  id: string;
  fullFile: string;
  previewFile: string;
  thumbFile: string;
  thumbnailBuffer: Buffer;
  width: number;
  height: number;
  fileSize: number;
  mimeType: string;
}

function resizeOptions(longEdge: number, w: number, h: number) {
  return w >= h
    ? { width: Math.min(longEdge, w) }
    : { height: Math.min(longEdge, h) };
}

export async function saveGenerationImage(
  imageBuffer: Buffer,
  sourceMimeType: string,
  workDir: string,
  sessionId: string,
): Promise<SavedImage> {
  const id = uuidv4();
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const pngBuffer = await sharp(imageBuffer).png().toBuffer();

  const needsPreviewResize = width > PREVIEW_MAX_W || height > PREVIEW_MAX_H;
  let previewPipeline = sharp(imageBuffer);
  if (needsPreviewResize) {
    previewPipeline = previewPipeline.resize({
      width: PREVIEW_MAX_W,
      height: PREVIEW_MAX_H,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const previewBuffer = await previewPipeline
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();

  const longEdge = Math.max(width, height);
  let thumbPipeline = sharp(imageBuffer);
  if (longEdge > THUMB_LONG_EDGE) {
    thumbPipeline = thumbPipeline.resize(resizeOptions(THUMB_LONG_EDGE, width, height));
  }
  const thumbnailBuffer = await thumbPipeline
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();

  const fileSize = pngBuffer.length + previewBuffer.length;
  const fullFile = `${id}.png`;
  const previewFile = `${id}_preview.jpg`;
  const thumbFile = `${id}_thumb.jpg`;

  const resultsDir = path.join(workDir, 'sessions', sessionId, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  fs.writeFileSync(path.join(resultsDir, fullFile), pngBuffer);
  fs.writeFileSync(path.join(resultsDir, previewFile), previewBuffer);
  fs.writeFileSync(path.join(resultsDir, thumbFile), thumbnailBuffer);

  return {
    id,
    fullFile,
    previewFile,
    thumbFile,
    thumbnailBuffer,
    width,
    height,
    fileSize,
    mimeType: sourceMimeType || 'image/png',
  };
}

const HIGHLIGHT_COLOR = { r: 108, g: 138, b: 255, alpha: 0.35 };
const HIGHLIGHT_JPEG_QUALITY = 80;

export async function generateHighlightImage(
  fullImageBase64: string,
  selection: SelectionInfo,
): Promise<string> {
  const inputBuf = Buffer.from(fullImageBase64, 'base64');
  const meta = await sharp(inputBuf).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  if (imgW === 0 || imgH === 0) {
    throw new Error('Cannot generate highlight: unable to read image dimensions');
  }

  const left = Math.max(0, Math.round(selection.x));
  const top = Math.max(0, Math.round(selection.y));
  const right = Math.min(imgW, Math.round(selection.x + selection.width));
  const bottom = Math.min(imgH, Math.round(selection.y + selection.height));
  const w = right - left;
  const h = bottom - top;

  if (w <= 0 || h <= 0) {
    throw new Error('Cannot generate highlight: selection is outside image bounds');
  }

  const overlayBuf = await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: HIGHLIGHT_COLOR,
    },
  })
    .png()
    .toBuffer();

  const resultBuf = await sharp(inputBuf)
    .composite([{ input: overlayBuf, left, top }])
    .jpeg({ quality: HIGHLIGHT_JPEG_QUALITY })
    .toBuffer();

  return resultBuf.toString('base64');
}
