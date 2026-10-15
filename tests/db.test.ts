// Tests backend contre la stack Supabase locale : authentification réelle, RLS, version, isolation.
// Lancer : supabase start && npm run test:db
import { test } from "node:test";
import assert from "node:assert/strict";
import { client, uniqueEmail, lastLink, follow, confirmedUser, URL, ANON } from "./helpers.ts";
import { seed } from "../src/core.ts";

const doc = (name = "Test") => { const s = seed(); return { ...s, settings: { ...s.settings, name } }; };

test("inscription : e-mail invalide et mot de passe faible refusés", async () => {
  const c = client();
  const bad = await c.auth.signUp({ email: "pas-un-email", password: "motdepasse123" });
  assert.ok(bad.error, "e-mail invalide accepté");
  const weak = await c.auth.signUp({ email: uniqueEmail("weak"), password: "abc" });
  assert.ok(weak.error, "mot de passe trop court accepté");
  const noDigit = await c.auth.signUp({ email: uniqueEmail("weak2"), password: "seulementdeslettres" });
  assert.ok(noDigit.error, "mot de passe sans chiffre accepté");
});

test("inscription : connexion impossible avant confirmation, possible après", async () => {
  const email = uniqueEmail("confirm"), password = "motdepasse123";
  const c = client();
  const r = await c.auth.signUp({ email, password, options: { data: { display_name: "Léa" } } });
  assert.equal(r.error, null);
  assert.equal(r.data.session, null, "session ouverte sans confirmation");
  const early = await c.auth.signInWithPassword({ email, password });
  assert.match(early.error?.message ?? "", /confirm/i);
  const location = await follow(await lastLink(email));
  assert.match(location, /access_token=/);
  const ok = await c.auth.signInWithPassword({ email, password });
  assert.equal(ok.error, null);
  const p = await c.from("profiles").select("display_name").single();
  assert.equal(p.data?.display_name, "Léa", "profil créé avec le nom d'inscription");
});

test("connexion refusée avec un mauvais mot de passe", async () => {
  const u = await confirmedUser("wrongpw");
  const r = await client().auth.signInWithPassword({ email: u.email, password: "mauvais123" });
  assert.ok(r.error);
});

