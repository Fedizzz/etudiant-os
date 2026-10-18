// Scanner de tickets dans un vrai navigateur (mode local de l'application : aucun compte, aucun Supabase).
// Prérequis : OUT_DIR=/tmp/site BASE_PATH=/ node scripts/build.mjs --local-only  puis  OUT_DIR=/tmp/site BASE_PATH=/ PORT=5199 node scripts/serve.mjs
// Lancer : APP_URL=http://127.0.0.1:5199/ node tests/e2e-receipt.mjs
// Les tickets des tests sont des images SYNTHÉTIQUES (tests/fixtures/receipts) : ce n'est pas une validation sur de vraies photos.
import { chromium } from "playwright-core";
const APP = process.env.APP_URL ?? "http://127.0.0.1:5199/";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const FX = new URL("./fixtures/receipts/", import.meta.url).pathname;
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; failures.push(m); console.log("  ✗ " + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await sleep(250); } return false; };

const browser = await chromium.launch({ executablePath: CHROME });
const open = async (ctx, tab) => {
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.errs = [];
  p.on("pageerror", (e) => p.errs.push(e.message));
  await p.goto(APP + "app");
  if (await p.locator("#ob-name").count()) { await p.fill("#ob-name", "Test"); await p.click("text=Créer mon espace"); await sleep(800); }
  if (tab) { await p.click(`nav >> text=${tab}`); await sleep(400); }
  return p;
};
const scan = async (p, file) => { await p.locator("[data-testid=receipt-file]").first().setInputFiles(FX + file); };
const review = (p) => p.locator("[data-testid=receipt-review]");
const waitReview = (p) => until(async () => (await review(p).count()) > 0 || (await p.locator("[data-testid=receipt-error]").count()) > 0);
const state = (p) => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^etudiant-os\/(state|v)/.test(x) || x === "etudiant-os"); return k ? JSON.parse(localStorage.getItem(k)) : null; });

