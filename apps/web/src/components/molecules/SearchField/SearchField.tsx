import type { ReactNode } from 'react';
import { FormField } from '../../FormField.js';
import { Input, type InputProps } from '../../ui/inputs.js';
import './SearchField.css';

export interface SearchFieldProps extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'className'> {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  inputClassName?: string;
}

/** Labelled search input with shared field wiring and no route knowledge. */
export function SearchField({
  label,
  value,
  onValueChange,
  hint,
  error,
  className = '',
  inputClassName,
  ...inputProps
}: SearchFieldProps) {
  return (
    <div className={`ui-search-field${className ? ` ${className}` : ''}`}>
      <FormField label={label} hint={hint} error={error}>
        {(control) => (
          <Input
            {...inputProps}
            {...control}
            type="search"
            value={value}
            className={inputClassName}
            onChange={(event) => onValueChange(event.target.value)}
          />
        )}
      </FormField>
    </div>
  );
}
