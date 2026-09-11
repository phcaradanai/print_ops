/**
 * Label + control + hint + error, wired together (FE-01.1).
 *
 * The existing forms wrap controls in a bare `<label>` or, worse, place the
 * label text next to an input with no association at all, and hint/error text
 * is a loose `<p>` no assistive technology connects to the field. `FormField`
 * generates the ids and wires `htmlFor`, `aria-describedby` and
 * `aria-invalid` so that cannot drift.
 *
 * The control is supplied via a render prop rather than cloned children, so the
 * caller keeps full control of its own input and simply spreads the ids.
 */

import { useId, type ReactNode } from 'react';

export interface FormFieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export interface FormFieldProps {
  label: ReactNode;
  /** Static help text, always shown. */
  hint?: ReactNode;
  /** Validation message. Its presence flips the control to `aria-invalid`. */
  error?: ReactNode;
  required?: boolean;
  requiredLabel?: string;
  children: (control: FormFieldControlProps) => ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required,
  requiredLabel,
  children,
}: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={'ui-field' + (error ? ' ui-field--invalid' : '')}>
      <label className="ui-field-label" htmlFor={id}>
        {label}
        {required && (
          <span className="ui-field-required" aria-label={requiredLabel}>
            {' *'}
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ui-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
