"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../../features/i18n/provider";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      id="modal"
      ref={ref}
      aria-label={t(title)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{t(title)}</h2>
        <button
          type="button"
          data-action="close"
          aria-label={t("Жабу")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
