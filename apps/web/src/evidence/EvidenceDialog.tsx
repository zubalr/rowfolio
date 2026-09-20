/**
 * EvidenceDialog — the dark end-anchored evidence drawer.
 *
 * Modal chrome comes from `@rowfolio/ui` Dialog (`surface="ink"`,
 * `placement="drawer"`): native `<dialog>` semantics supply the inert
 * background and Escape close; the primitive adds focus trap, initial focus
 * on the heading, focus restoration to the trigger and scroll isolation.
 * Desktop renders a 560px end-anchored drawer; under 768px it becomes a
 * full-height sheet. Everything inside is `EvidencePanel`.
 */
import type { I18n } from "@rowfolio/i18n";
import { Dialog } from "@rowfolio/ui";
import { EvidencePanel } from "./EvidencePanel.tsx";
import type { EvidenceBundle, EvidenceServices } from "./types.ts";
import "./evidence.css";

export interface EvidenceDialogProps {
  /** When `open` is false the bundle may still change; the panel stays mounted while open. */
  open: boolean;
  onClose: () => void;
  bundle: EvidenceBundle;
  services: EvidenceServices;
  i18n: I18n;
  pageSize?: number;
  maxRows?: number;
}

export function EvidenceDialog({
  open,
  onClose,
  bundle,
  services,
  i18n,
  pageSize,
  maxRows,
}: EvidenceDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={i18n.t("evidence.title")}
      description={i18n.t("common.local")}
      closeLabel={i18n.t("a11y.closeEvidence")}
      surface="ink"
      placement="drawer"
      testId="evidence-dialog"
    >
      <EvidencePanel
        bundle={bundle}
        services={services}
        i18n={i18n}
        {...(pageSize !== undefined ? { pageSize } : {})}
        {...(maxRows !== undefined ? { maxRows } : {})}
      />
    </Dialog>
  );
}
