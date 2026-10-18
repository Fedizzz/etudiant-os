// Faux serveur Supabase (tests uniquement) : traduit les appels /rest/v1/rpc/* et les lectures des tables flat_* en vrai SQL sur un PostgreSQL de test,
// avec le rôle `authenticated` et l'identifiant de l'utilisateur lu dans le jeton. Nécessite : npm i --no-save pg. Voir docs/colocation.md.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import pg from "pg";
const pool = new pg.Pool({ host: process.env.PGHOST ?? "/tmp/pgtest", port: Number(process.env.PGPORT ?? 5455), user: process.env.PGUSER ?? "postgres", database: process.env.PGDATABASE ?? "flats_ui" });
const PORT = 5460, ROOT = process.env.WEB_DIR ?? "/tmp/flat-ui-web";
const subOf = (req) => { try { const t = (req.headers.authorization ?? "").replace(/^Bearer /, ""); return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub ?? null; } catch { return null; } };
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
async function withUser(sub, fn) { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204);
  if (url.pathname === "/auth/v1/user") { const s = subOf(req); return s ? json(res, 200, { id: s, aud: "authenticated", email: s + "@t", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) : json(res, 401, { message: "no" }); }
  const body = await new Promise((ok) => { let b = ""; req.on("data", (d) => b += d); req.on("end", () => ok(b)); });
  try {
    let m;
    if ((m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/))) {
      const args = body ? JSON.parse(body) : {}; const keys = Object.keys(args);
      const sql = `select to_jsonb(r.v) as v from (select public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as v) r`;
      const out = await withUser(subOf(req), (c) => c.query(sql, keys.map((k) => args[k] === null ? null : typeof args[k] === "object" ? JSON.stringify(args[k]) : String(args[k]))));
      return json(res, 200, out.rows[0]?.v ?? null);
    }
    if ((m = url.pathname.match(/^\/rest\/v1\/(flat_groceries|flat_expenses|flat_chores|flat_chore_done)$/))) {
      const where = [], vals = [];
      for (const [k, v] of url.searchParams) if (/^[a-z_]+$/.test(k) && !["select", "order", "limit"].includes(k) && v.startsWith("eq.")) { vals.push(v.slice(3)); where.push(`${k} = $${vals.length}`); }
      const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean).map((o) => { const [c, d] = o.split("."); return /^[a-z_]+$/.test(c) ? `${c} ${d === "desc" ? "desc" : "asc"}` : null; }).filter(Boolean);
      const sel = url.searchParams.get("select") ?? "*", cols = sel === "*" ? null : sel.split(",").map((c) => c.trim());
      if (cols && !cols.every((c) => /^[a-z_]+$/.test(c))) return json(res, 400, { code: "PGRST100", message: "select invalide" });
      // Colonnes demandées vérifiées comme PostgREST : une colonne absente donne une erreur 42703 (migration manquante).
      const sql = `select to_jsonb(r) as v from (select ${cols ? cols.join(", ") : "*"} from public.${m[1]} t ${where.length ? "where " + where.join(" and ") : ""} ${order.length ? "order by " + order.join(",") : ""} limit ${Math.min(+url.searchParams.get("limit") || 1000, 1000)}) r`;
      const out = await withUser(subOf(req), (c) => c.query(sql, vals));
      return json(res, 200, out.rows.map((r) => r.v));
    }
    if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/realtime/")) return json(res, 404, { message: "not implemented" });
    const f = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
    res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html" }); res.end(fs.readFileSync(f));
  } catch (e) { console.log("ERR", req.url, e.code, e.message, "sub=", subOf(req)); if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return json(res, 400, { code: e.code, message: e.message, details: null, hint: null }); json(res, 500, { message: String(e.message) }); }
}).listen(PORT, "127.0.0.1", () => console.log("shim", PORT));
