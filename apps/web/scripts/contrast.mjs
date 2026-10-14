/**
 * WCAG contrast checker for the Portus palette.
 *
 * Neon on near-black routinely fails AA for body text while looking fine to the
 * eye, so the palette is checked with numbers rather than judgement. Run this
 * after any theme change:
 *
 *   node apps/web/scripts/contrast.mjs
 *
 * Exits non-zero if any declared pairing misses its target.
 */
const AA_BODY = 4.5;
const AA_LARGE = 3.0;

const DARK = {
  bg: "#06080D",
  surface: "#0C1017",
  surface2: "#131A26",
  border: "#26314A",
  fg: "#E6EDF7",
  muted: "#9BA9C2",
  cyan: "#3DDCF5",
  magenta: "#FF7AD9",
  lime: "#B4F04A",
  amber: "#FFC24B",
  amberSurface: "#1C1408",
  rose: "#FF8FA3",
};

const LIGHT = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  surface2: "#F5F6FA",
  border: "#E6E8EF",
  fg: "#131722",
  muted: "#5E6578",
  cyan: "#0A7EA4",
  magenta: "#C2268F",
  lime: "#30680D",
  amber: "#9A6400",
  amberSurface: "#FFF8E6",
  rose: "#D1344F",
};

function srgbToLin(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function pairsFor(P) {
  return [
    ["body text on page", P.fg, P.bg, AA_BODY],
    ["body text on card", P.fg, P.surface, AA_BODY],
    ["muted text on page", P.muted, P.bg, AA_BODY],
    ["muted text on card", P.muted, P.surface, AA_BODY],
    ["muted text on raised", P.muted, P.surface2, AA_BODY],
    ["cyan accent text on page", P.cyan, P.bg, AA_BODY],
    ["cyan accent text on card", P.cyan, P.surface, AA_BODY],
    ["magenta accent on card", P.magenta, P.surface, AA_BODY],
    ["lime live-state on card", P.lime, P.surface, AA_BODY],
    ["amber warning on warn surface", P.amber, P.amberSurface, AA_BODY],
    ["amber warning on page", P.amber, P.bg, AA_BODY],
    ["rose danger on card", P.rose, P.surface, AA_BODY],
    ["border against page (non-text)", P.border, P.bg, 1.2],
  ];
}

let failures = 0;
for (const [name, palette] of [
  ["dark", DARK],
  ["light", LIGHT],
]) {
  console.log(`WCAG contrast — Portus ${name} palette\n`);
  for (const [label, fg, bg, min] of pairsFor(palette)) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)}:1  (min ${min})  ${label}  ${fg} on ${bg}`,
    );
  }
  console.log("");
}

console.log(
  failures === 0
    ? `All pairings meet target.`
    : `${failures} pairing(s) below target.`,
);
process.exit(failures === 0 ? 0 : 1);
