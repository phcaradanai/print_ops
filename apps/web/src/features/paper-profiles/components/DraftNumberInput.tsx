import { useEffect, useRef, useState } from 'react';
import { Input, type InputProps } from '../../../components/ui/index.js';

export interface DraftNumberInputProps extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'onBlur'> {
  value: number | undefined;
  onValueChange: (value: number) => void;
  /** Runs when editing ends. Use this for normalization that should not fight typing. */
  onCommit?: (value: number | undefined) => void;
  normalize?: (value: number) => number;
}

/**
 * Numeric input with a local string draft. Native number inputs expose an
 * empty string while a user replaces a value; keeping that string locally is
 * what prevents React from immediately restoring the previous number.
 */
export function DraftNumberInput({
  value,
  onValueChange,
  onCommit,
  normalize,
  ...props
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState(() => formatNumber(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(formatNumber(value));
  }, [value]);

  return (
    <Input
      {...props}
      type="number"
      value={editingRef.current ? draft : formatNumber(value)}
      onFocus={() => {
        editingRef.current = true;
        setDraft(formatNumber(value));
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const parsed = Number.parseFloat(nextDraft);
        if (Number.isFinite(parsed)) onValueChange(parsed);
      }}
      onBlur={() => {
        const parsed = Number.parseFloat(draft);
        const committed = Number.isFinite(parsed)
          ? normalize ? normalize(parsed) : parsed
          : undefined;
        if (committed !== undefined && Number.isFinite(committed)) {
          onValueChange(committed);
          onCommit?.(committed);
        } else {
          onCommit?.(undefined);
        }
        editingRef.current = false;
        setDraft(formatNumber(value));
      }}
    />
  );
}

function formatNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value);
}
