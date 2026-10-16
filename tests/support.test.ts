// Tests backend : rôles administrateur, tickets, messagerie, notes internes, pièces jointes, journal d'audit, suspension.
// Contre la stack Supabase LOCALE (supabase start ; seed.sql ajoute les adresses admin de test). Lancer : npm run test:db
import { test } from "node:test";
import assert from "node:assert/strict";
import { client, confirmedUser, adminUser, lastLink, follow } from "./helpers.ts";
import { seed } from "../src/core.ts";

const PNG = () => new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0))], { type: "image/png" });
const bug = (extra: Record<string, unknown> = {}) => ({
  kind: "bug", category: "display", subject: "Le planning déborde", description: "Les blocs dépassent de l'écran sur mobile.",
  module: "planning", steps: "1. Ouvrir planning", expected: "Tout visible", observed: "Débordement", frequency: "often", impact: "medium",
  tech: { browser: "Test 1.0", appVersion: "2.0.0", route: "/app/planning" }, ...extra,
});
const isDenied = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42501" || /réservé|administrateur|non authentifié/i.test(e.message ?? ""));

test("rôle : les comptes autorisés et confirmés sont administrateurs, les autres non", async () => {
  const admin = await adminUser(1), user = await confirmedUser("plain");
  assert.equal((await admin.c.rpc("my_role")).data.is_admin, true);
  assert.equal((await user.c.rpc("my_role")).data.is_admin, false);
  assert.equal((await user.c.rpc("is_admin")).data, false);
});

test("rôle : impossible de s'attribuer le rôle administrateur", async () => {
  const u = await confirmedUser("escalade");
  // écriture directe dans les tables de rôles
  assert.ok((await u.c.from("user_roles").insert({ user_id: u.id, role: "admin", granted_via: "moi" })).error, "insertion d'un rôle");
  assert.ok((await u.c.from("admin_allowlist").insert({ email: u.email })).error, "ajout à la liste autorisée");
  assert.equal((await u.c.from("admin_allowlist").select("*")).data?.length ?? 0, 0, "liste autorisée lisible");
  // métadonnées falsifiées côté client
  await u.c.auth.updateUser({ data: { role: "admin", is_admin: true, email: "admin-test-1@test.local" } });
  await u.c.auth.refreshSession();
  assert.equal((await u.c.rpc("my_role")).data.is_admin, false, "métadonnées client prises comme preuve");
  // changement d'adresse vers une adresse autorisée NON confirmé : toujours pas administrateur
  const ch = await u.c.auth.updateUser({ email: "admin-test-3@test.local" });
  assert.equal(ch.error, null);
  assert.equal((await u.c.rpc("my_role")).data.is_admin, false, "adresse non confirmée prise comme preuve");
  // profil : le statut n'est pas modifiable par le client
  assert.ok((await u.c.from("profiles").update({ status: "active" }).eq("id", u.id)).error, "statut modifiable");
});

test("administration : toutes les fonctions admin refusent un utilisateur ordinaire", async () => {
  const u = await confirmedUser("intrus"), other = await confirmedUser("cible");
  const calls: [string, Record<string, unknown>][] = [
    ["admin_stats", {}], ["admin_list_users", {}], ["admin_get_user", { p_user: other.id }], ["admin_list_admins", {}],
    ["admin_update_profile", { p_user: other.id, p_display_name: "x", p_reason: "test test" }],
    ["admin_add_user_note", { p_user: other.id, p_body: "x" }], ["admin_set_status", { p_user: other.id, p_status: "suspended", p_reason: "test test" }],
    ["admin_request_password_reset", { p_user: other.id, p_reason: "test test" }], ["admin_user_files", { p_user: other.id }], ["admin_begin_deletion", { p_user: other.id, p_reason: "test test" }],
    ["admin_delete_user", { p_user: other.id, p_confirm_email: other.email, p_reason: "test test" }],
    ["admin_read_user_data", { p_user: other.id, p_path: ["settings", "name"], p_reason: "lecture test" }],
    ["admin_fix_user_data", { p_user: other.id, p_path: ["settings", "name"], p_expected: "a", p_value: "b", p_reason: "correction test" }],
    ["admin_revert_data_fix", { p_audit: 1, p_reason: "annulation test" }],
    ["admin_list_tickets", {}], ["admin_get_ticket", { p_ticket: crypto.randomUUID() }],
    ["admin_update_ticket", { p_ticket: crypto.randomUUID(), p_status: "closed" }], ["admin_add_ticket_note", { p_ticket: crypto.randomUUID(), p_body: "x" }],
  ];
  for (const [fn, args] of calls) {
    const r = await u.c.rpc(fn, args);
    assert.ok(isDenied(r.error), `${fn} accepté pour un non-administrateur (${JSON.stringify(r.error)})`);
  }
  // fonctions internes non exposées
  for (const fn of ["_audit", "_require_admin", "sync_admin_roles", "_apply_status", "_admin_users"]) assert.ok((await u.c.rpc(fn, {})).error, `${fn} exposée`);
  // visiteur non connecté
  assert.ok((await client().rpc("admin_stats")).error);
  // le profil de la cible est intact
  assert.equal((await other.c.from("profiles").select("display_name, status").single()).data!.status, "active");
});

