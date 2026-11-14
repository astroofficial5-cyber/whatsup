"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export default function Modal({
  title,
  onClose,
  children,
  wide,
  flush,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  flush?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className={`modal-body ${flush ? "flush" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
