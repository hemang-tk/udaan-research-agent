/** Udaan mark — a paper plane "in flight" (udaan = flight) on the emerald tile.
 *  Same artwork as public/favicon.svg, so the tab icon and navbar match. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Udaan"
    >
      <defs>
        <linearGradient id="udaanNavG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#udaanNavG)" />
      <g transform="translate(4 4) rotate(-28 12 12)">
        <path d="M2.4 20.8 22.6 12 2.4 3.2 2.3 9.9 14.6 12 2.3 14.1z" fill="#042b20" />
      </g>
    </svg>
  );
}
