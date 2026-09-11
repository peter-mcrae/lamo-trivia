/** Original outlined LAMO lettering, adapted from the existing LAMO Creator brand assets. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      src="/lamo-trivia-mark.svg"
      className={className}
      alt=""
      aria-hidden="true"
      width="740"
      height="730"
    />
  );
}

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`brand ${className}`} aria-label="LAMO Trivia">
      <img
        src="/lamo-wordmark.svg"
        className="brand-wordmark"
        alt=""
        aria-hidden="true"
        width="1357"
        height="350"
      />
      <span className="brand-product" aria-hidden="true">
        TRIVIA
      </span>
    </span>
  );
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="arrow-icon"
    >
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h16m-7-7 7 7-7 7"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Spark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m40 0 8 24 23-15-15 23 24 8-24 8 15 23-23-15-8 24-8-24L9 71l15-23L0 40l24-8L9 9l23 15Z" />
    </svg>
  );
}
