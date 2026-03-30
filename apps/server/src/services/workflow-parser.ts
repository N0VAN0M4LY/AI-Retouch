import type { ExposedParam, WorkflowNodeInfo } from '@ai-retouch/shared';

const EXPOSED_PREFIX = '[exposed]';

// ─── API-format node ─────────────────────────────────

interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

// ─── UI-format structures ────────────────────────────

interface UINode {
  id: number;
  type: string;
  title?: string;
  widgets_values?: unknown[];
  inputs?: Array<{ name: string; type: string; link: number | null }>;
  outputs?: Array<{ name: string; type: string; links: number[] | null }>;
}

interface UIWorkflow {
  nodes: UINode[];
  links: Array<[number, number, number, number, number, string]>;
  // [link_id, src_node_id, src_output_idx, dst_node_id, dst_input_idx, type]
}

// ─── object_info entry ───────────────────────────────

interface ObjectInfoEntry {
  input: {
    required?: Record<string, unknown[]>;
    optional?: Record<string, unknown[]>;
  };
  output: unknown[];
  name: string;
  display_name: string;
  category: string;
}

type ParamType = ExposedParam['type'];

const IMAGE_NODE_TYPES = new Set([
  'LoadImage', 'LoadImageMask', 'LoadImageFromUrl',
  'Image Load', 'VHS_LoadImage',
]);

const WIDGET_TYPES = new Set([
  'INT', 'FLOAT', 'STRING', 'BOOLEAN',
]);

// ─── Public API ──────────────────────────────────────

export function parseExposedParams(
  workflowJson: Record<string, unknown>,
  objectInfo: Record<string, unknown>,
): ExposedParam[] {
  if (isUIFormat(workflowJson)) {
    console.log('[Parser] Detected UI format workflow');
    return parseUIFormat(workflowJson as unknown as UIWorkflow, objectInfo);
  }
  console.log('[Parser] Detected API format workflow');
  return parseAPIFormat(workflowJson, objectInfo);
}

export function findImageInputNodes(
  workflowJson: Record<string, unknown>,
): Array<{ nodeId: string; nodeType: string; title: string }> {
  if (isUIFormat(workflowJson)) {
    const wf = workflowJson as unknown as UIWorkflow;
    return wf.nodes
      .filter((n) => IMAGE_NODE_TYPES.has(n.type))
      .map((n) => ({
        nodeId: String(n.id),
        nodeType: n.type,
        title: n.title ?? `${n.type} #${n.id}`,
      }));
  }

  const results: Array<{ nodeId: string; nodeType: string; title: string }> = [];
  for (const [nodeId, nodeRaw] of Object.entries(workflowJson)) {
    const node = nodeRaw as ApiNode;
    if (!node.class_type) continue;
    if (!IMAGE_NODE_TYPES.has(node.class_type)) continue;
    results.push({
      nodeId,
      nodeType: node.class_type,
      title: node._meta?.title ?? `${node.class_type} #${nodeId}`,
    });
  }
  return results;
}

export function findOutputNodes(
  workflowJson: Record<string, unknown>,
): Array<{ nodeId: string; nodeType: string; title: string }> {
  const OUTPUT_TYPES = new Set(['SaveImage', 'PreviewImage', 'VHS_VideoCombine']);

  if (isUIFormat(workflowJson)) {
    const wf = workflowJson as unknown as UIWorkflow;
    return wf.nodes
      .filter((n) => OUTPUT_TYPES.has(n.type))
      .map((n) => ({
        nodeId: String(n.id),
        nodeType: n.type,
        title: n.title ?? `${n.type} #${n.id}`,
      }));
  }

  const results: Array<{ nodeId: string; nodeType: string; title: string }> = [];
  for (const [nodeId, nodeRaw] of Object.entries(workflowJson)) {
    const node = nodeRaw as ApiNode;
    if (!node.class_type) continue;
    if (!OUTPUT_TYPES.has(node.class_type)) continue;
    results.push({
      nodeId,
      nodeType: node.class_type,
      title: node._meta?.title ?? `${node.class_type} #${nodeId}`,
    });
  }
  return results;
}

const OUTPUT_NODE_TYPES = new Set(['SaveImage', 'PreviewImage', 'VHS_VideoCombine']);

/**
 * Parse ALL nodes in a workflow, returning full metadata and params for each.
 * Used for the "All Nodes" view mode.
 */
export function parseAllNodes(
  workflowJson: Record<string, unknown>,
  objectInfo: Record<string, unknown>,
): WorkflowNodeInfo[] {
  if (isUIFormat(workflowJson)) {
    return parseAllNodesUI(workflowJson as unknown as UIWorkflow, objectInfo);
  }
  return parseAllNodesAPI(workflowJson, objectInfo);
}