test("signalement : création, validation des champs, numéro, statut initial, notification aux admins", async () => {
  const admin = await adminUser(1), u = await confirmedUser("bugger");
  const bad = [
    { ...bug(), subject: "a" }, { ...bug(), description: "court" }, { ...bug(), kind: "spam" }, { ...bug(), category: "inconnue" },
    { ...bug(), frequency: null }, { ...bug(), impact: "énorme" }, { ...bug(), subject: "x".repeat(200) }, { ...bug(), module: "hack" },
  ];
  for (const b of bad) assert.ok((await u.c.rpc("create_ticket", { p: b })).error, `ticket invalide accepté : ${JSON.stringify(b).slice(0, 80)}`);
  const r = await u.c.rpc("create_ticket", { p: bug({ status: "resolved", priority: "critical", owner_id: admin.id }) });
  assert.equal(r.error, null);
  const t = (await u.c.from("tickets").select("*").eq("id", r.data.id).single()).data!;
  assert.equal(t.owner_id, u.id, "propriétaire imposé par le client");
  assert.equal(t.status, "new"); assert.equal(t.priority, "normal", "priorité imposée par le client");
  assert.equal(t.number, r.data.number);
  // écriture directe interdite
  assert.ok((await u.c.from("tickets").insert({ ...bug(), owner_id: u.id })).error);
  assert.equal(((await u.c.from("tickets").update({ status: "closed", priority: "critical" }).eq("id", t.id).select()).data ?? []).length, 0);
  // l'admin reçoit une notification « nouveau ticket »
  const n = await admin.c.from("notifications").select("kind").eq("ticket_id", t.id);
  assert.deepEqual(n.data!.map((x) => x.kind), ["new_ticket"]);
});

test("isolation : un utilisateur ne voit ni les tickets, ni les messages, ni les captures d'un autre", async () => {
  const alice = await confirmedUser("ta"), bob = await confirmedUser("tb");
  const path = `${alice.id}/${crypto.randomUUID()}.png`;
  assert.equal((await alice.c.storage.from("support-files").upload(path, PNG(), { contentType: "image/png" })).error, null);
  const r = await alice.c.rpc("create_ticket", { p: bug({ attachment_path: path }) });
  assert.equal(r.error, null);
  await alice.c.rpc("post_message", { p_ticket: r.data.id, p_body: "Précision privée" });
  assert.equal((await bob.c.from("tickets").select("*").eq("id", r.data.id)).data!.length, 0, "ticket d'Alice lisible");
  assert.equal((await bob.c.from("tickets").select("*")).data!.length, 0);
  assert.equal((await bob.c.from("ticket_messages").select("*").eq("ticket_id", r.data.id)).data!.length, 0, "messages lisibles");
  assert.ok((await bob.c.rpc("post_message", { p_ticket: r.data.id, p_body: "intrusion" })).error, "message dans le ticket d'Alice");
  assert.ok((await bob.c.rpc("set_my_ticket_state", { p_ticket: r.data.id, p_action: "resolve" })).error);
  assert.ok((await bob.c.storage.from("support-files").download(path)).error, "capture d'Alice lisible");
  assert.ok((await bob.c.storage.from("support-files").upload(`${alice.id}/x.png`, PNG())).error, "écriture dans le dossier d'Alice");
  // Bob ne peut pas « s'approprier » la capture d'Alice en la référençant dans son propre ticket
  assert.ok((await bob.c.rpc("create_ticket", { p: bug({ attachment_path: path }) })).error, "référence au fichier d'un autre acceptée");
});