test("récupération du mot de passe : e-mail, lien, nouveau mot de passe", async () => {
  const u = await confirmedUser("reset");
  const c = client();
  await new Promise((r) => setTimeout(r, 1100)); // max_frequency
  assert.equal((await c.auth.resetPasswordForEmail(u.email, { redirectTo: "http://127.0.0.1:5173/reset-password" })).error, null);
  const link = await lastLink(u.email);
  assert.match(link, /type=recovery/);
  const loc = await follow(link);
  assert.match(loc, /^http:\/\/127\.0\.0\.1:5173\/reset-password#access_token=/);
  const params = new URLSearchParams(loc.split("#")[1]);
  const rc = client();
  await rc.auth.setSession({ access_token: params.get("access_token")!, refresh_token: params.get("refresh_token")! });
  assert.equal((await rc.auth.updateUser({ password: "nouveau456" })).error, null);
  assert.ok((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error, "ancien mot de passe encore valide");
  assert.equal((await client().auth.signInWithPassword({ email: u.email, password: "nouveau456" })).error, null);
});

test("redirection vers un domaine non autorisé refusée", async () => {
  const u = await confirmedUser("redir");
  await new Promise((r) => setTimeout(r, 1100));
  await client().auth.resetPasswordForEmail(u.email, { redirectTo: "https://site-malveillant.example/vol" });
  const loc = await follow(await lastLink(u.email));
  assert.doesNotMatch(loc, /site-malveillant/);
});

test("save_state : création, version, conflit", async () => {
  const { c } = await confirmedUser("ver");
  const a = await c.rpc("save_state", { p_state: doc("A"), p_base_version: 0, p_client: "t1" }).single();
  assert.equal(a.error, null); assert.deepEqual([a.data!.ok, a.data!.version], [true, 1]);
  const b = await c.rpc("save_state", { p_state: doc("B"), p_base_version: 1, p_client: "t2" }).single();
  assert.deepEqual([b.data!.ok, b.data!.version], [true, 2]);
  // écriture fondée sur une version périmée : refus + état serveur renvoyé
  const stale = await c.rpc("save_state", { p_state: doc("C"), p_base_version: 1, p_client: "t1" }).single();
  assert.equal(stale.data!.ok, false); assert.equal(stale.data!.version, 2);
  assert.equal((stale.data!.state as { settings: { name: string } }).settings.name, "B");
  const again0 = await c.rpc("save_state", { p_state: doc("D"), p_base_version: 0 }).single();
  assert.equal(again0.data!.ok, false, "recréation par-dessus des données existantes");
  const row = await c.from("user_data").select("version, state").single();
  assert.equal(row.data!.version, 2); assert.equal(row.data!.state.settings.name, "B");
});

test("save_state : document invalide refusé par la base", async () => {
  const { c } = await confirmedUser("invalid");
  const r = await c.rpc("save_state", { p_state: { foo: 1 }, p_base_version: 0 });
  assert.ok(r.error, "document arbitraire accepté");
});

test("isolation : un utilisateur ne peut ni lire, ni modifier, ni supprimer les données d'un autre", async () => {
  const alice = await confirmedUser("alice"), bob = await confirmedUser("bob");
  await alice.c.rpc("save_state", { p_state: doc("Alice"), p_base_version: 0 });
  await bob.c.rpc("save_state", { p_state: doc("Bob"), p_base_version: 0 });
  // lecture : Bob ne voit que sa ligne, même en filtrant sur l'id d'Alice
  const rows = await bob.c.from("user_data").select("user_id, state");
  assert.equal(rows.data!.length, 1); assert.equal(rows.data![0].user_id, bob.id);
  assert.equal((await bob.c.from("user_data").select("*").eq("user_id", alice.id)).data!.length, 0);
  assert.equal((await bob.c.from("profiles").select("*").eq("id", alice.id)).data!.length, 0);
  // écriture directe : interdite (aucun droit INSERT/UPDATE sur la table)
  const ins = await bob.c.from("user_data").insert({ user_id: alice.id, state: doc("Pirate") });
  assert.ok(ins.error, "insertion directe autorisée");
  const upd = await bob.c.from("user_data").update({ state: doc("Pirate") }).eq("user_id", alice.id).select();
  assert.ok(upd.error || upd.data!.length === 0, "modification des données d'Alice");
  const prof = await bob.c.from("profiles").update({ display_name: "Pirate" }).eq("id", alice.id).select();
  assert.equal(prof.data?.length ?? 0, 0);
  const del = await bob.c.from("user_data").delete().eq("user_id", alice.id).select();
  assert.equal(del.data?.length ?? 0, 0);
  // save_state n'écrit que la ligne de l'appelant
  await bob.c.rpc("save_state", { p_state: doc("Bob2"), p_base_version: 1 });
  const aliceRow = await alice.c.from("user_data").select("state, version").single();
  assert.equal(aliceRow.data!.state.settings.name, "Alice"); assert.equal(aliceRow.data!.version, 1);
});

test("visiteur non connecté : aucun accès", async () => {
  const anon = client();
  assert.equal((await anon.from("user_data").select("*")).data?.length ?? 0, 0);
  assert.equal((await anon.from("profiles").select("*")).data?.length ?? 0, 0);
  assert.ok((await anon.rpc("save_state", { p_state: doc(), p_base_version: 0 })).error);
  assert.ok((await anon.rpc("delete_my_account")).error);
  const raw = await fetch(`${URL}/rest/v1/user_data?select=*`, { headers: { apikey: ANON } });
  assert.ok(raw.status >= 400 || (await raw.json()).length === 0);
});

test("fichiers : dossier personnel uniquement", async () => {
  const alice = await confirmedUser("fa"), bob = await confirmedUser("fb");
  const pdf = new Blob(["%PDF-1.4 test"], { type: "application/pdf" });
  assert.equal((await alice.c.storage.from("user-files").upload(`${alice.id}/emploi-du-temps.pdf`, pdf)).error, null);
  assert.ok((await bob.c.storage.from("user-files").upload(`${alice.id}/intrus.pdf`, pdf)).error, "écriture dans le dossier d'Alice");
  assert.ok((await bob.c.storage.from("user-files").download(`${alice.id}/emploi-du-temps.pdf`)).error, "lecture du PDF d'Alice");
  const list = await bob.c.storage.from("user-files").list(alice.id);
  assert.equal(list.data?.length ?? 0, 0);
  assert.ok((await alice.c.storage.from("user-files").upload(`${alice.id}/x.exe`, new Blob(["MZ"], { type: "application/x-msdownload" }))).error, "type de fichier non PDF accepté");
});

test("profil : modification du nom d'affichage", async () => {
  const u = await confirmedUser("prof");
  const r = await u.c.from("profiles").update({ display_name: "Nouveau nom" }).eq("id", u.id).select().single();
  assert.equal(r.data!.display_name, "Nouveau nom");
  assert.ok((await u.c.from("profiles").update({ display_name: "x".repeat(200) }).eq("id", u.id)).error, "nom de 200 caractères accepté");
});

test("suppression du compte : fichiers d'abord, puis compte, profil et données supprimés", async () => {
  const u = await confirmedUser("del");
  await u.c.rpc("save_state", { p_state: doc(), p_base_version: 0 });
  await u.c.storage.from("user-files").upload(`${u.id}/a.pdf`, new Blob(["%PDF"], { type: "application/pdf" }));
  const blocked = await u.c.rpc("delete_my_account");
  assert.ok(blocked.error, "suppression malgré des fichiers restants");
  assert.equal((await u.c.storage.from("user-files").remove([`${u.id}/a.pdf`])).error, null);
  assert.equal((await u.c.rpc("delete_my_account")).error, null);
  assert.ok((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error, "connexion encore possible");
  // vérification côté base avec un autre compte : rien ne fuit, et la ligne a disparu (vérifiée via psql dans le script)
});
