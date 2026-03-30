import { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from './Icons';
import { getResultPreviewUrl } from '../api/results';
import { t } from '../i18n/setup';

interface Props {
  resultId: string;
  docPath?: string;
  sessionId?: string;
  onClose: () => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.15;

export default function ImagePreviewOverlay({ resultId, docPath, sessionId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [isFitted, setIsFitted] = useState(true);
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0, moved: false });

  useEffect(() => {
    setLoading(true);
    const url = getResultPreviewUrl(resultId, docPath, sessionId);
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setImgSrc(url);
      setLoading(false);
    };
    img.onerror = () => { setImgSrc(url); setLoading(false); };
    img.src = url;
  }, [resultId, docPath, sessionId]);

  useEffect(() => {
    if (!naturalSize) return;
    const vw = window.innerWidth - 48;
    const vh = window.innerHeight - 96;
    const fit = Math.min(1, vw / naturalSize.w, vh / naturalSize.h);
    setFitScale(fit);
    setScale(fit);
    setIsFitted(true);
  }, [naturalSize]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scrollCenterX = el.scrollLeft + mouseX;
    const scrollCenterY = el.scrollTop + mouseY;

    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));
      setIsFitted(false);
      const ratio = next / prev;
      requestAnimationFrame(() => {
        el.scrollLeft = scrollCenterX * ratio - mouseX;
        el.scrollTop = scrollCenterY * ratio - mouseY;
      });
      return next;
    });
  }, []);

  function handleFitToggle() {
    if (isFitted && naturalSize) {
      setScale(1);
      setIsFitted(false);
    } else {
      setScale(fitScale);
      setIsFitted(true);
    }
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;

    const isOverflow = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
    if (!isOverflow) return;

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollX: el.scrollLeft,
      scrollY: el.scrollTop,
      moved: false,
    };
    setDragging(true);
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    const el = containerRef.current;
    if (!el) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;

    el.scrollLeft = d.scrollX - dx;
    el.scrollTop = d.scrollY - dy;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    if (e.target === e.currentTarget || e.target === containerRef.current) {
      onClose();
    }
  }

  function handleImgClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    handleFitToggle();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setScale((s) => { setIsFitted(false); return Math.min(MAX_SCALE, s + ZOOM_STEP); });
      if (e.key === '-') setScale((s) => { setIsFitted(false); return Math.max(MIN_SCALE, s - ZOOM_STEP); });
      if (e.key === '0') { setScale(fitScale); setIsFitted(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitScale, onClose]);

  const displayW = naturalSize ? Math.round(naturalSize.w * scale) : 0;
  const displayH = naturalSize ? Math.round(naturalSize.h * scale) : 0;
  const pct = Math.round(scale * 100);
  const canPan = containerRef.current
    ? (containerRef.current.scrollWidth > containerRef.current.clientWidth ||
       containerRef.current.scrollHeight > containerRef.current.clientHeight)
    : false;

  return (
    <div
      className="overlay-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column',
        zIndex: 1000,
      }}
    >
      <div style={{
        position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4, zIndex: 1002,
      }}>
        <OverlayBtn onClick={() => { setIsFitted(false); setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP)); }}
          icon={<Icons.Plus color="#fff" size={14} />} />
        <OverlayBtn onClick={handleFitToggle}
          icon={<span style={{ color: '#fff', fontSize: 10, fontWeight: 600, minWidth: 32, textAlign: 'center' }}>{pct}%</span>} />
        <OverlayBtn onClick={() => { setIsFitted(false); setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP)); }}
          icon={<Icons.Minus color="#fff" size={14} />} />
        <div style={{ width: 8 }} />
        <OverlayBtn onClick={onClose} icon={<Icons.X color="#fff" size={16} />} />
      </div>

      <div
        ref={containerRef}
        onClick={handleBackdropClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          flex: 1, overflow: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
          cursor: dragging ? 'grabbing' : canPan ? 'grab' : 'default',
          userSelect: 'none',
        }}
      >
        {loading && (
          <span style={{ display: 'inline-flex', animation: 'spin 0.8s linear infinite' }}>
            <Icons.Loader color="var(--accent)" size={24} />
          </span>
        )}
        {!loading && imgSrc && (
          <img
            src={imgSrc}
            className="overlay-content"
            width={displayW}
            height={displayH}
            onClick={handleImgClick}
            draggable={false}
            style={{
              borderRadius: 4,
              objectFit: 'contain',
              flexShrink: 0,
              cursor: dragging ? 'grabbing' : canPan ? 'grab' : (isFitted ? 'zoom-in' : 'zoom-out'),
              transition: dragging ? 'none' : 'width 0.15s ease, height 0.15s ease',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
            }}
          />
        )}
        {!loading && !imgSrc && (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{t('drawer.empty')}</div>
        )}
      </div>

      {naturalSize && !loading && (
        <div style={{
          position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
          padding: '4px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.5)',
          color: 'rgba(255,255,255,0.7)', fontSize: 10, zIndex: 1002, whiteSpace: 'nowrap',
        }}>
          {naturalSize.w}×{naturalSize.h} · {pct}% · {t('chat.scroll_zoom')}
        </div>
      )}
    </div>
  );
}

function OverlayBtn({ onClick, icon }: { onClick: () => void; icon: React.ReactNode }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="btn-press"
      style={{
        padding: 6, borderRadius: 8, background: 'rgba(255,255,255,0.12)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(12px)',
      }}
    >
      {icon}
    </div>
  );
}
