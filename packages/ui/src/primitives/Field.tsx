/**
 * Field — a labelled input with help, error and unit affordances.
 *
 * The label is a real <label htmlFor>; help/error text is wired through
 * aria-describedby and errors set aria-invalid. An optional `unit` renders as
 * a direction-isolated island (units like "%" or "USD" stay LTR and are not
 * part of the editable value). Error indication is icon + text, never
 * color-only.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../cx.ts";
import { Icon } from "../icons.tsx";

export interface FieldProps {
  /** Visible label text (required — placeholders are not labels). */
  label: string;
  /** Optional supporting text rendered under the control. */
  help?: string;
  /** Error message; when present the field is invalid. */
  error?: string | undefined;
  /** Trailing unit island, e.g. "%" or "USD" — always LTR and labelled. */
  unit?: string;
  /** Required marker shown on the label and mirrored to the input. */
  required?: boolean;
  id?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-describedby" | "aria-invalid" | "required">;
  className?: string;
  children?: ReactNode;
}

export function Field({
  label,
  help,
  error,
  unit,
  required = false,
  id,
  inputProps,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const inputId = id ?? `rf-field-${autoId}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  return (
    <div className={cx("rf-field", error && "rf-field--invalid", className)}>
      <label className="rf-field__label" htmlFor={inputId}>
        {label}
        {required ? (
          <span className="rf-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className="rf-field__control">
        <input
          id={inputId}
          className="rf-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          required={required}
          {...inputProps}
        />
        {unit ? (
          <bdi dir="ltr" className="rf-field__unit">
            {unit}
          </bdi>
        ) : null}
      </div>
      {children}
      {help ? (
        <p className="rf-field__help" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="rf-field__error" id={errorId} role="alert">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
