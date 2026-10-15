// Serveur de développement statique avec repli SPA (toutes les routes → index.html).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
const PORT = Number(process.env.PORT ?? 5173), ROOT = process.env.OUT_DIR ?? "dist", BASE = process.env.BASE_PATH ?? "/etudiant-os/";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.startsWith(BASE)) path = "/" + path.slice(BASE.length); else if (path !== "/") { res.writeHead(404); res.end("404"); return; }
  let file = join(ROOT, path);
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(ROOT, "index.html"); }
  try { res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end("404"); }
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}${BASE}`));
