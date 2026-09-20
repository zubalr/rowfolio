/**
 * UploadFlow — the staged upload-review component. The composition root
 * supplies the locale provider, the ports (real `ingestPorts()` adapters plus
 * the contract `profileTable` once packages/normalize lands) and an
 * `onComplete` handler that hands the committed `UploadOutcome` downstream.
 */
import { Dialog, Section } from "@rowfolio/ui";
import { Button } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { useUploadController } from "./useUpload.ts";
import type { UploadOutcome, UploadPorts } from "./types.ts";
import { Dropzone } from "./Dropzone.tsx";
import { WorkingStatus } from "./WorkingStatus.tsx";
import { ConfigurePanel } from "./ConfigurePanel.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import { ErrorSurface } from "./ErrorSurface.tsx";
import "./upload.css";

export interface UploadFlowProps {
  i18n: I18n;
  ports: UploadPorts;
  onComplete?: (outcome: UploadOutcome) => void;
  testId?: string;
}

export function UploadFlow({ i18n, ports, onComplete, testId }: UploadFlowProps) {
  const { controller, state } = useUploadController(ports, {
    ...(onComplete !== undefined ? { onComplete } : {}),
  });

  return (
    <div className="rf-upload" data-testid={testId ?? "upload-flow"}>
      <Section title={i18n.t("upload.title")} headingLevel={2}>
        {state.stage === "idle" || state.stage === "confirm-replace" ? (
          <Dropzone
            i18n={i18n}
            hasPrior={state.prior !== null}
            onFile={(bytes, name) => controller.acceptFile(bytes, name)}
          />
        ) : null}

        {state.stage === "inspecting" || state.stage === "parsing" ? (
          <WorkingStatus
            i18n={i18n}
            file={state.file}
            progress={state.progress}
            onCancel={() => controller.cancel()}
          />
        ) : null}

        {state.stage === "configure" ? (
          <ConfigurePanel
            i18n={i18n}
            inspection={state.inspection}
            selection={state.selection}
            needsDelimiter={state.needsDelimiter}
            optedHiddenSheets={state.optedHiddenSheets}
            progress={state.progress}
            onSelectSheet={(id) => controller.selectSheet(id)}
            onOptIntoHidden={(id) => controller.optIntoHiddenSheet(id)}
            onRevokeHidden={(id) => controller.revokeHiddenSheet(id)}
            onChooseDelimiter={(d) => controller.chooseDelimiter(d)}
            onSetHeaderRow={(row) => controller.setHeaderRow(row)}
            onProceed={() => controller.proceed()}
            onCancel={() => controller.cancel()}
          />
        ) : null}

        {state.stage === "review" ? (
          <ReviewPanel
            i18n={i18n}
            table={state.table}
            inspection={state.inspection}
            selection={state.selection}
            proposedColumns={state.proposedColumns}
            issues={state.issues}
            decisions={state.decisions}
            onToggleIssue={(id, approved) => controller.toggleIssue(id, approved)}
            onConfirmColumn={(id) => controller.confirmColumn(id)}
            onDowngradeColumn={(id) => controller.downgradeColumnToText(id)}
            onToggleCache={(id, on) => controller.toggleFormulaCache(id, on)}
            onBack={() => controller.editSelection()}
            onSubmit={() => controller.submit()}
          />
        ) : null}

        {state.stage === "error" ? (
          <ErrorSurface
            i18n={i18n}
            failure={state.failure}
            hasPrior={state.prior !== null}
            onRetry={() => controller.retry()}
            onDismiss={() => controller.cancel()}
          />
        ) : null}
      </Section>

      <Dialog
        open={state.stage === "confirm-replace"}
        onClose={() => controller.declineReplace()}
        title={i18n.t("upload.title")}
        description={i18n.t("upload.previousRetained")}
        closeLabel={i18n.t("action.close")}
        testId="upload-replace-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => controller.declineReplace()}>
              {i18n.t("action.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => controller.confirmReplace()}
              data-testid="replace-confirm"
            >
              {i18n.t("action.upload")}
            </Button>
          </>
        }
      />
    </div>
  );
}
