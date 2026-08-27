import { StateIcon } from './status.js';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export type ControlSize = 'sm' | 'md';

function controlClass(base: string, size: ControlSize, invalid: boolean, className?: string) {
  return `${base} ${base}--${size}${invalid ? ` ${base}--invalid` : ''}${className ? ` ${className}` : ''}`;
}

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  requiredLabel?: string;
}

export function Label({ required, requiredLabel, className = '', children, ...props }: LabelProps) {
  return (
    <label {...props} className={`ui-label${className ? ` ${className}` : ''}`}>
      {children}
      {required && <span className="ui-label__required" aria-label={requiredLabel}>{' *'}</span>}
    </label>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  controlSize?: ControlSize;
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Monospace input for exact technical values such as NATS subjects and identifiers. */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  controlSize = 'md',
  invalid = false,
  leading,
  trailing,
  mono = false,
  className,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  const resolvedClassName = mono
    ? `ui-input--mono${className ? ` ${className}` : ''}`
    : className;
  const input = (
    <input
      {...props}
      ref={ref}
      className={controlClass('ui-input', controlSize, invalid, resolvedClassName)}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      spellCheck={props.spellCheck ?? (mono ? false : undefined)}
    />
  );
  if (leading == null && trailing == null) return input;
  return (
    <span
      className={`ui-input-group${invalid ? ' ui-input-group--invalid' : ''}`}
      onClick={(event) => {
        // Clicking anywhere in the framed group (padding, affix zones) must
        // focus the input so the field behaves like a single control.
        const inputEl = event.currentTarget.querySelector('input');
        if (event.target !== inputEl) inputEl?.focus();
      }}
    >
      {leading != null && <span className="ui-input-group__affix" aria-hidden="true">{leading}</span>}
      {input}
      {trailing != null && <span className="ui-input-group__affix ui-input-group__affix--end">{trailing}</span>}
    </span>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({
  controlSize = 'md', invalid = false, className, 'aria-invalid': ariaInvalid, children, ...props
}, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={controlClass('ui-select', controlSize, invalid, className)}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
    >
      {children}
    </select>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
  resize?: 'none' | 'vertical' | 'both';
  /** Monospace editing surface for JSON policies, payloads, and template source. */
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  controlSize = 'md', invalid = false, resize = 'vertical', mono = false, className, 'aria-invalid': ariaInvalid, ...props
}, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={controlClass('ui-textarea', controlSize, invalid, mono ? `ui-textarea--mono${className ? ` ${className}` : ''}` : className)}
      data-resize={resize}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      spellCheck={props.spellCheck ?? (mono ? false : undefined)}
    />
  );
});

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Reflected as `aria-pressed`, so the state is never carried by colour alone. */
  selected?: boolean;
  children: ReactNode;
}

export function Chip({ selected = false, className = '', children, type = 'button', ...props }: ChipProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-chip${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={selected}
    >
      {children}
    </button>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  hideLabel?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({
  label, description, hideLabel = false, className = '', ...props
}, ref) {
  return (
    <label className={`ui-check${hideLabel ? ' ui-check--bare' : ''}${className ? ` ${className}` : ''}`}>
      <input {...props} ref={ref} type="checkbox" />
      <span className={`ui-check__copy${hideLabel ? ' ui-visually-hidden' : ''}`}>
        <span className="ui-check__label">{label}</span>
        {description != null && <span className="ui-check__description">{description}</span>}
      </span>
    </label>
  );
});

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'defaultChecked'> {
  label: ReactNode;
  onLabel: ReactNode;
  offLabel: ReactNode;
  checked: boolean;
  description?: ReactNode;
  busy?: boolean;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({
  label,
  onLabel,
  offLabel,
  description,
  checked,
  busy = false,
  disabled = false,
  className = '',
  ...props
}, ref) {
  const state = checked ? 'on' : 'off';
  const blocked = disabled || busy;
  return (
    <label className={`ui-switch ui-switch--${state}${blocked ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <input
        {...props}
        ref={ref}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={blocked}
        aria-checked={checked}
        aria-busy={busy || undefined}
      />
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb"><StateIcon value={checked} /></span>
      </span>
      <span className="ui-switch__copy">
        <span className="ui-switch__label">{label}</span>
        <span className={`ui-switch__state ui-switch__state--${state}`}>
          {checked ? onLabel : offLabel}
        </span>
        {description != null && <span className="ui-switch__description">{description}</span>}
      </span>
    </label>
  );
});
