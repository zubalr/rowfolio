/**
 * In-flight status: a named-stage loading surface (never a fabricated
 * percentage) with a working Cancel — per 05_MOTION_SPEC.md progress rules.
 */
import { Button, Status } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { UploadFileRef, UploadProgress } from "./types.ts";

export interface WorkingStatusProps {
  i18n: I18n;
  file: UploadFileRef;
  progress: UploadProgress | null;
  onCancel(): void;
}

export function WorkingStatus({ i18n, file, progress, onCancel }: WorkingStatusProps) {
  return (
    <Status
      kind="loading"
      title={i18n.t("a11y.processing")}
      testId="upload-working"
      actions={
        <Button variant="secondary" onClick={onCancel} data-testid="upload-cancel">
          {i18n.t("action.cancel")}
        </Button>
      }
    >
      <span className="rf-upload__meta">
        <bdi dir="auto">{file.name}</bdi>
        {progress ? (
          <>
            {" · "}
            <bdi dir="ltr" className="rf-mono" data-testid="upload-stage">
              {progress.stage}
            </bdi>
          </>
        ) : null}
      </span>
    </Status>
  );
}
