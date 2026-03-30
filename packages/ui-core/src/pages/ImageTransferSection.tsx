import * as Icons from '../components/Icons';
import { useSpinner } from '../hooks/useAnimations';
import { t } from '../i18n/setup';

const THUMB_SIZE = 64;

// ─── Theme constants ────────────────────────────────

const T = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  orange: 'var(--orange)',
  border: 'var(--border)',
  glass: 'var(--glass)',
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
  background: 'var(--glass)',
  border: `1px solid ${T.border}`,
  cursor: 'pointer',
  padding: '3px 8px',
};

// ─── Exported types ──────────────────────────────────

export interface PsImageSource {
  id: string;
  name: string;
  thumbnail: string | null;
  width: number;
  height: number;
}

export interface CuiOutput {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
  nodeId: string;
}

// ─── Latent space suggestion ─────────────────────────

const LATENT_SIZES = [
  { w: 1024, h: 1024, ratio: '1:1' },
  { w: 1152, h: 896, ratio: '9:7' },
  { w: 896, h: 1152, ratio: '7:9' },
  { w: 1216, h: 832, ratio: '3:2' },
  { w: 832, h: 1216, ratio: '2:3' },
  { w: 1344, h: 768, ratio: '16:9' },
  { w: 768, h: 1344, ratio: '9:16' },
  { w: 1024, h: 768, ratio: '4:3' },
  { w: 768, h: 1024, ratio: '3:4' },
];

