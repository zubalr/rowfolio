/**
 * In-flight status: a named-stage loading surface (never a fabricated
 * percentage) with a working Cancel — per 05_MOTION_SPEC.md progress rules.
 * Real worker fractions render when the engine reports them; otherwise the
 * stage name plus an honest elapsed clock is the only progress claim.
 */
import { useEffect, useState } from "react";
import { Status } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { UploadFileRef, UploadProgress } from "./types.ts";

export interface WorkingStatusProps {
  i18n: I18n;
  file: UploadFileRef;
  progress: UploadProgress | null;
  onCancel(): void;
}

export function WorkingStatus({ i18n, file, progress, onCancel }: WorkingStatusProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <Status
      kind="loading"
      title={i18n.t("a11y.processing")}
      testId="upload-working"
      actions={
        <button type="button" className="rf-linkbtn" onClick={onCancel} data-testid="upload-cancel">
          {i18n.t("action.cancel")}
        </button>
      }
    >
      <span className="rf-upload__meta">
        <bdi dir="auto">{file.name}</bdi>
        {progress ? (
          <>
            {" · "}
            <bdi dir="ltr" className="rf-mono" data-testid="upload-stage">
              {progress.stage}
              {progress.fraction !== null ? ` ${Math.round(progress.fraction * 100)}%` : ""}
            </bdi>
          </>
        ) : null}
        {" · "}
        <bdi dir="ltr" className="rf-mono" data-testid="upload-elapsed">
          {elapsed}s
        </bdi>
      </span>
    </Status>
  );
}
