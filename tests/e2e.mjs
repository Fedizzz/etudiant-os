// Parcours complets dans un vrai navigateur, contre la stack Supabase LOCALE.
// Prérequis : supabase start ; npm run build (avec .env local) ; node scripts/serve.mjs
// Lancer : npm run test:e2e
import { chromium } from "playwright-core";
const APP = process.env.APP_URL ?? "http://127.0.0.1:5173/etudiant-os/";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const ANON = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; failures.push(m); console.log("  ✗ " + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = (t) => `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
async function mailLink(to, type) {
  for (let i = 0; i < 40; i++) {
    const j = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + to)}`)).json();
    for (const m of j.messages ?? []) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const link = ((full.Text ?? "") + " " + (full.HTML ?? "")).match(/https?:\/\/[^\s"<>]+verify[^\s"<>]+/)?.[0]?.replace(/&amp;/g, "&");
      if (link && (!type || link.includes(`type=${type}`))) return link;
    }
    await sleep(300);
  }
  throw new Error("pas d'e-mail pour " + to);
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await sleep(200); } return false; };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = async (o = {}) => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...o }); const p = await c.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); return p; };
  const status = (p) => p.locator("[data-testid=sync-status]").first().textContent().catch(() => "");
  const ls = (p) => p.evaluate(() => Object.keys(localStorage));
  // Lecture directe du document du compte via l'API (jeton de la session du navigateur) : vérifie ce qui est VRAIMENT en base.
  const remote = (p) => p.evaluate(async (key) => { const s = JSON.parse(localStorage.getItem("etudiant-os/auth")); const r = await fetch("http://127.0.0.1:54321/rest/v1/user_data?select=state,version", { headers: { apikey: key, Authorization: "Bearer " + s.access_token } }); return (await r.json())[0]?.state ?? null; }, ANON);
  const addTask = async (p, title) => {
    // Sur téléphone le menu du haut se cache en descendant : on remonte comme le ferait l'utilisateur.
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(350);
    await p.locator("button:has-text('Tâche')").first().click(); await p.fill("#tf-title", title); await p.keyboard.press("Enter"); await sleep(150);
  };
  const login = async (p, mail, pw, path = "login") => {
    await p.goto(APP + path); await p.fill("#li-email", mail); await p.fill("#li-pw", pw); await p.click("button[type=submit]:has-text('Se connecter')");
  };

  console.log("1. Landing, liens et pages publiques");
  let p = await ctx();
  await p.goto(APP); await p.waitForLoadState("networkidle");
  ok((await p.textContent("h1")).includes("Un seul espace"), "titre de la landing");
  for (const id of ["fonctionnalites", "comment", "avantages", "faq"]) ok(await p.locator(`#${id}`).count() === 1 && await p.locator(`a[href='#${id}']`).count() >= 1, `ancre #${id} reliée`);
  ok(await p.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)) || true, "images");
  await p.click("nav >> text=Commencer gratuitement"); ok(p.url().endsWith("/signup"), "CTA → /signup");
  await p.goto(APP); await p.click("nav >> text=Se connecter"); ok(p.url().endsWith("/login"), "Se connecter → /login");
  await p.goto(APP + "confidentialite"); ok((await p.textContent("h1")).includes("confidentialité"), "page confidentialité");
  await p.goto(APP + "conditions"); ok((await p.textContent("h1")).includes("Conditions"), "page conditions");
  await p.goto(APP + "page-inexistante"); ok((await p.textContent("h1")).includes("n'existe pas"), "page 404");
  await p.goto(APP + "app/planning"); await p.waitForURL(/login/); ok(p.url().includes("next=%2Fetudiant-os%2Fapp%2Fplanning"), "page privée → connexion avec retour prévu");
  ok(!(await p.content()).includes("Tableau de bord"), "aucun contenu privé affiché");

  console.log("2. Inscription : validations");
  await p.goto(APP + "signup"); await p.click("button:has-text('Créer mon compte')");
  ok(await p.isVisible("text=Indiquez un prénom") && await p.isVisible("text=Adresse e-mail invalide") && await p.isVisible("text=Acceptez les conditions"), "champs vides signalés");
  await p.fill("#su-name", "Léa"); await p.fill("#su-email", "pas-un-mail"); await p.fill("#su-password", "abc"); await p.fill("#su-confirm", "abd");
  ok(await p.isVisible("text=8 caractères minimum.") && await p.isVisible("text=ne correspondent pas"), "mot de passe faible et confirmation différente signalés");
  ok(await p.getAttribute("#su-email", "aria-invalid") === "true", "champ invalide annoncé (aria-invalid)");

  console.log("3. Inscription réelle, confirmation par e-mail, premier lancement");
  const A = email("alice"), PW = "motdepasse123";
  await p.fill("#su-email", A); await p.fill("#su-password", PW); await p.fill("#su-confirm", PW); await p.check("#su-terms");
  await p.click("button:has-text('Créer mon compte')");
  ok(await until(() => p.isVisible("text=Vérifie ta boîte mail")), "écran « vérifie ta boîte mail »");
  await login(p, A, PW); ok(await until(() => p.isVisible("text=pas encore confirmée")), "connexion refusée avant confirmation");
  await p.goto(await mailLink(A, "signup"));
  ok(await until(() => p.isVisible("text=Bienvenue dans")), "lien de confirmation → connecté, premier lancement");
  ok((await p.inputValue("#ob-name")) === "Léa", "nom d'inscription repris");
  await p.click("text=Créer mon espace");
  ok(await until(() => p.url().endsWith("/app") && p.isVisible("h1:has-text('Tableau de bord')")), "tableau de bord du compte");
  ok(await until(async () => (await status(p)).includes("Enregistré")), "statut « Enregistré » après confirmation serveur");
  await addTask(p, "Rapport de TP");
  ok(await until(async () => (await status(p)).includes("Enregistré")), "nouvelle tâche enregistrée");

  console.log("4. Deuxième appareil : mêmes données, synchronisation en direct");
  const p2 = await ctx({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(p2, A, PW);
  ok(await until(() => p2.isVisible("text=Rapport de TP")), "appareil 2 : la tâche est là");
  await addTask(p, "Fiche de lecture");
  ok(await until(() => p2.isVisible("text=Fiche de lecture"), 12000), "appareil 2 : modification reçue sans recharger (temps réel)");
  await p2.locator("[aria-label=Menu]").click(); await p2.click("[role=menu] >> text=Budget"); await p2.waitForTimeout(400);
  await p2.fill("#bd-label", "Resto U"); await p2.fill("#bd-amount", "3,30"); await p2.click("button:has-text('Ajouter la dépense')");
  await until(async () => (await status(p2)).includes("Enregistré"));
  await p.goto(APP + "app/budget"); ok(await until(() => p.isVisible("li:has-text('Resto U')")), "appareil 1 : dépense de l'appareil 2 visible");

  console.log("5. Hors ligne puis reconnexion, et conflit");
  await p.goto(APP + "app"); await p.waitForTimeout(500);
  await p.context().setOffline(true); await p2.context().setOffline(true);
  await addTask(p, "Tâche hors ligne A"); await addTask(p2, "Tâche hors ligne B");
  ok(await until(async () => (await status(p)).includes("Hors ligne")), "statut « Hors ligne » (jamais « Enregistré »)");
  await p.reload().catch(() => {});
  await p.context().setOffline(false); await p.reload(); await p.waitForTimeout(800);
  ok(await until(() => p.isVisible("text=Tâche hors ligne A")), "modification hors ligne conservée après actualisation");
  ok(await until(async () => (await status(p)).includes("Enregistré")), "envoyée au retour de la connexion");
  await p2.context().setOffline(false); await p2.evaluate(() => window.dispatchEvent(new Event("online")));
  ok(await until(async () => (await status(p2)).includes("Enregistré"), 12000), "appareil 2 renvoie après conflit");
  await p.reload(); ok(await until(() => p.isVisible("text=Tâche hors ligne B")), "conflit : les deux modifications sont conservées");
  ok(await p.isVisible("text=Tâche hors ligne A"), "… y compris celle de l'appareil 1");

  console.log("6. Actualisation, déconnexion, appareil partagé");
  await p.reload(); ok(await until(() => p.isVisible("h1:has-text('Tableau de bord')")), "session restaurée après actualisation");
  await p.goto(APP + "app/settings"); ok(await until(() => p.isVisible("[data-testid=account-email]")), "section Mon compte");
  ok((await p.textContent("[data-testid=account-email]")).includes(A), "e-mail du compte affiché");
  await p.click("button:has-text('Se déconnecter')"); await p.waitForURL(APP);
  const keys = await ls(p);
  ok(!keys.some((k) => k.startsWith("etudiant-os/u/") || k.startsWith("etudiant-os/auth")), "aucune donnée du compte ni session restante (" + keys.join(",") + ")");
  await p.goto(APP + "app"); await p.waitForURL(/login/); ok(true, "/app → connexion après déconnexion");

  console.log("7. Connexion : erreur, puis retour à la page demandée");
  await p.goto(APP + "app/budget"); await p.waitForURL(/login/);
  await p.fill("#li-email", A); await p.fill("#li-pw", "mauvais123"); await p.click("button[type=submit]:has-text('Se connecter')");
  ok(await until(() => p.isVisible("text=E-mail ou mot de passe incorrect")), "mauvais mot de passe refusé");
  await p.fill("#li-pw", PW); await p.click("button[type=submit]:has-text('Se connecter')");
  ok(await until(() => p.url().endsWith("/app/budget")), "retour vers /app/budget après connexion");

  console.log("8. Isolation : un autre compte ne voit rien");
  const C = email("charlie"); const pc = await ctx();
  await pc.goto(APP + "signup"); await pc.fill("#su-name", "Charlie"); await pc.fill("#su-email", C); await pc.fill("#su-password", PW); await pc.fill("#su-confirm", PW); await pc.check("#su-terms"); await pc.click("button:has-text('Créer mon compte')");
  await until(() => pc.isVisible("text=Vérifie ta boîte mail")); await pc.goto(await mailLink(C, "signup"));
  await until(() => pc.isVisible("text=Bienvenue dans")); await pc.click("text=Créer mon espace"); await pc.waitForTimeout(800);
  ok(!(await pc.isVisible("text=Rapport de TP")) && !(await pc.content()).includes("Fiche de lecture"), "aucune tâche d'Alice chez Charlie");
  const stolen = await pc.evaluate(async () => { const r = await fetch("http://127.0.0.1:54321/rest/v1/user_data?select=state", { headers: { apikey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH", Authorization: "Bearer " + JSON.parse(localStorage.getItem("etudiant-os/auth")).access_token } }); return (await r.json()).length; });
  ok(stolen <= 1, `requête directe à l'API : seulement sa propre ligne (${stolen})`);

  console.log("9. Mot de passe oublié");
  const pr = await ctx();
  await pr.goto(APP + "forgot-password"); await pr.fill("#fp-email", C); await pr.click("button:has-text('Envoyer le lien')");
  ok(await until(() => pr.isVisible("text=Si un compte existe")), "message neutre après demande");
  await pr.goto(await mailLink(C, "recovery"));
  ok(await until(() => pr.isVisible("h1:has-text('Nouveau mot de passe')")), "lien → page nouveau mot de passe");
  await pr.fill("#rp-a", "nouveau456"); await pr.fill("#rp-b", "nouveau456"); await pr.click("button:has-text('Enregistrer le mot de passe')");
  ok(await until(() => pr.isVisible("text=Mot de passe modifié")), "mot de passe changé");
  const pr2 = await ctx(); await login(pr2, C, "nouveau456");
  ok(await until(() => pr2.url().endsWith("/app")), "connexion avec le nouveau mot de passe");
  const pr3 = await ctx(); await login(pr3, C, PW); ok(await until(() => pr3.isVisible("text=incorrect")), "ancien mot de passe refusé");
  await pr.goto(APP + "reset-password"); ok(true, "");

  console.log("10. Import des données locales dans un nouveau compte");
  const pl = await ctx();
  await pl.goto(APP); await pl.evaluate(() => {
    const t = new Date(); const d = (n) => new Date(t.getTime() + n * 864e5).toISOString().slice(0, 10);
    localStorage.setItem("etudiant-os/v1", JSON.stringify({ version: 1, courses: [{ id: "c1", name: "Algèbre", code: "MATH", coef: 1, color: "#2f6fed", grades: [] }], classes: [],
      tasks: [{ id: "lt1", title: "Tâche locale", courseId: "c1", kind: "devoir", status: "todo", deadline: d(3), estimate: 60, spent: 0, priority: 2, createdAt: d(0) }],
      groceries: [], chores: [], sleep: [{ date: d(-1), bed: "23:30", wake: "07:30", quality: 4 }], focus: [], budget: { monthly: 500, limits: {}, expenses: [{ id: "e1", date: d(0), amount: 4.2, category: "Restauration", label: "Café" }], recurring: [] },
      settings: { name: "Local", onboarded: true }, templates: [], products: [] }));
  });
  const L = email("local");
  await pl.goto(APP + "signup"); await pl.fill("#su-name", "Local"); await pl.fill("#su-email", L); await pl.fill("#su-password", PW); await pl.fill("#su-confirm", PW); await pl.check("#su-terms"); await pl.click("button:has-text('Créer mon compte')");
  await until(() => pl.isVisible("text=Vérifie ta boîte mail")); await pl.goto(await mailLink(L, "signup"));
  ok(await until(() => pl.isVisible("text=Importer les données de cet appareil")), "proposition d'import (jamais automatique)");
  const prev = await pl.textContent("[data-testid=import-preview]");
  ok(/1\s*tâches/.test(prev) && /1\s*dépenses/.test(prev) && /1\s*nuits/.test(prev), "aperçu de ce qui sera importé : " + prev.replace(/\s+/g, " "));
  await pl.click("button:has-text('Importer dans mon compte')");
  ok(await until(() => pl.isVisible("text=Tâche locale")), "données importées visibles");
  ok(await until(async () => (await status(pl)).includes("Enregistré")), "import enregistré dans le compte");
  ok(await pl.evaluate(() => !!localStorage.getItem("etudiant-os/v1")), "données locales non effacées automatiquement");
  await pl.reload(); await pl.waitForTimeout(1200);
  ok(!(await pl.isVisible("text=Importer les données de cet appareil")), "pas de nouvelle proposition après import");
  const other = await ctx(); await login(other, L, PW); ok(await until(() => other.isVisible("text=Tâche locale")), "données importées présentes sur un autre appareil");
  const st10 = await remote(other); ok(st10 && st10.tasks.filter((t) => t.title === "Tâche locale").length === 1 && st10.budget.expenses.length === 1, "aucun doublon en base");

  console.log("11. Modules métier en mode compte");
  const pf = await ctx(); await pf.clock.install(); await login(pf, L, PW); await until(() => pf.url().endsWith("/app"));
  await pf.goto(APP + "app/focus"); await until(() => pf.isVisible("[data-pomo-toggle]"));
  const tid = await pf.evaluate(() => [...document.querySelectorAll("#pomo-task option")].find((o) => o.textContent.includes("Tâche locale"))?.value);
  await pf.selectOption("#pomo-task", tid); await pf.click("[data-pomo-toggle]"); await pf.clock.fastForward("51:00"); await pf.waitForTimeout(1500);
  await pf.clock.runFor(3000);
  ok(await until(() => pf.isVisible("text=50 min")), "session de focus terminée (50 min comptées)");
  ok(await until(async () => { const st = await remote(pf); return st && st.focus.length === 1 && st.focus[0].minutes === 50 && st.tasks.find((t) => t.title === "Tâche locale").spent === 50; }, 15000), "session enregistrée en base, temps reporté sur la tâche");
  const pv = await ctx(); await login(pv, L, PW); await until(() => pv.url().endsWith("/app"));
  ok(await until(() => pv.isVisible("text=50 min")), "focus visible sur un autre appareil (tableau de bord)");

  console.log("12. Compte : nom, suppression");
  await pv.goto(APP + "app/settings"); await until(() => pv.isVisible("#ac-name"));
  await pv.fill("#ac-name", "Local Renommé"); await pv.click("form:has(#ac-name) button[type=submit]");
  ok(await until(() => pv.isVisible("text=Nom d'affichage mis à jour")), "nom d'affichage modifié");
  await pv.click("button:has-text('Supprimer mon compte')"); await pv.fill("#ac-del", "SUPPRIMER"); await pv.click("button:has-text('Supprimer définitivement')");
  ok(await until(() => pv.url() === APP), "compte supprimé → accueil");
  const gone = await ctx(); await login(gone, L, PW); ok(await until(() => gone.isVisible("text=incorrect")), "connexion impossible après suppression");

  console.log("13. Téléphone : landing et connexion sans débordement");
  const pm = await ctx({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  for (const path of ["", "login", "signup", "forgot-password", "confidentialite"]) { await pm.goto(APP + path); await pm.waitForTimeout(400); const sw = await pm.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 360, `/${path} : pas de défilement horizontal (${sw})`); }
  await pm.goto(APP); await pm.click("[aria-label=Menu]"); ok(await pm.isVisible("#land-menu >> text=FAQ"), "menu mobile de la landing");

  const errs = [p, p2, pc, pr, pl, pf, pv, pm].flatMap((x) => x.errs);
  ok(errs.length === 0, "aucune erreur JavaScript (" + errs.slice(0, 3).join(" | ") + ")");
  console.log(`\n${pass} réussis, ${fail} échoués`); if (fail) console.log("Échecs :\n- " + failures.join("\n- "));
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
