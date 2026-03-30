import { useCallback, useEffect, useState } from 'react';

import type { GenerationResult, ResultSourceType } from '@ai-retouch/shared';

import * as Icons from '../components/Icons';
import Tooltip from '../components/Tooltip';
import { getResults, getResultPreviewUrl, updateResult } from '../api/results';
import { smartApplyToPS } from '../api/bridge';
import { useDataRefresh } from '../hooks/useDataEvents';
import ImagePreviewOverlay from '../components/ImagePreviewOverlay';
import { t } from '../i18n/setup';
import { usePSConnected } from '../platform/usePSConnected';

type SourceFilter = ResultSourceType | 'all';

const PAGE_SIZE = 20;
const THUMB_SIZE = 88;

const T = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  orange: 'var(--orange)',
  red: 'var(--red)',
  border: 'var(--border)',
  glass: 'var(--glass)',
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'rgba(0,0,0,0.03)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
};

const pillActive: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--accent-soft)',
  border: '1px solid var(--pill-active-border)',
  color: 'var(--accent)',
  cursor: 'pointer',
};

interface LibraryTabProps {
  documentPath?: string | null;
}

export default function LibraryTab({ documentPath }: LibraryTabProps) {
  const bridgeConnected = usePSConnected();
  const [items, setItems] = useState<GenerationResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const selected = selectedId ? items.find((r) => r.id === selectedId) : null;

  const [refreshKey, setRefreshKey] = useState(0);

  const fetchPage = useCallback(
    async (p: number, append: boolean) => {
      if (!documentPath) return;
      setLoading(true);
      try {
        const res = await getResults({
          page: p,
          limit: PAGE_SIZE,
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          bookmarked: bookmarkedOnly || undefined,
          docPath: documentPath,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setPage(res.page);
        setTotalPages(res.totalPages);
      } catch (err) {
        console.error('[LibraryTab] Failed to fetch results:', err);
      } finally {
        setLoading(false);
      }
    },
    [sourceFilter, bookmarkedOnly, refreshKey, documentPath],
  );

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  function handleRefresh() {
    setSelectedId(null);
    fetchPage(1, false);
  }

  useEffect(() => {
    setSelectedId(null);
    fetchPage(1, false);
  }, [fetchPage]);

  const refreshFromEvent = useCallback(() => fetchPage(1, false), [fetchPage]);
  useDataRefresh('sessions', refreshFromEvent);
  useDataRefresh('results', refreshFromEvent);

  function handleLoadMore() {
    if (page < totalPages) fetchPage(page + 1, true);
  }

  function patchItem(id: string, patch: Partial<GenerationResult>) {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function handleApply(r: GenerationResult) {
    if (!bridgeConnected || !r.width || !r.height) return;
    setApplying(r.id);
    try {
      await smartApplyToPS({
        resultId: r.id,
        width: r.width,
        height: r.height,
        documentPath: documentPath ?? undefined,
        sessionId: r.sessionId ?? undefined,
      });
      patchItem(r.id, { appliedToCanvas: true });
    } catch {
      /* ignore */
    } finally {
      setApplying(null);
    }
  }

  async function handleBookmark(r: GenerationResult) {
    const newVal = !r.bookmarked;
    try {
      await updateResult(r.id, { bookmarked: newVal }, documentPath ?? undefined);
      patchItem(r.id, { bookmarked: newVal });
    } catch {
      /* ignore */
    }
  }

  const grouped = groupByDate(items);

  const filterLabels: Record<SourceFilter, string> = {
    all: t('lib.filter_all'),
    direct: t('lib.filter_direct'),
    agent: t('lib.filter_agent'),
    comfyui: t('lib.filter_comfyui'),
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          {(['all', 'direct', 'agent', 'comfyui'] as SourceFilter[]).map((f) => (
            <FilterChip
              key={f}
              label={filterLabels[f]}
              active={sourceFilter === f}
              onClick={() => setSourceFilter(f)}
            />
          ))}
          <div style={{ width: 1, height: 16, background: T.border, margin: '0 4px' }} />
          <FilterChip
            label={t('lib.bookmarked_only')}
            icon={<Icons.Star color={bookmarkedOnly ? T.orange : T.text3} size={10} />}
            active={bookmarkedOnly}
            onClick={() => setBookmarkedOnly(!bookmarkedOnly)}
          />
          <Tooltip text={t('refresh')}>
            <div
              onClick={loading ? undefined : handleRefresh}
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                padding: '3px 6px',
                borderRadius: 5,
                cursor: loading ? 'default' : 'pointer',
                background: T.glass,
                border: `1px solid ${T.border}`,
              }}
            >
              <Icons.Loader color={T.text3} size={10} />
            </div>
          </Tooltip>
          <span style={{ marginLeft: 6, fontSize: 10, color: T.text3 }}>
            {total}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: previewId ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
        {items.length === 0 && !loading && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.text3,
            fontSize: 13,
          }}>
            <Icons.Box color={T.text3} size={32} />
            <div style={{ marginTop: 8 }}>{t('lib.empty')}</div>
          </div>
        )}

        {items.length > 0 && (
          <div className={!loading ? 'anim-fade-in' : undefined}>
            {grouped.map((group) => (
              <div key={group.label} style={{ padding: '0 12px', flexShrink: 0 }}>
                <div style={{
                  fontSize: 11,
                  color: T.text3,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  padding: '10px 0 6px',
                }}>
                  {group.label === 'today' ? t('lib.today') : group.label === 'yesterday' ? t('lib.yesterday') : t('lib.earlier')}
                </div>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                }}>
                  {group.items.map((r) => (
                    <GridThumb
                      key={r.id}
                      result={r}
                      isSelected={selectedId === r.id}
                      onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                      onDoubleClick={() => setPreviewId(r.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {page < totalPages && (
          <div
            onClick={loading ? undefined : handleLoadMore}
            style={{
              textAlign: 'center',
              padding: '12px',
              fontSize: 11,
              color: T.accent,
              cursor: loading ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {loading ? t('loading') : t('lib.load_more')}
          </div>
        )}
        {items.length > 0 && page >= totalPages && (
          <div style={{
            textAlign: 'center',
            padding: '12px',
            fontSize: 10,
            color: T.text3,
            flexShrink: 0,
          }}>
            {t('lib.no_more')}
          </div>
        )}
      </div>

      {selected && (
        <div style={{
          borderTop: `1px solid ${T.border}`,
          padding: '10px 12px',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.03)',
        }}>
          <DetailPanel
            result={selected}
            onApply={() => handleApply(selected)}
            onBookmark={() => handleBookmark(selected)}
            onPreview={() => setPreviewId(selected.id)}
            applying={applying === selected.id}
          />
        </div>
      )}

      {previewId && (
        <ImagePreviewOverlay
          resultId={previewId}
          docPath={documentPath ?? undefined}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}

function GridThumb({
  result: r,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  result: GenerationResult;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const src = r.thumbnailData
    ? `data:image/jpeg;base64,${r.thumbnailData}`
    : getResultPreviewUrl(r.id);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'relative',
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        border: isSelected
          ? `2px solid ${T.accent}`
          : `1px solid ${T.border}`,
        background: '#000',
        marginRight: 6,
        marginBottom: 6,
        flexShrink: 0,
      }}
    >
      <img
        src={src}
        width={THUMB_SIZE}
        height={THUMB_SIZE}
        style={{
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          objectFit: 'cover',
          display: 'block',
        }}
      />
      <div style={{
        position: 'absolute',
        top: 3,
        right: 3,
        display: 'flex',
      }}>
        {r.appliedToCanvas && (
          <Badge color={T.green}><Icons.Check size={8} color="#fff" /></Badge>
        )}
        {r.bookmarked && (
          <Badge color={T.orange}><Icons.Star size={8} color="#fff" /></Badge>
        )}
      </div>
      <div style={{
        position: 'absolute',
        bottom: 2,
        left: 2,
        padding: '1px 4px',
        borderRadius: 3,
        background: 'rgba(0,0,0,0.6)',
        fontSize: 8,
        color: 'rgba(255,255,255,0.7)',
        textTransform: 'capitalize',
      }}>
        {r.sourceType === 'direct' ? t('lib.filter_direct') : r.sourceType === 'agent' ? t('lib.filter_agent') : r.sourceType === 'comfyui' ? t('lib.filter_comfyui') : r.sourceType}
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 14,
      height: 14,
      borderRadius: 7,
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    }}>
      {children}
    </div>
  );
}

function DetailPanel({
  result: r,
  onApply,
  onBookmark,
  onPreview,
  applying,
}: {
  result: GenerationResult;
  onApply: () => void;
  onBookmark: () => void;
  onPreview: () => void;
  applying: boolean;
}) {
  const bridgeConnected = usePSConnected();
  const ts = new Date(r.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div
          onClick={onPreview}
          style={{
            width: 48,
            height: 48,
            borderRadius: 6,
            overflow: 'hidden',
            cursor: 'pointer',
            border: `1px solid ${T.border}`,
            background: '#000',
            flexShrink: 0,
            marginRight: 6,
          }}
        >
          <img
            src={r.thumbnailData ? `data:image/jpeg;base64,${r.thumbnailData}` : getResultPreviewUrl(r.id)}
            width={48}
            height={48}
            style={{ width: 48, height: 48, objectFit: 'cover', display: 'block' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>
            {t('lib.source')}：<span style={{ color: T.text2 }}>{r.sourceType === 'direct' ? t('lib.filter_direct') : r.sourceType === 'agent' ? t('lib.filter_agent') : r.sourceType === 'comfyui' ? t('lib.filter_comfyui') : r.sourceType}</span>
            {r.modelRef && (
              <span> / {t('lib.model')}：<span style={{ color: T.text2 }}>{r.modelRef}</span></span>
            )}
          </div>
          <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>
            {t('lib.time')}：<span style={{ color: T.text2 }}>{timeStr}</span>
            {r.elapsedMs != null && (
              <span style={{ color: T.text3 }}> ({(r.elapsedMs / 1000).toFixed(1)}s)</span>
            )}
          </div>
          {r.width && r.height && (
            <div style={{ fontSize: 10, color: T.text3 }}>
              {t('lib.resolution')}：<span style={{ color: T.text2 }}>{r.width}×{r.height}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {bridgeConnected && (
          <ActionBtn
            className={applying ? undefined : 'btn-press'}
            onClick={onApply}
            disabled={applying}
            icon={<Icons.Download color={T.accent} size={11} />}
            label={applying ? '应用中...' : '应用'}
            accent
          />
        )}
        <ActionBtn
          className="btn-press"
          onClick={onBookmark}
          icon={<Icons.Star color={r.bookmarked ? T.orange : T.text2} size={11} />}
          label={r.bookmarked ? '已收藏' : '收藏'}
        />
        <ActionBtn
          onClick={onPreview}
          icon={<Icons.Eye color={T.text2} size={11} />}
          label="Preview"
        />
      </div>
    </div>
  );
}

function ActionBtn({
  onClick,
  icon,
  label,
  accent,
  disabled,
  className,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={className}
      style={{
        ...(accent ? pillActive : pill),
        padding: '4px 10px',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      <span style={{ marginRight: 4, display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}

function FilterChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        ...(active ? pillActive : pill),
        padding: '3px 8px',
        cursor: 'pointer',
        marginRight: 4,
        marginBottom: 2,
      }}
    >
      {icon && <span style={{ marginRight: 3, display: 'flex' }}>{icon}</span>}
      <span style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}

interface DateGroup {
  label: 'today' | 'yesterday' | 'earlier';
  items: GenerationResult[];
}

function groupByDate(items: GenerationResult[]): DateGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  const groups: Record<DateGroup['label'], GenerationResult[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const item of items) {
    if (item.createdAt >= todayStart) {
      groups.today.push(item);
    } else if (item.createdAt >= yesterdayStart) {
      groups.yesterday.push(item);
    } else {
      groups.earlier.push(item);
    }
  }

  return (['today', 'yesterday', 'earlier'] as DateGroup['label'][])
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ label: k, items: groups[k] }));
}
