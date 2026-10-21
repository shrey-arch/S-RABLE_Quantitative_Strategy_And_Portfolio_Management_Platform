import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

/**
 * Label + control + hint/error, wired for screen readers.
 * The control is passed as a function so it receives the right id and aria attributes:
 *
 *   <FormField label="Email" error={errors.email}>
 *     {(field) => <Input {...field} type="email" />}
 *   </FormField>
 */
export interface FieldProps {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export function FormField(props: {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (field: FieldProps) => ReactNode;
}) {
  const id = useId();
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-2', props.className)}>
      <Label htmlFor={id}>
        {props.label}
        {props.required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
      </Label>
      {props.children({
        id,
        'aria-invalid': props.error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {props.hint && !props.error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      )}
    </div>
  );
}
