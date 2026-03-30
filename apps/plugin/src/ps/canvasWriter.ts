import { getResultFullUrl } from '../lib/backend';
import { SELECTION_ALPHA_CHANNEL } from './imageExtractor';

const psRequire = (globalThis as any).require as ((m: string) => any) | undefined;

function getPhotoshop() {
  const ps = psRequire?.('photoshop');
  if (!ps) throw new Error('Photoshop API not available (running outside UXP?)');
  return ps;
}

function getUXP() {
  const uxp = psRequire?.('uxp');
  if (!uxp) throw new Error('UXP API not available (running outside UXP?)');
  return uxp;
}

/**
 * Set the active Photoshop selection to a rectangle.
 * Used to restore a session-locked selection onto the canvas.
 */
export async function setSelectionOnCanvas(bounds: {
  x: number; y: number; width: number; height: number;
}): Promise<void> {
  const ps = getPhotoshop();
  const { app, core, action } = ps;

  const doc = app.activeDocument;
  if (!doc) throw new Error('No active document');

  await core.executeAsModal(
    async () => {
      await action.batchPlay(
        [
          {
            _obj: 'set',
            _target: [{ _ref: 'channel', _property: 'selection' }],
            to: {
              _obj: 'rectangle',
              top: { _unit: 'pixelsUnit', _value: bounds.y },
              left: { _unit: 'pixelsUnit', _value: bounds.x },
              bottom: { _unit: 'pixelsUnit', _value: bounds.y + bounds.height },
              right: { _unit: 'pixelsUnit', _value: bounds.x + bounds.width },
            },
          },
        ],
        { modalBehavior: 'execute' },
      );
    },
    { commandName: 'AI Retouch: Restore Selection' },
  );
}

export interface PlaceImageOptions {
  resultId: string;
  imageWidth: number;
  imageHeight: number;
  /** Scale & position the image to fit these bounds (region mode). */
  targetBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Create a layer mask from the saved alpha channel selection shape. */
  needsMask?: boolean;
  /** Selection to restore after the operation (from persisted message data). */
  restoreSelection?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layerName?: string;
  docPath?: string;
  sessionId?: string;
}

export interface PlaceResult {
  layerId: number;
}

async function fetchUrlToToken(imageUrl: string): Promise<{ token: string; tempFile: any }> {
  const uxp = getUXP();
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();

  const tempFolder = await uxp.storage.localFileSystem.getTemporaryFolder();
  const tempFile = await tempFolder.createFile(
    `comfyui-result-${Date.now()}.png`,
    { overwrite: true },
  );
  await tempFile.write(arrayBuffer, { format: uxp.storage.formats.binary });
  const token = await uxp.storage.localFileSystem.createSessionToken(tempFile);
  return { token, tempFile };
}

async function fetchResultToToken(resultId: string, docPath?: string, sessionId?: string): Promise<{ token: string; tempFile: any }> {
  const uxp = getUXP();
  const imageUrl = getResultFullUrl(resultId, docPath, sessionId);
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch result image: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();

  const tempFolder = await uxp.storage.localFileSystem.getTemporaryFolder();
  const tempFile = await tempFolder.createFile(
    `ai-result-${Date.now()}.png`,
    { overwrite: true },
  );
  await tempFile.write(arrayBuffer, { format: uxp.storage.formats.binary });
  const token = await uxp.storage.localFileSystem.createSessionToken(tempFile);
  return { token, tempFile };
}

/**
 * Place an AI-generated result image onto the active PS canvas as a Smart Object layer.
 *
 * Supports two sizing modes:
 *   A) targetBounds provided — scale & position the image to fit those bounds (region)
 *   B) no targetBounds       — place at full canvas size
 *
 * When needsMask is true, a layer mask is created from the saved alpha channel
 * selection shape (preserving irregular selections like lasso/magic wand).
 *
 * Returns the PS layer ID for session-layer binding.
 */
