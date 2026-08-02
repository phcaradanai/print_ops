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
  className?: string;
  selectClassName?: string;
  children: ReactNode;
}

/** Labelled controlled single-select filter with no domain mapping. */
export function SelectFilter({
  label,
  value,
  onValueChange,
  hint,
  error,
  className = '',
  selectClassName,
  children,
  ...selectProps
}: SelectFilterProps) {
  return (
    <div className={`ui-select-filter${className ? ` ${className}` : ''}`}>
      <FormField label={label} hint={hint} error={error}>
        {(control) => (
          <Select
            {...selectProps}
            {...control}
            value={value}
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
