/**
 * Dropzone — a real `<input type="file">` (keyboard/screen-reader operable)
 * plus pointer drag/drop. The privacy promise and supported limits are stated
 * on the surface, before any file is chosen.
 */
import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { Button, Icon, cx } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { POLICY } from "@rowfolio/contracts";

export interface DropzoneProps {
  i18n: I18n;
  onFile(bytes: ArrayBuffer, name: string): void;
  /** Show "previous valid session retained" note (a committed outcome exists). */
  hasPrior: boolean;
  disabled?: boolean;
}

const ACCEPT = ".csv,.xlsx";

export function Dropzone({ i18n, onFile, hasPrior, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const offer = (file: File | undefined) => {
    if (!file || disabled) return;
    void file.arrayBuffer().then((bytes) => onFile(bytes, file.name));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    offer(event.dataTransfer.files[0]);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    offer(event.target.files?.[0]);
    // Allow picking the same file again (retry) — clear the selection.
    event.target.value = "";
  };

  const limits = POLICY.limits;
  return (
    <div className="rf-upload__intro">
      <div
        className={cx("rf-upload__drop", dragging && "rf-upload__drop--active")}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="upload-dropzone"
      >
        <label className="rf-upload__drop-label">
          <span className="rf-upload__drop-icon" aria-hidden="true">
            <Icon name="upload" size={20} />
          </span>
          {i18n.t("upload.drop")}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="rf-visually-hidden"
            onChange={onChange}
            disabled={disabled}
            data-testid="upload-input"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          {i18n.t("action.upload")}
        </Button>
      </div>
      <p className="rf-upload__meta" data-testid="upload-limits">
        {i18n.t("upload.types")}
      </p>
      {/* Limit labels are schema-vocabulary tokens in mono; numerals are
          formatted in the active numbering system. */}
      <ul className="rf-upload__limits">
        <li>
          <bdi dir="ltr" className="rf-mono">
            bytes
          </bdi>
          <bdi dir="ltr" className="rf-mono">
            ≤ {i18n.formatInteger(limits.compressedBytes / 1048576)} MiB
          </bdi>
        </li>
        <li>
          <bdi dir="ltr" className="rf-mono">
            rows
          </bdi>
          <bdi dir="ltr" className="rf-mono">
            ≤ {i18n.formatInteger(limits.rowsIncludingHeader)}
          </bdi>
        </li>
        <li>
          <bdi dir="ltr" className="rf-mono">
            columns
          </bdi>
          <bdi dir="ltr" className="rf-mono">
            ≤ {i18n.formatInteger(limits.columns)}
          </bdi>
        </li>
      </ul>
      <p className="rf-upload__note">{i18n.t("privacy.short")}</p>
      {hasPrior ? (
        <p className="rf-upload__prior" data-testid="upload-prior-note">
          <Icon name="check" />
          {i18n.t("upload.previousRetained")}
        </p>
      ) : null}
    </div>
  );
}