export async function placeResultOnCanvas(options: PlaceImageOptions): Promise<PlaceResult> {
  const ps = getPhotoshop();
  const { app, core, action } = ps;

  const doc = app.activeDocument;
  if (!doc) throw new Error('No active document');

  const { token, tempFile } = await fetchResultToToken(options.resultId, options.docPath, options.sessionId);

  let resultLayerId = -1;

  try {
    let targetW: number;
    let targetH: number;
    let targetX: number;
    let targetY: number;

    console.log(`[canvasWriter] ===== placeResultOnCanvas DEBUG =====`);
    console.log(`[canvasWriter] doc.width=${doc.width}, doc.height=${doc.height}, doc.resolution=${(doc as any).resolution}`);

    if (options.targetBounds) {
      targetW = options.targetBounds.width;
      targetH = options.targetBounds.height;
      targetX = options.targetBounds.x;
      targetY = options.targetBounds.y;
      console.log(`[canvasWriter] Mode: region target=${targetW}x${targetH} @ (${targetX},${targetY}), mask=${!!options.needsMask}`);
    } else {
      targetW = doc.width;
      targetH = doc.height;
      targetX = 0;
      targetY = 0;
      console.log(`[canvasWriter] Mode: fullCanvas target=${targetW}x${targetH}, mask=${!!options.needsMask}`);
    }

    await core.executeAsModal(
      async () => {
        // ── Step 1: Place the image ──
        await action.batchPlay(
          [
            {
              _obj: 'placeEvent',
              null: { _path: token, _kind: 'local' },
            },
          ],
          { modalBehavior: 'execute' },
        );

        // ── Step 2: Read placed layer's actual bounds ──
        const layer = doc.activeLayers?.[0];
        if (!layer) throw new Error('No layer created after placeEvent');

        resultLayerId = layer.id;

        const bounds = layer.bounds;
        console.log(`[canvasWriter] placeResult AFTER placeEvent: bounds.left=${bounds.left}, top=${bounds.top}, right=${bounds.right}, bottom=${bounds.bottom}`);

        const placedW = bounds.right - bounds.left;
        const placedH = bounds.bottom - bounds.top;
        console.log(`[canvasWriter] placeResult placedW=${placedW}, placedH=${placedH}`);

        if (placedW <= 0 || placedH <= 0) {
          throw new Error('Placed layer has zero dimensions');
        }

        // ── Step 3: Scale to target size ──
        const scaleX = (targetW / placedW) * 100;
        const scaleY = (targetH / placedH) * 100;
        console.log(`[canvasWriter] placeResult scaleX=${scaleX.toFixed(2)}%, scaleY=${scaleY.toFixed(2)}%`);

        await action.batchPlay(
          [
            {
              _obj: 'transform',
              _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
              freeTransformCenterState: {
                _enum: 'quadCenterState',
                _value: 'QCSCorner0',
              },
              width: { _unit: 'percentUnit', _value: scaleX },
              height: { _unit: 'percentUnit', _value: scaleY },
              interfaceIconFrameDimmed: {
                _enum: 'interpolationType',
                _value: 'automaticInterpolation',
              },
            },
          ],
          { modalBehavior: 'execute' },
        );

        // ── Step 3b: Move layer to exact target position ──
        const scaledBounds = layer.bounds;
        const deltaX = targetX - scaledBounds.left;
        const deltaY = targetY - scaledBounds.top;

        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          await action.batchPlay(
            [
              {
                _obj: 'move',
                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                to: {
                  _obj: 'offset',
                  horizontal: { _unit: 'pixelsUnit', _value: deltaX },
                  vertical: { _unit: 'pixelsUnit', _value: deltaY },
                },
              },
            ],
            { modalBehavior: 'execute' },
          );
        }

        // ── Step 4: Create layer mask from selection alpha channel ──
        if (options.needsMask) {
          let selectionLoaded = false;

          // Try loading the actual selection shape from the saved alpha channel
          try {
            await action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'channel', _property: 'selection' }],
                  to: { _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL },
                },
              ],
              { modalBehavior: 'execute' },
            );
            selectionLoaded = true;
            console.log('[canvasWriter] Loaded selection from alpha channel');
          } catch {
            console.warn('[canvasWriter] Alpha channel not found, falling back to rectangular selection');
          }

          // Fallback: use rectangular selection from restoreSelection bounds
          if (!selectionLoaded && options.restoreSelection) {
            const rs = options.restoreSelection;
            await action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'channel', _property: 'selection' }],
                  to: {
                    _obj: 'rectangle',
                    top: { _unit: 'pixelsUnit', _value: rs.y },
                    left: { _unit: 'pixelsUnit', _value: rs.x },
                    bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                    right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                  },
                },
              ],
              { modalBehavior: 'execute' },
            );
            selectionLoaded = true;
          }

          if (selectionLoaded) {
            await action.batchPlay(
              [
                {
                  _obj: 'make',
                  new: { _class: 'channel' },
                  at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                  using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
                },
              ],
              { modalBehavior: 'execute' },
            );

            await action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'channel', _property: 'selection' }],
                  to: { _enum: 'ordinal', _value: 'none' },
                },
              ],
              { modalBehavior: 'execute' },
            );
            console.log('[canvasWriter] Mask created successfully');
          }
        }

        // ── Step 5: Rename the layer ──
        layer.name = options.layerName ?? 'AI Result';

        // ── Step 6: Restore selection from alpha channel (preserving irregular shapes) ──
        if (options.needsMask) {
          try {
            await action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'channel', _property: 'selection' }],
                  to: { _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL },
                },
              ],
              { modalBehavior: 'execute' },
            );
            console.log('[canvasWriter] Restored selection from alpha channel');
          } catch (err) {
            // Fallback to rectangle if alpha channel load fails
            if (options.restoreSelection) {
              const rs = options.restoreSelection;
              try {
                await action.batchPlay(
                  [
                    {
                      _obj: 'set',
                      _target: [{ _ref: 'channel', _property: 'selection' }],
                      to: {
                        _obj: 'rectangle',
                        top: { _unit: 'pixelsUnit', _value: rs.y },
                        left: { _unit: 'pixelsUnit', _value: rs.x },
                        bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                        right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                      },
                    },
                  ],
                  { modalBehavior: 'execute' },
                );
              } catch (e) {
                console.warn('[canvasWriter] Failed to restore selection (fallback):', e);
              }
            }
          }
        } else if (options.restoreSelection) {
          // No mask used: restore as rectangle
          const rs = options.restoreSelection;
          try {
            await action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'channel', _property: 'selection' }],
                  to: {
                    _obj: 'rectangle',
                    top: { _unit: 'pixelsUnit', _value: rs.y },
                    left: { _unit: 'pixelsUnit', _value: rs.x },
                    bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                    right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                  },
                },
              ],
              { modalBehavior: 'execute' },
            );
          } catch (err) {
            console.warn('[canvasWriter] Failed to restore selection:', err);
          }
        }
      },
      { commandName: 'AI Retouch: Place Result' },
    );
  } finally {
    try {
      await tempFile.delete();
    } catch {
      /* temp file cleanup is best-effort */
    }
  }

  return { layerId: resultLayerId };
}