test("pièces jointes : formats interdits refusés", async () => {
  const u = await confirmedUser("files");
  const up = (name: string, blob: Blob, type: string) => u.c.storage.from("support-files").upload(`${u.id}/${name}`, blob, { contentType: type });
  assert.ok((await up("a.exe", new Blob(["MZ"]), "application/x-msdownload")).error, ".exe accepté");
  assert.ok((await up("a.html", new Blob(["<script>"]), "text/html")).error, ".html accepté");
  assert.ok((await up("a.svg", new Blob(["<svg/>"]), "image/svg+xml")).error, ".svg (scriptable) accepté");
  assert.ok((await up("a.png.html", PNG(), "image/png")).error, "extension trompeuse acceptée");
  assert.ok((await up("big.png", new Blob([new Uint8Array(6 * 1024 * 1024)]), "image/png")).error, "fichier de 6 Mo accepté");
  assert.equal((await up(`${crypto.randomUUID()}.png`, PNG(), "image/png")).error, null);
  // chemin inventé ou fichier inexistant refusé par create_ticket
  assert.ok((await u.c.rpc("create_ticket", { p: bug({ attachment_path: `${u.id}/inexistant.png` }) })).error);
  assert.ok((await u.c.rpc("create_ticket", { p: bug({ attachment_path: `../${u.id}/x.png` }) })).error);
});

test("messagerie : réponse admin, réponse utilisateur, historique, notes internes invisibles, non-lu", async () => {
  const admin = await adminUser(1), u = await confirmedUser("conv");
  const r = await u.c.rpc("create_ticket", { p: { kind: "help", category: "usage", subject: "Comment exporter ?", description: "Je ne trouve pas l'export de mes données.", urgency: "low" } });
  assert.equal(r.error, null);
  const id = r.data.id as string;
  // l'admin voit le ticket, ajoute une note interne et répond en demandant une précision
  assert.equal((await admin.c.rpc("admin_get_ticket", { p_ticket: id })).data.ticket.owner_email, u.email);
  assert.equal((await admin.c.rpc("admin_add_ticket_note", { p_ticket: id, p_body: "NOTE SECRÈTE interne" })).error, null);
  const reply = await admin.c.rpc("post_message", { p_ticket: id, p_body: "Réglages > Mon compte > Exporter. Quel appareil ?", p_status: "waiting_user" });
  assert.equal(reply.error, null); assert.equal(reply.data.author_role, "admin");
  // l'utilisateur voit la réponse, une notification, l'indicateur non-lu ; jamais la note
  const msgs = (await u.c.from("ticket_messages").select("author_role, body").eq("ticket_id", id).order("created_at")).data!;
  assert.ok(msgs.some((m) => m.author_role === "admin" && /Exporter/.test(m.body)));
  assert.ok(!msgs.some((m) => /SECRÈTE/.test(m.body)), "note interne visible dans la conversation");
  assert.equal((await u.c.from("ticket_notes").select("*")).data!.length, 0, "notes internes lisibles");
  const t1 = (await u.c.from("tickets").select("*").eq("id", id).single()).data!;
  assert.equal(t1.status, "waiting_user"); assert.equal(t1.last_message_by, "admin");
  assert.ok(new Date(t1.last_message_at) > new Date(t1.owner_read_at), "réponse non signalée comme non lue");
  const notes = (await u.c.from("notifications").select("kind, read_at").eq("ticket_id", id)).data!;
  assert.deepEqual(notes.map((n) => n.kind), ["info_requested"]);
  await u.c.rpc("mark_ticket_read", { p_ticket: id });
  assert.equal((await u.c.from("notifications").select("read_at").eq("ticket_id", id).single()).data!.read_at !== null, true);
  // l'utilisateur répond : statut repasse à « ouvert », les admins sont notifiés
  const ur = await u.c.rpc("post_message", { p_ticket: id, p_body: "Sur iPhone." });
  assert.equal(ur.data.author_role, "user");
  assert.equal((await u.c.from("tickets").select("status").eq("id", id).single()).data!.status, "open");
  assert.ok((await admin.c.from("notifications").select("kind").eq("ticket_id", id)).data!.some((n) => n.kind === "user_message"));
  // impossible de falsifier un message administrateur ou de changer le statut en écrivant un message
  assert.ok((await u.c.from("ticket_messages").insert({ ticket_id: id, author_role: "admin", body: "Faux admin" })).error);
  assert.ok((await u.c.rpc("post_message", { p_ticket: id, p_body: "x", p_status: "resolved" })).error, "statut modifié par l'utilisateur");
  // historique complet dans l'ordre
  const all = (await u.c.from("ticket_messages").select("author_role, body").eq("ticket_id", id).order("created_at")).data!;
  assert.deepEqual(all.map((m) => m.author_role), ["admin", "system", "user"]);
});