function parseAllNodesUI(
  wf: UIWorkflow,
  objectInfo: Record<string, unknown>,
): WorkflowNodeInfo[] {
  const nodes: WorkflowNodeInfo[] = [];

  for (const node of wf.nodes) {
    const rawTitle = (node.title ?? '').trim();
    const hasExposedTag = rawTitle.toLowerCase().startsWith(EXPOSED_PREFIX.toLowerCase());
    const displayTitle = hasExposedTag
      ? (rawTitle.slice(EXPOSED_PREFIX.length).trim() || node.type)
      : (rawTitle || node.type);
    const nodeType = node.type;
    const nodeId = String(node.id);
    const info = objectInfo[nodeType] as ObjectInfoEntry | undefined;

    const widgetNames = info ? getWidgetInputNames(info) : [];
    const widgetValues = node.widgets_values ?? [];
    const allInputDefs = { ...info?.input?.required, ...info?.input?.optional };

    const params: ExposedParam[] = [];
    for (let i = 0; i < widgetNames.length && i < widgetValues.length; i++) {
      const paramName = widgetNames[i];
      if (!paramName) continue;
      const currentValue = widgetValues[i];
      const inputDef = allInputDefs[paramName];
      const resolved = resolveParamType(paramName, currentValue, inputDef, nodeType);
      if (!resolved) continue;
      params.push({
        nodeId, nodeTitle: displayTitle, nodeType, paramName,
        displayName: resolved.displayName, type: resolved.type,
        default: resolved.defaultValue, min: resolved.min, max: resolved.max,
        step: resolved.step, options: resolved.options, source: 'auto',
      });
    }

    const isImageInput = IMAGE_NODE_TYPES.has(nodeType);
    if (isImageInput) {
      const hasImageParam = params.some(p => p.paramName === 'image');
      if (!hasImageParam) {
        params.push({
          nodeId, nodeTitle: displayTitle, nodeType, paramName: 'image',
          displayName: 'image', type: 'image', default: null, source: 'auto',
        });
      }
    }

    nodes.push({
      nodeId, nodeType, title: displayTitle, rawTitle,
      hasExposedTag, isImageInput,
      isOutput: OUTPUT_NODE_TYPES.has(nodeType),
      params,
    });
  }

  return nodes;
}

function parseAllNodesAPI(
  workflowJson: Record<string, unknown>,
  objectInfo: Record<string, unknown>,
): WorkflowNodeInfo[] {
  const nodes: WorkflowNodeInfo[] = [];

  for (const [nodeId, nodeRaw] of Object.entries(workflowJson)) {
    const node = nodeRaw as ApiNode;
    if (!node.class_type) continue;

    const rawTitle = (node._meta?.title ?? '').trim();
    const hasExposedTag = rawTitle.toLowerCase().startsWith(EXPOSED_PREFIX.toLowerCase());
    const displayTitle = hasExposedTag
      ? (rawTitle.slice(EXPOSED_PREFIX.length).trim() || node.class_type)
      : (rawTitle || `${node.class_type} #${nodeId}`);
    const nodeType = node.class_type;
    const infoEntry = objectInfo[nodeType] as ObjectInfoEntry | undefined;
    const allInputDefs = { ...infoEntry?.input?.required, ...infoEntry?.input?.optional };

    const params: ExposedParam[] = [];
    for (const [paramName, value] of Object.entries(node.inputs)) {
      if (isConnectionValue(value)) continue;
      const inputDef = allInputDefs[paramName];
      const resolved = resolveParamType(paramName, value, inputDef, nodeType);
      if (!resolved) continue;
      params.push({
        nodeId, nodeTitle: displayTitle, nodeType, paramName,
        displayName: resolved.displayName, type: resolved.type,
        default: resolved.defaultValue, min: resolved.min, max: resolved.max,
        step: resolved.step, options: resolved.options, source: 'auto',
      });
    }

    nodes.push({
      nodeId, nodeType, title: displayTitle, rawTitle,
      hasExposedTag, isImageInput: IMAGE_NODE_TYPES.has(nodeType),
      isOutput: OUTPUT_NODE_TYPES.has(nodeType),
      params,
    });
  }

  return nodes;
}

/**
 * Convert a UI-format workflow to API format (for submitting to /prompt).
 * Requires objectInfo to map widgets_values to named inputs.
 */