/**
 * Place an image from a URL onto the PS canvas with optional selection-aware
 * positioning and masking. Used by ComfyUI Tab for auto-apply of results.
 *
 * Supports the same modes as placeResultOnCanvas:
 *   A) targetBounds provided → scale & position to fit those bounds
 *   B) no targetBounds       → place at full canvas size
 *
 * When needsMask is true, creates a layer mask from the saved alpha channel.
 */
export interface PlaceUrlOptions {
  targetBounds?: { x: number; y: number; width: number; height: number };
  needsMask?: boolean;
  restoreSelection?: { x: number; y: number; width: number; height: number };
  layerName?: string;
}

export async function placeUrlOnCanvas(imageUrl: string, options?: PlaceUrlOptions): Promise<void> {
  const ps = getPhotoshop();
  const { app, core, action } = ps;

  const doc = app.activeDocument;
  if (!doc) throw new Error('No active document');

  const { token, tempFile } = await fetchUrlToToken(imageUrl);
  const bpExec = { modalBehavior: 'execute' } as const;

  try {
    let targetW: number;
    let targetH: number;
    let targetX: number;
    let targetY: number;

    console.log(`[canvasWriter] ===== placeUrlOnCanvas DEBUG =====`);
    console.log(`[canvasWriter] doc.width=${doc.width}, doc.height=${doc.height}, doc.resolution=${(doc as any).resolution}`);

    if (options?.targetBounds) {
      targetW = options.targetBounds.width;
      targetH = options.targetBounds.height;
      targetX = options.targetBounds.x;
      targetY = options.targetBounds.y;
      console.log(`[canvasWriter] placeUrl region target=${targetW}x${targetH} @ (${targetX},${targetY}), mask=${!!options.needsMask}`);
    } else {
      targetW = doc.width;
      targetH = doc.height;
      targetX = 0;
      targetY = 0;
      console.log(`[canvasWriter] placeUrl fullCanvas target=${targetW}x${targetH}`);
    }

    await core.executeAsModal(
      async () => {
        await action.batchPlay(
          [{ _obj: 'placeEvent', null: { _path: token, _kind: 'local' } }],
          bpExec,
        );

        const layer = doc.activeLayers?.[0];
        if (!layer) throw new Error('No layer created after placeEvent');

        const bounds = layer.bounds;
        console.log(`[canvasWriter] placeUrl AFTER placeEvent: bounds.left=${bounds.left}, top=${bounds.top}, right=${bounds.right}, bottom=${bounds.bottom}`);

        const placedW = bounds.right - bounds.left;
        const placedH = bounds.bottom - bounds.top;
        console.log(`[canvasWriter] placeUrl placedW=${placedW}, placedH=${placedH}`);

        if (placedW <= 0 || placedH <= 0) throw new Error('Placed layer has zero dimensions');

        const scaleX = (targetW / placedW) * 100;
        const scaleY = (targetH / placedH) * 100;
        console.log(`[canvasWriter] placeUrl scaleX=${scaleX.toFixed(2)}%, scaleY=${scaleY.toFixed(2)}%`);

        await action.batchPlay(
          [{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSCorner0' },
            width: { _unit: 'percentUnit', _value: scaleX },
            height: { _unit: 'percentUnit', _value: scaleY },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'automaticInterpolation' },
          }],
          bpExec,
        );

        const scaledBounds = layer.bounds;
        console.log(`[canvasWriter] placeUrl AFTER transform: bounds.left=${scaledBounds.left}, top=${scaledBounds.top}, right=${scaledBounds.right}, bottom=${scaledBounds.bottom}`);
        console.log(`[canvasWriter] placeUrl AFTER transform: size=${(scaledBounds.right - scaledBounds.left).toFixed(1)}x${(scaledBounds.bottom - scaledBounds.top).toFixed(1)}`);

        const deltaX = targetX - scaledBounds.left;
        const deltaY = targetY - scaledBounds.top;
        console.log(`[canvasWriter] placeUrl move deltaX=${deltaX.toFixed(2)}, deltaY=${deltaY.toFixed(2)}`);
        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          await action.batchPlay(
            [{
              _obj: 'move',
              _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
              to: {
                _obj: 'offset',
                horizontal: { _unit: 'pixelsUnit', _value: deltaX },
                vertical: { _unit: 'pixelsUnit', _value: deltaY },
              },
            }],
            bpExec,
          );
        }

        console.log(`[canvasWriter] ===== placeUrlOnCanvas DONE =====`);

        if (options?.needsMask) {
          let selLoaded = false;

          try {
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL },
              }],
              bpExec,
            );
            selLoaded = true;
            console.log('[canvasWriter] placeUrl: loaded selection from alpha channel');
          } catch {
            console.warn('[canvasWriter] placeUrl: alpha channel not found, falling back to rectangle');
          }

          if (!selLoaded && options.restoreSelection) {
            const rs = options.restoreSelection;
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: {
                  _obj: 'rectangle',
                  top: { _unit: 'pixelsUnit', _value: rs.y },
                  left: { _unit: 'pixelsUnit', _value: rs.x },
                  bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                  right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                },
              }],
              bpExec,
            );
            selLoaded = true;
          }

          if (selLoaded) {
            await action.batchPlay(
              [{
                _obj: 'make',
                new: { _class: 'channel' },
                at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
                using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
              }],
              bpExec,
            );
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _enum: 'ordinal', _value: 'none' },
              }],
              bpExec,
            );
            console.log('[canvasWriter] placeUrl: mask created');
          }
        }

        if (options?.needsMask) {
          try {
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: { _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL },
              }],
              bpExec,
            );
            console.log('[canvasWriter] placeUrl: restored selection from alpha channel');
          } catch {
            if (options.restoreSelection) {
              const rs = options.restoreSelection;
              try {
                await action.batchPlay(
                  [{
                    _obj: 'set',
                    _target: [{ _ref: 'channel', _property: 'selection' }],
                    to: {
                      _obj: 'rectangle',
                      top: { _unit: 'pixelsUnit', _value: rs.y },
                      left: { _unit: 'pixelsUnit', _value: rs.x },
                      bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                      right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                    },
                  }],
                  bpExec,
                );
              } catch (e) {
                console.warn('[canvasWriter] placeUrl: failed to restore selection (fallback):', e);
              }
            }
          }
        } else if (options?.restoreSelection) {
          const rs = options.restoreSelection;
          try {
            await action.batchPlay(
              [{
                _obj: 'set',
                _target: [{ _ref: 'channel', _property: 'selection' }],
                to: {
                  _obj: 'rectangle',
                  top: { _unit: 'pixelsUnit', _value: rs.y },
                  left: { _unit: 'pixelsUnit', _value: rs.x },
                  bottom: { _unit: 'pixelsUnit', _value: rs.y + rs.height },
                  right: { _unit: 'pixelsUnit', _value: rs.x + rs.width },
                },
              }],
              bpExec,
            );
          } catch (e) {
            console.warn('[canvasWriter] placeUrl: failed to restore selection:', e);
          }
        }

        layer.name = options?.layerName ?? 'ComfyUI Result';
      },
      { commandName: 'AI Retouch: Place ComfyUI Result' },
    );
  } finally {
    try { await tempFile.delete(); } catch { /* best-effort */ }
  }
}

