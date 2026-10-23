const paths: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chart: "M4 20h17 M7 16v-5 M12 16V4 M17 16V8",
  wallet: "M3 6h17v14H3z M3 6V4h14v2 M15 11h6v5h-6z",
  balance: "M12 3v18 M5 21h14 M4 7h16 M6 7l-4 7h8L6 7z M18 7l-4 7h8l-4-7z",
  swap: "M4 7h16l-4-4 M20 17H4l4 4",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8a3 3 0 0 1 0 6 M19 17a4 4 0 0 1 3 4",
  shop: "M3 10v10h18V10 M2 10l3-7h14l3 7 M8 20v-7h8v7 M2 10q3 4 6 0 4 4 8 0 3 4 6 0",
  book: "M3 3h6q3 0 3 3v15q-2-3-5-3H3z M21 3h-6q-3 0-3 3v15q2-3 5-3h4z",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6",
  download: "M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4",
  clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  down: "M6 9l6 6 6-6",
  bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4 M12 2v2",
  search: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6",
  calendar: "M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16",
  building: "M4 21V3h12v18 M16 9h5v12 M8 7h4 M8 11h4 M8 15h4",
  trend: "M3 17l6-6 4 4 8-11 M15 4h6v6",
  check: "M5 12l4 4L19 6",
  shield: "M12 2l9 4v7q-2 7-9 9-7-2-9-9V6z M8 12l3 3 5-6",
  info: "M12 10v7 M12 6v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  close: "M6 6l12 12 M18 6L6 18",
  plus: "M12 4v16 M4 12h16",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  logout: "M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4",
  file: "M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8",
  spark: "M12 3l2 6 7 3-7 3-2 6-2-6-7-3 7-3z",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2c-3 3-4 6-4 10s1 7 4 10 M12 2c3 3 4 6 4 10s-1 7-4 10",
  eye: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  "eye-off": "M3 3l18 18 M10 6.2A12 12 0 0 1 12 6c6.4 0 10 6 10 6a15 15 0 0 1-3.1 3.6 M6.2 7.7C3.5 9.4 2 12 2 12s3.6 6 10 6c1.4 0 2.7-.3 3.8-.8 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  refresh: "M20 7V2 M20 7h-5 M20 7A9 9 0 1 0 21 15",
};
export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
