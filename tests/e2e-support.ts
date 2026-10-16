// Parcours support + administration dans un vrai navigateur, contre la stack Supabase LOCALE.
// Prérequis : supabase start (seed.sql : adresses admin de test) ; npm run build (avec .env local) ; node scripts/serve.mjs
// Lancer : npm run test:e2e:support
import { chromium, type Page } from "playwright-core";
import { confirmedUser, adminUser, URL as API, ANON } from "./helpers.ts";
import { seed } from "../src/core.ts";
const ready = () => { const s = seed(); return { ...s, settings: { ...s.settings, onboarded: true } }; };

const APP = process.env.APP_URL ?? "http://127.0.0.1:5173/etudiant-os/";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let pass = 0, fail = 0; const failures: string[] = [];
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; failures.push(m); console.log("  ✗ " + m); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => Promise<unknown> | unknown, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await sleep(200); } return false; };

const browser = await chromium.launch({ executablePath: CHROME });
const open = async (o: Record<string, unknown> = {}) => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...o }); const p = await c.newPage(); const errs: string[] = []; p.on("pageerror", (e) => errs.push(e.message)); return Object.assign(p, { errs }); };
const login = async (p: Page, mail: string, pw: string, next = "app") => {
  await p.goto(APP + "login?next=" + encodeURIComponent(new globalThis.URL(APP).pathname + next));
  await p.fill("#li-email", mail); await p.fill("#li-pw", pw); await p.click("button[type=submit]:has-text('Se connecter')");
  await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 10000 });
};
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  const admin = await adminUser(1);
  const user = await confirmedUser("e2e-support");
  await user.c.rpc("save_state", { p_state: ready(), p_base_version: 0 });
  await admin.c.rpc("save_state", { p_state: ready(), p_base_version: 0 }); // sans effet si l'admin a déjà des données

  console.log("Accès administrateur");
  const up = await open();
  await login(up, user.email, user.password, "app/settings");
  await until(() => up.locator("text=Aide & support").count());
  ok(await up.locator("text=Aide & support").count() > 0, "carte Aide & support dans les réglages");
  ok(await up.locator("[data-testid=admin-link]").count() === 0, "pas de bouton Administration pour un utilisateur");
  await up.goto(APP + "admin");
  ok(await until(() => up.locator("[data-testid=admin-denied]").count()), "/admin : accès refusé pour un utilisateur ordinaire");
  ok(await up.locator("[data-testid=admin-shell]").count() === 0, "aucun écran d'administration rendu");
  await up.goto(APP + "admin/users");
  ok(await until(() => up.locator("[data-testid=admin-denied]").count()), "/admin/users : accès refusé aussi");
  // contournement depuis la console : appel direct de l'API avec le jeton de l'utilisateur
  const forced = await up.evaluate(async ({ api, key }) => { const s = JSON.parse(localStorage.getItem("etudiant-os/auth")!); const r = await fetch(api + "/rest/v1/rpc/admin_list_users", { method: "POST", headers: { apikey: key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" }, body: "{}" }); return r.status; }, { api: API, key: ANON });
  ok(forced >= 400, `appel direct de admin_list_users refusé (HTTP ${forced})`);
  ok((await admin.c.from("admin_audit").select("action").eq("actor_id", user.id)).data!.some((r) => r.action === "admin_access_denied"), "tentative d'accès journalisée");

  console.log("Signaler un problème");
  await up.goto(APP + "app/report-problem");
  await until(() => up.locator("[data-testid=report-form]").count());
  ok(await up.locator("h1:has-text('Signaler un problème')").count() > 0, "titre de page dans l'en-tête de l'application");
  await up.click("button:has-text('Envoyer le signalement')");
  ok(await up.locator("#bug-subject[aria-invalid=true]").count() === 1 && await up.locator("#bug-category[aria-invalid=true]").count() === 1, "champs obligatoires signalés");
  ok(await up.locator("text=Indique la fréquence").count() === 1, "message d'erreur compréhensible");
  await up.setInputFiles("[data-testid=attach-input]", { name: "piege.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  ok(await up.locator("text=Format non accepté").count() === 1, "fichier SVG refusé avant envoi");
  await up.setInputFiles("[data-testid=attach-input]", { name: "capture.png", mimeType: "image/png", buffer: PNG });
  ok(await up.locator("text=capture.png").count() === 1, "capture PNG acceptée avec aperçu");
  ok((await up.locator("[data-testid=tech-info]").textContent())!.includes("/etudiant-os/app/report-problem"), "infos techniques affichées (page)");
  await up.selectOption("#bug-category", "calculation"); await up.selectOption("#bug-module", "budget");
  await up.fill("#bug-subject", "Total du budget faux"); await up.fill("#bug-description", "Le total ne correspond pas à la somme des dépenses.");
  await up.fill("#bug-steps", "1. Budget 2. Ajouter 3 dépenses"); await up.selectOption("#bug-frequency", "always"); await up.selectOption("#bug-impact", "high");
  await up.click("button:has-text('Envoyer le signalement')");
  ok(await until(() => up.locator("[data-testid=ticket-sent]").count()), "confirmation d'envoi affichée");
  ok(await up.locator("text=Tu peux suivre son avancement dans Mes demandes").count() === 1, "message de confirmation demandé");
  const number = Number((await up.locator("[data-testid=ticket-sent] h2").textContent())!.match(/(\d+)/)![1]);
  ok(number > 0, `numéro de ticket généré (#${number})`);
  const ticket = (await user.c.from("tickets").select("*").eq("number", number).single()).data!;
  ok(ticket.attachment_path?.startsWith(user.id + "/"), "capture stockée dans le dossier de l'utilisateur");
  ok(ticket.tech?.route === "/etudiant-os/app/report-problem" && !JSON.stringify(ticket.tech).match(/token|budget|tasks/i), "infos techniques limitées, sans données privées");
  await up.click("button:has-text('Voir ma demande')");
  ok(await until(() => up.locator("[data-testid=ticket-status]:has-text('Nouveau')").count()), "statut consultable : Nouveau");
  ok(await until(() => up.locator("[data-testid=thread] img[alt='Pièce jointe']").count()), "capture visible par son propriétaire");

  console.log("Besoin d'aide ?");
  await up.goto(APP + "app/help");
  await until(() => up.locator("[data-testid=help-form]").count());
  ok(await up.locator("text=Une question sur Étudiant.OS").count() > 0, "sous-titre de la page d'aide");
  await up.selectOption("#help-category", "usage"); await up.fill("#help-subject", "Comment exporter mes données ?"); await up.fill("#help-description", "Je veux une copie de mes données.");
  await up.click("button:has-text('Envoyer ma demande')");
  ok(await until(() => up.locator("[data-testid=ticket-sent]").count()), "demande d'aide envoyée");
  await up.goto(APP + "app/requests");
  ok(await until(async () => (await up.locator("[data-testid=requests-list] li").count()) === 2), "Mes demandes : les 2 tickets");

  console.log("Réponse de l'administration");
  const ap = await open();
  await login(ap, admin.email, admin.password, "app/settings");
  ok(await until(() => ap.locator("[data-testid=admin-link]").count()), "bouton Administration visible pour l'admin");
  await ap.click("[data-testid=admin-link]");
  ok(await until(() => ap.locator("[data-testid=admin-dashboard]").count()), "tableau de bord admin ouvert");
  const stats = (await admin.c.rpc("admin_stats")).data;
  ok((await ap.locator("[data-testid=admin-dashboard]").textContent())!.includes(String(stats.users_total)), "statistiques réelles affichées");
  await ap.goto(APP + "admin/tickets");
  await until(() => ap.locator("[data-testid=tickets-list]").count());
  await ap.fill("[data-testid=ticket-search]", "#" + number);
  ok(await until(async () => (await ap.locator("[data-testid=tickets-list] li").count()) === 1), "recherche par numéro de ticket");
  await ap.locator("[data-testid=tickets-list] li button").first().click();
  await until(() => ap.locator("[data-testid=admin-ticket]").count());
  ok(await until(() => ap.locator("[data-testid=thread] img[alt='Pièce jointe']").count()), "l'admin voit la capture");
  await ap.fill("[data-testid=admin-note] textarea", "NOTE-INTERNE-SECRETE : probablement l'arrondi");
  await ap.click("[data-testid=admin-note] button[type=submit]");
  ok(await until(() => ap.locator("text=NOTE-INTERNE-SECRETE").count()), "note interne ajoutée");
  await ap.selectOption("[data-testid=admin-priority]", "critical");
  ok(await until(() => ap.locator("text=Priorité mise à jour").count()), "priorité passée à Critique");
  await ap.fill("[data-testid=admin-reply] textarea", "Merci ! Quelle devise utilises-tu ?");
  await ap.selectOption("[data-testid=reply-status]", "waiting_user");
  await ap.click("button:has-text('Envoyer la réponse')");
  ok(await until(() => ap.locator("text=Réponse envoyée").count()), "réponse envoyée (confirmée après enregistrement)");
  ok(await until(() => ap.locator("[data-testid=admin-status]").evaluate((e) => (e as HTMLSelectElement).value === "waiting_user")), "statut En attente de l'utilisateur");

  console.log("Côté utilisateur : notification et conversation");
  await up.goto(APP + "app");
  ok(await until(() => up.locator("[data-testid=notif-badge]").count(), 15000), "pastille de notification (temps réel / relecture)");
  await up.goto(APP + "app/requests");
  ok(await until(() => up.locator("text=Nouvelle réponse").count()), "indicateur de réponse non lue");
  await up.locator("[data-testid=requests-list] li button", { hasText: "Total du budget faux" }).click();
  ok(await until(() => up.locator("text=Quelle devise utilises-tu").count()), "réponse de l'admin visible");
  ok(await up.locator("text=NOTE-INTERNE-SECRETE").count() === 0, "note interne invisible pour l'utilisateur");
  ok(await up.locator("text=attend une précision").count() === 1, "demande de précision mise en avant");
  await up.fill("#reply-body", "En euros.");
  await up.click("[data-testid=reply-form] button[type=submit]");
  ok(await until(() => up.locator("[data-testid=thread] li[data-role=user]:has-text('En euros.')").count()), "réponse de l'utilisateur ajoutée à l'historique");
  ok(await until(() => up.locator("[data-testid=ticket-status]:has-text('Ouvert')").count()), "statut repassé à Ouvert");
  await ap.reload();
  ok(await until(() => ap.locator("[data-testid=thread]:has-text('En euros.')").count()), "l'admin voit la réponse de l'utilisateur");
  await ap.click("button:has-text('Marquer résolu')");
  ok(await until(() => ap.locator("text=Ticket marqué comme résolu").count()), "ticket résolu par l'admin");
  await up.reload();
  ok(await until(() => up.locator("[data-testid=ticket-status]:has-text('Résolu')").count()), "l'utilisateur voit Résolu");
  await up.click("button:has-text('Rouvrir la demande')");
  ok(await until(() => up.locator("[data-testid=ticket-status]:has-text('Ouvert')").count()), "l'utilisateur rouvre son ticket");

  console.log("Isolation dans le navigateur");
  const other = await confirmedUser("e2e-curieux");
  await other.c.rpc("save_state", { p_state: ready(), p_base_version: 0 });
  const op = await open();
  await login(op, other.email, other.password);
  await op.goto(APP + "app/requests/" + ticket.id);
  ok(await until(() => op.locator("text=Demande introuvable").count()), "URL du ticket d'un autre : introuvable");
  ok(await op.locator("text=Total du budget faux").count() === 0, "aucun contenu du ticket d'un autre");

  console.log("Gestion des utilisateurs");
  await ap.goto(APP + "admin/users");
  await ap.fill("[data-testid=user-search]", user.email);
  ok(await until(() => ap.locator(`[data-testid=users-table] td:has-text('${user.email}')`).count()), "recherche d'un utilisateur par e-mail");
  await ap.locator(`[data-testid=users-table] tr:has-text('${user.email}')`).click();
  ok(await until(() => ap.locator("[data-testid=user-detail]").count()), "fiche utilisateur ouverte");
  ok(!(await ap.locator("[data-testid=user-detail]").textContent())!.match(/mot de passe :|encrypted|token/i), "aucun secret dans la fiche");
  await ap.locator("[data-testid=user-detail] button:has-text('Modifier')").first().click();
  await ap.fill("#new-name", "Nom corrigé"); await ap.fill("#reason", "Ticket #" + number + " : faute de frappe");
  await ap.click("button:has-text('Enregistrer')");
  ok(await until(() => ap.locator("[data-testid=user-name]:has-text('Nom corrigé')").count()), "nom d'affichage modifié");
  ok(await until(() => ap.locator("[data-testid=user-audit]:has-text('Profil modifié')").count()), "modification visible dans l'historique");
  await ap.click("button:has-text('Suspendre le compte')");
  await ap.fill("#reason", "Test de suspension e2e"); await ap.click("[role=dialog] button[type=submit]");
  ok(await until(() => ap.locator("text=Compte suspendu.").count()), "compte suspendu");
  await up.goto(APP + "app");
  ok(await until(() => up.locator("text=Compte suspendu").count() + up.locator("#li-email").count()), "l'utilisateur suspendu perd l'accès");
  await ap.click("button:has-text('Réactiver le compte')");
  await ap.fill("#reason", "Fin du test e2e"); await ap.click("[role=dialog] button[type=submit]");
  ok(await until(() => ap.locator("text=Compte réactivé.").count()), "compte réactivé");

  console.log("Journal d'audit et mobile");
  await ap.goto(APP + "admin/audit");
  ok(await until(() => ap.locator("[data-testid=audit-list]:has-text('Compte suspendu')").count()), "journal : suspension tracée");
  const mp = await open({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  await login(mp, admin.email, admin.password, "admin/tickets/" + ticket.id);
  ok(await until(() => mp.locator("[data-testid=admin-ticket]").count()), "ticket admin sur téléphone");
  ok(await noOverflow(mp), "pas de débordement horizontal (admin, 375 px)");
  await mp.goto(APP + "app/report-problem"); await until(() => mp.locator("[data-testid=report-form]").count());
  ok(await noOverflow(mp), "pas de débordement horizontal (signalement, 375 px)");
  await mp.click("button[aria-label=Menu]");
  ok(await mp.locator("[role=menu] >> text=Besoin d'aide ?").count() === 1 && await mp.locator("[role=menu] >> text=Administration").count() === 1, "menu ⋮ : aide, signalement, administration");
  for (const p of [up, ap, op, mp]) ok(p.errs.length === 0, "aucune erreur JavaScript" + (p.errs.length ? " : " + p.errs.join(" | ") : ""));
} catch (e) { fail++; failures.push(String(e)); console.error(e); }
await browser.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail) { console.log(failures.join("\n")); process.exit(1); }
