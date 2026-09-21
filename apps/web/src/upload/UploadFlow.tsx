/**
 * UploadFlow — the staged upload-review component. The composition root
 * supplies the locale provider, the ports (real `ingestPorts()` adapters plus
 * the contract `profileTable` once packages/normalize lands) and an
 * `onComplete` handler that hands the committed `UploadOutcome` downstream.
 *
 * Each stage renders on one plate carrying its spine label: `01 UPLOAD` for
 * the drop/parse stages, `02 CHECKS` for configure and review.
 */
import { Dialog } from "@rowfolio/ui";
import { Button } from "@rowfolio/ui";
import { useEffect } from "react";
import type { I18n } from "@rowfolio/i18n";
import { takePendingPickerFile } from "../landing/pendingUpload.ts";
import { useUploadController } from "./useUpload.ts";
import type { UploadOutcome, UploadPorts } from "./types.ts";
import { Dropzone } from "./Dropzone.tsx";
import { WorkingStatus } from "./WorkingStatus.tsx";
import { ConfigurePanel } from "./ConfigurePanel.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import { ErrorSurface } from "./ErrorSurface.tsx";
import { Plate } from "../workspace/Plate.tsx";
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

  // A file the session-level upload path could not resolve alone (e.g. an
  // ambiguous CSV delimiter) is stashed for this surface — claim it on
  // mount so its configure/picker stage mounts instead of a dead banner.
  useEffect(() => {
    const pending = takePendingPickerFile();
    if (pending !== null) controller.acceptFile(pending.bytes, pending.name);
  }, [controller]);

  const uploadPlate = { index: "01", name: i18n.t("plate.upload"), title: i18n.t("upload.title") };

  return (
    <div className="rf-upload" data-testid={testId ?? "upload-flow"}>
      {state.stage === "idle" || state.stage === "confirm-replace" ? (
        <Plate {...uploadPlate}>
          <Dropzone
            i18n={i18n}
            hasPrior={state.prior !== null}
            onFile={(bytes, name) => controller.acceptFile(bytes, name)}
          />
        </Plate>
      ) : null}

      {state.stage === "inspecting" || state.stage === "parsing" ? (
        <Plate {...uploadPlate}>
          <WorkingStatus
            i18n={i18n}
            file={state.file}
            progress={state.progress}
            onCancel={() => controller.cancel()}
          />
        </Plate>
      ) : null}

      {state.stage === "configure" ? (
        <Plate index="02" name={i18n.t("plate.checks")} title={i18n.t("upload.range")}>
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
        </Plate>
      ) : null}

      {state.stage === "review" ? (
        <Plate index="02" name={i18n.t("plate.checks")} title={i18n.t("quality.preview")}>
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
        </Plate>
      ) : null}

      {state.stage === "error" ? (
        <Plate {...uploadPlate}>
          <ErrorSurface
            i18n={i18n}
            failure={state.failure}
            hasPrior={state.prior !== null}
            onRetry={() => controller.retry()}
            onDismiss={() => controller.cancel()}
          />
        </Plate>
      ) : null}

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