export function convertUIToAPI(
  uiWorkflow: UIWorkflow,
  objectInfo: Record<string, unknown>,
): Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }> {
  const prompt: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }> = {};

  const linkMap = new Map<number, [number, number]>();
  for (const link of uiWorkflow.links ?? []) {
    const [linkId, srcNodeId, srcOutputIdx] = link;
    linkMap.set(linkId, [srcNodeId, srcOutputIdx]);
  }

  for (const node of uiWorkflow.nodes) {
    const nodeId = String(node.id);
    const inputs: Record<string, unknown> = {};

    if (node.inputs) {
      for (const inp of node.inputs) {
        if (inp.link != null) {
          const src = linkMap.get(inp.link);
          if (src) inputs[inp.name] = [String(src[0]), src[1]];
        }
      }
    }

    const info = objectInfo[node.type] as ObjectInfoEntry | undefined;
    if (info && node.widgets_values) {
      const widgetNames = getWidgetInputNames(info);
      for (let i = 0; i < widgetNames.length && i < node.widgets_values.length; i++) {
        const name = widgetNames[i];
        if (name && !(name in inputs)) {
          inputs[name] = node.widgets_values[i];
        }
      }
    }

    prompt[nodeId] = {
      class_type: node.type,
      inputs,
      ...(node.title ? { _meta: { title: node.title } } : {}),
    };
  }

  return prompt;
}

// ─── Format detection ────────────────────────────────

function isUIFormat(json: Record<string, unknown>): boolean {
  return Array.isArray(json.nodes) && Array.isArray(json.links);
}

// ─── UI format parser ────────────────────────────────

function parseUIFormat(
  wf: UIWorkflow,
  objectInfo: Record<string, unknown>,
): ExposedParam[] {
  const params: ExposedParam[] = [];

  for (const node of wf.nodes) {
    const title = (node.title ?? '').trim();
    if (!title.toLowerCase().startsWith(EXPOSED_PREFIX.toLowerCase())) continue;

    const displayTitle = title.slice(EXPOSED_PREFIX.length).trim() || node.type;
    const nodeType = node.type;
    const nodeId = String(node.id);
    const info = objectInfo[nodeType] as ObjectInfoEntry | undefined;

    const widgetNames = info ? getWidgetInputNames(info) : [];
    const widgetValues = node.widgets_values ?? [];

    const allInputDefs = {
      ...info?.input?.required,
      ...info?.input?.optional,
    };

    for (let i = 0; i < widgetNames.length && i < widgetValues.length; i++) {
      const paramName = widgetNames[i];
      if (!paramName) continue;

      const currentValue = widgetValues[i];
      const inputDef = allInputDefs[paramName];
      const resolved = resolveParamType(paramName, currentValue, inputDef, nodeType);
      if (!resolved) continue;

      params.push({
        nodeId,
        nodeTitle: displayTitle,
        nodeType,
        paramName,
        displayName: resolved.displayName,
        type: resolved.type,
        default: resolved.defaultValue,
        min: resolved.min,
        max: resolved.max,
        step: resolved.step,
        options: resolved.options,
        source: 'auto',
      });
    }

    if (IMAGE_NODE_TYPES.has(nodeType)) {
      const hasImageParam = params.some(
        (p) => p.nodeId === nodeId && p.paramName === 'image',
      );
      if (!hasImageParam) {
        params.push({
          nodeId,
          nodeTitle: displayTitle,
          nodeType,
          paramName: 'image',
          displayName: 'image',
          type: 'image',
          default: null,
          source: 'auto',
        });
      }
    }
  }

  return params;
}

/**
 * Threshold for detecting seed-type INT inputs.
 * Any INT with max >= this is likely a seed and has a hidden
 * `control_after_generate` widget in widgets_values.
 */
const SEED_MAX_THRESHOLD = 2 ** 32;

/**
 * Get the ordered list of widget (non-connection) input names for a node type.
 * This matches the order of widgets_values in the UI format.
 *
 * Returns null entries for hidden internal widgets (e.g. control_after_generate)
 * that ComfyUI's frontend inserts into widgets_values but are absent from object_info.
 */
function getWidgetInputNames(info: ObjectInfoEntry): (string | null)[] {
  const names: (string | null)[] = [];

  for (const section of [info.input?.required, info.input?.optional]) {
    if (!section) continue;
    for (const [name, def] of Object.entries(section)) {
      if (!Array.isArray(def) || def.length === 0) continue;
      const typeOrOptions = def[0];
      if (Array.isArray(typeOrOptions)) {
        names.push(name);
      } else if (typeof typeOrOptions === 'string') {
        if (WIDGET_TYPES.has(typeOrOptions)) {
          names.push(name);

          if (typeOrOptions === 'INT') {
            const constraints = (def[1] ?? {}) as Record<string, unknown>;
            const max = constraints.max as number | undefined;
            const controlOpt = constraints.control_after_generate;
            if (controlOpt !== false && max != null && max >= SEED_MAX_THRESHOLD) {
              names.push(null);
            }
          }
        }
      }
    }
  }

  return names;
}

