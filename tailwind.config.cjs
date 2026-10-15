// Jetons de couleur = variables CSS définies dans src/styles.css (clair / sombre).
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { bg: c("bg"), panel: c("panel"), sunken: c("sunken"), line: c("line"), fg: c("fg"), ink: c("ink"), muted: c("muted"), accent: c("accent"), onaccent: c("onaccent"), pink: c("pink"), hi: c("hi"), ok: c("ok"), warn: c("warn"), bad: c("bad") },
    fontFamily: { sans: ["Instrument Sans", "ui-sans-serif", "system-ui", "sans-serif"], display: ["Bricolage Grotesque", "Instrument Sans", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    opacity: { 6: ".06", 8: ".08", 12: ".12", 15: ".15" },
  } },
};
