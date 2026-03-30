import type { AdapterResultImage } from './types.js';

const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

const BARE_URL_RE = /(?:^|[\s\n])(https?:\/\/[^\s\n<>"']+)/g;

function isLikelyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif|bmp)([?#]|$)/.test(lower)) return true;
  if (lower.includes('storage.googleapis.com')) return true;
  if (lower.includes('oaidalleapiprodscus.blob.core.windows.net')) return true;
  if (/\/images?\/[0-9a-f-]{20,}/i.test(lower)) return true;
  return false;
}

interface ResolvedImages {
  cleanText: string;
  images: AdapterResultImage[];
}

async function downloadImageUrl(url: string): Promise<AdapterResultImage | null> {
  try {
    console.log(`[ImageURL] Downloading image from: ${url.slice(0, 120)}...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[ImageURL] Failed to download (${res.status}): ${url.slice(0, 120)}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const mime = contentType.split(';')[0].trim();
    if (!mime.startsWith('image/')) {
      console.warn(`[ImageURL] Not an image content-type (${mime}): ${url.slice(0, 120)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[ImageURL] Downloaded ${buf.length} bytes, mime=${mime}`);
    return { data: buf, mimeType: mime };
  } catch (err) {
    console.warn(`[ImageURL] Error downloading: ${err}`);
    return null;
  }
}

/**
 * Scan response text for image URLs in multiple formats:
 *   1. Markdown images: `![alt](URL)`
 *   2. Bare URLs from known image-hosting domains or with image extensions
 *
 * Downloads each image and returns cleaned text + image buffers.
 */
export async function resolveImageUrlsFromText(text: string | undefined): Promise<ResolvedImages> {
  if (!text) return { cleanText: '', images: [] };

  const images: AdapterResultImage[] = [];
  let cleanText = text;

  // Pass 1: markdown images ![alt](URL)
  const mdMatches = [...cleanText.matchAll(MD_IMAGE_RE)];
  for (const match of mdMatches) {
    const [fullMatch, , url] = match;
    const img = await downloadImageUrl(url);
    if (img) {
      images.push(img);
      cleanText = cleanText.replace(fullMatch, '');
    }
  }

  // Pass 2: bare URLs that look like images (not already captured by markdown)
  const bareMatches = [...cleanText.matchAll(BARE_URL_RE)];
  for (const match of bareMatches) {
    const url = match[1].replace(/[.,;)}\]]+$/, '');
    if (!isLikelyImageUrl(url)) continue;
    const img = await downloadImageUrl(url);
    if (img) {
      images.push(img);
      cleanText = cleanText.replace(url, '');
    }
  }

  cleanText = cleanText.trim();
  return { cleanText, images };
}
