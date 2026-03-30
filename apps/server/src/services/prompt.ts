import type { ImageContext } from '@ai-retouch/shared';
import type { AdapterImage } from '../adapters/types.js';
import { generateHighlightImage } from './image.js';

interface ImageEntry {
  image: AdapterImage;
  description: string;
}

/**
 * Converts an ImageContext (from the plugin) into an ordered list of
 * AdapterImage objects with descriptive text, ready to send to a model.
 *
 * Also generates the highlight image on the server side using sharp
 * when fullImage + selection are available and highlightImage was requested.
 */
export async function buildImagesFromContext(
  ctx: ImageContext,
  wantHighlight: boolean,
): Promise<{ images: AdapterImage[]; promptPrefix: string }> {
  const entries: ImageEntry[] = [];
  let imageIndex = 1;

  const hasRegion = !!(ctx.regionImage && ctx.selection);
  const totalCount =
    [ctx.fullImage, hasRegion, ctx.mask].filter(Boolean).length +
    (wantHighlight && ctx.fullImage && ctx.selection ? 1 : 0);

  const mime = ctx.mimeType ?? 'image/png';

  if (ctx.fullImage) {
    let desc = `Image ${imageIndex} is a screenshot of the full canvas (${ctx.canvasSize.width}x${ctx.canvasSize.height}).`;
    if (totalCount > 1 && hasRegion) desc += ' This image is for REFERENCE.';
    entries.push({
      image: { data: ctx.fullImage, mimeType: mime },
      description: desc,
    });
    imageIndex++;
  }

  if (hasRegion) {
    const s = ctx.selection!;
    entries.push({
      image: { data: ctx.regionImage!, mimeType: mime },
      description: `Image ${imageIndex} is a crop of the user's selected region, size ${s.width}x${s.height}, located at (${s.x}, ${s.y}) on the canvas.`,
    });
    imageIndex++;
  }

  if (wantHighlight && ctx.fullImage && ctx.selection) {
    try {
      const highlightBase64 = await generateHighlightImage(ctx.fullImage, ctx.selection);
      entries.push({
        image: { data: highlightBase64, mimeType: mime },
        description: `Image ${imageIndex} is the full canvas with the user's selected region highlighted by a semi-transparent overlay. This image is for REFERENCE.`,
      });
      imageIndex++;
    } catch (e) {
      console.warn('[Prompt] Failed to generate highlight image:', e);
    }
  }

  if (ctx.mask) {
    entries.push({
      image: { data: ctx.mask, mimeType: mime },
      description: `Image ${imageIndex} is a mask where white areas indicate the region the user wants processed. This image is for REFERENCE.`,
    });
    imageIndex++;
  }

  if (ctx.extraImages && ctx.extraImages.length > 0) {
    for (const extra of ctx.extraImages) {
      const label = extra.name ? ` (${extra.name})` : '';
      entries.push({
        image: { data: extra.data, mimeType: extra.mimeType },
        description: `Image ${imageIndex} is an additional reference image provided by the user${label}.`,
      });
      imageIndex++;
    }
  }

  const descriptions = entries.map((e) => e.description);
  const promptPrefix = descriptions.length > 0
    ? descriptions.join('\n') + '\n\n'
    : '';

  return {
    images: entries.map((e) => e.image),
    promptPrefix,
  };
}
