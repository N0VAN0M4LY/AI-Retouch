import {
  type BridgeStatus,
  type ExtractImageParams,
  type PlaceResultParams,
  type SmartApplyParams,
  type SetSelectionParams,
  type ImageContext,
  type DocumentInfo,
  type SelectionInfo,
  type LayerInfo,
} from '@ai-retouch/shared';
import { request } from './client';

// ─── PS Bridge ───────────────────────────────────────────

export async function fetchBridgeStatus(): Promise<BridgeStatus> {
  return request<BridgeStatus>('/api/ps/status');
}

export async function extractImageFromPS(params: ExtractImageParams): Promise<ImageContext> {
  return request<ImageContext>('/api/ps/extract-image', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function applyResultToPS(params: PlaceResultParams): Promise<{ layerId?: number }> {
  return request<{ layerId?: number }>('/api/ps/place-result', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function smartApplyToPS(
  params: SmartApplyParams,
): Promise<{ layerId?: number; layerName?: string; resultId: string }> {
  return request<{ layerId?: number; layerName?: string; resultId: string }>('/api/ps/smart-apply', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getPSDocument(): Promise<DocumentInfo | null> {
  return request<DocumentInfo | null>('/api/ps/document');
}

export async function getPSSelection(): Promise<SelectionInfo | null> {
  return request<SelectionInfo | null>('/api/ps/selection');
}

export async function setPSSelection(params: SetSelectionParams): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/api/ps/selection', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getPSLayers(): Promise<LayerInfo[]> {
  return request<LayerInfo[]>('/api/ps/layers');
}
