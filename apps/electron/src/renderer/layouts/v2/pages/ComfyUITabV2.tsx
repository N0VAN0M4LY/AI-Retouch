import { useState, useRef, useCallback } from 'react';
import * as Icons from '@ai-retouch/ui-core/components/Icons';
import Dropdown from '@ai-retouch/ui-core/components/Dropdown';
import { useSpinner } from '@ai-retouch/ui-core/hooks/useAnimations';
import {
  useComfyUIWorkflow,
  type ImageAssignment,
  type ParamValues,
  type CuiOutput,
  type PsImageSource,
  type NodeViewMode,
} from '@ai-retouch/ui-core/hooks/useComfyUIWorkflow';
import { suggestLatentSize } from '@ai-retouch/ui-core/pages/ImageTransferSection';
import type { ExposedParam, WorkflowNodeInfo } from '@ai-retouch/shared';
import { t } from '@ai-retouch/ui-core/i18n';

// ─── Drag reorder hook ───────────────────────────────

function useDragReorder(onReorder: (from: number, to: number) => void) {
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);

  const onDragStart = useCallback((idx: number) => (e: React.DragEvent) => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    (e.currentTarget as HTMLElement).style.opacity = '0.5';
  }, []);

  const onDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    dragIdx.current = null;
    overIdx.current = null;
  }, []);

  const onDragOver = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    overIdx.current = idx;
  }, []);

  const onDrop = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from !== null && from !== idx) {
      onReorder(from, idx);
    }
    dragIdx.current = null;
    overIdx.current = null;
  }, [onReorder]);

  return { onDragStart, onDragEnd, onDragOver, onDrop };
}

// ─── Constants ───────────────────────────────────────

const THUMB_SIZE = 56;
const NODE_COLORS = [
  'var(--green)', 'var(--orange)', 'var(--accent2)',
  'var(--accent)', '#FF375F', 'var(--red)',
];

// ─── Helpers ─────────────────────────────────────────

function Spinner({ size = 12 }: { size?: number }) {
  const ch = useSpinner();
  return <span style={{ fontSize: size, fontFamily: 'monospace', letterSpacing: 1 }}>{ch}</span>;
}

// ─── Main Component ──────────────────────────────────

interface ComfyUITabV2Props {
  documentPath: string | null;
}

