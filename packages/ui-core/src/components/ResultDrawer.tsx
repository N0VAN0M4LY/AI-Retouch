import { useCallback, useEffect, useState } from 'react';
import type { GenerationResult } from '@ai-retouch/shared';
import * as Icons from './Icons';
import Tooltip from './Tooltip';
import ImagePreviewOverlay from './ImagePreviewOverlay';
import { getResults, getResultPreviewUrl, updateResult } from '../api/results';
import { smartApplyToPS } from '../api/bridge';
import { t } from '../i18n/setup';
import { useDataRefresh, emitDataChange } from '../hooks/useDataEvents';
import { usePSConnected } from '../platform/usePSConnected';

const MINI_SIZE = 24;
const THUMB_SIZE = 52;

interface ResultDrawerProps {
  activeSessionId?: string | null;
  documentPath?: string | null;
}

export default function ResultDrawer({ activeSessionId, documentPath }: ResultDrawerProps) {
  const bridgeConnected = usePSConnected();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<GenerationResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const selected = selectedId ? items.find((r) => r.id === selectedId) : null;

  const fetchResults = useCallback(async () => {
    if (!activeSessionId) { setItems([]); setTotal(0); return; }
    try {
      const res = await getResults({ page: 1, limit: 20, sessionId: activeSessionId ?? undefined, docPath: documentPath ?? undefined });
      setItems(res.items); setTotal(res.total);
    } catch { /* ignore */ }
  }, [activeSessionId, documentPath]);

  useEffect(() => { fetchResults(); }, [fetchResults]);
  useDataRefresh('results', fetchResults);

  async function handleApply(r: GenerationResult) {
    if (!bridgeConnected || !r.width || !r.height) return;
    setApplying(true);
    try {
      await smartApplyToPS({
        resultId: r.id, width: r.width, height: r.height,
        sessionId: activeSessionId ?? undefined, documentPath: documentPath ?? undefined,
        requestConfig: r.requestConfig,
      });
      setItems((prev) => prev.map((it) => (it.id === r.id ? { ...it, appliedToCanvas: true } : it)));
    } catch { /* ignore */ } finally { setApplying(false); }
  }

  async function handleBookmark(r: GenerationResult) {
    const newVal = !r.bookmarked;
    try {
      await updateResult(r.id, { bookmarked: newVal }, documentPath ?? undefined, activeSessionId ?? undefined);
      setItems((prev) => prev.map((it) => (it.id === r.id ? { ...it, bookmarked: newVal } : it)));
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border)', background: 'var(--glass)', flexShrink: 0,
    }}>
      <Tooltip text={expanded ? t('drawer.collapse') : t('drawer.expand')} position="top">
        <div onClick={() => setExpanded(!expanded)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', cursor: 'pointer', flexShrink: 0, width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ marginRight: 6, display: 'flex' }}><Icons.Box color="var(--text-muted)" size={12} /></span>
            <span>{t('drawer.title')} ({total}{t('drawer.items')})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {!expanded && items.length > 0 && (
              <div style={{ display: 'flex', marginRight: 6 }}>
                {items.slice(0, 4).map((r) => (
                  <MiniThumb key={r.id} result={r} />
                ))}
              </div>
            )}
            <span
              onClick={(e) => { e.stopPropagation(); emitDataChange('results'); }}
              style={{ display: 'flex', cursor: 'pointer', marginRight: 4, padding: 2, borderRadius: 4 }}
              title={t('drawer.refresh') ?? 'Refresh'}
            >
              <Icons.RefreshCw color="var(--text-muted)" size={11} />
            </span>
            <span style={{ display: 'flex', color: 'var(--text-muted)' }}>
              <span style={{ transition: 'transform 0.25s ease', transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)' }}>
                <Icons.ChevronDown color="var(--text-muted)" size={12} />
              </span>
            </span>
          </div>
        </div>
      </Tooltip>
      <div className={expanded ? 'drawer-body expanded' : 'drawer-body collapsed'} style={{ padding: '0 12px 10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', overflowX: previewId ? 'hidden' : 'scroll', paddingBottom: 6, flexShrink: 0 }}>
            {items.map((r) => (
              <DrawerThumb key={r.id} result={r} isSelected={selectedId === r.id}
                onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                onDoubleClick={() => setPreviewId(r.id)} />
            ))}
            {items.length === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '12px 0' }}>{t('drawer.empty')}</div>}
          </div>
          {selected && (
            <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 2 }}>
              {bridgeConnected && (
                <DrawerBtn onClick={() => handleApply(selected)} disabled={applying}
                  icon={<Icons.Download color="#34C759" size={10} />} label={applying ? t('chat.applying') : t('chat.apply')} accent />
              )}
              <DrawerBtn onClick={() => handleBookmark(selected)}
                icon={<Icons.Star color={selected.bookmarked ? '#FF9500' : 'var(--text-muted)'} size={10} />}
                label={selected.bookmarked ? t('chat.bookmarked') : t('chat.bookmark')} />
              <DrawerBtn onClick={() => setPreviewId(selected.id)}
                icon={<Icons.Eye color="var(--text-secondary)" size={10} />} label={t('drawer.preview')} />
            </div>
          )}
      </div>
      {previewId && <ImagePreviewOverlay resultId={previewId} docPath={documentPath ?? undefined} sessionId={activeSessionId ?? undefined} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function MiniThumb({ result: r }: { result: GenerationResult }) {
  const src = r.thumbnailData ? `data:image/jpeg;base64,${r.thumbnailData}` : getResultPreviewUrl(r.id);
  return (
    <div style={{ width: MINI_SIZE, height: MINI_SIZE, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', background: '#000', marginLeft: 3, flexShrink: 0 }}>
      <img src={src} width={MINI_SIZE} height={MINI_SIZE} style={{ width: MINI_SIZE, height: MINI_SIZE, objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

function DrawerThumb({ result: r, isSelected, onClick, onDoubleClick }: { result: GenerationResult; isSelected: boolean; onClick: () => void; onDoubleClick: () => void }) {
  const src = r.thumbnailData ? `data:image/jpeg;base64,${r.thumbnailData}` : getResultPreviewUrl(r.id);
  return (
    <div onClick={onClick} onDoubleClick={onDoubleClick} style={{
      width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
      background: '#000', marginRight: 5, flexShrink: 0, position: 'relative',
    }}>
      <img src={src} width={THUMB_SIZE} height={THUMB_SIZE} style={{ width: THUMB_SIZE, height: THUMB_SIZE, objectFit: 'cover', display: 'block' }} />
      {(r.appliedToCanvas || r.bookmarked) && (
        <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex' }}>
          {r.appliedToCanvas && <Badge color="#34C759"><Icons.Check size={7} color="#fff" /></Badge>}
          {r.bookmarked && <Badge color="#FF9500"><Icons.Star size={7} color="#fff" /></Badge>}
        </div>
      )}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <div style={{ width: 12, height: 12, borderRadius: 6, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 1 }}>{children}</div>;
}

function DrawerBtn({ onClick, icon, label, accent, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; accent?: boolean; disabled?: boolean }) {
  return (
    <div onClick={disabled ? undefined : onClick} style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 6, fontSize: 10,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, marginRight: 5, marginBottom: 3,
      background: accent ? 'rgba(52,199,89,0.12)' : 'var(--bg-elevated)',
      border: `1px solid ${accent ? 'rgba(52,199,89,0.25)' : 'var(--border)'}`,
      color: accent ? '#34C759' : 'var(--text-secondary)',
    }}>
      <span style={{ marginRight: 3, display: 'flex' }}>{icon}</span>{label}
    </div>
  );
}
