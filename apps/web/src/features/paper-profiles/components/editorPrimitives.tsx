import { useId, useState, type ReactNode } from 'react';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function getIconButtonAriaLabel(label: string, disabled: boolean, disabledReason?: string): string {
  return disabled && disabledReason ? `${label}: ${disabledReason}` : label;
}

export function getIconButtonTooltipText(label: string, disabled: boolean, disabledReason?: string): string {
  return disabled ? disabledReason || label : label;
}

export function isIconButtonActionBlocked(disabled: boolean): boolean {
  return disabled;
}

// ── Collapsible Section ────────────────────────────────────────────
export function Section({ title, defaultOpen, children, icon, open, onToggle }: {
  title: string; defaultOpen?: boolean; children: ReactNode; icon?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen !== false);
  const isOpen = open !== undefined ? open : internalOpen;
  const handleToggle = () => { if (onToggle) onToggle(); else setInternalOpen(!isOpen); };
  return (
    <div className="pp-section">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="pp-section__toggle"
      >
        <PaperProfileIcon name="chevron" className={`pp-section__chevron${isOpen ? ' is-open' : ''}`} />
        {icon && <span className="pp-section__icon">{icon}</span>}
        <span className="pp-section__title">{title}</span>
        <PaperProfileIcon name={isOpen ? 'minus' : 'plus'} className="pp-section__state-icon" />
      </button>
      {isOpen && <div className="pp-section__body">{children}</div>}
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
    >
      <button
        type="button"
        className={'pp-icon-btn' + (active ? ' pp-icon-btn--active' : '')}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        aria-describedby={tooltipId}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
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
    <div className="pp-color-field">
      <label className="pp-label pp-color-field__label">{label}</label>
      <input className="pp-color" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input className="pp-input pp-input--sm pp-input--mono pp-color-field__value" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Ruler wrapper around the paper preview ─────────────────────────
