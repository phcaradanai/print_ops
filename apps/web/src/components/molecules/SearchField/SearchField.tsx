import type { ReactNode } from 'react';
import { FormField } from '../../FormField.js';
import { Input, type InputProps } from '../../ui/inputs.js';
import './SearchField.css';

export interface SearchFieldProps extends Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange' | 'className'> {
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  requiredLabel?: string;
  className?: string;
  inputClassName?: string;
}

/** Labelled controlled search input with shared field wiring and no route knowledge. */
export function SearchField({
  label,
  value,
  onValueChange,
  hint,
  error,
  required = false,
  requiredLabel,
  invalid = false,
  className = '',
  inputClassName,
  ...inputProps
}: SearchFieldProps) {
  const isInvalid = invalid || Boolean(error);

  return (
    <div className={`ui-search-field${className ? ` ${className}` : ''}`}>
      <FormField
        label={label}
        hint={hint}
        error={error}
        required={required}
        requiredLabel={requiredLabel}
      >
        {(control) => (
          <Input
            {...inputProps}
            {...control}
            type="search"
            value={value}
            required={required}
            invalid={isInvalid}
            className={inputClassName}
            onChange={(event) => onValueChange(event.target.value)}
          />
        )}
      </FormField>
    </div>
  );
}