test("tickets : résolution, fermeture, réouverture, priorité, assignation (journalisées)", async () => {
  const admin = await adminUser(1), admin2 = await adminUser(2), u = await confirmedUser("cycle");
  const id = (await u.c.rpc("create_ticket", { p: bug({ impact: "blocking" }) })).data.id as string;
  assert.equal((await u.c.from("tickets").select("priority").eq("id", id).single()).data!.priority, "high", "impact bloquant → priorité haute");
  assert.equal((await admin.c.rpc("admin_update_ticket", { p_ticket: id, p_priority: "critical", p_assigned: admin2.id })).error, null);
  assert.ok((await admin.c.rpc("admin_update_ticket", { p_ticket: id, p_assigned: u.id })).error, "assignation à un non-admin");
  assert.equal((await admin.c.rpc("admin_update_ticket", { p_ticket: id, p_status: "resolved" })).error, null);
  let t = (await u.c.from("tickets").select("status, priority, assigned_to, resolved_at").eq("id", id).single()).data!;
  assert.deepEqual([t.status, t.priority, t.assigned_to], ["resolved", "critical", admin2.id]); assert.ok(t.resolved_at);
  assert.ok((await u.c.from("notifications").select("kind").eq("ticket_id", id)).data!.some((n) => n.kind === "ticket_resolved"));
  // l'utilisateur rouvre
  assert.equal((await u.c.rpc("set_my_ticket_state", { p_ticket: id, p_action: "reopen" })).error, null);
  assert.equal((await u.c.from("tickets").select("status").eq("id", id).single()).data!.status, "open");
  // l'admin ferme : l'utilisateur ne peut plus écrire, mais peut rouvrir
  await admin.c.rpc("admin_update_ticket", { p_ticket: id, p_status: "closed" });
  assert.ok((await u.c.rpc("post_message", { p_ticket: id, p_body: "encore" })).error, "message sur ticket fermé");
  assert.equal((await u.c.rpc("set_my_ticket_state", { p_ticket: id, p_action: "reopen" })).error, null);
  t = (await u.c.from("tickets").select("status").eq("id", id).single()).data!;
  assert.equal(t.status, "open");
  // journal
  const log = (await admin.c.rpc("admin_get_ticket", { p_ticket: id })).data.audit.map((a: { action: string }) => a.action);
  for (const a of ["ticket_priority", "ticket_assigned", "ticket_closed"]) assert.ok(log.includes(a), `${a} non journalisé`);
  // filtres
  const list = await admin.c.rpc("admin_list_tickets", { p_priority: "critical", p_owner: u.id });
  assert.equal(list.data.total, 1); assert.equal(list.data.rows[0].id, id);
  assert.equal((await admin.c.rpc("admin_list_tickets", { p_q: "#" + list.data.rows[0].number })).data.rows[0].id, id);
});

