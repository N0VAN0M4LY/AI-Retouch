import type {
  ExtractImageParams,
  PlaceResultParams,
  SmartApplyParams,
  SetSelectionParams,
  ImageContext,
  SelectionInfo,
  DocumentInfo,
  LayerInfo,
} from '@ai-retouch/shared';

import { extractImageContext, getActiveSelectionInfo } from '../ps/imageExtractor';
import { placeResultOnCanvas, setSelectionOnCanvas } from '../ps/canvasWriter';
import { smartApplyToCanvas } from '../ps/applyHelper';
import { getActiveDocumentInfo } from '../ps/documentTracker';
import { registerCommandHandler } from './bridgeAgent';

const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

function getPhotoshop() {
  const ps = psRequire?.('photoshop');
  if (!ps) throw new Error('Photoshop API not available');
  return ps;
}

function registerAllHandlers(): void {
  registerCommandHandler('extractImage', async (params) => {
    const p = params as unknown as ExtractImageParams;
    const context: ImageContext = await extractImageContext(p.sourceMode, p.sendPolicy, {
      overrideSelection: p.overrideSelection,
      saveSelectionAlphaChannel: p.saveSelectionAlphaChannel,
      maxResolution: p.maxResolution,
      preserveBitDepth: p.preserveBitDepth,
      rawFloat32: p.rawFloat32,
    });
    return context;
  });

  registerCommandHandler('placeResult', async (params) => {
    const p = params as unknown as PlaceResultParams;
    await placeResultOnCanvas({
      resultId: p.resultId,
      imageWidth: p.imageWidth,
      imageHeight: p.imageHeight,
      targetBounds: p.targetBounds,
      needsMask: p.needsMask,
      restoreSelection: p.restoreSelection,
      layerName: p.layerName ?? 'AI Result',
      docPath: p.docPath,
      sessionId: p.sessionId,
    });
    return { layerId: undefined };
  });

  registerCommandHandler('smartApply', async (params) => {
    const p = params as unknown as SmartApplyParams;
    const result = await smartApplyToCanvas(
      {
        id: p.resultId,
        width: p.width,
        height: p.height,
        requestConfig: p.requestConfig,
      } as any,
      {
        sessionId: p.sessionId,
        documentPath: p.documentPath,
        fallbackSendPolicy: p.fallbackSendPolicy,
      },
    );
    return {
      layerId: result.binding?.layerId,
      layerName: result.binding?.layerName,
      resultId: p.resultId,
    };
  });

  registerCommandHandler('getDocumentInfo', async () => {
    const info = getActiveDocumentInfo();
    if (!info) return null;
    const ps = getPhotoshop();
    const doc = ps.app.activeDocument;
    const docInfo: DocumentInfo = {
      id: info.id,
      path: info.path,
      title: info.title,
      width: doc?.width ?? 0,
      height: doc?.height ?? 0,
    };
    return docInfo;
  });

  registerCommandHandler('getSelection', async () => {
    const sel: SelectionInfo | null = getActiveSelectionInfo();
    return sel;
  });

  registerCommandHandler('setSelection', async (params) => {
    const p = params as unknown as SetSelectionParams;
    await setSelectionOnCanvas(p);
    return { success: true };
  });

  registerCommandHandler('getLayerList', async () => {
    const ps = getPhotoshop();
    const doc = ps.app.activeDocument;
    if (!doc) return [];

    function mapLayers(layers: any): LayerInfo[] {
      const result: LayerInfo[] = [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const info: LayerInfo = {
          id: l.id,
          name: l.name,
          kind: String(l.kind ?? 'unknown'),
          visible: l.visible ?? true,
          opacity: l.opacity ?? 100,
        };
        if (l.layers && l.layers.length > 0) {
          info.children = mapLayers(l.layers);
        }
        result.push(info);
      }
      return result;
    }

    return mapLayers(doc.layers);
  });

  registerCommandHandler('ping', async () => {
    return { alive: true };
  });
}

export { registerAllHandlers };
