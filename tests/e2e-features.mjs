// Nouvelles fonctions dans un vrai navigateur (mode local, aucun compte) : tutoriel, thème automatique, examens et plan de révision,
// reports, calendrier (création par clic, suppression confirmée, notes glissées, routines, tâches sans horaire), achats à recevoir,
// mode cuisine, argent de poche, analyse PDF, sélecteurs de durée.
// Prérequis : OUT_DIR=/tmp/site BASE_PATH=/ node scripts/build.mjs --local-only  puis  OUT_DIR=/tmp/site BASE_PATH=/ PORT=5199 node scripts/serve.mjs
// Lancer : APP_URL=http://127.0.0.1:5199/ node tests/e2e-features.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
const APP = process.env.APP_URL ?? "http://127.0.0.1:5199/";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; failures.push(m); console.log("  ✗ " + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 }, acceptDownloads: true });
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const go = async (tab) => { await p.click(`nav >> text=${tab}`); await sleep(1100); };
const stateOf = () => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x === "etudiant-os/v1"); return k ? JSON.parse(localStorage.getItem(k)) : null; });
const toastText = () => p.locator("[role=status]").allInnerTexts();

try {
  console.log("Premier lancement et tutoriel");
  await p.goto(APP + "app");
  await p.fill("#ob-name", "Test"); await p.click("text=Créer mon espace"); await sleep(900);
  ok(await p.locator("[data-testid=tutorial]").count() === 1, "le tutoriel guidé s'affiche après l'Onboarding");
  const t1 = await p.locator("[data-testid=tutorial]").innerText();
  await p.click("[data-testid=tutorial] >> text=Suivant"); await sleep(1100);
  const t2 = await p.locator("[data-testid=tutorial]").innerText();
  ok(t1 !== t2 && /2\/9/.test(t2), "« Suivant » passe à l'étape 2 et change de page");
  ok((await p.locator("h1").first().innerText()).toLowerCase().includes("acad"), "le tutoriel ouvre la page correspondante");
  await p.click("[data-testid=tutorial] >> text=Passer"); await sleep(400);
  ok(await p.locator("[data-testid=tutorial]").count() === 0, "« Passer » ferme le tutoriel");
  ok((await stateOf()).settings.tutorialDone === true, "le choix est enregistré (tutorialDone)");
  await p.reload(); await sleep(700);
  ok(await p.locator("[data-testid=tutorial]").count() === 0, "le tutoriel ne revient pas après rechargement");

  console.log("Thème automatique");
  await go("Réglages");
  await p.selectOption("#st-theme", "auto"); await sleep(300);
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  await p.fill("#st-dark-from", hhmm((nowM + 1440 - 60) % 1440)); await p.fill("#st-dark-to", hhmm((nowM + 60) % 1440)); await sleep(500);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark", "dans la plage nocturne : thème sombre");
  await p.fill("#st-dark-from", hhmm((nowM + 120) % 1440)); await p.fill("#st-dark-to", hhmm((nowM + 240) % 1440)); await sleep(500);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "light", "hors plage : thème clair");
  ok((await stateOf()).settings.theme === "auto", "la préférence « auto » est enregistrée");
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("etudiant-os/theme"))) === "auto", "la clé de thème permet l'application avant le rendu");
  await p.selectOption("#st-theme", "dark"); await sleep(300);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark" && (await stateOf()).settings.theme === "dark", "le choix manuel reste possible et prioritaire");
  await p.selectOption("#st-theme", "system"); await sleep(200);
  await p.click("[data-testid=restart-tour]"); await sleep(600);
  ok(await p.locator("[data-testid=tutorial]").count() === 1, "« Revoir le tutoriel » (Réglages) relance le tutoriel");
  await p.click("[data-testid=tutorial] >> text=Passer"); await sleep(300);

  console.log("Académique : module, examen, heure limite, plan de révision, report");
  await go("Académique");
  await p.fill("#cf-name", "Maths"); await p.click("button:has-text('Module')"); await sleep(300);
  await p.click("button:has-text('Nouvelle tâche')"); await sleep(300);
  await p.selectOption("#tf-kind", "perso"); await p.selectOption("#tf-kind", "devoir");
  ok(await p.inputValue("#tf-dl") !== "9999-12-31" && await p.inputValue("#tf-dl") === plus(3), "passer de « devoir perso » à « devoir » remet une échéance réelle (pas l'an 9999)");
  await p.selectOption("#tf-kind", "devoir");
  ok(await p.locator("#tf-est").evaluate((e) => e.tagName) === "SELECT", "durée estimée : sélecteur de durée commun");
  await p.fill("#tf-title", "Partiel de maths"); await p.selectOption("#tf-kind", "examen"); await p.fill("#tf-dl", plus(5));
  await p.click("button:has-text('Midi')");
  await p.selectOption("#tf-est", "custom"); await p.fill("#tf-est-custom", "200");
  await p.click("[data-testid=revision-plan] >> text=Générer"); await sleep(300);
  const sessions = await p.locator("[data-testid=revision-plan] li").count();
  ok(sessions >= 3, `le plan de révision est généré (${sessions} séances)`);
  await p.fill("[data-testid=revision-plan] li:first-child input[placeholder^=Thème]", "Algèbre");
  await p.fill("[data-testid=revision-plan] li:first-child input[aria-label^='Début']", "16:00"); await p.fill("[data-testid=revision-plan] li:first-child input[aria-label^='Fin']", "17:30");
  await p.click("[role=dialog] button[type=submit]"); await sleep(500);
  let st = await stateOf(); const ex = st.tasks.find((t) => t.title === "Partiel de maths");
  ok(ex && ex.dueTime === "12:00" && ex.revision.length === sessions && ex.estimate >= 200, "examen enregistré avec heure et plan");
  ok(ex.revision.some((r) => r.start === "16:00" && r.minutes === 90), "début et fin choisis pour une séance (16:00–17:30)");
  ok(ex.revision.reduce((n, r) => n + r.minutes, 0) >= 195 && ex.revision.some((r) => r.topic === "Algèbre"), "séances: durée totale et thème conservés");
  ok((await p.locator("[data-testid=exams-list]").innerText()).includes("Partiel de maths") && (await p.locator("[data-testid=exams-list]").innerText()).includes("J-5"), "carte « Examens à venir » avec compte à rebours");
  // report
  await p.click("button:has-text('Nouvelle tâche')"); await sleep(300);
  ok(await p.locator("text=Moment préféré pour travailler").count() === 1 && (await p.locator("text=Heure limite").count()) === 0, "le formulaire propose un « moment préféré » (matin, midi, soir), pas une heure limite");
  await p.click("[role=dialog] button:has-text('Soir')"); await p.fill("#tf-title", "Devoir A"); await p.fill("#tf-dl", plus(2)); await p.click("[role=dialog] button[type=submit]"); await sleep(300);
  await p.click("button:has-text('Nouvelle tâche')"); await sleep(300);
  await p.fill("#tf-title", "Devoir B"); await p.fill("#tf-dl", plus(2)); await p.click("[role=dialog] button[type=submit]"); await sleep(300);
  await p.locator("article:has-text('Devoir A') >> button[aria-label^='Reporter']").click(); await sleep(200);
  await p.click("[role=dialog][aria-label=Reporter] >> text=+1 semaine"); await sleep(400);
  st = await stateOf(); const A = st.tasks.find((t) => t.title === "Devoir A"), B = st.tasks.find((t) => t.title === "Devoir B");
  ok(A.prefer === "20:00" && !A.dueTime, "moment préféré « soir » enregistré");
  ok(A.deadline === plus(9) && A.postponed.length === 1 && A.postponed[0].from === plus(2), "le report déplace l'échéance et garde l'historique");
  ok(B.deadline === plus(2) && !B.postponed, "l'échéance d'un autre devoir ne change pas");
  ok((await p.locator("article:has-text('Devoir A')").innerText()).includes("Reportée 1×"), "badge « Reportée 1× » visible");
  // notes
  await p.fill("textarea[aria-label=Notes]", "- Appeler le prof de maths\n- Acheter des cahiers"); await sleep(900);

  console.log("Planning : création par clic, détail, suppression confirmée, notes glissées");
  await go("Planning");
  const grid = p.locator("[data-testid=day-grid]"); await p.evaluate(() => window.scrollTo(0, 300)); await sleep(200); const box = await grid.boundingBox();
  await p.mouse.click(box.x + 24, Math.max(box.y, 0) + 300); await sleep(400);
  ok(await p.locator("[data-testid=event-editor]").count() === 1, "toucher une plage vide ouvre « Nouvel événement »");
  ok(/^\d\d:\d\d$/.test(await p.inputValue("#ee-start")) && await p.inputValue("#ee-date") === plus(0), "la date et l'heure du créneau touché sont préremplies");
  await p.fill("#ee-title", "Dentiste"); await p.fill("#ee-place", "Cabinet Dupont");
  await p.selectOption("#ee-dur", "45"); await p.selectOption("#ee-remind", "30");
  await p.fill("#ee-steps", "Carte vitale"); await p.keyboard.press("Enter");
  await p.click("[data-testid=event-editor] >> button[type=submit]"); await sleep(500);
  st = await stateOf(); const ev = st.events.find((e) => e.title === "Dentiste");
  ok(ev && ev.place === "Cabinet Dupont" && ev.remind === 30 && ev.steps.length === 1, "événement créé avec lieu, rappel et checklist");
  ok(ev && (parseInt(ev.end) * 60 + parseInt(ev.end.slice(3))) - (parseInt(ev.start) * 60 + parseInt(ev.start.slice(3))) === 45, "la durée choisie (45 min) donne l'heure de fin");
  await p.locator("[data-testid=events-list] >> text=Dentiste").click(); await sleep(300);
  ok((await p.locator("[data-testid=event-editor]").count()) === 1 && (await p.inputValue("#ee-place")) === "Cabinet Dupont", "la liste ouvre l'écran de détails de l'événement");
  await p.click("[data-testid=event-editor] >> text=Annuler"); await sleep(200);
  // suppression avec confirmation (bloc du planning)
  const blk = p.locator("[role=button]:has-text('Dentiste')").first(); await blk.scrollIntoViewIfNeeded(); await blk.click(); await sleep(300);
  ok(await p.locator("[data-testid=block-detail]").count() === 1, "toucher le bloc ouvre sa fiche");
  await p.click("[data-testid=block-delete]"); await sleep(250);
  ok(await p.locator("[data-testid=confirm-dialog]").count() === 1, "la suppression demande une confirmation");
  await p.click("[data-testid=confirm-dialog] >> text=Annuler"); await sleep(250);
  ok((await stateOf()).events.some((e) => e.title === "Dentiste"), "« Annuler » conserve l'événement");
  await p.click("[data-testid=block-delete]"); await sleep(200); await p.click("[data-testid=confirm-yes]"); await sleep(400);
  ok(!(await stateOf()).events.some((e) => e.title === "Dentiste"), "« Supprimer » (confirmé) retire l'événement");
  // notes dans le calendrier
  ok(await p.locator("[data-testid=notes-tray] li").count() === 2, "les lignes de notes sont proposées à planifier");
  await p.evaluate(() => window.scrollTo(0, 300)); await sleep(200);
  await p.locator("[data-testid=notes-tray] li").first().dragTo(p.locator("[data-testid=day-grid]"), { targetPosition: { x: 30, y: 300 } }); await sleep(500);
  ok(await p.locator("[data-testid=event-editor]").count() === 1 && (await p.inputValue("#ee-title")) === "Appeler le prof de maths", "glisser une note dans le calendrier crée un événement prérempli");
  await p.click("[data-testid=event-editor] >> button[type=submit]"); await sleep(400);
  ok((await stateOf()).events.some((e) => e.title === "Appeler le prof de maths"), "l'événement issu de la note est enregistré");
  // sélection multiple : rectangle à la souris puis glisser le groupe
  for (const [name, hh] of [["Multi A", "20:00"], ["Multi B", "21:30"]]) {
    await p.evaluate(() => window.scrollTo(0, 300)); await sleep(150);
    const gb = await p.locator("[data-testid=day-grid]").boundingBox(); await p.mouse.click(gb.x + 24, Math.max(gb.y, 0) + 40); await sleep(350);
    await p.fill("#ee-title", name); await p.fill("#ee-start", hh); await p.selectOption("#ee-dur", "30");
    await p.click("[data-testid=event-editor] >> button[type=submit]"); await sleep(400);
  }
  const startOf = async (n) => (await stateOf()).events.find((e) => e.title === n)?.start;
  const a0 = await startOf("Multi A"), b0 = await startOf("Multi B");
  await p.locator("[data-bk*=event]:has-text('Multi A')").first().scrollIntoViewIfNeeded();
  const ba = await p.locator("[data-bk]:has-text('Multi A')").first().boundingBox(), bb = await p.locator("[data-bk]:has-text('Multi B')").first().boundingBox();
  const g = await p.locator("[data-testid=day-grid]").boundingBox();
  await p.mouse.move(g.x + g.width - 6, ba.y - 6); await p.mouse.down(); await p.mouse.move(g.x + 80, (ba.y + bb.y) / 2, { steps: 6 }); await p.mouse.move(g.x + 80, bb.y + bb.height + 6, { steps: 6 }); await p.mouse.up(); await sleep(300);
  ok(await p.locator("[data-testid=multi-bar]").count() === 1 && /2 sélectionnés/.test(await p.locator("[data-testid=multi-bar]").innerText()), "un rectangle tracé à la souris sélectionne plusieurs événements");
  ok(await p.locator("[data-testid=event-editor]").count() === 0, "tracer le rectangle ne crée pas d'événement");
  const sb = await p.locator("[data-bk]:has-text('Multi A')").first().boundingBox();
  await p.mouse.move(sb.x + 20, sb.y + 8); await p.mouse.down(); await p.mouse.move(sb.x + 20, sb.y + 8 - 84 / 2, { steps: 8 }); await p.mouse.up(); await sleep(400);
  const a1 = await startOf("Multi A"), b1 = await startOf("Multi B"), mn = (h) => parseInt(h) * 60 + parseInt(h.slice(3));
  ok(mn(a0) - mn(a1) === 30 && mn(b0) - mn(b1) === 30, "glisser l'un des blocs sélectionnés décale tout le groupe de la même durée (−30 min)");
  await p.locator("[data-testid=select-mode]").click(); await p.locator("[data-bk]:has-text('Multi A')").first().click(); await p.locator("[data-bk]:has-text('Multi B')").first().click(); await sleep(200);
  ok(/2 sélectionnés/.test(await p.locator("[data-testid=multi-bar]").innerText()), "le mode « Sélectionner » permet de cocher plusieurs blocs au toucher/clic");
  await p.fill("[data-testid=multi-bar] input[type=date]", plus(1)); await p.click("[data-testid=multi-move-day]"); await sleep(400);
  { const s2 = await stateOf(); ok(["Multi A", "Multi B"].every((n) => s2.events.find((e) => e.title === n)?.date === plus(1)), "« Déplacer à ce jour » envoie tout le groupe au jour choisi"); }
  await p.locator("[data-testid=select-mode]").click();
  // rappel imminent
  { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes() + 10;
    if (m < 23 * 60) {
      const before = (await toastText()).length;
      await p.evaluate(() => window.scrollTo(0, 300)); await sleep(150);
      const bx = await p.locator("[data-testid=day-grid]").boundingBox(); await p.mouse.click(bx.x + 24, Math.max(bx.y, 0) + 200); await sleep(400);
      await p.fill("#ee-title", "Visio TD"); await p.fill("#ee-start", hhmm(m)); await p.selectOption("#ee-remind", "30");
      await p.click("[data-testid=event-editor] >> button[type=submit]"); await sleep(700);
      ok((await toastText()).join(" ").includes("⏰ Visio TD"), "un rappel imminent s'affiche dans l'application");
    } }
  // examen détaillé : séances dans le planning d'un jour de révision
  const firstRev = ex.revision.sort((a, b) => a.date.localeCompare(b.date))[0];
  // tâche sans horaire
  await go("Tâches perso");
  await p.fill("[aria-label='Ajout rapide']", "Imprimer le TD"); await p.keyboard.press("Enter"); await sleep(300);
  await go("Planning");
  ok((await p.locator("[data-testid=untimed-strip]").innerText()).includes("Imprimer le TD"), "une tâche sans horaire s'affiche en pastille comme les routines");

  console.log("Tâche perso : heure limite, début sans fin, report");
  await go("Tâches perso");
  await p.click("button:has-text('Tâche détaillée')"); await sleep(300);
  await p.fill("#td-text", "Rendre la carte"); await p.click("button:has-text('Soir')");
  await p.click("[role=dialog] button[type=submit]"); await sleep(400);
  let td = (await stateOf()).todos.find((x) => x.text === "Rendre la carte");
  ok(td && td.dueTime === "20:00" && td.due === plus(0), "tâche perso avec moment préféré « soir »");
  await p.click("button:has-text('Tâche détaillée')"); await sleep(300);
  await p.fill("#td-text", "RDV banque"); await p.fill("#td-start", "15:00"); await p.fill("#td-end", "16:00");
  await p.click("text=Retirer l'heure de fin"); await sleep(150);
  ok(await p.inputValue("#td-end") === "", "« Retirer l'heure de fin » vide la fin");
  await p.click("[role=dialog] button[type=submit]"); await sleep(400);
  td = (await stateOf()).todos.find((x) => x.text === "RDV banque");
  ok(td && td.start === "15:00" && !td.end, "tâche perso avec début seul");
  await p.locator("li:has-text('Rendre la carte') >> button[aria-label^='Reporter']").click(); await sleep(200);
  await p.click("[role=dialog][aria-label=Reporter] >> text=+1 jour"); await sleep(400);
  td = (await stateOf()).todos.find((x) => x.text === "Rendre la carte");
  ok(td.due === plus(1) && td.postponed.length === 1, "report d'une tâche perso avec historique");

  console.log("Routine dans le calendrier");
  await go("Routines");
  await p.locator("main button:has-text('Routine')").first().click(); await sleep(400);
  await p.fill("#hb-name", "Yoga"); await p.fill("#hb-time", "07:30");
  await p.check("[data-testid=habit-calendar] input[type=checkbox]"); await p.selectOption("#hb-dur", "30");
  await p.click("[role=dialog] button[type=submit]"); await sleep(400);
  const h = (await stateOf()).habits.find((x) => x.name === "Yoga");
  ok(h && h.inCalendar === true && h.duration === 30 && h.time === "07:30", "routine configurée (calendrier, durée, heure)");
  await go("Planning");
  ok(await p.locator("[role=button]:has-text('Yoga')").count() >= 1, "la routine apparaît dans le calendrier");
  await p.locator("[role=button]:has-text('Yoga')").first().evaluate((el) => el.click()); await sleep(300);
  await p.click("[data-testid=block-delete]"); await sleep(200); await p.click("[data-testid=confirm-yes]"); await sleep(400);
  const h2 = (await stateOf()).habits.find((x) => x.name === "Yoga");
  ok(h2 && !h2.inCalendar && (await p.locator("[role=button]:has-text('Yoga')").count()) === 0, "retirer du calendrier conserve la routine");

  console.log("Courses : à recevoir / à la maison, recettes et mode cuisine");
  await go("Courses");
  await p.fill("#gr-name", "Lait"); await p.fill("#gr-price", "1,20"); await p.keyboard.press("Enter"); await sleep(250);
  await p.locator("button[aria-label=Cocher]").first().click(); await sleep(200);
  await p.check("[data-testid=gr-pending]"); await p.click("button:has-text('Valider (à recevoir)')"); await sleep(400);
  ok(await p.locator("[data-testid=to-receive]").count() === 1 && (await p.locator("[data-testid=to-receive]").innerText()).includes("Lait"), "l'achat commandé est « à recevoir »");
  ok(!(await p.locator("text=Estimation d'après vos achats").count()), "il n'est pas encore « à la maison »");
  await p.click("[data-testid=to-receive] >> text=Reçu / prêt"); await sleep(400);
  ok(await p.locator("[data-testid=to-receive]").count() === 0 && (await p.locator("text=Estimation d'après vos achats").count()) === 1, "après réception, l'article est à la maison");
  await p.click("[data-testid=recipe-new]"); await sleep(250);
  await p.fill("#rc-name", "Pâtes"); await p.fill("#rc-ing", "200 g de pâtes\n2 œufs"); await p.fill("#rc-steps", "Cuire les pâtes 10 min\nMélanger avec les œufs");
  await p.click("[data-testid=recipe-form] >> button[type=submit]"); await sleep(400);
  await p.locator("[data-testid^=cook-]").first().click(); await sleep(400);
  ok(await p.locator("[data-testid=cooking-mode]").count() === 1, "le mode cuisine s'ouvre en plein écran");
  const fontPx = await p.locator("[data-testid=cooking-mode] ol li button span").nth(1).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  ok(fontPx >= 24, `texte lisible (${fontPx}px)`);
  ok((await p.locator("[data-testid=cooking-mode]").innerText()).includes("Lancer 10 min"), "minuteur détecté dans l'étape");
  await p.click("[data-testid=cooking-next]"); await sleep(250);
  ok((await p.locator("[data-testid=cooking-mode]").innerText()).includes("Étapes 1/2"), "cocher une étape fait avancer la progression");
  await p.click("[role=tab]:has-text('Ingrédients')"); await p.locator("[data-testid=cooking-mode] ul li button").first().click(); await sleep(200);
  ok((await p.locator("[data-testid=cooking-mode]").innerText()).includes("Ingrédients 1/2"), "les ingrédients se cochent");
  await p.click("[aria-label='Plus de personnes']"); await sleep(150);
  ok((await p.locator("[data-testid=cooking-mode]").innerText()).includes("300 g de pâtes"), "les quantités suivent le nombre de personnes");
  await p.click("[data-testid=cooking-close]"); await sleep(250);
  await p.click("button:has-text('Ingrédients → liste')"); await sleep(300);
  ok((await stateOf()).groceries.some((g) => g.name === "pâtes" && g.qty === "200 g"), "les ingrédients rejoignent la liste de courses");

  console.log("Ménage : sélecteur de durée");
  await go("Ménage");
  await p.fill("#ch-name", "Poubelles"); await p.selectOption("#ch-min", "30");
  await p.locator("main button[type=submit]:has-text('Ajouter')").last().click(); await sleep(400);
  ok((await stateOf()).chores.some((c) => c.name === "Poubelles" && c.minutes === 30), "corvée créée avec la durée choisie (30 min)");

  console.log("En ce moment : compte à rebours");
  { const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m > 20 && m < 23 * 60 + 30) {
      await p.evaluate(({ s, e, d }) => { const k = "etudiant-os/v1"; const st = JSON.parse(localStorage.getItem(k)); st.events = [...(st.events ?? []), { id: "live1", title: "Cours en cours", date: d, start: s, end: e, recurrence: "none", until: null }]; localStorage.setItem(k, JSON.stringify(st)); },
        { s: hhmm(m - 10), e: hhmm(m + 20), d: plus(0) });
      await p.reload(); await sleep(1500); await go("Tableau de bord");
      const txt = await p.locator("[data-testid=live-now]").first().innerText();
      ok(txt.includes("Cours en cours") && txt.includes("restant"), "la carte « En ce moment » affiche l'événement en cours");
      const c1 = await p.locator("[data-testid=live-countdown]").first().innerText(); await sleep(2100);
      const c2 = await p.locator("[data-testid=live-countdown]").first().innerText();
      const sec = (x) => x.split(":").reduce((a, v) => a * 60 + Number(v), 0);
      ok(sec(c1) <= 20 * 60 && sec(c1) > 0 && sec(c2) < sec(c1), `le compte à rebours diminue chaque seconde (${c1} → ${c2})`);
      await go("Planning");
      ok(await p.locator("[data-testid=live-now]").count() >= 1, "le compte à rebours est aussi dans le planning du jour");
    } }

  console.log("Série : restaurations et compagnon");
  { const s0 = await stateOf(); const d = (n) => plus(n);
    // jours actifs : il y a 6, 5, 4 jours (routine cochée) ; manqué : il y a 3 et 2 jours ; actif hier et aujourd'hui
    await p.evaluate(({ days }) => { const k = "etudiant-os/v1"; const st = JSON.parse(localStorage.getItem(k)); st.habits = [{ id: "hh", name: "Étirements", emoji: "🤸", cat: "sport", days: [0,1,2,3,4,5,6], done: days, since: "2026-01-01" }]; localStorage.setItem(k, JSON.stringify(st)); }, { days: [d(-6), d(-5), d(-4), d(-1), d(0)] });
    await p.reload(); await sleep(1500);
    await p.click("button[aria-label^='Série']"); await sleep(600);
    ok((await p.locator("[data-testid=streak-restore]").innerText()).includes("3 / 3"), "3 restaurations disponibles ce mois-ci");
    ok(await p.locator("[data-testid=restore-day]").count() === 1, "un seul jour offert à la fois (le premier manqué)");
    await p.locator("[data-testid=restore-day]").click(); await sleep(400);
    ok((await p.locator("[data-testid=streak-restore]").innerText()).includes("2 / 3") && await p.locator("[data-testid=restore-day]").count() === 1, "après une restauration : 2/3 et le jour suivant est offert");
    await p.locator("[data-testid=restore-day]").click(); await sleep(400);
    ok((await stateOf()).restores.length === 2 && (await p.locator("[data-testid=streak-hero]").innerText()).includes("7 jours"), "la série est rejointe (7 jours)");
    ok((await p.locator("[data-testid=restore-day]").count()) === 0, "plus aucun jour à restaurer");
    await p.fill("#pet-name", "Mochi"); await p.click("[aria-label=Renard]"); await p.click("[data-testid=pet-adopt-btn]"); await sleep(400);
    ok((await p.locator("[data-testid=pet]").innerText()).includes("Mochi") && (await stateOf()).pet.kind === "renard", "adoption d'un compagnon");
    const e0 = await p.locator("[data-testid=pet-emoji]").innerText();
    ok(e0 === "🥚" && (await p.locator("[data-testid=pet]").innerText()).includes("Œuf"), "il commence en œuf");
    await p.click("[data-testid=pet-feed]"); await sleep(300);
    ok((await stateOf()).pet.fed.length === 1 && await p.locator("[data-testid=pet-feed]").isDisabled(), "il se nourrit une seule fois par jour");
    await p.keyboard.press("Escape"); await sleep(300); }

  await go("Ménage");
  await p.locator("[data-testid^=chore-edit-]").first().click(); await sleep(300);
  await p.fill("#ce-name", "Sortir les poubelles"); await p.click("[data-testid=chore-edit] >> text=Une seule fois"); await p.fill("#ce-date", plus(2));
  await p.fill("#ce-time", "18:30"); await p.selectOption("#ce-min", "45");
  await p.click("[data-testid=chore-edit] >> button[type=submit]"); await sleep(400);
  const ch = (await stateOf()).chores.find((c) => c.name === "Sortir les poubelles");
  ok(ch && ch.recurrence === "once" && ch.date === plus(2) && ch.time === "18:30" && ch.minutes === 45, "corvée modifiée : nom, date, heure de début et durée");
  await p.locator("[data-testid^=chore-edit-]").first().click(); await sleep(300);
  await p.click("[data-testid=chore-edit] >> [aria-label=\"Retirer l'heure\"]"); await p.click("[data-testid=chore-edit] >> button[type=submit]"); await sleep(400);
  ok(!(await stateOf()).chores.find((c) => c.name === "Sortir les poubelles").time, "l'heure de début peut être retirée");

  console.log("Budget : argent de poche, reste par catégorie, analyse PDF");
  await go("Budget");
  await p.selectOption("#bd-cat", "Restauration"); await p.fill("#bd-amount", "12,50"); await p.fill("#bd-label", "Resto"); await p.keyboard.press("Enter"); await sleep(300);
  await p.click("[data-testid=pocket-config]"); await sleep(200);
  await p.fill("#pk-amt", "40"); await p.click("[data-testid=pocket-form] >> button[type=submit]"); await sleep(400);
  ok((await p.locator("[data-testid=pocket]").innerText()).includes("restants sur"), "l'argent de poche est configuré et suivi");
  const rem = await p.locator("[data-testid=pocket-remaining]").innerText();
  ok(/27,50/.test(rem), `reste de l'enveloppe : ${rem.replace(/\s+/g, " ")}`);
  await p.click("[data-testid=limits-btn]"); await p.fill("#lim-Restauration", "30"); await p.locator("#lim-Restauration").blur(); await p.click("[data-testid=limits-btn]"); await sleep(300);
  ok((await p.locator("[data-testid=cat-remaining-Restauration]").innerText()).includes("Reste 17,50"), "reste par catégorie affiché");
  // dettes entre personnes
  await p.click("[data-testid=debt-add-btn]"); await sleep(200);
  await p.fill("#db-person", "Inès"); await p.fill("#db-amount", "40"); await p.fill("#db-label", "Concert");
  await p.click("[data-testid=debt-form] >> button[type=submit]"); await sleep(400);
  ok((await p.locator("[data-testid=debts]").innerText()).includes("Inès") && (await p.locator("[data-testid=debts]").innerText()).includes("+40,00"), "une personne qui me doit de l'argent (hors colocation) apparaît");
  await p.fill("[aria-label='Montant remboursé par Inès']", "15"); await p.click("button:has-text('Reçu')"); await sleep(300);
  ok((await stateOf()).budget.debts[0].repaid[0].amount === 15 && (await p.locator("[data-testid=debts]").innerText()).includes("+25,00"), "remboursement partiel : le reste est mis à jour (25 €)");
  await p.click("[data-testid=debt-add-btn]"); await p.click("[data-testid=debt-form] >> text=Je dois"); await p.fill("#db-person", "Hugo"); await p.fill("#db-amount", "12"); await p.click("[data-testid=debt-form] >> button[type=submit]"); await sleep(300);
  ok((await p.locator("[data-testid=debts]").innerText()).includes("−12,00"), "ce que je dois à quelqu'un apparaît de l'autre côté");
  await p.click("button[aria-label='Hugo']").catch(() => {}); await p.locator("li:has-text('Hugo') >> button:has-text('Soldé')").click(); await sleep(300);
  ok(!(await p.locator("[data-testid=debts]").innerText()).includes("Hugo"), "« Soldé » retire la dette");
  // plafonds suggérés
  await p.click("[data-testid=suggest-limits-btn]"); await sleep(200);
  const nSug = await p.locator("[data-testid=limit-suggestions] li").count();
  ok(nSug >= 3, `une limite est suggérée pour ${nSug} catégories`);
  const lim0 = Object.keys((await stateOf()).budget.limits).length;
  await p.click("[data-testid=apply-all-limits]"); await sleep(300);
  const lim1 = (await stateOf()).budget.limits; const tot = Object.values(lim1).reduce((n, v) => n + v, 0);
  ok(Object.keys(lim1).length >= nSug && tot <= (await stateOf()).budget.monthly, `« Tout appliquer » enregistre les plafonds (${tot} € ≤ budget)`);
  const dl = p.waitForEvent("download");
  await p.click("[data-testid=budget-pdf]"); const d = await dl; const path = await d.path();
  const head = fs.readFileSync(path).subarray(0, 8).toString("latin1");
  ok(head.startsWith("%PDF-1.4") && d.suggestedFilename().startsWith("analyse-budget-"), `analyse PDF téléchargée (${d.suggestedFilename()})`);
  ok(errs.length === 0, "aucune erreur JavaScript" + (errs.length ? " : " + errs.slice(0, 3).join(" | ") : ""));
} catch (e) { fail++; failures.push("exception : " + e.message.split("\n")[0]); console.log("  ✗ exception : " + e.message.split("\n").slice(0, 8).join(" | ")); await p.screenshot({ path: "/tmp/claude-0/feat-fail.png" }).catch(() => {}); }
await browser.close();
console.log(`\n${pass} réussis, ${fail} échec(s)`); if (fail) { console.log(failures.join("\n")); process.exit(1); }
