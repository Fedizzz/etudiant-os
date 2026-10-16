// Abonnement iCal : téléchargement par la base (fetch_calendar) et garde-fous. Stack Supabase LOCALE.
// Un petit serveur sert un .ics sur la machine hôte ; son adresse est autorisée pour ce test uniquement (app_config).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { client, confirmedUser } from "./helpers.ts";
import { parseIcs } from "../src/ical.ts";

const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_etudiant-os";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x1\r\nDTSTART:20261019T080000Z\r\nDTEND:20261019T093000Z\r\nSUMMARY:CM Algèbre\r\nLOCATION:Amphi B\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
let server: http.Server, base = "";
const sql = (q: string) => execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-tAc", q]).toString().trim();

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/cal.ics") { res.writeHead(200, { "Content-Type": "text/calendar" }); res.end(ICS); }
    else if (req.url === "/page") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>connexion</html>"); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((ok) => server.listen(0, "0.0.0.0", ok));
  const gw = sql(`select '${execFileSync("docker", ["network", "inspect", "supabase_network_etudiant-os", "-f", "{{(index .IPAM.Config 0).Gateway}}"]).toString().trim()}'`);
  base = `http://${gw}:${(server.address() as { port: number }).port}`;
  sql(`insert into public.app_config values ('calendar_test_host', '${gw}') on conflict (key) do update set value = excluded.value`);
});
after(() => { sql("delete from public.app_config where key = 'calendar_test_host'"); server.close(); });

test("un utilisateur connecté récupère son flux .ics, lisible par le lecteur", async () => {
  const u = await confirmedUser("ical");
  const r = await u.c.rpc("fetch_calendar", { p_url: `${base}/cal.ics` });
  assert.equal(r.error, null, r.error?.message);
  const ev = parseIcs(r.data as string, "2026-10-19", "2026-10-19");
  assert.equal(ev[0].title, "CM Algèbre"); assert.equal(ev[0].room, "Amphi B");
});

test("refus : non connecté, page qui n'est pas un calendrier, 404, adresses internes, http public", async () => {
  const u = await confirmedUser("ical2");
  assert.ok((await client().rpc("fetch_calendar", { p_url: `${base}/cal.ics` })).error, "visiteur non connecté");
  assert.match((await u.c.rpc("fetch_calendar", { p_url: `${base}/page` })).error?.message ?? "", /pas un calendrier/);
  assert.match((await u.c.rpc("fetch_calendar", { p_url: `${base}/absent` })).error?.message ?? "", /404/);
  for (const bad of ["http://localhost/x.ics", "https://127.0.0.1/x.ics", "https://10.0.0.5/a", "https://192.168.1.1/a", "https://169.254.169.254/latest/meta-data",
    "https://intranet.local/a.ics", "https://[::1]/a", "http://edt.univ.fr/cal.ics", "https://edt.univ.fr:8080/cal.ics", "ftp://x.fr/a", "pas un lien"]) {
    assert.ok((await u.c.rpc("fetch_calendar", { p_url: bad })).error, `adresse acceptée : ${bad}`);
  }
});