export default function ComfyUITabV2({ documentPath }: ComfyUITabV2Props) {
  const wf = useComfyUIWorkflow({ documentPath });
  const [wfListOpen, setWfListOpen] = useState(true);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const drag = useDragReorder(wf.handleReorder);

  const filteredFiles = workflowFilter
    ? wf.remoteFiles.filter(f => f.name.toLowerCase().includes(workflowFilter.toLowerCase()) || f.path.toLowerCase().includes(workflowFilter.toLowerCase()))
    : wf.remoteFiles;

  const grouped = filteredFiles.reduce<Record<string, Array<{ path: string; name: string }>>>((acc, entry) => {
    const parts = entry.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : t('cui.workflows');
    (acc[folder] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden' }}>

      {/* ────────── Left Column ────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', paddingRight: 2 }}>

        {/* Connection status */}
        <div className="v2-glass-card" style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Icons.Dot color={wf.connected ? 'var(--green)' : 'var(--red)'} />
          <span style={{ fontSize: 12, fontWeight: 550, color: wf.connected ? 'var(--green)' : 'var(--red)' }}>
            {wf.connected ? t('cui.connected') : t('cui.disconnected')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{wf.status?.address ?? '...'}</span>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: wf.wsConnected ? 'var(--green)' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: wf.wsConnected ? 'var(--green)' : '#999', display: 'inline-block' }} />
            {wf.wsConnected ? t('cui.ws_connected') : t('cui.ws_disconnected')}
          </div>
          <div className="v2-pill" style={{ fontSize: 11 }} onClick={wf.handleTestConnection}>
            <Icons.RefreshCw size={12} /> {t('cui.test')}
          </div>
        </div>

        {/* Not connected hint */}
        {!wf.connected && (
          <div className="v2-glass-card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {t('cui.not_connected')}
            </div>
          </div>
        )}

        {wf.connected && (
          <>
            {/* Hint toast */}
            {wf.hintMessage && (
              <div className="v2-glass-card" style={{
                padding: '8px 14px', fontSize: 11, color: 'var(--orange)',
                textAlign: 'center', borderColor: 'rgba(255,149,0,0.25)',
                background: 'rgba(255,149,0,0.08)',
              }}>
                {wf.hintMessage}
              </div>
            )}

            {/* Combined: Workflow list (overlay) + Nodes (right) */}
            <div className="v2-glass-card" style={{ padding: 0, flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>

              {/* Left panel: workflow list (overlay on top of nodes) */}
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 10,
                display: 'flex', flexDirection: 'column',
                width: wfListOpen ? 200 : 32,
                transition: 'width 0.2s ease',
                borderRight: '1px solid var(--border-subtle)',
                overflow: 'hidden',
                background: 'var(--bg-base)',
              }}>
                {/* Header */}
                <div
                  style={{
                    padding: wfListOpen ? '10px 12px' : '10px 0',
                    display: 'flex', alignItems: 'center', gap: 6,
                    borderBottom: '1px solid var(--border-subtle)',
                    flexShrink: 0, cursor: 'pointer',
                    justifyContent: wfListOpen ? 'flex-start' : 'center',
                  }}
                  onClick={() => setWfListOpen(!wfListOpen)}
                >
                  <span style={{ display: 'flex', color: 'var(--text3)', transform: wfListOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }}>
                    <Icons.ChevronDown size={12} />
                  </span>
                  {wfListOpen && (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', flex: 1 }}>{t('cui.workflows')}</span>
                      <div
                        className="v2-pill"
                        style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={(e) => { e.stopPropagation(); wf.refreshRemote(); }}
                      >
                        {wf.remoteLoading ? <Spinner size={10} /> : <Icons.RefreshCw size={10} />}
                      </div>
                    </>
                  )}
                </div>

                {/* Collapsed vertical label */}
                {!wfListOpen && (
                  <div
                    onClick={() => setWfListOpen(true)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', overflow: 'hidden',
                    }}
                  >
                    <span style={{
                      writingMode: 'vertical-rl',
                      fontSize: 10, fontWeight: 500, letterSpacing: 3,
                      color: 'var(--text3)', whiteSpace: 'nowrap', userSelect: 'none',
                    }}>
                      {t('cui.step1_workflow')}
                    </span>
                  </div>
                )}

                {/* List body */}
                {wfListOpen && (
                  <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
                    <div style={{ padding: '0 8px 4px' }}>
                      <input
                        type="text"
                        placeholder={t('cui.search_workflows')}
                        value={workflowFilter}
                        onChange={(e) => setWorkflowFilter(e.target.value)}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          background: 'var(--bg2)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          color: 'var(--text1)',
                          width: '100%',
                          outline: 'none',
                          marginBottom: 4,
                        }}
                      />
                    </div>
                    {wf.remoteError && (
                      <div style={{ fontSize: 11, color: 'var(--orange)', padding: 8, textAlign: 'center' }}>
                        {wf.remoteError}
                      </div>
                    )}
                    {!wf.remoteLoading && !wf.remoteError && (
                      <>
                        {Object.entries(grouped).map(([folder, items]) => (
                          <div key={folder} style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, padding: '2px 12px' }}>{folder}</div>
                            {items.map((entry) => {
                              const active = wf.selectedPath === entry.path;
                              return (
                                <div
                                  key={entry.path}
                                  onClick={() => wf.handleSelectFromDropdown(entry.path)}
                                  style={{
                                    padding: '4px 12px 4px 16px', fontSize: 11,
                                    cursor: 'pointer',
                                    background: active ? 'var(--accent-soft)' : 'transparent',
                                    color: active ? 'var(--accent)' : 'var(--text2)',
                                    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                                    fontWeight: active ? 550 : 400,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                  }}
                                >{entry.name}</div>
                              );
                            })}
                          </div>
                        ))}
                        {filteredFiles.length === 0 && (
                          <div style={{ padding: 16, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                            {t('cui.empty')}
                          </div>
                        )}
                      </>
                    )}
                    {wf.remoteLoading && (
                      <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>
                        <Spinner size={11} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right panel: workflow nodes */}
              <div style={{ flex: 1, overflow: 'auto', padding: '14px 14px 14px 46px', minWidth: 0 }}>
                {wf.parsing && (
                  <div style={{ padding: 14, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>
                    <Icons.Loader size={14} color="var(--accent)" /> {t('loading')}
                  </div>
                )}
                {wf.parseError && (
                  <div style={{ padding: 14, textAlign: 'center', fontSize: 11, color: 'var(--red)' }}>
                    {wf.parseError}
                  </div>
                )}

                {!wf.selectedPath && !wf.parsing && (
                  <div className="v2-placeholder" style={{ height: '100%' }}>
                    <Icons.FileJson size={20} color="var(--text4)" />
                    <div style={{ fontSize: 11 }}>{t('cui.select_workflow')}</div>
                  </div>
                )}

                {wf.workflowReady && wf.parsed && (
                  <>
                    {/* Mode toggle: Selected / All */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', flex: 1 }}>
                        {wf.selectedPath?.split('/').pop()}
                      </div>
                      <V2NodeViewToggle mode={wf.nodeViewMode} onChange={wf.setNodeViewMode} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 10 }}>{t('cui.step3_nodes')}</div>

                    {wf.nodeViewMode === 'all' ? (
                      /* ── All Nodes mode ── */
                      <>
                        {wf.allNodes.map((node, idx) => (
                          <div
                            key={node.nodeId}
                            draggable
                            onDragStart={drag.onDragStart(idx)}
                            onDragEnd={drag.onDragEnd}
                            onDragOver={drag.onDragOver(idx)}
                            onDrop={drag.onDrop(idx)}
                          >
                            <V2AllModeNodeCard
                              node={node}
                              color={NODE_COLORS[idx % NODE_COLORS.length]}
                              isExposed={wf.exposedNodeIds.has(node.nodeId)}
                              onToggleExposed={() => wf.handleToggleExposed(node.nodeId)}
                              assignment={node.isImageInput ? (wf.imageAssignments[node.nodeId] ?? null) : null}
                              onAssign={node.isImageInput ? () => wf.handleAssignImage(node.nodeId) : undefined}
                              onReplace={node.isImageInput ? () => wf.handleAssignImage(node.nodeId) : undefined}
                              onRemove={node.isImageInput ? () => wf.handleRemoveAssignment(node.nodeId) : undefined}
                              paramValues={wf.paramValues}
                              onParamChange={wf.handleParamChange}
                            />
                          </div>
                        ))}
                        {wf.allNodes.length === 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 16 }}>
                            {t('cui.empty')}
                          </div>
                        )}
                      </>
                    ) : (
                      /* ── Selected Nodes mode: build merged list sorted by allNodes order ── */
                      (() => {
                        const items: Array<{ type: 'image'; nodeId: string; nodeType: string; title: string } | { type: 'param'; nodeId: string; params: ExposedParam[] }> = [];
                        const visImgSet = new Set(wf.visibleImageNodes.map(n => n.nodeId));
                        for (const n of wf.allNodes) {
                          if (!wf.exposedNodeIds.has(n.nodeId)) continue;
                          if (visImgSet.has(n.nodeId)) {
                            items.push({ type: 'image', nodeId: n.nodeId, nodeType: n.nodeType, title: n.title });
                          }
                          const nodeParams = wf.visibleParamsByNode.get(n.nodeId);
                          if (nodeParams && nodeParams.length > 0) {
                            items.push({ type: 'param', nodeId: n.nodeId, params: nodeParams });
                          }
                        }
                        return items.length === 0 ? (
                          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 16 }}>
                            {t('cui.empty')}
                            <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 4 }}>
                              {t('cui.switch_to_all_hint')}
                            </div>
                          </div>
                        ) : (
                          <>
                            {items.map((item, idx) => {
                              const globalIdx = wf.allNodes.findIndex(n => n.nodeId === item.nodeId);
                              return (
                                <div
                                  key={`${item.type}-${item.nodeId}`}
                                  draggable
                                  onDragStart={drag.onDragStart(globalIdx)}
                                  onDragEnd={drag.onDragEnd}
                                  onDragOver={drag.onDragOver(globalIdx)}
                                  onDrop={drag.onDrop(globalIdx)}
                                >
                                  {item.type === 'image' ? (
                                    <V2LoadImageNode
                                      nodeId={item.nodeId}
                                      nodeTitle={item.title}
                                      nodeType={item.nodeType}
                                      color={NODE_COLORS[idx % NODE_COLORS.length]}
                                      assignment={wf.imageAssignments[item.nodeId] ?? null}
                                      onAssign={() => wf.handleAssignImage(item.nodeId)}
                                      onReplace={() => wf.handleAssignImage(item.nodeId)}
                                      onRemove={() => wf.handleRemoveAssignment(item.nodeId)}
                                    />
                                  ) : (
                                    <V2NodeParamGroup
                                      nodeId={item.nodeId}
                                      nodeType={item.params[0].nodeType}
                                      nodeTitle={item.params[0].nodeTitle}
                                      color={NODE_COLORS[idx % NODE_COLORS.length]}
                                      params={item.params}
                                      paramValues={wf.paramValues}
                                      onParamChange={wf.handleParamChange}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </>
                        );
                      })()
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Action buttons */}
            {wf.workflowReady && (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <div
                  className={`v2-pill ${wf.hasAssignedImages && !wf.executing && !wf.pollingResult ? 'active' : ''}`}
                  style={{
                    flex: 1, justifyContent: 'center', fontWeight: 550, padding: '9px 0',
                    opacity: (!wf.hasAssignedImages || wf.executing || wf.pollingResult) ? 0.5 : 1,
                    cursor: (!wf.hasAssignedImages || wf.executing || wf.pollingResult) ? 'default' : 'pointer',
                  }}
                  onClick={!wf.executing && !wf.pollingResult && wf.hasAssignedImages ? wf.handleSendImagesOnly : undefined}
                >
                  <Icons.Upload size={12} /> {t('cui.send_images_only')}
                </div>
                <button
                  className="v2-execute-btn"
                  style={{
                    flex: 1,
                    opacity: (wf.executing || wf.pollingResult) ? 0.7 : 1,
                    cursor: (wf.executing || wf.pollingResult) ? 'default' : 'pointer',
                  }}
                  onClick={!wf.executing && !wf.pollingResult ? wf.handleSendAndExecute : undefined}
                  disabled={wf.executing || wf.pollingResult}
                >
                  {wf.executing
                    ? <><Spinner size={12} /> {wf.executeStatus ?? t('cui.executing')}</>
                    : t('cui.send_and_execute')}
                </button>
              </div>
            )}

            {/* No images hint */}
            {wf.workflowReady && wf.parsed && wf.parsed.imageInputNodes.length > 0 && !wf.hasAssignedImages && (
              <div style={{ fontSize: 10, color: 'var(--orange)', textAlign: 'center', opacity: 0.8 }}>
                {t('cui.not_assigned')}
              </div>
            )}

            {/* Status messages */}
            {wf.executeError && (
              <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center' }}>
                {wf.executeError}
              </div>
            )}
            {wf.executeResult && !wf.pollingResult && (
              <div style={{ fontSize: 11, color: 'var(--green)', textAlign: 'center' }}>
                {wf.executeResult}
              </div>
            )}
          </>
        )}
      </div>

      {/* ────────── Right Column ────────── */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>

        {/* Image Transfer (PS sources) — always visible */}
        <div className="v2-glass-card" style={{ padding: 14, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 2 }}>
            {t('cui.image_transfer')}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 10 }}>{t('cui.step2_image')}</div>

          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>
            {t('cui.ps_to_cui')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', paddingBottom: 6, gap: 8 }}>
            {wf.psSources.map((source) => (
              <V2ThumbCard
                key={source.id}
                thumbnail={source.thumbnail}
                label={source.name}
                selected={wf.selectedSourceId === source.id}
                onClick={() => wf.setSelectedSourceId(source.id)}
              />
            ))}
          </div>
          {wf.psSources.find(s => s.id === wf.selectedSourceId) && (() => {
            const sel = wf.psSources.find(s => s.id === wf.selectedSourceId)!;
            if (sel.width <= 0) return null;
            const latent = suggestLatentSize(sel.width, sel.height);
            return (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                {sel.name}: {sel.width}x{sel.height}
                {latent && <span> | {t('img_transfer.suggested_latent')}: {latent.w}x{latent.h} ({latent.ratio})</span>}
              </div>
            );
          })()}
        </div>

        {/* Execution progress */}
        <div className="v2-glass-card" style={{ padding: 14, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10 }}>
            {t('v2.task_queue')}
          </div>

          {wf.pollingResult ? (
            wf.progressInfo ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text2)', marginBottom: 8, gap: 6 }}>
                  <Spinner size={11} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {wf.executingNode || t('cui.executing')}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace', flexShrink: 0 }}>
                    {wf.progressInfo.value}/{wf.progressInfo.max}
                  </span>
                </div>
                <div className="v2-progress-track">
                  <div className="v2-progress-fill" style={{ width: `${wf.progressInfo.percentage}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text3)' }}>
                  <span>{wf.progressInfo.percentage}%</span>
                  {wf.currentPromptId && (
                    <span className="v2-pill red" style={{ fontSize: 10, padding: '1px 6px', cursor: 'pointer' }} onClick={wf.handleCancelExecution}>
                      {t('cui.cancel')}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text3)', padding: 8 }}>
                <Spinner size={12} /> {wf.executeStatus || t('cui.waiting_result')}
              </div>
            )
          ) : wf.queueRemaining > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: 8 }}>
              {t('v2.task_queue')}: {wf.queueRemaining}
            </div>
          ) : (
            <div className="v2-placeholder" style={{ padding: '16px 8px' }}>
              <Icons.Zap size={16} color="var(--text4)" />
              <div style={{ fontSize: 11 }}>{t('v2.no_active_tasks')}</div>
            </div>
          )}
        </div>

        {/* Result preview */}
        <div className="v2-glass-card" style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{t('v2.result_preview')}</span>
            <div className="v2-pill" style={{ fontSize: 10 }} onClick={wf.handleRefreshOutputs}>
              {wf.refreshingOutputs ? <Spinner size={10} /> : <Icons.RefreshCw size={10} />}
              {t('cui.refresh_outputs')}
            </div>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 10 }}>{t('cui.step4_result')}</div>

          {wf.cuiOutputs.length > 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Selected output large preview */}
              {wf.selectedOutputIdx != null && wf.cuiOutputs[wf.selectedOutputIdx] && (
                <div style={{
                  borderRadius: 10, overflow: 'hidden',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--glass-inset)',
                  aspectRatio: '1',
                  maxHeight: 220,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img
                    src={wf.cuiOutputs[wf.selectedOutputIdx].url}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                  />
                </div>
              )}

              {/* Thumbnail strip */}
              <div style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', gap: 6, paddingBottom: 4 }}>
                {wf.cuiOutputs.map((output, idx) => (
                  <V2OutputThumbCard
                    key={`${output.nodeId}-${output.filename}`}
                    url={output.url}
                    selected={wf.selectedOutputIdx === idx}
                    onClick={() => wf.setSelectedOutputIdx(idx)}
                    label={output.filename}
                  />
                ))}
              </div>

              {/* Action buttons for selected output */}
              {wf.selectedOutputIdx != null && wf.cuiOutputs[wf.selectedOutputIdx] && (() => {
                const sel = wf.cuiOutputs[wf.selectedOutputIdx!];
                const isApplied = wf.appliedImages.has(sel.filename);
                const isApplying = wf.applyingImage === sel.filename;
                return (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div
                      className={`v2-pill ${isApplied ? 'green' : 'active'}`}
                      style={{
                        flex: 1, justifyContent: 'center', fontSize: 11,
                        cursor: isApplied || isApplying ? 'default' : 'pointer',
                        opacity: isApplied || isApplying ? 0.7 : 1,
                      }}
                      onClick={!isApplied && !isApplying ? () => wf.handleApplyToCanvas(sel) : undefined}
                    >
                      {isApplying ? (
                        <><Spinner size={10} /> {t('cui.applying')}</>
                      ) : isApplied ? (
                        <><Icons.Check size={10} /> {t('cui.applied')}</>
                      ) : (
                        <><Icons.Download size={10} /> {t('cui.apply')}</>
                      )}
                    </div>
                    <div
                      className="v2-pill"
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11, cursor: 'pointer' }}
                      onClick={() => wf.handleSaveToLibrary(sel)}
                    >
                      <Icons.Save size={10} /> {t('cui.save_to_library')}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="v2-placeholder" style={{ flex: 1 }}>
              <Icons.Image size={20} color="var(--text4)" />
              <div style={{ fontSize: 11 }}>
                {wf.refreshingOutputs ? <><Spinner size={11} /> {t('loading')}</> : t('v2.run_workflow_hint')}
              </div>
            </div>
          )}

          {/* Result error */}
          {wf.resultError && !wf.pollingResult && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--orange)', textAlign: 'center' }}>
              {wf.resultError}
              <span
                className="v2-pill" style={{ fontSize: 10, marginLeft: 8, cursor: 'pointer' }}
                onClick={() => wf.setResultError(null)}
              >OK</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── V2 ThumbCard ────────────────────────────────────

function V2ThumbCard({
  thumbnail, label, selected, onClick,
}: {
  thumbnail: string | null; label: string; selected: boolean; onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, cursor: 'pointer',
      flexShrink: 0, overflow: 'hidden', position: 'relative',
      border: selected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
      background: 'var(--glass-inset)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {thumbnail ? (
        <img src={thumbnail} style={{
          width: THUMB_SIZE, height: THUMB_SIZE, objectFit: 'cover', display: 'block',
        }} />
      ) : (
        <Icons.Image size={18} color="var(--text4)" />
      )}
      {selected && (
        <div style={{
          position: 'absolute', bottom: 2, right: 2,
          width: 14, height: 14, borderRadius: 7,
          background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.Check size={8} color="#fff" />
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(0,0,0,0.6)', fontSize: 8,
        color: 'rgba(255,255,255,0.8)', textAlign: 'center',
        padding: '1px 2px', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
    </div>
  );
}

// ─── V2 OutputThumbCard ──────────────────────────────

function V2OutputThumbCard({
  url, selected, onClick, label,
}: {
  url: string; selected: boolean; onClick: () => void; label?: string;
}) {
  return (
    <div onClick={onClick} style={{
      width: 48, height: 48, borderRadius: 7, cursor: 'pointer',
      flexShrink: 0, overflow: 'hidden', position: 'relative',
      border: selected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
      background: 'var(--glass-inset)',
    }}>
      <img src={url} style={{
        width: 48, height: 48, objectFit: 'cover', display: 'block',
      }} />
      {label && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.6)', fontSize: 7,
          color: 'rgba(255,255,255,0.8)', textAlign: 'center',
          padding: '1px 2px', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── V2 LoadImageNode ────────────────────────────────

function V2LoadImageNode({
  nodeId, nodeTitle, nodeType, color,
  assignment, onAssign, onReplace, onRemove,
}: {
  nodeId: string; nodeTitle: string; nodeType: string; color: string;
  assignment: ImageAssignment | null;
  onAssign: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{
      marginBottom: 8, borderRadius: 8,
      border: '1px solid var(--border-subtle)',
      overflow: 'hidden', background: 'var(--glass-inset)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '6px 10px',
        borderLeft: `3px solid ${color}`,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color, fontFamily: 'monospace',
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          padding: '1px 5px', borderRadius: 4, marginRight: 8,
        }}>#{nodeId}</span>
        <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, flex: 1 }}>
          {nodeTitle}
        </span>
        <span style={{
          fontSize: 9, color: 'var(--text3)', fontFamily: 'monospace',
          background: 'var(--glass)', padding: '1px 5px', borderRadius: 4,
        }}>{nodeType}</span>
      </div>

      {/* Body */}
      <div style={{
        padding: '8px 10px 8px 16px',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        {!assignment ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>image</span>
            <div className="v2-pill active" style={{ fontSize: 10, cursor: 'pointer' }} onClick={onAssign}>
              <Icons.Image size={10} /> {t('cui.assign')}
            </div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>({t('cui.not_assigned')})</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>image</span>
            <div className="v2-pill" style={{ fontSize: 10, cursor: 'pointer' }} onClick={onReplace}>
              <Icons.RefreshCw size={9} /> {t('cui.replace')}
            </div>
            {assignment.thumbnail && (
              <div style={{
                width: 32, height: 32, borderRadius: 6, overflow: 'hidden',
                border: '1px solid var(--border-subtle)', flexShrink: 0,
              }}>
                <img src={assignment.thumbnail} style={{ width: 32, height: 32, objectFit: 'cover', display: 'block' }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--text2)' }}>{assignment.sourceName}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)' }}>{assignment.width}x{assignment.height}</div>
            </div>
            <div className="v2-pill red" style={{ fontSize: 10, cursor: 'pointer', padding: '3px 6px' }} onClick={onRemove}>
              {t('cui.remove')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── V2 NodeParamGroup ───────────────────────────────

function V2NodeParamGroup({
  nodeId, nodeType, nodeTitle, color, params, paramValues, onParamChange,
}: {
  nodeId: string; nodeType: string; nodeTitle: string; color: string;
  params: ExposedParam[]; paramValues: ParamValues;
  onParamChange: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div style={{
      marginBottom: 8, borderRadius: 8,
      border: '1px solid var(--border-subtle)',
      overflow: 'hidden', background: open ? 'var(--glass-inset)' : 'transparent',
    }}>
      <div onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', padding: '6px 10px',
        cursor: 'pointer', borderLeft: `3px solid ${color}`,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color, fontFamily: 'monospace',
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          padding: '1px 5px', borderRadius: 4, marginRight: 8,
        }}>#{nodeId}</span>
        <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, flex: 1 }}>{nodeTitle}</span>
        <span style={{
          fontSize: 9, color: 'var(--text3)', fontFamily: 'monospace',
          background: 'var(--glass)', padding: '1px 5px', borderRadius: 4, marginRight: 8,
        }}>{nodeType}</span>
        <span style={{ color: 'var(--text3)', display: 'flex' }}>
          {open ? <Icons.ChevronUp size={12} /> : <Icons.ChevronDown size={12} />}
        </span>
      </div>

      {open && (
        <div style={{
          padding: '8px 10px 10px 16px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {params.map((p) => {
            const key = `${p.nodeId}:${p.paramName}`;
            return (
              <V2EditableParamRow key={key} param={p} value={paramValues[key]} onChange={(v) => onParamChange(key, v)} />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── V2 EditableParamRow ─────────────────────────────

function V2EditableParamRow({ param, value, onChange }: {
  param: ExposedParam; value: unknown; onChange: (v: unknown) => void;
}) {
  switch (param.type) {
    case 'enum':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', width: 70, flexShrink: 0 }}>{param.displayName}</span>
          <Dropdown
            value={String(value ?? '')}
            options={(param.options ?? []).map(o => ({ value: o, label: o }))}
            onChange={(v) => onChange(v)}
          />
        </div>
      );
    case 'int':
    case 'float':
      return <V2NumericParamRow param={param} value={value} onChange={onChange} />;
    case 'string':
      return (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{param.displayName}</div>
          <textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            style={{
              width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 8,
              resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
              height: 60, background: 'var(--glass)', border: '1px solid var(--border-subtle)',
              color: 'var(--text)',
            }}
          />
        </div>
      );
    case 'boolean':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', width: 70, flexShrink: 0 }}>{param.displayName}</span>
          <div onClick={() => onChange(!value)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {value ? <Icons.ToggleRight color="var(--green)" /> : <Icons.ToggleLeft color="var(--text3)" />}
          </div>
        </div>
      );
    default:
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', width: 70, flexShrink: 0 }}>{param.displayName}</span>
          <input
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            style={{
              flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 8,
              background: 'var(--glass)', border: '1px solid var(--border-subtle)', color: 'var(--text)',
            }}
          />
        </div>
      );
  }
}

// ─── V2 NumericParamRow ──────────────────────────────

function V2NumericParamRow({ param, value, onChange }: {
  param: ExposedParam; value: unknown; onChange: (v: unknown) => void;
}) {
  const numValue = Number(value ?? param.default ?? 0);
  const min = param.min ?? 0;
  const max = param.max ?? (param.type === 'int' ? 1000 : 1);
  const step = param.step ?? (param.type === 'float' ? 0.01 : 1);
  const isInt = param.type === 'int';
  const isSeed = param.paramName === 'seed';
  const clampedMax = isSeed ? 999999999 : max;

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    onChange(isInt ? Math.round(v) : v);
  }
  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '' || raw === '-') return;
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(isInt ? Math.round(v) : v);
  }

  if (isSeed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', width: 70, flexShrink: 0 }}>
          {param.displayName}
        </span>
        <input
          value={String(numValue)}
          onChange={handleInput}
          style={{
            flex: 1, fontSize: 12, padding: '4px 10px', borderRadius: 8,
            background: 'var(--glass)', border: '1px solid var(--border-subtle)', color: 'var(--text)',
          }}
        />
        <div
          className="v2-pill"
          style={{ fontSize: 9, padding: '3px 6px', cursor: 'pointer' }}
          onClick={() => onChange(Math.floor(Math.random() * 999999999))}
          title={t('cui.random_seed')}
        >
          <Icons.RefreshCw size={10} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', width: 70, flexShrink: 0 }}>
        {param.displayName}
      </span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <input
          type="range"
          min={min} max={clampedMax} step={step} value={numValue}
          onChange={handleSlider}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>
      <input
        value={isInt ? String(numValue) : numValue.toFixed(2)}
        onChange={handleInput}
        style={{
          width: 48, fontSize: 11, padding: '2px 4px', borderRadius: 6,
          textAlign: 'right', background: 'var(--glass)',
          border: '1px solid var(--border-subtle)', color: 'var(--text)',
        }}
      />
    </div>
  );
}

// ─── V2 NodeViewToggle ───────────────────────────────

function V2NodeViewToggle({ mode, onChange }: { mode: NodeViewMode; onChange: (m: NodeViewMode) => void }) {
  return (
    <div style={{
      display: 'flex', borderRadius: 6, overflow: 'hidden',
      border: '1px solid var(--border-subtle)', fontSize: 10, fontWeight: 550,
    }}>
      {(['selected', 'all'] as const).map((m) => (
        <div
          key={m}
          onClick={() => onChange(m)}
          style={{
            padding: '3px 10px', cursor: 'pointer',
            background: mode === m ? 'var(--accent)' : 'transparent',
            color: mode === m ? '#fff' : 'var(--text3)',
            transition: 'all 0.15s ease',
          }}
        >
          {m === 'selected' ? t('cui.mode_selected') : t('cui.mode_all')}
        </div>
      ))}
    </div>
  );
}

// ─── V2 AllModeNodeCard (used in "all nodes" mode) ───

function V2AllModeNodeCard({
  node, color, isExposed, onToggleExposed,
  assignment, onAssign, onReplace, onRemove,
  paramValues, onParamChange,
}: {
  node: WorkflowNodeInfo; color: string;
  isExposed: boolean; onToggleExposed: () => void;
  assignment: ImageAssignment | null;
  onAssign?: () => void; onReplace?: () => void; onRemove?: () => void;
  paramValues: ParamValues; onParamChange: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const nonImageParams = node.params.filter(p => p.type !== 'image');
  const hasContent = node.isImageInput || nonImageParams.length > 0;

  return (
    <div style={{
      marginBottom: 6, borderRadius: 8,
      border: isExposed ? '1px solid var(--accent-soft)' : '1px solid var(--border-subtle)',
      overflow: 'hidden',
      background: isExposed ? 'rgba(108,138,255,0.04)' : 'var(--glass-inset)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '5px 10px',
        borderLeft: `3px solid ${color}`,
        cursor: hasContent ? 'pointer' : 'default',
      }} onClick={hasContent ? () => setOpen(!open) : undefined}>
        <span style={{ cursor: 'grab', color: 'var(--text4)', marginRight: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
              title={t('cui.drag_to_reorder')}>
          <Icons.GripVertical size={12} />
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color, fontFamily: 'monospace',
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          padding: '1px 5px', borderRadius: 4, marginRight: 6,
        }}>#{node.nodeId}</span>
        <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title}
        </span>
        <span style={{
          fontSize: 8, color: 'var(--text4)', fontFamily: 'monospace',
          marginRight: 6, flexShrink: 0,
        }}>{node.nodeType}</span>

        {/* Exposed checkbox */}
        <div
          onClick={(e) => { e.stopPropagation(); onToggleExposed(); }}
          style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            border: isExposed ? '1.5px solid var(--accent)' : '1.5px solid var(--text4)',
            background: isExposed ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
          title={isExposed ? t('cui.unmark_exposed') : t('cui.mark_exposed')}
        >
          {isExposed && <Icons.Check size={10} color="#fff" />}
        </div>

        {hasContent && (
          <span style={{ color: 'var(--text4)', display: 'flex', marginLeft: 4 }}>
            {open ? <Icons.ChevronUp size={10} /> : <Icons.ChevronDown size={10} />}
          </span>
        )}
      </div>

      {/* Expandable body */}
      {open && hasContent && (
        <div style={{ padding: '6px 10px 8px 16px', borderTop: '1px solid var(--border-subtle)' }}>
          {/* Image assignment (if image input node) */}
          {node.isImageInput && (
            <div style={{ marginBottom: nonImageParams.length > 0 ? 8 : 0 }}>
              {!assignment ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>image</span>
                  <div className="v2-pill active" style={{ fontSize: 10, cursor: 'pointer' }} onClick={onAssign}>
                    <Icons.Image size={10} /> {t('cui.assign')}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>({t('cui.not_assigned')})</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>image</span>
                  <div className="v2-pill" style={{ fontSize: 10, cursor: 'pointer' }} onClick={onReplace}>
                    <Icons.RefreshCw size={9} /> {t('cui.replace')}
                  </div>
                  {assignment.thumbnail && (
                    <div style={{ width: 28, height: 28, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                      <img src={assignment.thumbnail} style={{ width: 28, height: 28, objectFit: 'cover', display: 'block' }} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9, color: 'var(--text2)' }}>{assignment.sourceName}</div>
                  </div>
                  <div className="v2-pill red" style={{ fontSize: 9, cursor: 'pointer', padding: '2px 5px' }} onClick={onRemove}>
                    {t('cui.remove')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Non-image params */}
          {nonImageParams.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {nonImageParams.map(p => {
                const key = `${p.nodeId}:${p.paramName}`;
                return (
                  <V2EditableParamRow key={key} param={p} value={paramValues[key]} onChange={(v) => onParamChange(key, v)} />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