export function suggestLatentSize(w: number, h: number): { w: number; h: number; ratio: string } {
  if (w <= 0 || h <= 0) return LATENT_SIZES[0];
  const aspect = w / h;
  let best = LATENT_SIZES[0];
  let bestDiff = Infinity;
  for (const s of LATENT_SIZES) {
    const diff = Math.abs(s.w / s.h - aspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

// ─── Internal helpers ────────────────────────────────

function Spinner({ size = 12 }: { size?: number }) {
  const ch = useSpinner();
  return <span style={{ fontSize: size, fontFamily: 'monospace', letterSpacing: 1 }}>{ch}</span>;
}

function ThumbCard({
  source, selected, onClick,
}: {
  source: PsImageSource; selected: boolean; onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, cursor: 'pointer',
      flexShrink: 0, marginRight: 8, overflow: 'hidden', position: 'relative',
      border: selected ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
      background: T.glass2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {source.thumbnail ? (
        <img src={source.thumbnail} style={{
          width: THUMB_SIZE, height: THUMB_SIZE, objectFit: 'cover', display: 'block',
        }} />
      ) : (
        <Icons.Image size={20} color={T.text3} />
      )}
      {selected && (
        <div style={{
          position: 'absolute', bottom: 2, right: 2,
          width: 14, height: 14, borderRadius: 7,
          background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        {source.name}
      </div>
    </div>
  );
}

function OutputThumbCard({
  url, selected, onClick, label,
}: {
  url: string; selected: boolean; onClick: () => void; label?: string;
}) {
  return (
    <div onClick={onClick} style={{
      width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8, cursor: 'pointer',
      flexShrink: 0, marginRight: 8, overflow: 'hidden', position: 'relative',
      border: selected ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
      background: T.glass2,
    }}>
      <img src={url} style={{
        width: THUMB_SIZE, height: THUMB_SIZE, objectFit: 'cover', display: 'block',
      }} />
      {label && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.6)', fontSize: 8,
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

// ─── Main Component ──────────────────────────────────

interface Props {
  psSources: PsImageSource[];
  selectedSourceId: string | null;
  onSelectSource: (id: string) => void;
  cuiOutputs: CuiOutput[];
  selectedOutputIdx: number | null;
  onSelectOutput: (idx: number) => void;
  onRefreshOutputs: () => void;
  refreshingOutputs: boolean;
  onApplyToCanvas: (output: CuiOutput) => void;
  onSaveToLibrary?: (output: CuiOutput) => void;
  applyingImage: string | null;
  appliedImages: Set<string>;
}

export default function ImageTransferSection({
  psSources, selectedSourceId, onSelectSource,
  cuiOutputs, selectedOutputIdx, onSelectOutput,
  onRefreshOutputs, refreshingOutputs,
  onApplyToCanvas, onSaveToLibrary, applyingImage, appliedImages,
}: Props) {
  const selectedSource = psSources.find((s) => s.id === selectedSourceId);
  const selectedOutput = selectedOutputIdx != null ? cuiOutputs[selectedOutputIdx] : null;
  const latent = selectedSource && selectedSource.width > 0
    ? suggestLatentSize(selectedSource.width, selectedSource.height)
    : null;

  return (
    <div style={{ ...glass, padding: 14, marginBottom: 10 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: T.text2,
        marginBottom: 10, letterSpacing: 0.5,
      }}>
        📡 {t('cui.image_transfer')}
      </div>

      {/* ── PS → CUI ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: T.text3, fontWeight: 600, marginBottom: 6 }}>
          {t('cui.ps_to_cui')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', paddingBottom: 6 }}>
          {psSources.map((source) => (
            <ThumbCard
              key={source.id}
              source={source}
              selected={selectedSourceId === source.id}
              onClick={() => onSelectSource(source.id)}
            />
          ))}
          <div style={{
            width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8,
            border: `1px dashed ${T.border}`, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}>
            <Icons.Plus size={16} color={T.text3} />
          </div>
        </div>

        {selectedSource && selectedSource.width > 0 && (
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
            <div>
              {t('img_transfer.selected')}: {selectedSource.name} ({selectedSource.width}×{selectedSource.height})
            </div>
            {latent && (
              <div>
                {t('img_transfer.suggested_latent')}: {latent.w}×{latent.h} ({latent.ratio})
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: `1px dashed ${T.border}`, marginBottom: 10 }} />

      {/* ── CUI → PS ── */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 6,
        }}>
          <span style={{ fontSize: 11, color: T.text3, fontWeight: 600 }}>
            {t('cui.cui_to_ps')}
          </span>
          <div onClick={onRefreshOutputs} style={{ ...pill, fontSize: 10 }}>
            {refreshingOutputs ? (
              <Spinner size={10} />
            ) : (
              <span style={{ marginRight: 4, display: 'flex' }}><Icons.RefreshCw size={10} /></span>
            )}
            {t('cui.refresh_outputs')}
          </div>
        </div>

        {cuiOutputs.length > 0 ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', paddingBottom: 6 }}>
              {cuiOutputs.map((output, idx) => (
                <OutputThumbCard
                  key={`${output.nodeId}-${output.filename}`}
                  url={output.url}
                  selected={selectedOutputIdx === idx}
                  onClick={() => onSelectOutput(idx)}
                  label={output.filename}
                />
              ))}
            </div>

            {selectedOutput && (
              <div style={{ display: 'flex', flexDirection: 'row', marginTop: 4 }}>
                <div
                  onClick={
                    !applyingImage && !appliedImages.has(selectedOutput.filename)
                      ? () => onApplyToCanvas(selectedOutput)
                      : undefined
                  }
                  style={{
                    ...pill, fontSize: 10, marginRight: 6,
                    background: appliedImages.has(selectedOutput.filename)
                      ? 'rgba(52,199,89,0.12)' : 'var(--pill-active-bg)',
                    border: appliedImages.has(selectedOutput.filename)
                      ? '1px solid rgba(52,199,89,0.25)' : '1px solid var(--pill-active-border)',
                    color: appliedImages.has(selectedOutput.filename)
                      ? T.green
                      : applyingImage === selectedOutput.filename ? T.text3 : T.accent,
                    cursor: applyingImage || appliedImages.has(selectedOutput.filename) ? 'default' : 'pointer',
                  }}
                >
                  {applyingImage === selectedOutput.filename ? (
                    <><Spinner size={9} /><span style={{ marginLeft: 4 }}>{t('cui.applying')}</span></>
                  ) : appliedImages.has(selectedOutput.filename) ? (
                    <>
                      <span style={{ marginRight: 4, display: 'flex' }}>
                        <Icons.Check size={10} color={T.green} />
                      </span>
                      {t('cui.applied')}
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: 4, display: 'flex' }}>
                        <Icons.Download size={10} color={T.accent} />
                      </span>
                      {t('cui.apply')}
                    </>
                  )}
                </div>
                <div
                  onClick={onSaveToLibrary && selectedOutput ? () => onSaveToLibrary(selectedOutput) : undefined}
                  style={{
                    ...pill, fontSize: 10,
                    cursor: onSaveToLibrary ? 'pointer' : 'default',
                    opacity: onSaveToLibrary ? 1 : 0.5,
                  }}
                >
                  <span style={{ marginRight: 4, display: 'flex' }}>
                    <Icons.Save size={10} />
                  </span>
                  {t('cui.save_to_library')}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: 12 }}>
            {refreshingOutputs
              ? <><Spinner size={11} /> {t('loading')}</>
              : t('cui.no_output')}
          </div>
        )}
      </div>
    </div>
  );
}
