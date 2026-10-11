"use client";

import { useEffect, useRef } from "react";

/**
 * A small modal dialog for the notebook page (rival picker, character cards): a dimmed backdrop
 * (a click on it closes), Escape closes, Tab stays inside, the page behind doesn't scroll, and focus
 * goes back to whatever opened it.
 */
export function Dialog({ label, onClose, className = "", testid, children }: { label: string; onClose: () => void; className?: string; testid?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const html = document.documentElement;
    const prev = { o: html.style.overflow, b: document.body.style.overflow };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("button:not([disabled])");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']") ?? []);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && (i === items.length - 1 || i === -1)) {
        e.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev.o;
      document.body.style.overflow = prev.b;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="dlg-backdrop"
      data-testid={testid ? `${testid}-backdrop` : undefined}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div className={`dlg ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={label} data-testid={testid}>
        <button type="button" className="dlg-x" aria-label="Close" data-testid={testid ? `${testid}-close` : undefined} onClick={() => close.current()}>
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
