/**
 * Error surface — typed, localized failure with retry and preserved-session
 * honesty. `error.<CODE>` copy comes from the contract catalog; the stable
 * diagnostic detail is rendered as a machine token, never source content.
 */
import { Button, Icon, Status } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { UploadFailure } from "./types.ts";

export interface ErrorSurfaceProps {
  i18n: I18n;
  failure: UploadFailure;
  hasPrior: boolean;
  onRetry(): void;
  onDismiss(): void;
}

export function ErrorSurface({ i18n, failure, hasPrior, onRetry, onDismiss }: ErrorSurfaceProps) {
  return (
    <div data-testid="upload-error">
      <Status
        kind="error"
        title={i18n.errorText(failure.code)}
        actions={
          <>
            {failure.recoverable ? (
              <Button variant="secondary" onClick={onRetry} data-testid="upload-error-retry">
                {i18n.t("action.retry")}
              </Button>
            ) : null}
            <button type="button" className="rf-linkbtn" onClick={onDismiss} data-testid="upload-error-dismiss">
              {i18n.t("action.back")}
            </button>
          </>
        }
      >
        <span className="rf-upload__meta">
          {i18n.t("upload.types")}
          {" · "}
          <code className="rf-upload__code" data-testid="upload-error-detail">
            {failure.detail}
          </code>
        </span>
      </Status>
      {hasPrior ? (
        <p className="rf-upload__prior" data-testid="upload-prior-note">
          <Icon name="check" />
          {i18n.t("upload.previousRetained")}
        </p>
      ) : null}
    </div>
  );
}