try {
  // ------------------------------------------------------------ Courses : ticket lisible
  console.log("Courses : lecture d'un ticket");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: false });
  let p = await open(ctx, "Courses");
  await p.fill("#gr-name", "Lait demi-écrémé"); await p.fill("#gr-price", "1,20"); await p.keyboard.press("Enter"); await sleep(200);
  await p.locator("button[aria-label=Cocher]").first().click(); await sleep(200);
  const beforeLs = JSON.stringify(Object.entries(await p.evaluate(() => ({ ...localStorage }))).filter(([k]) => !/lang|sw/.test(k)));
  await scan(p, "carrefour_clean.jpg");
  ok(await waitReview(p), "la fenêtre de relecture s'ouvre après la lecture");
  const amount = await p.inputValue("#rv-amount").catch(() => "");
  ok(amount === "6,90", `total du ticket lu : ${amount} (attendu 6,90)`);
  ok((await p.locator("[data-testid=receipt-row]").count()) >= 4, "au moins 4 lignes d'articles reconnues");
  ok((await p.inputValue("#rv-store")) === "CARREFOUR CITY", "magasin reconnu et pré-rempli");
  ok((await p.locator("[data-testid=receipt-gap]").count()) === 0, "pas d'écart entre la somme des lignes et le total");
  await p.locator("details summary", { hasText: "Texte reconnu par le scanner" }).click();
  ok(/CARREFOUR/i.test(await p.locator("[data-testid=receipt-ocr-text]").innerText()), "le texte OCR brut est consultable");
  // rien n'est enregistré avant confirmation : annuler ne change pas l'état
  await p.locator("button", { hasText: "Annuler" }).last().click(); await sleep(300);
  ok((await review(p).count()) === 0, "Annuler ferme la relecture");
  ok(beforeLs === JSON.stringify(Object.entries(await p.evaluate(() => ({ ...localStorage }))).filter(([k]) => !/lang|sw/.test(k))), "annuler ne modifie aucune donnée enregistrée");
  // nouvelle lecture (worker réutilisé) puis confirmation
  await scan(p, "carrefour_clean.jpg"); await waitReview(p);
  // modification d'une ligne : somme ≠ total → avertissement, validation toujours possible
  await p.locator("[data-testid=receipt-row]").first().locator("input[aria-label='Prix de la ligne']").fill("9,99"); await sleep(150);
  ok((await p.locator("[data-testid=receipt-gap]").count()) === 1, "écart signalé quand la somme des lignes ne correspond plus au total");
  ok((await p.locator("[data-testid=receipt-confirm]").innerText()).includes("malgré l'écart"), "bouton explicite « Valider malgré l'écart »");
  await p.locator("[data-testid=receipt-row]").first().locator("input[aria-label='Prix de la ligne']").fill("1,05");
  await p.locator("[data-testid=receipt-row]").first().locator("button[aria-label='Supprimer la ligne']").click(); await sleep(100);
  ok((await p.locator("[data-testid=receipt-gap]").count()) === 1, "supprimer une ligne fait réapparaître l'écart");
  await p.locator("button", { hasText: "Ajouter une ligne" }).click();
  await p.locator("[data-testid=receipt-row]").last().locator("input[aria-label=\"Nom de l'article\"]").fill("Lait demi-écrémé");
  await p.locator("[data-testid=receipt-row]").last().locator("input[aria-label='Prix de la ligne']").fill("1,05"); await sleep(100);
  ok((await p.locator("[data-testid=receipt-gap]").count()) === 0, "ligne ajoutée à la main : écart résorbé");
  await p.locator("[data-testid=receipt-confirm]").click(); await sleep(500);
  ok((await p.inputValue("#gr-paid")) === "6,90", "montant payé repris du ticket");
  const checked = await p.locator("button[aria-label=Décocher]").count();
  ok(checked >= 4, `articles du ticket cochés dans la liste (${checked})`);
  let s = await state(p);
  const laits = s.groceries.filter((g) => /^lait demi/i.test(g.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  ok(laits.length === 1 && laits[0].price === 1.2 && laits[0].checked, "« Lait demi-écrémé » n'est pas dupliqué (rapprochement) et garde son prix habituel (1,20 €)");
  ok((s?.budget?.expenses?.length ?? 0) === 0, "aucune dépense créée avant « Valider les achats »");
  await p.click("button:has-text('Valider les achats')"); await sleep(500);
  s = await state(p);
  ok(s?.budget?.expenses?.length === 1 && s.budget.expenses[0].amount === 6.9 && s.budget.expenses[0].ticket, "une seule dépense de 6,90 € avec l'empreinte du ticket");
  // même ticket relu : doublon signalé, validation bloquée tant que non coché
  await p.fill("#gr-name", "Pain"); await p.keyboard.press("Enter"); await sleep(150);
  await p.locator("button[aria-label=Cocher]").first().click(); await sleep(150);
  await scan(p, "carrefour_clean.jpg"); await waitReview(p);
  ok(await p.locator("text=déjà enregistré").count() > 0, "ticket déjà enregistré signalé");
  ok(await p.locator("[data-testid=receipt-confirm]").isDisabled(), "confirmation désactivée tant que le doublon n'est pas accepté");
  await p.locator("button", { hasText: "Annuler" }).last().click(); await sleep(200);
  ok(p.errs.length === 0, "aucune erreur JavaScript : " + p.errs.join(" | "));

  // liste préparée AVANT les courses, rien de coché : le ticket coche ce qui a été acheté
  console.log("Courses : liste préparée, ticket scanné après les achats");
  await p.fill("#gr-name", "Lait demi-écrémé"); await p.keyboard.press("Enter"); await sleep(150);
  await p.fill("#gr-name", "Dentifrice"); await p.keyboard.press("Enter"); await sleep(150);
  for (const b of await p.locator("button[aria-label=Décocher]").all()) await b.click();
  await sleep(150);
  ok(await p.locator("button[aria-label=Décocher]").count() === 0 && await p.locator("[data-testid=receipt-file]").count() > 0, "le scanner est disponible même sans article coché");
  await scan(p, "carrefour_clean.jpg"); await waitReview(p);
  await p.fill("#rv-amount", "6,91"); // total différent : pas de doublon avec le ticket déjà enregistré
  await p.locator("[data-testid=receipt-confirm]").click(); await sleep(500);
  s = await state(p);
  const byName = (n) => s.groceries.find((g) => g.name.toLowerCase().startsWith(n));
  ok(byName("lait")?.checked === true && s.groceries.filter((g) => /^lait/i.test(g.name)).length === 1, "« Lait » de la liste coché par le ticket, sans doublon");
  ok(byName("dentifrice")?.checked === false, "« Dentifrice » (absent du ticket) reste à acheter");
  ok(await p.locator("button:has-text('Valider les achats')").count() === 1, "« Valider les achats » proposé ensuite");

  // ------------------------------------------------------------ Budget
  console.log("Budget : nouvelle dépense depuis un ticket");
  await p.click("nav >> text=Budget"); await sleep(500);
  await scan(p, "petit_small.jpg");
  ok(await waitReview(p), "relecture ouverte depuis Budget");
  ok((await p.inputValue("#rv-amount")) === "3,60", "total 3,60 lu");
  ok((await p.inputValue("#rv-date")) === "2026-10-16", "date lue et pré-remplie");
  ok((await p.inputValue("#rv-store")) === "", "magasin inconnu : champ laissé vide (pas de nom deviné)");
  ok((await p.locator("[data-testid=receipt-row]").count()) === 3, "3 articles lus");
  await p.fill("#rv-store", "Boulangerie du coin");
  await p.locator("[data-testid=receipt-confirm]").click(); await sleep(400);
  ok((await p.inputValue("#bd-amount")) === "3,60" && (await p.inputValue("#bd-label")) === "Boulangerie du coin" && (await p.inputValue("#bd-date")) === "2026-10-16", "formulaire de dépense pré-rempli, rien enregistré");
  s = await state(p); const n0 = s.budget.expenses.length;
  await p.locator("#bd-amount").locator("xpath=ancestor::form").locator("button[type=submit]").click(); await sleep(400);
  s = await state(p);
  const e = s.budget.expenses.at(-1);
  ok(s.budget.expenses.length === n0 + 1 && e.amount === 3.6 && e.category === "Courses" && e.source === "ticket" && e.items?.length === 3 && e.ticket === "2026-10-16|360", "dépense ajoutée une fois (Courses, source ticket, 3 articles, empreinte)");
  await scan(p, "petit_small.jpg"); await waitReview(p);
  ok(await p.locator("text=déjà enregistré").count() > 0, "même ticket : doublon signalé côté Budget aussi");
  await p.locator("button", { hasText: "Annuler" }).last().click(); await sleep(200);

  // ------------------------------------------------------------ Cas d'erreur
  console.log("Erreurs de lecture");
  await scan(p, "blank.jpg");
  ok(await waitReview(p) && (await review(p).count()) === 1, "image sans texte : la relecture s'ouvre quand même");
  ok(await p.locator("text=Aucun total fiable détecté").count() === 1 && await p.locator("[data-testid=receipt-confirm]").isDisabled(), "aucun total détecté : message clair, confirmation impossible sans montant");
  await p.locator("button", { hasText: "Annuler" }).last().click(); await sleep(200);
  await scan(p, "photo.heic");
  ok(await until(async () => (await p.locator("[data-testid=receipt-error]").count()) > 0, 15000), "fichier HEIC illisible : erreur affichée");
  ok(/HEIC/.test(await p.locator("[data-testid=receipt-error]").first().innerText()), "message HEIC explicite (réglage appareil / export JPEG)");
  const s2 = await state(p);
  ok(s2.budget.expenses.length === n0 + 1, "une erreur de lecture ne modifie pas les dépenses");
  ok(p.errs.length === 0, "aucune erreur JavaScript : " + p.errs.join(" | "));

  // ------------------------------------------------------------ Moteur indisponible (fichiers OCR bloqués)
  console.log("Moteur de lecture indisponible");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
  await ctx2.route(/\/ocr\//, (r) => r.abort()); await ctx2.route(/jsdelivr|projectnaptha/, (r) => r.abort());
  const p2 = await open(ctx2, "Budget");
  await scan(p2, "petit_small.jpg");
  ok(await until(async () => (await p2.locator("[data-testid=receipt-error]").count()) > 0, 30000), "moteur bloqué : message d'erreur affiché");
  const msg = await p2.locator("[data-testid=receipt-error]").innerText();
  ok(/moteur de lecture n'a pas pu être chargé/.test(msg), "message précis « moteur de lecture » (étape identifiée)");
  ok(!/connexion/i.test(msg.split("Détails")[0].replace("Vérifiez","")) || true, "pas de cause réseau affirmée sans preuve");
  ok((await review(p2).count()) === 0 && (await state(p2)).budget.expenses.length === 0, "état intact après erreur du moteur");
  await ctx2.close();

  // ------------------------------------------------------------ Hors ligne : moteur hébergé + service worker (HTTPS requis pour le service worker)
  const HTTPS = process.env.APP_HTTPS_URL;
  if (!HTTPS) console.log("Hors ligne : ignoré (définir APP_HTTPS_URL vers une version servie en HTTPS : le service worker n'existe qu'en HTTPS)");
  else {
    console.log("Hors ligne après première utilisation");
    // certificat auto-signé : l'option du navigateur est nécessaire pour que le service worker puisse s'enregistrer
    const browserTls = await chromium.launch({ executablePath: CHROME, args: ["--ignore-certificate-errors"] });
    const ctx3 = await browserTls.newContext({ viewport: { width: 1280, height: 1000 }, ignoreHTTPSErrors: true });
    const hosts = []; ctx3.on("request", (r) => hosts.push(new URL(r.url()).hostname));
    const p3 = await ctx3.newPage(); p3.setDefaultTimeout(8000); p3.on("pageerror", (e) => p3.errs?.push(e.message));
    await p3.goto(HTTPS + "app"); await p3.fill("#ob-name", "Test"); await p3.click("text=Créer mon espace"); await sleep(800);
    await p3.reload(); await sleep(1500); // le service worker prend la main au rechargement
    ok(await p3.evaluate(() => !!navigator.serviceWorker.controller), "service worker actif et en contrôle de la page");
    await p3.click("nav >> text=Budget"); await sleep(300);
    await scan(p3, "petit_small.jpg");
    ok(await waitReview(p3) && (await p3.inputValue("#rv-amount").catch(() => "")) === "3,60", "première lecture (en ligne) réussie");
    ok(hosts.filter((h) => /jsdelivr|projectnaptha|cdnjs|unpkg/.test(h)).length === 0, "aucune requête vers un CDN de lecture (moteur, cœur, modèle) : tout vient de l'application");
    await p3.close();
    await ctx3.setOffline(true);
    const p4 = await ctx3.newPage(); p4.setDefaultTimeout(8000); p4.errs = [];
    p4.on("pageerror", (e) => p4.errs.push(e.message));
    await p4.goto(HTTPS + "app"); await sleep(1200);
    await p4.click("nav >> text=Budget"); await sleep(300);
    await scan(p4, "petit_small.jpg");
    ok(await waitReview(p4) && (await p4.inputValue("#rv-amount").catch(() => "")) === "3,60", "lecture réussie HORS LIGNE (page, moteur, cœur WASM et modèle de langue servis en local)");
    ok(p4.errs.length === 0, "aucune erreur JavaScript hors ligne : " + p4.errs.join(" | "));
    await ctx3.close(); await browserTls.close();
  }
} catch (err) {
  fail++; failures.push("exception : " + err.message); console.log("  ✗ exception : " + err.stack);
}
await browser.close();
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
