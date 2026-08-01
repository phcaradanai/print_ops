import {
  forwardRef,
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
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  controlSize = 'md',
  invalid = false,
  leading,
  trailing,
  className,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) {
  const input = (
    <input
      {...props}
      ref={ref}
      className={controlClass('ui-input', controlSize, invalid, className)}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
    />
  );
  if (leading == null && trailing == null) return input;
  return (
    <span className={`ui-input-group${invalid ? ' ui-input-group--invalid' : ''}`}>
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
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({
  controlSize = 'md', invalid = false, resize = 'vertical', className, 'aria-invalid': ariaInvalid, ...props
}, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={controlClass('ui-textarea', controlSize, invalid, className)}
      data-resize={resize}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
    />
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({
  label, description, className = '', ...props
}, ref) {
  return (
    <label className={`ui-check${className ? ` ${className}` : ''}`}>
      <input {...props} ref={ref} type="checkbox" />
      <span className="ui-check__copy">
        <span className="ui-check__label">{label}</span>
        {description != null && <span className="ui-check__description">{description}</span>}
      </span>
    </label>
  );
});

