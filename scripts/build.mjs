// Build de production : esbuild (TypeScript/React) + Tailwind CLI → dist/
// Variables : SUPABASE_URL, SUPABASE_ANON_KEY (clé publique), BASE_PATH (ex. /etudiant-os/), SITE_URL.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";

const dev = process.argv.includes("--dev");
const OUT = process.env.OUT_DIR ?? "dist";
const noEnv = process.argv.includes("--local-only");
// .env local facultatif (jamais commité)
if (!noEnv && existsSync(".env")) for (const l of readFileSync(".env", "utf8").split("\n")) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const BASE = process.env.BASE_PATH ?? (dev ? "/" : "/etudiant-os/");
const SITE = process.env.SITE_URL ?? (dev ? "http://127.0.0.1:5173/" : "https://fedizzz.github.io/etudiant-os/");
const url = noEnv ? "" : process.env.SUPABASE_URL ?? "", key = noEnv ? "" : process.env.SUPABASE_ANON_KEY ?? "";
if (/service_role|sb_secret_/.test(key)) { console.error("Refus : SUPABASE_ANON_KEY contient une clé secrète. Utilisez la clé publique (anon / publishable)."); process.exit(1); }
if (!url || !key) console.warn("⚠ SUPABASE_URL / SUPABASE_ANON_KEY absents : build en mode local uniquement (pas de comptes).");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
await build({
  entryPoints: ["src/main.tsx"], bundle: true, format: "esm", outfile: `${OUT}/assets/app.js`, minify: !dev, sourcemap: dev ? "inline" : false,
  target: ["es2020", "safari14"], jsx: "transform", legalComments: "none",
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"), __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_ANON_KEY__: JSON.stringify(key), __BASE_PATH__: JSON.stringify(BASE), __SITE_URL__: JSON.stringify(SITE), __GOOGLE_AUTH__: JSON.stringify(process.env.GOOGLE_AUTH === "1") },
});
execFileSync("npx", ["tailwindcss", "-c", "tailwind.config.cjs", "-i", "src/styles.css", "-o", `${OUT}/assets/app.css`, ...(dev ? [] : ["--minify"])], { stdio: ["ignore", "ignore", "inherit"] });
const hash = createHash("sha256").update(readFileSync(`${OUT}/assets/app.js`)).update(readFileSync(`${OUT}/assets/app.css`)).digest("hex").slice(0, 10);
const html = readFileSync("src/index.html", "utf8").replaceAll("%BASE%", BASE).replaceAll("%SITE_URL%", SITE).replaceAll("%HASH%", hash);
writeFileSync(`${OUT}/index.html`, html);
writeFileSync(`${OUT}/404.html`, html); // GitHub Pages : les routes (/login, /app…) retombent sur l'application
cpSync("public", OUT, { recursive: true });
const sw = readFileSync(`${OUT}/sw.js`, "utf8").replace("__VERSION__", hash);
writeFileSync(`${OUT}/sw.js`, sw);
writeFileSync(`${OUT}/_redirects`, `${BASE}* ${BASE}index.html 200\n`); // Netlify / Cloudflare Pages
writeFileSync(`${OUT}/.nojekyll`, "");
console.log(`✓ ${OUT}/ (${dev ? "dev" : "prod"}, base ${BASE}, ${url ? "Supabase configuré" : "mode local"}, ${hash})`);
