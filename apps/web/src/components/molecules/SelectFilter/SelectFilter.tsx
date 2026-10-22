import type { ReactNode } from 'react';
import { FormField } from '../../FormField.js';
import { Select, type SelectProps } from '../../ui/inputs.js';
import './SelectFilter.css';

export interface SelectFilterProps extends Omit<SelectProps, 'value' | 'defaultValue' | 'multiple' | 'onChange' | 'className'> {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  requiredLabel?: string;
  className?: string;
  selectClassName?: string;
  hideLabel?: boolean;
  children: ReactNode;
}

/** Labelled controlled single-select filter with no domain mapping. */
export function SelectFilter({
  label,
  value,
  onValueChange,
  hint,
  error,
  required = false,
  requiredLabel,
  invalid = false,
  className = '',
  selectClassName,
  hideLabel = true,
  children,
  ...selectProps
}: SelectFilterProps) {
  const isInvalid = invalid || Boolean(error);
  const labelText = typeof label === 'string' ? label : undefined;

  return (
    <div className={`ui-select-filter${className ? ` ${className}` : ''}`}>
      <FormField
        label={hideLabel ? <span className="ui-visually-hidden">{label}</span> : label}
        hint={hint}
        error={error}
        required={required}
        requiredLabel={requiredLabel}
      >
        {(control) => (
          <Select
            aria-label={labelText}
            {...selectProps}
            {...control}
            value={value}
            required={required}
            invalid={isInvalid}
            className={selectClassName}
            onChange={(event) => onValueChange(event.target.value)}
          >
            {children}
          </Select>
        )}
      </FormField>
    </div>
  );
}
