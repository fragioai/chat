export default function Logo() {
  return (
    <span className="logo" aria-label="Fragio">
      <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="var(--accent)" />
        <path d="M18 20h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H32l-9 8v-8h-5a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z" fill="#fff" />
        <path d="M26 27h14M26 34h9" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="logo-text">Fragio</span>
    </span>
  );
}