test("pièce jointe d'une réponse admin : lisible par le propriétaire du ticket seulement", async () => {
  const admin = await adminUser(1), u = await confirmedUser("pj"), other = await confirmedUser("pj2");
  const id = (await u.c.rpc("create_ticket", { p: bug() })).data.id as string;
  const path = `${admin.id}/${crypto.randomUUID()}.png`;
  assert.equal((await admin.c.storage.from("support-files").upload(path, PNG(), { contentType: "image/png" })).error, null);
  assert.equal((await admin.c.rpc("post_message", { p_ticket: id, p_body: "Voir capture", p_attachment: path })).error, null);
  assert.equal((await u.c.storage.from("support-files").download(path)).error, null, "propriétaire ne peut pas lire la capture de la réponse");
  assert.ok((await other.c.storage.from("support-files").download(path)).error, "un autre utilisateur lit la capture");
});

test("journal d'audit : illisible pour les utilisateurs, non modifiable même par un admin", async () => {
  const admin = await adminUser(1), u = await confirmedUser("audit");
  await admin.c.rpc("admin_get_user", { p_user: u.id });
  assert.equal((await u.c.from("admin_audit").select("*")).data!.length, 0, "journal lisible par un utilisateur");
  const rows = (await admin.c.from("admin_audit").select("id, action").eq("target_user", u.id)).data!;
  assert.ok(rows.some((r) => r.action === "user_viewed"));
  await admin.c.from("admin_audit").delete().eq("id", rows[0].id);
  assert.equal((await admin.c.from("admin_audit").select("id").eq("id", rows[0].id)).data!.length, 1, "trace effacée");
  const upd = await admin.c.from("admin_audit").update({ action: "rien" }).eq("id", rows[0].id).select();
  assert.equal(upd.data?.length ?? 0, 0);
  assert.ok((await admin.c.from("admin_audit").insert({ action: "faux" })).error, "insertion directe dans le journal");
  // accès refusé à /admin journalisé
  await u.c.rpc("log_admin_denied", { p_path: "/admin" });
  assert.ok((await admin.c.from("admin_audit").select("action").eq("actor_id", u.id)).data!.some((r) => r.action === "admin_access_denied"));
});

test("utilisateurs : recherche, fiche, modification du profil journalisée, notes", async () => {
  const admin = await adminUser(1), u = await confirmedUser("cherche");
  await u.c.rpc("save_state", { p_state: seed(), p_base_version: 0 });
  const found = await admin.c.rpc("admin_list_users", { p_q: u.email });
  assert.equal(found.data.total, 1); assert.equal(found.data.rows[0].id, u.id); assert.equal(found.data.rows[0].role, "user");
  assert.equal((await admin.c.rpc("admin_list_users", { p_q: u.id.slice(0, 8) })).data.rows[0].id, u.id);
  assert.ok((await admin.c.rpc("admin_list_users", { p_role: "admin" })).data.rows.every((r: { role: string }) => r.role === "admin"));
  const fiche = (await admin.c.rpc("admin_get_user", { p_user: u.id })).data;
  assert.equal(fiche.user.email, u.email); assert.ok(fiche.data.counts.tasks >= 0);
  assert.ok(!JSON.stringify(fiche).match(/encrypted_password|password|token/i), "secret dans la fiche");
  assert.ok((await admin.c.rpc("admin_update_profile", { p_user: u.id, p_display_name: "Corrigé", p_reason: "" })).error, "modification sans justification");
  assert.equal((await admin.c.rpc("admin_update_profile", { p_user: u.id, p_display_name: "Corrigé", p_reason: "Demande du ticket #1" })).error, null);
  assert.equal((await u.c.from("profiles").select("display_name").single()).data!.display_name, "Corrigé");
  assert.equal((await admin.c.rpc("admin_add_user_note", { p_user: u.id, p_body: "Utilisateur sur iPad" })).error, null);
  const after = (await admin.c.rpc("admin_get_user", { p_user: u.id })).data;
  assert.ok(after.audit.some((a: { action: string; summary: { to: string } }) => a.action === "profile_updated" && a.summary.to === "Corrigé"));
  assert.equal(after.notes[0].body, "Utilisateur sur iPad");
});

