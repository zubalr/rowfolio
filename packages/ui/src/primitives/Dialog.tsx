/**
 * Dialog — the modal primitive.
 *
 * Built on the native <dialog> element: showModal() supplies inert background
 * and Escape handling; this component adds initial focus on the heading,
 * contained Tab navigation, focus restoration to the trigger, and page scroll
 * isolation — the behaviour 16_ACCESSIBILITY_SPEC.md requires of every modal
 * surface (including the evidence drawer, which is a modal at all
 * breakpoints).
 *
 * `surface="ink"` applies the dark evidence treatment; `placement="drawer"`
 * anchors to the logical end edge (520–620px spec'd, 560px token) and becomes
 * a full-height sheet under 768px.
 */
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { cx } from "../cx.ts";
import { Button } from "./Button.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  /** Called when the user requests close (Escape, close button, cancel). */
  onClose: () => void;
  /** Dialog title — receives initial focus. */
  title: string;
  /** Optional quiet description under the title (aria-describedby). */
  description?: string;
  /** Accessible name of the close control — required localized string. */
  closeLabel: string;
  /** Light surface (default) or the dark evidence treatment. */
  surface?: "paper" | "ink";
  /** Centered panel (default) or end-anchored evidence drawer. */
  placement?: "center" | "drawer";
  /** Footer row, typically action Buttons. */
  footer?: ReactNode;
  /** Stable test hook — only where needed. */
  testId?: string;
  children?: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  surface = "paper",
  placement = "center",
  footer,
  testId,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      document.body.style.overflow = "hidden";
      // Initial focus lands on the heading, per the accessibility spec.
      titleRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleClose = () => {
      document.body.style.overflow = "";
      onClose();
      restoreRef.current?.focus();
      restoreRef.current = null;
    };
    const handleCancel = (event: Event) => {
      // Keep a single close path: prevent native close so `close` fires once.
      event.preventDefault();
      el.close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === el,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || active === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("close", handleClose);
    el.addEventListener("cancel", handleCancel);
    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("close", handleClose);
      el.removeEventListener("cancel", handleCancel);
      el.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={cx(
        "rf-dialog",
        placement === "drawer" && "rf-dialog--drawer",
      )}
      data-rf-surface={surface === "ink" ? "ink" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      data-testid={testId}
    >
      <div className="rf-dialog__inner">
        <div className="rf-dialog__head">
          <div>
            <h2 className="rf-dialog__title" id={titleId} ref={titleRef} tabIndex={-1}>
              {title}
            </h2>
            {description ? (
              <p className="rf-dialog__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="secondary"
            icon="close"
            label={closeLabel}
            onClick={() => dialogRef.current?.close()}
            className="rf-dialog__close"
          />
        </div>
        <div className="rf-dialog__body">{children}</div>
        {footer ? <div className="rf-dialog__foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}
