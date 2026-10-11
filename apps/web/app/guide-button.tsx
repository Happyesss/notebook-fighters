"use client";

/** the "?" button that opens the guide */
export function GuideButton({ onOpen, className = "", label = "How to play" }: { onOpen: () => void; className?: string; label?: string }) {
  return (
    <button type="button" className={`guide-btn ${className}`} data-testid="guide-open" aria-label="How to play" title="How to play" onClick={onOpen}>
      <span className="guide-q" aria-hidden="true">?</span>
      <span className="guide-btn-label">{label}</span>
    </button>
  );
}
