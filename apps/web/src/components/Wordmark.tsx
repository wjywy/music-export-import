import { Link } from 'react-router-dom';

export function FerryMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 18.7c3.2 3 7 4.5 11.5 4.5s8.3-1.5 11.5-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 5.6v11.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16.5 7.4 23 12.2h-6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 10.6 10.7 13.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="渡口 · 首页">
      <FerryMark />
      <span className="brand-cn">渡口</span>
      <span className="brand-en">Dukou</span>
    </Link>
  );
}
