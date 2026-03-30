import * as Icons from '../components/Icons';
import { useSpinner } from '../hooks/useAnimations';
import { useComfyUIWorkflow, type ImageAssignment, type ParamValues } from '../hooks/useComfyUIWorkflow';
import ImageTransferSection from './ImageTransferSection';
import type { ExposedParam } from '@ai-retouch/shared';
import { t } from '../i18n/setup';
import { useState } from 'react';

// ─── Theme constants ────────────────────────────────

const T = {
  bg: 'var(--bg-base)',
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  text4: '#AEAEB2',
  accent: 'var(--accent)',
  accentSoft: 'var(--pill-active-bg)',
  green: 'var(--green)',
  greenSoft: 'rgba(52,199,89,0.12)',
  orange: 'var(--orange)',
  red: 'var(--red)',
  redSoft: 'rgba(255,59,48,0.10)',
  purple: 'var(--accent2)',
  border: 'var(--border)',
  borderSubtle: 'var(--pill-bg)',
  glass: 'var(--glass)',
  glassHover: 'var(--glass-hover)',
  glassActive: 'var(--glass-active)',
  glass2: 'var(--glass-hover)',
};

const glass: React.CSSProperties = {
  background: T.glass,
  borderRadius: 10,
  border: `1px solid ${T.border}`,
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: T.glass,
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
  padding: '3px 8px',
};

const pillActive: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: T.accentSoft,
  border: '1px solid var(--pill-active-border)',
  color: T.accent,
  cursor: 'pointer',
  padding: '3px 8px',
};

// ─── Sub-components ─────────────────────────────────

function Spinner({ size = 12 }: { size?: number }) {
  const ch = useSpinner();
  return <span style={{ fontSize: size, fontFamily: 'monospace', letterSpacing: 1 }}>{ch}</span>;
}

// ─── Main Component ──────────────────────────────────

interface Props {
  documentPath?: string | null;
}