test("correction de données : lecture et modification ciblées, justifiées, journalisées, annulables", async () => {
  const admin = await adminUser(1), u = await confirmedUser("fix");
  const s = seed(); const task = s.tasks[0];
  await u.c.rpc("save_state", { p_state: s, p_base_version: 0 });
  const path = ["tasks", `id:${task.id}`, "title"];
  assert.ok((await admin.c.rpc("admin_read_user_data", { p_user: u.id, p_path: path, p_reason: "court" })).error, "lecture sans justification");
  assert.ok((await admin.c.rpc("admin_read_user_data", { p_user: u.id, p_path: ["timer"], p_reason: "Ticket #12 : vérification" })).error, "section non autorisée");
  const cur = await admin.c.rpc("admin_read_user_data", { p_user: u.id, p_path: path, p_reason: "Ticket #12 : titre corrompu" });
  assert.equal(cur.data, task.title);
  assert.ok((await admin.c.rpc("admin_fix_user_data", { p_user: u.id, p_path: path, p_expected: "autre", p_value: "Nouveau", p_reason: "Ticket #12 : correction" })).error, "valeur attendue ignorée");
  assert.ok((await admin.c.rpc("admin_fix_user_data", { p_user: u.id, p_path: path, p_expected: task.title, p_value: 42, p_reason: "Ticket #12 : correction" })).error, "changement de type accepté");
  const fix = await admin.c.rpc("admin_fix_user_data", { p_user: u.id, p_path: path, p_expected: task.title, p_value: "Titre corrigé", p_reason: "Ticket #12 : correction demandée" });
  assert.equal(fix.error, null);
  const row = (await u.c.from("user_data").select("state, version, updated_by").single()).data!;
  assert.equal(row.state.tasks[0].title, "Titre corrigé"); assert.equal(row.version, 2); assert.equal(row.updated_by, "admin");
  const entry = (await admin.c.from("admin_audit").select("id, summary, reason").eq("target_user", u.id).eq("action", "data_fixed").single()).data!;
  assert.equal(entry.summary.from, task.title); assert.equal(entry.summary.to, "Titre corrigé");
  assert.equal((await admin.c.rpc("admin_revert_data_fix", { p_audit: entry.id, p_reason: "Erreur de manipulation" })).error, null);
  assert.equal((await u.c.from("user_data").select("state").single()).data!.state.tasks[0].title, task.title);
  assert.ok((await admin.c.rpc("admin_revert_data_fix", { p_audit: entry.id, p_reason: "Deuxième annulation" })).error, "double annulation");
});

