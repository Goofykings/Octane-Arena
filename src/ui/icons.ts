const paths: Record<string, string> = {
  helmet: "M4 13V9l4-6h8l4 6v11H4z M5 10h14v5H5 M8 18h8",
  robot: "M4 7h16v14H4z M12 7V2 M7 11h2m6 0h2 M8 17h8",
  comet:
    "M2 3l9 5M2 8l6 3M7 2l6 6 M17 9a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M16 12l-2 4h4",
  fox: "M3 3l9 5 9-5-2 14-7 5-7-5z M3 3l4 11 5 4 5-4 4-11 M7 12l3 2m7-2-3 2",
  smile: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M7 9h2m6 0h2 M7 14q5 6 10 0",
  prism: "M12 2l10 10-10 10L2 12z M12 2l4 10-4 10-4-10z M2 12h20",
  body: "M3 15l2-6 4-3h6l4 3 2 6v4h-3v-3H6v3H3z M6 11h12 M6 14h2m8 0h2",
  paint: "M4 14L14 4l6 6-10 10H4z M12 6l6 6 M4 14l6 6 M20 16v5",
  wheels: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 8v8m-4-4h8m-7-3 6 6m0-6-6 6",
  boost: "M13 2L5 13h6l-1 9 9-13h-6z",
  topper: "M3 17h18 M6 17l2-9h8l2 9 M8 12h8",
  decal: "M4 4h16v12l-4 4H4z M16 20v-4h4 M8 8h8m-8 4h5",
  explosion: "M12 2l2 6 7-3-4 6 5 3-7 1-1 7-4-6-7 3 4-7-5-3 7-1z",
  bot: "M5 8h14v12H5z M12 8V4m-2 0h4 M8 12h2m4 0h2 M8 16h8",
  freeplay: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9l6 0 2 5-5 3-5-3z",
  ranked: "M5 4h14v9l-7 8-7-8z M8 9l4-3 4 3m-8 4 4-3 4 3",
  extras: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M17 13v8m-4-4h8",
  rings: "M12 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M12 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M5 14a7 7 0 0 0 14 0 M8 17a4 4 0 0 0 8 0",
  friend:
    "M8 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M2 20v-5l3-3h6l3 3v5 M17 7a3 3 0 0 1 0 6m0 2h3l2 3v2",
  profile: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-4l4-3h8l4 3v4",
  lock: "M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v11H5z M12 14v3",
};
export const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
