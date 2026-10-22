import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
  </Glyph>
);

export const ArrowLeft = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" />
  </Glyph>
);

export const ArrowUpRight = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" />
  </Glyph>
);

export const Plus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 3v10M3 8h10" />
  </Glyph>
);

export const Download = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 3v7M5 7.5 8 10.5l3-3M3 12.5h10" />
  </Glyph>
);

export const Copy = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.2" />
    <path d="M10.5 5.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
  </Glyph>
);

export const Check = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M2.8 8.4 6.2 11.6 13.2 4.4" />
  </Glyph>
);

export const Close = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Glyph>
);

export const Trash = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1h5.8l.6-8.1M6.8 7v3.2M9.2 7v3.2" />
  </Glyph>
);

export const Search = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="7" cy="7" r="3.8" />
    <path d="m10 10 3 3" />
  </Glyph>
);

export const LogOut = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9.5 3H12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5M6.5 5.5 9 8l-2.5 2.5M9 8H2.5" />
  </Glyph>
);

export const Upload = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M8 10.5v-8M5 5.5 8 2.5l3 3M3 13h10" />
  </Glyph>
);

export const ShareIcon = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="4.2" r="1.9" />
    <circle cx="4" cy="8" r="1.9" />
    <circle cx="12" cy="11.8" r="1.9" />
    <path d="m5.7 7.1 4.6-2M5.7 8.9l4.6 2" />
  </Glyph>
);

export const LinkIcon = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6.5 9.5a2.8 2.8 0 0 1 0-4l1.6-1.6a2.8 2.8 0 0 1 4 4l-.9.9M9.5 6.5a2.8 2.8 0 0 1 0 4l-1.6 1.6a2.8 2.8 0 0 1-4-4l.9-.9" />
  </Glyph>
);

export const Music = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 12.2V4.2l7-1.4v8" />
    <circle cx="4.4" cy="12.2" r="1.8" />
    <circle cx="11.4" cy="10.8" r="1.8" />
  </Glyph>
);

export const Alert = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.6M8 11.1v.1" />
  </Glyph>
);

export const Refresh = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v3.5H9.5" />
  </Glyph>
);