export default function ComfyUITab({ documentPath }: Props) {
  const wf = useComfyUIWorkflow({ documentPath: documentPath ?? null });

  const connColor = wf.connected ? T.green : wf.status?.state === 'error' ? T.red : T.text3;
  const connLabel = wf.connected ? t('cui.connected')
    : wf.status?.state === 'error' ? t('cui.disconnected') : '未知';

  const nodeColors = [T.green, T.orange, T.purple, T.accent, '#FF375F', T.red];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', background: T.bg }}>
      {/* 1. Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
        <span style={{ marginRight: 8, display: 'flex' }}><Icons.Dot color={connColor} /></span>
        <span style={{ color: connColor, fontWeight: 500, marginRight: 8 }}>{connLabel}</span>
        <span style={{ color: T.text3, flex: 1 }}>{wf.status?.address ?? '...'}</span>
        <div onClick={wf.handleTestConnection} style={{ ...pill, fontSize: 10 }}>
          <span style={{ marginRight: 4, display: 'flex' }}><Icons.RefreshCw size={10} /></span>
          {t('cui.test')}
        </div>
      </div>

      {/* Not connected hint */}
      {!wf.connected && (
        <div style={{ ...glass, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: T.text3 }}>
            {t('cui.not_connected')}。请确保 ComfyUI 已运行并点击上方「{t('cui.test')}」。
          </div>
        </div>
      )}

      {wf.connected && (
        <>
          {/* 2. Workflow selector */}
          <div style={{ ...glass, padding: 12, marginBottom: 10 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              letterSpacing: 0.5,
            }}>
              <span>📂 {t('cui.workflows')}</span>
              <div onClick={wf.refreshRemote} style={{ ...pill, fontSize: 10 }}>
                <span style={{ marginRight: 4, display: 'flex' }}><Icons.RefreshCw size={10} /></span>
                {t('cui.refresh')}
              </div>
            </div>

            {wf.remoteLoading && (
              <div style={{ fontSize: 11, color: T.text3, padding: 8, textAlign: 'center' }}>
                <Spinner size={12} /> {t('cui.loading')}
              </div>
            )}

            {wf.remoteError && (
              <div style={{ fontSize: 11, color: T.orange, padding: 8, textAlign: 'center' }}>
                {wf.remoteError}
              </div>
            )}

            {!wf.remoteLoading && !wf.remoteError && (
              <select
                value={wf.selectedPath ?? ''}
                onChange={(e) => {
                  if (e.target.value) wf.handleSelectFromDropdown(e.target.value);
                }}
                style={{
                  width: '100%', fontSize: 12, padding: '6px 10px',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                <option value="">
                  {wf.remoteFiles.length === 0
                    ? t('cui.empty')
                    : t('cui.select_workflow')}
                </option>
                {wf.remoteFiles.map((entry) => (
                  <option key={entry.path} value={entry.path}>{entry.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Parse loading / error */}
          {wf.parsing && (
            <div style={{ ...glass, padding: 14, textAlign: 'center', fontSize: 11, color: T.text3, marginBottom: 10 }}>
              <Spinner size={12} /> Parsing workflow…
            </div>
          )}

          {wf.parseError && (
            <div style={{ ...glass, padding: 14, textAlign: 'center', fontSize: 11, color: T.red, marginBottom: 10 }}>
              {wf.parseError}
            </div>
          )}

          {/* 3. IMAGE TRANSFER section */}
          {wf.workflowReady && (
            <ImageTransferSection
              psSources={wf.psSources}
              selectedSourceId={wf.selectedSourceId}
              onSelectSource={wf.setSelectedSourceId}
              cuiOutputs={wf.cuiOutputs}
              selectedOutputIdx={wf.selectedOutputIdx}
              onSelectOutput={wf.setSelectedOutputIdx}
              onRefreshOutputs={wf.handleRefreshOutputs}
              refreshingOutputs={wf.refreshingOutputs}
              onApplyToCanvas={wf.handleApplyToCanvas}
              onSaveToLibrary={wf.handleSaveToLibrary}
              applyingImage={wf.applyingImage}
              appliedImages={wf.appliedImages}
            />
          )}

          {/* Hint toast */}
          {wf.hintMessage && (
            <div style={{
              ...glass, padding: '8px 14px', marginBottom: 10,
              fontSize: 11, color: T.orange, textAlign: 'center',
              border: '1px solid rgba(255,149,0,0.25)',
              background: 'rgba(255,149,0,0.08)',
            }}>
              {wf.hintMessage}
            </div>
          )}

          {/* 4. WORKFLOW NODES section */}
          {wf.workflowReady && wf.parsed && (
            <div style={{ ...glass, padding: 12, marginBottom: 10, border: `1px solid ${T.border}` }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: T.text2,
                marginBottom: 12, letterSpacing: 0.5,
              }}>
                📂 {t('cui.exposed_nodes')}
              </div>

              {/* LoadImage nodes */}
              {wf.parsed.imageInputNodes.map((node, idx) => (
                <LoadImageNode
                  key={node.nodeId}
                  nodeId={node.nodeId}
                  nodeTitle={node.title}
                  nodeType={node.nodeType}
                  color={nodeColors[idx % nodeColors.length]}
                  assignment={wf.imageAssignments[node.nodeId] ?? null}
                  onAssign={() => wf.handleAssignImage(node.nodeId)}
                  onReplace={() => wf.handleAssignImage(node.nodeId)}
                  onRemove={() => wf.handleRemoveAssignment(node.nodeId)}
                />
              ))}

              {wf.nonImageParams.length === 0 && wf.parsed.imageInputNodes.length === 0 && (
                <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: 16 }}>
                  This workflow has no exposed parameters or image inputs.
                </div>
              )}

              {Array.from(wf.paramsByNode.entries()).map(([nodeId, params], idx) => (
                <NodeParamGroup
                  key={nodeId}
                  nodeId={nodeId}
                  nodeType={params[0].nodeType}
                  nodeTitle={params[0].nodeTitle}
                  color={nodeColors[(wf.parsed!.imageInputNodes.length + idx) % nodeColors.length]}
                  params={params}
                  paramValues={wf.paramValues}
                  onParamChange={wf.handleParamChange}
                />
              ))}
            </div>
          )}

          {/* 5. Action buttons bar */}
          {wf.workflowReady && (
            <div style={{ display: 'flex', flexDirection: 'row', marginBottom: 10 }}>
              <div
                className="btn-press"
                onClick={!wf.executing && !wf.pollingResult && wf.hasAssignedImages ? wf.handleSendImagesOnly : undefined}
                style={{
                  flex: 1, marginRight: 6, padding: '10px 0', borderRadius: 10,
                  textAlign: 'center',
                  background: (!wf.hasAssignedImages || wf.executing || wf.pollingResult)
                    ? T.glass2 : 'var(--pill-active-bg)',
                  color: (!wf.hasAssignedImages || wf.executing || wf.pollingResult)
                    ? T.text3 : T.accent,
                  fontWeight: 600, fontSize: 12,
                  cursor: (!wf.hasAssignedImages || wf.executing || wf.pollingResult) ? 'default' : 'pointer',
                  border: (!wf.hasAssignedImages || wf.executing || wf.pollingResult)
                    ? `1px solid ${T.border}` : '1px solid rgba(0,122,255,0.35)',
                  opacity: (!wf.hasAssignedImages || wf.executing || wf.pollingResult) ? 0.6 : 1,
                }}
              >
                📤 {t('cui.send_images_only')}
              </div>

              <div
                className="btn-press"
                onClick={!wf.executing && !wf.pollingResult ? wf.handleSendAndExecute : undefined}
                style={{
                  flex: 1, marginLeft: 6, padding: '10px 0', borderRadius: 10,
                  textAlign: 'center',
                  background: (wf.executing || wf.pollingResult) ? T.glass2 : T.accent,
                  color: (wf.executing || wf.pollingResult) ? T.text3 : '#fff',
                  fontWeight: 600, fontSize: 12,
                  cursor: (wf.executing || wf.pollingResult) ? 'default' : 'pointer',
                  border: (wf.executing || wf.pollingResult)
                    ? `1px solid ${T.border}` : '1px solid rgba(0,122,255,0.5)',
                  letterSpacing: 0.5,
                  opacity: (wf.executing || wf.pollingResult) ? 0.7 : 1,
                }}
              >
                {wf.executing
                  ? <><Spinner size={12} />{'  '}{wf.executeStatus ?? t('cui.executing')}</>
                  : `▶  ${t('cui.send_and_execute')}`}
              </div>
            </div>
          )}

          {/* No images hint */}
          {wf.workflowReady && wf.parsed && wf.parsed.imageInputNodes.length > 0 && !wf.hasAssignedImages && (
            <div style={{ fontSize: 10, color: T.orange, textAlign: 'center', marginBottom: 6, opacity: 0.8 }}>
              ⚠ No images assigned to input nodes — you can still execute without images
            </div>
          )}

          {/* Status messages */}
          {wf.executeError && (
            <div style={{ fontSize: 10, color: T.red, textAlign: 'center', marginBottom: 6 }}>
              {wf.executeError}
            </div>
          )}
          {wf.executeResult && (
            <div style={{ fontSize: 10, color: T.green, textAlign: 'center', marginBottom: 6 }}>
              {wf.executeResult}
            </div>
          )}

          {/* 6. Execution progress */}
          {wf.pollingResult && (
            <div style={{ ...glass, padding: 12, marginBottom: 10 }}>
              {wf.progressInfo ? (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', fontSize: 11,
                    color: T.text2, marginBottom: 8,
                  }}>
                    <Spinner size={11} />
                    <span style={{
                      marginLeft: 6, flex: 1, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {wf.executingNode || t('cui.executing')}
                    </span>
                    <span style={{
                      fontSize: 10, color: T.text3,
                      fontFamily: 'monospace', flexShrink: 0,
                    }}>
                      {wf.progressInfo.value}/{wf.progressInfo.max}
                    </span>
                  </div>
                  <div style={{
                    height: 4, borderRadius: 2,
                    background: T.glass2, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      background: `linear-gradient(90deg, ${T.accent}, ${T.green})`,
                      width: `${wf.progressInfo.percentage}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    marginTop: 4, fontSize: 10, color: T.text3,
                  }}>
                    <span>{wf.progressInfo.percentage}%</span>
                    {wf.currentPromptId && (
                      <span
                        onClick={wf.handleCancelExecution}
                        style={{ color: T.red, cursor: 'pointer' }}
                      >
                        {t('cui.cancel')}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', fontSize: 11, color: T.text3 }}>
                  <Spinner size={12} />{'  '}{wf.executeStatus || t('cui.waiting_result')}
                </div>
              )}
            </div>
          )}

          {/* Queue status */}
          {wf.queueRemaining > 0 && !wf.pollingResult && (
            <div style={{ fontSize: 10, color: T.text3, textAlign: 'center', marginBottom: 6 }}>
              Queue: {wf.queueRemaining} remaining
            </div>
          )}

          {wf.resultError && !wf.pollingResult && (
            <div style={{ ...glass, padding: 14, textAlign: 'center', fontSize: 11, color: T.orange, marginBottom: 10 }}>
              {wf.resultError}
              <div
                onClick={() => { wf.setResultError(null); }}
                style={{ ...pill, fontSize: 10, marginTop: 8, display: 'inline-flex', cursor: 'pointer' }}
              >
                OK
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── LoadImage Assignment Node ───────────────────────

function LoadImageNode({
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
      marginBottom: 8, borderRadius: 8, border: `1px solid ${T.border}`,
      overflow: 'hidden', background: T.glass,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 10px',
        borderLeft: `3px solid ${color}`,
        background: T.glass,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color, opacity: 0.7, fontFamily: 'monospace',
          background: `${color}18`, padding: '1px 5px', borderRadius: 4, marginRight: 8,
        }}>#{nodeId}</span>
        <span style={{ fontSize: 11, color: T.text2, fontWeight: 500, flex: 1 }}>
          {nodeTitle}
        </span>
        <span style={{
          fontSize: 9, color: T.text3, fontFamily: 'monospace',
          background: T.glass2, padding: '1px 5px', borderRadius: 4,
        }}>{nodeType}</span>
      </div>

      <div style={{
        padding: '8px 10px 10px 16px',
        borderTop: `1px solid ${T.border}`,
      }}>
        {!assignment ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: T.text3, marginRight: 8 }}>image</span>
            <div
              onClick={onAssign}
              style={{
                ...pill, fontSize: 10, cursor: 'pointer',
                background: T.accentSoft,
                border: '1px solid var(--pill-active-border)',
                color: T.accent,
              }}
            >
              📷 {t('cui.assign')}
            </div>
            <span style={{ fontSize: 10, color: T.text3, marginLeft: 8 }}>
              ({t('cui.not_assigned')})
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: T.text3, marginRight: 8 }}>image</span>
            <div
              onClick={onReplace}
              style={{ ...pill, fontSize: 10, cursor: 'pointer', marginRight: 8 }}
            >
              🔄 {t('cui.replace')}
            </div>
            {assignment.thumbnail && (
              <div style={{
                width: 36, height: 36, borderRadius: 6, overflow: 'hidden',
                border: `1px solid ${T.border}`, marginRight: 8, flexShrink: 0,
              }}>
                <img src={assignment.thumbnail} style={{
                  width: 36, height: 36, objectFit: 'cover', display: 'block',
                }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.text2 }}>{assignment.sourceName}</div>
              <div style={{ fontSize: 9, color: T.text3 }}>
                {assignment.width}×{assignment.height}
              </div>
            </div>
            <div
              onClick={onRemove}
              style={{
                ...pill, fontSize: 10, cursor: 'pointer',
                background: T.redSoft,
                border: '1px solid rgba(255,59,48,0.25)',
                color: T.red, padding: '3px 6px',
              }}
            >
              {t('cui.remove')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NodeParamGroup ──────────────────────────────────

function NodeParamGroup({
  nodeId, nodeType, nodeTitle, color, params, paramValues, onParamChange,
}: {
  nodeId: string; nodeType: string; nodeTitle: string; color: string;
  params: ExposedParam[]; paramValues: ParamValues;
  onParamChange: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div style={{
      marginBottom: 8, borderRadius: 8, border: `1px solid ${T.border}`,
      overflow: 'hidden', background: open ? T.glass : 'transparent',
    }}>
      <div onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center',
        padding: '7px 10px', cursor: 'pointer',
        borderLeft: `3px solid ${color}`,
        background: open ? T.glass : 'transparent',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color, opacity: 0.7, fontFamily: 'monospace',
          background: `${color}18`, padding: '1px 5px', borderRadius: 4,
          marginRight: 8,
        }}>#{nodeId}</span>
        <span style={{ fontSize: 11, color: T.text2, fontWeight: 500, flex: 1 }}>{nodeTitle}</span>
        <span style={{
          fontSize: 9, color: T.text3, fontFamily: 'monospace',
          background: T.glass2, padding: '1px 5px', borderRadius: 4,
          marginRight: 8,
        }}>{nodeType}</span>
        <span style={{ color: T.text3, display: 'flex' }}>
          {open ? <Icons.ChevronUp size={12} /> : <Icons.ChevronDown size={12} />}
        </span>
      </div>

      {open && (
        <div style={{
          padding: '8px 10px 10px 16px', borderTop: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
        }}>
          {params.map((p, i) => {
            const key = `${p.nodeId}:${p.paramName}`;
            return (
              <div key={key} style={{ marginBottom: i < params.length - 1 ? 8 : 0 }}>
                <EditableParamRow param={p} value={paramValues[key]} onChange={(v) => onParamChange(key, v)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Editable parameter row ──────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, color: T.text3, width: 70, flexShrink: 0, marginRight: 8,
};

function EditableParamRow({ param, value, onChange }: {
  param: ExposedParam; value: unknown; onChange: (v: unknown) => void;
}) {
  switch (param.type) {
    case 'enum':
      return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={LABEL_STYLE}>{param.displayName}</span>
          <select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 8, cursor: 'pointer' }}
          >
            {(param.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );
    case 'int':
    case 'float':
      return <NumericParamRow param={param} value={value} onChange={onChange} />;
    case 'string':
      return (
        <div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>{param.displayName}</div>
          <textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            style={{
              width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 8,
              resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
              height: 70,
            }}
          />
        </div>
      );
    case 'boolean':
      return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={LABEL_STYLE}>{param.displayName}</span>
          <div onClick={() => onChange(!value)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {value ? <Icons.ToggleRight color={T.green} /> : <Icons.ToggleLeft color={T.text3} />}
          </div>
        </div>
      );
    default:
      return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={LABEL_STYLE}>{param.displayName}</span>
          <input
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 8 }}
          />
        </div>
      );
  }
}

// ─── Numeric param with slider + input ───────────────

function NumericParamRow({ param, value, onChange }: {
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
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: T.text3, width: 70, flexShrink: 0, marginRight: 8 }}>
          {param.displayName}
        </span>
        <input
          value={String(numValue)}
          onChange={handleInput}
          style={{ flex: 1, fontSize: 12, padding: '4px 10px', borderRadius: 8 }}
        />
        <div
          onClick={() => onChange(Math.floor(Math.random() * 999999999))}
          style={{ ...pill, fontSize: 9, padding: '3px 6px', cursor: 'pointer', marginLeft: 8 }}
          title={t('cui.random_seed')}
        >🎲</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: T.text3, width: 70, flexShrink: 0, marginRight: 8 }}>
        {param.displayName}
      </span>
      <div style={{ flex: 1, position: 'relative', height: 16, display: 'flex', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={clampedMax}
          step={step}
          value={numValue}
          onChange={handleSlider}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>
      <input
        value={isInt ? String(numValue) : numValue.toFixed(2)}
        onChange={handleInput}
        style={{ width: 48, fontSize: 11, padding: '2px 4px', borderRadius: 6, textAlign: 'right', marginLeft: 8 }}
      />
    </div>
  );
}
