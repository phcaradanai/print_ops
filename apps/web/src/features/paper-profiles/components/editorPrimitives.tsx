import { useId, useState, type CSSProperties, type ReactNode } from 'react';

export function getIconButtonAriaLabel(label: string, disabled: boolean, disabledReason?: string): string {
  return disabled && disabledReason ? `${label}: ${disabledReason}` : label;
}

export function getIconButtonTooltipText(label: string, disabled: boolean, disabledReason?: string): string {
  return disabled ? disabledReason || label : label;
}

export function isIconButtonActionBlocked(disabled: boolean): boolean {
  return disabled;
}

// ── Inline styles ──────────────────────────────────────────────────
export const s = {
  label: { display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', fontWeight: 600, color: '#374151' } as CSSProperties,
  input: { width: '100%', maxWidth: 420, padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem' } as CSSProperties,
  smallInput: { width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, font: 'inherit', fontSize: '0.8rem' } as CSSProperties,
  sel: { width: '100%', maxWidth: 420, padding: '0.45rem 0.55rem', border: '1px solid #d1d5db', borderRadius: 6, font: 'inherit', fontSize: '0.85rem', background: '#fff' } as CSSProperties,
  btn: { padding: '0.5rem 1rem', border: 0, borderRadius: 6, background: '#1e1e2e', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' } as CSSProperties,
  btnSmall: { padding: '0.3rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem' } as CSSProperties,
  btnDanger: { padding: '0.3rem 0.6rem', border: '1px solid #f38ba8', borderRadius: 4, background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '0.75rem' } as CSSProperties,
  section: { borderBottom: '1px solid #e5e7eb', padding: '0' } as CSSProperties,
};

// ── Collapsible Section ────────────────────────────────────────────
export function Section({ title, defaultOpen, children, icon, open, onToggle }: {
  title: string; defaultOpen?: boolean; children: ReactNode; icon?: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen !== false);
  const isOpen = open !== undefined ? open : internalOpen;
  const handleToggle = () => { if (onToggle) onToggle(); else setInternalOpen(!isOpen); };
  return (
    <div className="pp-section" style={{ ...s.section, marginBottom: 0 }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="pp-section__toggle"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.75rem', border: 0, background: 'transparent',
          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#1e1e2e',
          textTransform: 'uppercase', letterSpacing: '0.03em',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: '0.75rem', color: '#6b7280' }}>▶</span>
        {icon && <span style={{ fontSize: '0.85rem' }}>{icon}</span>}
        {title}
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: '0.75rem' }}>{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="pp-section__body" style={{ padding: '0 0.75rem 0.75rem' }}>{children}</div>}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  disabledReason,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const tooltipId = useId();
  const ariaLabel = getIconButtonAriaLabel(label, disabled, disabledReason);
  const tipText = getIconButtonTooltipText(label, disabled, disabledReason);
  const handleClick = () => {
    if (isIconButtonActionBlocked(disabled)) return;
    onClick();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
    }
  };
  return (
    <div
      className="pp-icon-btn-wrapper"
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        className={'pp-icon-btn' + (active ? ' pp-icon-btn--active' : '')}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        aria-describedby={tooltipId}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={disabled ? { pointerEvents: 'none' } : undefined}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pp-icon-btn-tooltip"
      >
        {tipText}
      </span>
    </div>
  );
}

// ── Color Picker ───────────────────────────────────────────────────
export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <label className="pp-label" style={{ marginBottom: 0, whiteSpace: 'nowrap', minWidth: 60 }}>{label}</label>
      <input className="pp-color" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input className="pp-input pp-input--sm pp-input--mono" style={{ width: 88 }} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Ruler wrapper around the paper preview ─────────────────────────