test("suspension : écritures et connexion bloquées, réactivation, journal ; admins protégés", async () => {
  const admin = await adminUser(1), admin2 = await adminUser(2), u = await confirmedUser("susp");
  await u.c.rpc("save_state", { p_state: seed(), p_base_version: 0 });
  assert.ok((await admin.c.rpc("admin_set_status", { p_user: u.id, p_status: "suspended", p_reason: "" })).error, "sans justification");
  assert.ok((await admin.c.rpc("admin_set_status", { p_user: admin2.id, p_status: "suspended", p_reason: "test interdit" })).error, "admin suspendu par un admin");
  assert.ok((await admin.c.rpc("admin_set_status", { p_user: admin.id, p_status: "suspended", p_reason: "test interdit" })).error, "auto-suspension");
  assert.equal((await admin.c.rpc("admin_set_status", { p_user: u.id, p_status: "suspended", p_reason: "Abus signalé" })).error, null);
  assert.ok((await u.c.rpc("save_state", { p_state: seed(), p_base_version: 1 })).error, "écriture d'un compte suspendu");
  assert.ok((await u.c.rpc("create_ticket", { p: bug() })).error, "ticket d'un compte suspendu");
  assert.equal((await u.c.from("user_data").select("*")).data!.length, 0, "lecture des données d'un compte suspendu");
  assert.ok((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error, "connexion d'un compte suspendu");
  assert.equal((await admin.c.rpc("admin_set_status", { p_user: u.id, p_status: "active", p_reason: "Levée après échange" })).error, null);
  const back = await client().auth.signInWithPassword({ email: u.email, password: u.password });
  assert.equal(back.error, null, "reconnexion après réactivation");
  const log = (await admin.c.from("admin_audit").select("action, reason").eq("target_user", u.id)).data!.map((r) => r.action);
  assert.ok(log.includes("account_suspended") && log.includes("account_reactivated"));
});

test("suppression par un admin : fichiers puis compte, confirmation par e-mail, journal conservé", async () => {
  const admin = await adminUser(1), u = await confirmedUser("adel");
  await u.c.storage.from("user-files").upload(`${u.id}/edt.pdf`, new Blob(["%PDF"], { type: "application/pdf" }));
  const p = `${u.id}/${crypto.randomUUID()}.png`;
  await u.c.storage.from("support-files").upload(p, PNG(), { contentType: "image/png" });
  await u.c.rpc("create_ticket", { p: bug({ attachment_path: p }) });
  assert.ok((await admin.c.rpc("admin_delete_user", { p_user: u.id, p_confirm_email: "faux@x.fr", p_reason: "Demande RGPD" })).error, "mauvaise confirmation");
  assert.ok((await admin.c.rpc("admin_delete_user", { p_user: u.id, p_confirm_email: u.email, p_reason: "Demande RGPD" })).error, "fichiers restants ignorés");
  assert.ok((await admin.c.rpc("admin_user_files", { p_user: u.id })).error, "fichiers listés sans procédure de suppression");
  assert.ok((await admin.c.storage.from("user-files").download(`${u.id}/edt.pdf`)).error, "l'admin lit les PDF d'un utilisateur actif");
  assert.equal((await admin.c.rpc("admin_begin_deletion", { p_user: u.id, p_reason: "Demande RGPD" })).error, null);
  assert.ok((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error, "connexion pendant la suppression");
  const files = (await admin.c.rpc("admin_user_files", { p_user: u.id })).data as { bucket: string; name: string }[];
  assert.equal(files.length, 2);
  for (const b of ["user-files", "support-files"]) {
    const names = files.filter((f) => f.bucket === b).map((f) => f.name);
    const rm = await admin.c.storage.from(b).remove(names);
    assert.equal(rm.error, null, `suppression des fichiers ${b} : ${rm.error?.message}`);
  }
  assert.equal(((await admin.c.rpc("admin_user_files", { p_user: u.id })).data as unknown[]).length, 0, "fichiers non supprimés");
  assert.equal((await admin.c.rpc("admin_delete_user", { p_user: u.id, p_confirm_email: u.email, p_reason: "Demande RGPD" })).error, null);
  assert.ok((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error);
  assert.ok((await admin.c.from("admin_audit").select("action").eq("target_user", u.id)).data!.some((r) => r.action === "account_deleted"), "trace perdue");
});

test("réinitialisation du mot de passe demandée par un admin : e-mail standard envoyé, aucun mot de passe exposé", async () => {
  const admin = await adminUser(1), u = await confirmedUser("rst");
  const r = await admin.c.rpc("admin_request_password_reset", { p_user: u.id, p_reason: "Ticket : mot de passe oublié" });
  assert.equal(r.data, u.email);
  await new Promise((res) => setTimeout(res, 1100));
  assert.equal((await client().auth.resetPasswordForEmail(r.data, { redirectTo: "http://127.0.0.1:5173/reset-password" })).error, null);
  assert.match(await lastLink(u.email), /type=recovery/);
  void follow;
});

test("statistiques : chiffres réels de la base", async () => {
  const admin = await adminUser(1);
  const s = (await admin.c.rpc("admin_stats")).data;
  for (const k of ["users_total", "signups_7d", "active_7d", "bugs_open", "help_open", "awaiting_reply", "resolved", "critical_open"]) assert.equal(typeof s[k], "number", k);
  assert.ok(s.users_total >= 2 && Array.isArray(s.recent_tickets) && Array.isArray(s.recent_audit));
});
