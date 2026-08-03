/**
 * Paper Profiles editor primitives.
 *
 * These were a parallel primitive layer — its own collapsible section, its own
 * icon button with a hand-rolled tooltip, its own colour field — built because
 * the shared system had no workspace vocabulary. It does now, so each of these
 * is an adapter that keeps this feature's call signature while the appearance
 * and behaviour come from `components/ui`. The pure helpers below stay: they
 * are the tested contract for how a blocked control explains itself.
 */

import type { ReactNode } from 'react';
import { CollapsibleSection, ColorField, IconButton as SharedIconButton } from '../../../components/ui/index.js';

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
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <CollapsibleSection
      className="pp-section"
      title={title}
      leading={icon}
      defaultOpen={defaultOpen !== false}
      open={open}
      onToggle={onToggle}
    >
      {children}
    </CollapsibleSection>
  );
}

// ── Icon button ────────────────────────────────────────────────────

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
  return (
    <SharedIconButton
      label={label}
      pressed={active}
      disabled={disabled}
      disabledReason={disabledReason}
      onClick={onClick}
    >
      {icon}
    </SharedIconButton>
  );
}

// ── Color Picker ───────────────────────────────────────────────────

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <ColorField label={label} value={value} onChange={onChange} swatchLabel={label} />;
}
