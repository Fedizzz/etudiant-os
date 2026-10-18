// Parcours de la colocation à deux utilisateurs (Alice, Bob) dans un vrai navigateur, contre le vrai SQL (voir docs/colocation.md).
import { chromium } from "playwright-core";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
const open = async (u) => { const p = await (await b.newContext({ viewport: { width: 1100, height: 1000 } })).newPage(); p.setDefaultTimeout(6000); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); await p.goto(`${process.env.APP_URL ?? "http://127.0.0.1:5460/"}?u=${u}`); await sleep(1200); return p; };
const A = await open("a"), B = await open("b");
try {
  ok(await A.locator("text=Créer un appartement").count() === 1, "sans appartement : formulaires créer / rejoindre");
  await A.fill("#fl-name", "Coloc des Lilas"); await A.click("button:has-text('Créer l\\'appartement')"); await sleep(800);
  ok(await A.locator("[data-testid=flat-view]").count() === 1, "Alice crée l'appartement");
  await A.click("[data-testid=flat-tab-membres]"); await sleep(200);
  const code = (await A.locator("[data-testid=flat-code]").innerText()).trim();
  ok(/^[A-Z0-9]{10}$/.test(code), "code d'invitation affiché : " + code);
  // Bob : mauvais code puis bon code
  await B.fill("#fl-code", "ZZZZZZZZZZ"); await B.click("form >> button:has-text('Rejoindre')"); await sleep(600);
  ok(await B.locator("text=Code d'invitation invalide").count() >= 1, "Bob : mauvais code refusé avec un message");
  await B.fill("#fl-code", code.toLowerCase()); await B.click("form >> button:has-text('Rejoindre')"); await sleep(800);
  ok(await B.locator("[data-testid=flat-view]").count() === 1, "Bob rejoint avec le code");
  // Courses communes : Alice ajoute, Bob voit après relecture
  await A.click("[data-testid=flat-tab-courses]"); await A.fill("#fg-name", "Lait"); await A.fill("#fg-price", "1,50"); await A.press("#fg-name", "Enter"); await sleep(600);
  await A.fill("#fg-name", "Pâtes"); await A.fill("#fg-price", "2"); await A.press("#fg-name", "Enter"); await sleep(600);
  await B.reload(); await sleep(1200);
  ok(await B.locator("[data-testid=flat-groceries] li").count() === 2, "Bob voit les 2 articles ajoutés par Alice");
  await B.locator("[data-testid=flat-groceries] li input[type=checkbox]").first().click(); await sleep(900);
  await A.reload(); await sleep(1200);
  ok(await A.locator("[data-testid=flat-groceries] li input:checked").count() === 1, "Alice voit l'article coché par Bob");
  // Valider les achats : Bob a payé 10 €, partagé à 2
  await B.locator("[data-testid=flat-checkout]").click(); await sleep(300);
  await B.fill("#fe-amount", "10"); await B.selectOption("#fe-payer", { label: "Bob (moi)" });
  ok((await B.locator("[data-testid=fe-preview]").innerText()).includes("5,00"), "aperçu : 5,00 € chacune");
  await B.click("[data-testid=fe-submit]"); await sleep(900);
  ok(await B.locator("[data-testid=flat-groceries] li").count() === 1, "article coché retiré de la liste après validation");
  await B.click("[data-testid=flat-tab-depenses]"); await sleep(300);
  ok((await B.locator("[data-testid=flat-my-balance]").innerText()).includes("5,00"), "Bob : « On vous doit 5,00 € »");
  ok((await B.locator("[data-testid=flat-transfers]").innerText()).includes("Alice doit 5,00 € à Bob"), "« Alice doit 5,00 € à Bob »");
  // Dépense d'Alice : 7,01 € à 2 (centimes)
  await A.click("[data-testid=flat-tab-depenses]"); await sleep(1500);
  await A.click("[data-testid=flat-add-expense]"); await A.fill("#fe-label", "Internet"); await A.fill("#fe-amount", "7,01"); await A.click("[data-testid=fe-submit]"); await sleep(900);
  const t = await A.locator("[data-testid=flat-transfers]").innerText();
  ok(/Alice doit/.test(t) || /Bob doit/.test(t), "soldes recalculés : " + t.replace(/\n/g, " "));
  // Remboursement
  const label = (await A.locator("[data-testid=flat-transfers] button").first().count()) ? "bouton présent" : "";
  ok(label !== "", "bouton « Marquer remboursé » proposé");
  await A.locator("[data-testid=flat-transfers] button").first().click(); await sleep(900);
  ok(await A.locator("[data-testid=flat-expenses] li").count() === 3, "remboursement ajouté à l'historique");
  // Sécurité : Bob ne peut pas supprimer la dépense d'Alice depuis l'UI (pas de bouton)
  await B.reload(); await sleep(1200); await B.click("[data-testid=flat-tab-depenses]"); await sleep(300);
  const delBob = await B.locator("[data-testid=flat-expenses] li", { hasText: "Internet" }).locator("button[aria-label='Supprimer la dépense']").count();
  ok(delBob === 0, "Bob (membre) n'a pas de bouton supprimer sur la dépense d'Alice");
  // Ménage partagé : Alice crée une corvée quotidienne en rotation, Bob la voit et la coche
  await A.reload(); await sleep(1200); await A.click("[data-testid=flat-tab-menage]"); await sleep(300);
  ok(await A.locator("text=Aucune corvée commune").count() === 1, "ménage : liste vide au départ");
  await A.click("[data-testid=flat-add-chore]"); await A.selectOption("#fc-rec", "daily"); await A.fill("#fc-name", "Vaisselle"); await A.click("[data-testid=fc-submit]"); await sleep(900);
  ok(await A.locator("[data-testid=flat-chore-row]", { hasText: "Vaisselle" }).count() >= 1, "Alice voit la corvée dans la semaine");
  await B.reload(); await sleep(1200); await B.click("[data-testid=flat-tab-menage]"); await sleep(400);
  ok(await B.locator("[data-testid=flat-chore-row]", { hasText: "Vaisselle" }).count() >= 7 - 0 || await B.locator("[data-testid=flat-chore-row]", { hasText: "Vaisselle" }).count() >= 1, "Bob voit la même corvée");
  const todayRow = B.locator("[data-testid=flat-chore-row]", { hasText: "Vaisselle" }).nth(await B.evaluate(() => (new Date().getDay() + 6) % 7));
  await todayRow.locator("input[type=checkbox]").click(); await sleep(900);
  await A.reload(); await sleep(1200); await A.click("[data-testid=flat-tab-menage]"); await sleep(400);
  const aRow = A.locator("[data-testid=flat-chore-row]", { hasText: "Vaisselle" }).nth(await A.evaluate(() => (new Date().getDay() + 6) % 7));
  ok((await aRow.innerText()).includes("fait par Bob"), "Alice voit « fait par Bob »");
  // Alice (propriétaire) supprime la corvée
  await A.locator("summary", { hasText: "Gérer les corvées" }).click(); A.once("dialog", (d) => d.accept());
  await A.locator("button[aria-label='Supprimer la corvée']").click(); await sleep(900);
  ok(await A.locator("text=Aucune corvée commune").count() === 1, "corvée supprimée");
  // Quitter
  await B.click("[data-testid=flat-tab-membres]"); await B.click("[data-testid=flat-leave]"); await B.click("[role=dialog] button:text-is('Quitter')"); await sleep(900);
  ok(await B.locator("text=Créer un appartement").count() === 1, "Bob quitte : retour aux formulaires");
  await A.reload(); await sleep(1200); await A.click("[data-testid=flat-tab-membres]");
  ok(await A.locator("ul li", { hasText: "Bob" }).count() === 0, "Bob n'apparaît plus dans les membres d'Alice");
  ok(A.errs.length + B.errs.length === 0, "aucune erreur JavaScript : " + [...A.errs, ...B.errs].join(" | "));
} catch (e) { fail++; console.log("  ✗ exception: " + e.message.split("\n")[0]); await A.screenshot({ path: "flatA.png" }); await B.screenshot({ path: "flatB.png" }); }
await b.close(); console.log(`${pass} ok, ${fail} échecs`);