// ─── API format parser ───────────────────────────────

function parseAPIFormat(
  workflowJson: Record<string, unknown>,
  objectInfo: Record<string, unknown>,
): ExposedParam[] {
  const params: ExposedParam[] = [];

  for (const [nodeId, nodeRaw] of Object.entries(workflowJson)) {
    const node = nodeRaw as ApiNode;
    if (!node.class_type || !node._meta?.title) continue;

    const title = node._meta.title.trim();
    if (!title.toLowerCase().startsWith(EXPOSED_PREFIX.toLowerCase())) continue;

    const displayTitle = title.slice(EXPOSED_PREFIX.length).trim() || node.class_type;
    const nodeType = node.class_type;
    const infoEntry = objectInfo[nodeType] as ObjectInfoEntry | undefined;

    const allInputDefs = {
      ...infoEntry?.input?.required,
      ...infoEntry?.input?.optional,
    };

    for (const [paramName, value] of Object.entries(node.inputs)) {
      if (isConnectionValue(value)) continue;

      const inputDef = allInputDefs[paramName];
      const resolved = resolveParamType(paramName, value, inputDef, nodeType);
      if (!resolved) continue;

      params.push({
        nodeId,
        nodeTitle: displayTitle,
        nodeType,
        paramName,
        displayName: resolved.displayName,
        type: resolved.type,
        default: resolved.defaultValue,
        min: resolved.min,
        max: resolved.max,
        step: resolved.step,
        options: resolved.options,
        source: 'auto',
      });
    }
  }

  return params;
}

// ─── Shared helpers ──────────────────────────────────

function isConnectionValue(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'string' && typeof value[1] === 'number';
}

interface ResolvedParam {
  type: ParamType;
  displayName: string;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

function resolveParamType(
  paramName: string,
  currentValue: unknown,
  inputDef: unknown[] | undefined,
  nodeType: string,
): ResolvedParam | null {
  if (IMAGE_NODE_TYPES.has(nodeType) && paramName === 'image') {
    return { type: 'image', displayName: 'image', defaultValue: currentValue };
  }

  if (!inputDef || inputDef.length === 0) {
    return inferFromValue(paramName, currentValue);
  }

  const typeOrOptions = inputDef[0];
  const constraints = (inputDef[1] ?? {}) as Record<string, unknown>;

  if (Array.isArray(typeOrOptions)) {
    return {
      type: 'enum',
      displayName: paramName,
      defaultValue: constraints.default ?? currentValue ?? typeOrOptions[0],
      options: typeOrOptions.map(String),
    };
  }

  if (typeof typeOrOptions === 'string') {
    switch (typeOrOptions) {
      case 'INT':
        return {
          type: 'int', displayName: paramName,
          defaultValue: constraints.default ?? currentValue ?? 0,
          min: constraints.min as number | undefined,
          max: constraints.max as number | undefined,
          step: (constraints.step as number | undefined) ?? 1,
        };
      case 'FLOAT':
        return {
          type: 'float', displayName: paramName,
          defaultValue: constraints.default ?? currentValue ?? 0.0,
          min: constraints.min as number | undefined,
          max: constraints.max as number | undefined,
          step: (constraints.step as number | undefined) ?? 0.01,
        };
      case 'STRING':
        return {
          type: 'string', displayName: paramName,
          defaultValue: constraints.default ?? currentValue ?? '',
        };
      case 'BOOLEAN':
        return {
          type: 'boolean', displayName: paramName,
          defaultValue: constraints.default ?? currentValue ?? false,
        };
      default:
        if (typeOrOptions === typeOrOptions.toUpperCase() && typeOrOptions.length > 1) {
          return null;
        }
        return inferFromValue(paramName, currentValue);
    }
  }

  return inferFromValue(paramName, currentValue);
}

function inferFromValue(paramName: string, value: unknown): ResolvedParam | null {
  if (typeof value === 'number') {
    const isFloat = !Number.isInteger(value);
    return {
      type: isFloat ? 'float' : 'int',
      displayName: paramName,
      defaultValue: value,
      step: isFloat ? 0.01 : 1,
    };
  }
  if (typeof value === 'string') {
    return { type: 'string', displayName: paramName, defaultValue: value };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', displayName: paramName, defaultValue: value };
  }
  return null;
}