/**
 * Replace a session layer's content by deleting the old layer and placing the
 * new image fresh — using the same proven logic as `placeResultOnCanvas` (L3).
 *
 * Flow:
 *   1. Read old layer's on-canvas bounds (position + size)
 *   2. If mask exists → back it up to a temp alpha channel, then delete it
 *   3. Delete the old layer
 *   4. `placeEvent` the new image → new Smart Object layer
 *   5. Scale to old dimensions: `oldW / placedW`  (same formula as L3)
 *   6. Move to old position:    `oldX - scaledX`  (same formula as L3)
 *   7. Restore mask from backup
 *   8. Set the original layer name
 *
 * Returns the **new** layer ID (the old one no longer exists).
 */
export async function replaceSmartObjectContent(
  layerId: number,
  resultId: string,
  docPath?: string,
  sessionId?: string,
): Promise<number> {
  const ps = getPhotoshop();
  const { app, core, action } = ps;

  const doc = app.activeDocument;
  if (!doc) throw new Error('No active document');

  const { token, tempFile } = await fetchResultToToken(resultId, docPath, sessionId);

  const MASK_BACKUP = '_air_mask_backup';
  const bpExec = { modalBehavior: 'execute' } as const;

  let newLayerId = layerId;

  try {
    await core.executeAsModal(
      async () => {
        // ── 1. Select old layer, read its state ──
        await action.batchPlay(
          [{ _obj: 'select', _target: [{ _ref: 'layer', _id: layerId }], makeVisible: false }],
          bpExec,
        );

        const oldLayer = doc.activeLayers?.[0];
        if (!oldLayer) throw new Error('Target layer not found');
        const layerName = oldLayer.name;

        // ── 2. Detect and save mask ──
        const [desc] = await action.batchPlay(
          [{ _obj: 'get', _target: [{ _ref: 'layer', _id: layerId }] }],
          bpExec,
        );
        const hasMask = desc.hasUserMask === true || desc.userMaskEnabled === true;

        // ── 2b. Read SO placement transform for true geometry ──
        //    smartObjectMore.transform stores the 4 corner coordinates of the
        //    content rectangle in document space (TL, TR, BR, BL — 8 doubles).
        //    This gives true width/height/angle instead of the inflated AABB
        //    that bounds returns for rotated layers.
        const soTf = desc.smartObjectMore?.transform;
        let targetW = 0;
        let targetH = 0;
        let targetAngle = 0;
        let targetCX = 0;
        let targetCY = 0;

        if (soTf && Array.isArray(soTf) && soTf.length >= 8) {
          const v = soTf.map((x: any) => (typeof x === 'number' ? x : (x?._value ?? x)));
          const P0 = { x: v[0], y: v[1] };
          const P1 = { x: v[2], y: v[3] };
          const P2 = { x: v[4], y: v[5] };
          const P3 = { x: v[6], y: v[7] };

          targetW = Math.hypot(P1.x - P0.x, P1.y - P0.y);
          targetH = Math.hypot(P3.x - P0.x, P3.y - P0.y);
          targetAngle = Math.atan2(P1.y - P0.y, P1.x - P0.x) * (180 / Math.PI);
          targetCX = (P0.x + P1.x + P2.x + P3.x) / 4;
          targetCY = (P0.y + P1.y + P2.y + P3.y) / 4;

          console.log(
            `[canvasWriter] SO transform: ${targetW.toFixed(1)}×${targetH.toFixed(1)}, ` +
            `angle=${targetAngle.toFixed(2)}°, center=(${targetCX.toFixed(1)},${targetCY.toFixed(1)})`,
          );
        }

        let maskSaved = false;
        if (hasMask) {
          try {
            try {
              await action.batchPlay(
                [{ _obj: 'delete', _target: [{ _ref: 'channel', _name: MASK_BACKUP }] }],
                bpExec,
              );
            } catch { /* doesn't exist — expected */ }

            await action.batchPlay(
              [{ _obj: 'duplicate', _target: [{ _ref: 'channel', _enum: 'channel', _value: 'mask' }], name: MASK_BACKUP }],
              bpExec,
            );

            await action.batchPlay(
              [{ _obj: 'select', _target: [{ _ref: 'layer', _id: layerId }], makeVisible: false }],
              bpExec,
            );

            await action.batchPlay(
              [{ _obj: 'delete', _target: [{ _ref: 'channel', _enum: 'channel', _value: 'mask' }] }],
              bpExec,
            );
            maskSaved = true;
          } catch (e) {
            console.warn('[canvasWriter] Failed to save mask:', e);
          }
        }

        // ── 3. Fallback: read AABB bounds if SO transform was unavailable ──
        if (targetW <= 0) {
          const [freshDesc] = await action.batchPlay(
            [{ _obj: 'get', _target: [{ _ref: 'layer', _id: layerId }] }],
            bpExec,
          );
          const fb = freshDesc.bounds;
          const left = fb.left?._value ?? fb.left ?? 0;
          const top = fb.top?._value ?? fb.top ?? 0;
          const right = fb.right?._value ?? fb.right ?? 0;
          const bottom = fb.bottom?._value ?? fb.bottom ?? 0;
          targetW = right - left;
          targetH = bottom - top;
          targetCX = left + targetW / 2;
          targetCY = top + targetH / 2;
          console.log(
            `[canvasWriter] Bounds fallback: ${targetW.toFixed(1)}×${targetH.toFixed(1)} @ ` +
            `center=(${targetCX.toFixed(1)},${targetCY.toFixed(1)})`,
          );
        }

        if (targetW <= 0 || targetH <= 0) {
          throw new Error('Old layer has zero dimensions');
        }

        // ── 4. Delete the old layer ──
        await action.batchPlay(
          [{ _obj: 'delete', _target: [{ _ref: 'layer', _id: layerId }] }],
          bpExec,
        );

        // ── 5. Place new image (identical to L3's placeEvent) ──
        await action.batchPlay(
          [{ _obj: 'placeEvent', null: { _path: token, _kind: 'local' } }],
          bpExec,
        );

        const newLayer = doc.activeLayers?.[0];
        if (!newLayer) throw new Error('No layer created after placeEvent');
        newLayerId = newLayer.id;

        const placedBounds = newLayer.bounds;
        const placedW = placedBounds.right - placedBounds.left;
        const placedH = placedBounds.bottom - placedBounds.top;

        if (placedW <= 0 || placedH <= 0) {
          throw new Error('Placed layer has zero dimensions');
        }

        // ── 6. Scale to old dimensions + rotate to match old orientation ──
        const scaleX = (targetW / placedW) * 100;
        const scaleY = (targetH / placedH) * 100;

        const transformDesc: Record<string, any> = {
          _obj: 'transform',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
          width: { _unit: 'percentUnit', _value: scaleX },
          height: { _unit: 'percentUnit', _value: scaleY },
          interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'automaticInterpolation' },
        };
        if (Math.abs(targetAngle) > 0.01) {
          transformDesc.angle = { _unit: 'angleUnit', _value: targetAngle };
        }

        await action.batchPlay([transformDesc], bpExec);

        // ── 7. Move to correct center position ──
        //    After scale+rotate from center, the AABB center == true content center.
        //    Read fresh bounds via batchPlay, align centers.
        const [postDesc] = await action.batchPlay(
          [{ _obj: 'get', _target: [{ _ref: 'layer', _id: newLayerId }] }],
          bpExec,
        );
        const nb = postDesc.bounds;
        const nbLeft = nb.left?._value ?? nb.left ?? 0;
        const nbTop = nb.top?._value ?? nb.top ?? 0;
        const nbRight = nb.right?._value ?? nb.right ?? 0;
        const nbBottom = nb.bottom?._value ?? nb.bottom ?? 0;
        const newCX = (nbLeft + nbRight) / 2;
        const newCY = (nbTop + nbBottom) / 2;

        const deltaX = targetCX - newCX;
        const deltaY = targetCY - newCY;

        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          await action.batchPlay(
            [{
              _obj: 'move',
              _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
              to: {
                _obj: 'offset',
                horizontal: { _unit: 'pixelsUnit', _value: deltaX },
                vertical: { _unit: 'pixelsUnit', _value: deltaY },
              },
            }],
            bpExec,
          );
        }

        // ── 8. Restore mask from backup ──
        if (maskSaved) {
          try {
            await action.batchPlay(
              [{ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _ref: 'channel', _name: MASK_BACKUP } }],
              bpExec,
            );
            await action.batchPlay(
              [{ _obj: 'make', new: { _class: 'channel' }, at: { _ref: 'channel', _enum: 'channel', _value: 'mask' }, using: { _enum: 'userMaskEnabled', _value: 'revealSelection' } }],
              bpExec,
            );
            await action.batchPlay(
              [{ _obj: 'delete', _target: [{ _ref: 'channel', _name: MASK_BACKUP }] }],
              bpExec,
            );
            await action.batchPlay(
              [{ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'none' } }],
              bpExec,
            );
          } catch (e) {
            console.error('[canvasWriter] Failed to restore mask:', e);
            try {
              await action.batchPlay(
                [{ _obj: 'delete', _target: [{ _ref: 'channel', _name: MASK_BACKUP }] }],
                bpExec,
              );
            } catch { /* best-effort cleanup */ }
          }
        }

        // ── 9. Set layer name ──
        newLayer.name = layerName;

        // ── 10. Restore selection (same as L3's Step 6) ──
        try {
          await action.batchPlay(
            [{ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _ref: 'channel', _name: SELECTION_ALPHA_CHANNEL } }],
            bpExec,
          );
        } catch {
          // Alpha channel doesn't exist (no-mask / full-canvas mode) — that's fine
        }

        console.log(
          `[canvasWriter] Layer replaced: #${layerId} → #${newLayerId}, ` +
          `${Math.round(targetW)}×${Math.round(targetH)} @ center=(${Math.round(targetCX)},${Math.round(targetCY)}), angle=${targetAngle.toFixed(1)}°` +
          `${maskSaved ? ', mask restored' : ''}`,
        );
      },
      { commandName: 'AI Retouch: Replace Layer Content' },
    );
  } finally {
    try {
      await tempFile.delete();
    } catch { /* best-effort */ }
  }

  return newLayerId;
}
