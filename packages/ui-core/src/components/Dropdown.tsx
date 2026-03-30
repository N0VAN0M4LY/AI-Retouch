import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import * as Icons from './Icons';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  width?: number;
  accent?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxVisible?: number;
  renderAction?: (option: DropdownOption) => ReactNode;
}

export default function Dropdown({
  value, options, onChange, width = 180, accent = false, disabled = false,
  placeholder, maxVisible = 5.5, renderAction,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; dropUp: boolean }>({ top: 0, left: 0, width: 0, dropUp: false });

  const itemHeight = 28;
  const menuMaxHeight = maxVisible * itemHeight;

  const updateMenuPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuH = Math.min(options.length * itemHeight, menuMaxHeight);
    const gap = 2;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const dropUp = spaceBelow < menuH && rect.top - gap > spaceBelow;
    setMenuPos({
      top: dropUp ? rect.top - gap - menuH : rect.bottom + gap,
      left: rect.left,
      width: rect.width + (renderAction ? 28 : 0),
      dropUp,
    });
  }, [renderAction, options.length, menuMaxHeight, itemHeight]);

  useLayoutEffect(() => {
    if (open) updateMenuPos();
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll() { updateMenuPos(); }
    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, updateMenuPos]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? '';

  const fillParent = !width;

  const menu = open && createPortal(
    <div ref={menuRef} className="dropdown-menu" style={{
      position: 'fixed', top: menuPos.top, left: menuPos.left,
      width: menuPos.width,
      background: 'var(--glass-active)', border: '1px solid var(--border)',
      borderRadius: 8, zIndex: 99999, maxHeight: menuMaxHeight,
      overflowY: 'auto',
      boxShadow: menuPos.dropUp ? '0 -4px 16px rgba(0,0,0,.35)' : '0 4px 16px rgba(0,0,0,.35)',
    }}>
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <div key={opt.value} style={{
            display: 'flex', alignItems: 'center', height: itemHeight, padding: '0 10px', fontSize: 11, cursor: 'pointer',
            color: isSelected ? 'var(--accent)' : 'var(--text2)',
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
          }}>
            <div onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opt.label}
            </div>
            {renderAction && <div style={{ marginLeft: 4, flexShrink: 0, display: 'flex' }}>{renderAction(opt)}</div>}
          </div>
        );
      })}
      {options.length === 0 && (
        <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>—</div>
      )}
    </div>,
    document.body,
  );

  return (
    <div style={{
      position: 'relative',
      display: fillParent ? 'flex' : 'inline-flex',
      flexShrink: fillParent ? 1 : 0,
      flex: fillParent ? 1 : undefined,
      minWidth: 0,
    }}>
      <div
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 10px', borderRadius: 8, fontSize: 11,
          width: fillParent ? '100%' : width,
          background: accent ? 'var(--accent-soft)' : 'var(--glass)',
          border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
          color: accent ? 'var(--accent)' : 'var(--text2)',
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{selectedLabel}</span>
        <span style={{ marginLeft: 4, display: 'flex', flexShrink: 0 }}>
          {open ? <Icons.ChevronUp color={accent ? 'var(--accent)' : 'var(--text3)'} size={12} /> : <Icons.ChevronDown color={accent ? 'var(--accent)' : 'var(--text3)'} size={12} />}
        </span>
      </div>
      {menu}
    </div>
  );
}
