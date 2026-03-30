import { useEffect, useRef } from 'react';
import { t } from '../i18n/setup';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel?: () => void; // If omitted → alert mode (confirm button only)
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        (onCancel ?? onConfirm)();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const isAlert = !onCancel;
  const isDanger = variant === 'danger';

  const confirmBtnBg = isDanger
    ? 'var(--red, #ff3b30)'
    : 'var(--accent, #007aff)';

  return (
    <div
      ref={overlayRef}
      className="overlay-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--modal-overlay-bg, rgba(0,0,0,0.4))',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === overlayRef.current) {
          (onCancel ?? onConfirm)();
        }
      }}
    >
      <div
        className="overlay-content"
        style={{
          background: 'var(--glass-active, rgba(255,255,255,0.9))',
          border: '1px solid var(--border, rgba(0,0,0,0.1))',
          borderRadius: 16,
          padding: '24px 28px',
          maxWidth: 340,
          width: '90%',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 20 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!isAlert && (
            <button
              onClick={onCancel}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text2)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {cancelLabel ?? t('cancel')}
            </button>
          )}
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: 'none',
              background: confirmBtnBg,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirmLabel ?? t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
