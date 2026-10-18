// Parcours de la colocation à deux utilisateurs (Alice, Bob) dans un vrai navigateur, contre le vrai SQL (voir docs/colocation.md).
// L'onglet Colocation = appartement, membres, code. Courses / Budget / Ménage proposent « Perso | Colocation » seulement dans un appartement.
import { chromium } from "playwright-core";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
const open = async (u) => { const p = await (await b.newContext({ viewport: { width: 1100, height: 1100 } })).newPage(); p.setDefaultTimeout(6000); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("dialog", (d) => d.accept()); await p.goto(`${process.env.APP_URL ?? "http://127.0.0.1:5460/"}?u=${u}`); await sleep(1200); return p; };
const nav = async (p, label) => { await p.locator(`nav >> text=${label}`).first().click(); await sleep(500); };
const scope = async (p, id, which) => { await p.click(`[data-testid=scope-${id}-${which}]`); await sleep(500); };
const reload = async (p) => { await p.reload(); await sleep(1500); };
const A = await open("a"), B = await open("b");
try {
  // ---- Sans appartement : onglets personnels inchangés, pas de choix Perso/Colocation
  await nav(A, "Courses");
  ok(await A.locator("[data-testid=scope-groceries]").count() === 0 && await A.locator("#gr-name").count() === 1, "sans appartement : Courses = version personnelle, sans sélecteur");
  await nav(A, "Budget"); ok(await A.locator("[data-testid=scope-budget]").count() === 0, "sans appartement : Budget sans sélecteur");
  await nav(A, "Ménage"); ok(await A.locator("[data-testid=scope-chores]").count() === 0, "sans appartement : Ménage sans sélecteur");
  await nav(A, "Tableau de bord");

  // ---- Onglet Colocation : créer / rejoindre / membres / code
  await nav(A, "Colocation");
  ok(await A.locator("text=Créer un appartement").count() === 1, "Colocation : formulaires créer / rejoindre");
  await A.fill("#fl-name", "Coloc des Lilas"); await A.click("button:has-text('Créer l\\'appartement')"); await sleep(900);
  ok(await A.locator("[data-testid=flat-view]").count() === 1, "Alice crée l'appartement");
  const code = (await A.locator("[data-testid=flat-code]").innerText()).trim();
  ok(/^[A-Z0-9]{10}$/.test(code), "code d'invitation affiché : " + code);
  ok(await A.locator("[data-testid=flat-groceries]").count() === 0 && await A.locator("[data-testid=flat-checkout]").count() === 0, "l'onglet Colocation ne montre que les membres et le code (pas les courses)");
  await nav(B, "Colocation");
  await B.fill("#fl-code", "ZZZZZZZZZZ"); await B.click("form >> button:has-text('Rejoindre')"); await sleep(700);
  ok(await B.locator("text=Code d'invitation invalide").count() >= 1, "Bob : mauvais code refusé avec un message");
  await B.fill("#fl-code", code.toLowerCase()); await B.click("form >> button:has-text('Rejoindre')"); await sleep(1000);
  ok(await B.locator("[data-testid=flat-view]").count() === 1, "Bob rejoint avec le code");
  ok(await B.locator("li", { hasText: "Alice" }).count() >= 1, "Bob voit Alice dans les membres");

  // ---- Courses : « Perso | Colocation »
  await nav(A, "Courses");
  ok(await A.locator("[data-testid=scope-groceries]").count() === 1 && await A.locator("#gr-name").count() === 1, "dans un appartement : Courses garde la version personnelle + sélecteur");
  await scope(A, "groceries", "flat");
  await A.fill("#fg-name", "Lait"); await A.fill("#fg-price", "1,50"); await A.press("#fg-name", "Enter"); await sleep(700);
  await A.fill("#fg-name", "Pâtes"); await A.fill("#fg-price", "2"); await A.press("#fg-name", "Enter"); await sleep(700);
  await reload(B); await nav(B, "Courses"); await scope(B, "groceries", "flat");
  ok(await B.locator("[data-testid=flat-groceries] li").count() === 2, "Bob voit les 2 articles ajoutés par Alice");
  await B.locator("[data-testid=flat-groceries] li input[type=checkbox]").first().click(); await sleep(1000);
  await reload(A); await nav(A, "Courses"); await scope(A, "groceries", "flat");
  ok(await A.locator("[data-testid=flat-groceries] li input:checked").count() === 1, "Alice voit l'article coché par Bob");
  await B.locator("[data-testid=flat-checkout]").click(); await sleep(300);
  await B.fill("#fe-amount", "10"); await B.selectOption("#fe-payer", { label: "Bob (moi)" });
  ok((await B.locator("[data-testid=fe-preview]").innerText()).includes("5,00"), "aperçu : 5,00 € chacune");
  await B.click("[data-testid=fe-submit]"); await sleep(1000);
  ok(await B.locator("[data-testid=flat-groceries] li").count() === 1, "article coché retiré de la liste après validation");

  // ---- Budget : dépenses partagées
  await nav(B, "Budget"); await scope(B, "budget", "flat");
  ok((await B.locator("[data-testid=flat-my-balance]").innerText()).includes("5,00"), "Bob : « On vous doit 5,00 € »");
  ok((await B.locator("[data-testid=flat-transfers]").innerText()).includes("Alice doit 5,00 € à Bob"), "« Alice doit 5,00 € à Bob »");
  await reload(A); await nav(A, "Budget");
  ok(await A.locator("#bd-amount").count() === 1, "Budget d'Alice : version personnelle intacte");
  await scope(A, "budget", "flat");
  await A.click("[data-testid=flat-add-expense]"); await A.fill("#fe-label", "Internet"); await A.fill("#fe-amount", "7,01"); await A.click("[data-testid=fe-submit]"); await sleep(1000);
  const t = await A.locator("[data-testid=flat-transfers]").innerText();
  ok(/Alice doit 1,50 € à Bob/.test(t), "soldes recalculés (centimes compris) : " + t.replace(/\n/g, " "));
  await A.locator("[data-testid=flat-transfers] button").first().click(); await sleep(1000);
  ok(await A.locator("[data-testid=flat-expenses] li").count() === 3, "remboursement ajouté à l'historique");
  await reload(B); await nav(B, "Budget"); await scope(B, "budget", "flat");
  ok(await B.locator("[data-testid=flat-expenses] li", { hasText: "Internet" }).locator("button[aria-label='Supprimer la dépense']").count() === 0, "Bob (membre) n'a pas de bouton supprimer sur la dépense d'Alice");

  // ---- Budget personnel : MA part des dépenses communes (courses incluses), pas les remboursements
  await nav(A, "Budget"); await scope(A, "budget", "perso");
  const liA = A.locator("li", { hasText: "colocation (ma part)" });
  ok(await liA.count() === 2, "budget perso d'Alice : 2 lignes « colocation (ma part) » (courses + internet), pas le remboursement");
  ok((await liA.filter({ hasText: "Courses" }).first().innerText()).includes("5,00"), "courses partagées payées par Bob : ma part 5,00 € dans mon budget");
  ok((await liA.filter({ hasText: "Internet" }).first().innerText()).includes("3,51"), "internet payé par moi (7,01 €) : ma part 3,51 € seulement");
  ok(await liA.first().locator("button[aria-label='Supprimer la dépense']").count() === 0 && await liA.first().locator("button[aria-label='Modifier la dépense']").count() === 0, "ces lignes ne se modifient pas ici (elles viennent de la colocation)");
  await nav(B, "Budget"); await scope(B, "budget", "perso");
  ok(await B.locator("li", { hasText: "colocation (ma part)" }).filter({ hasText: "3,50" }).count() === 1 && await B.locator("li", { hasText: "colocation (ma part)" }).filter({ hasText: "5,00" }).count() === 1, "budget perso de Bob : 5,00 € et 3,50 €");

  // ---- Ménage : même écran que le ménage personnel (suggestions, rotation, checklist, report…)
  await nav(A, "Ménage"); await scope(A, "chores", "flat");
  ok(await A.locator("text=Aucune corvée définie").count() === 1, "ménage commun : vide au départ");
  ok(await A.locator("[data-testid=chore-presets]").count() === 1, "suggestions de corvées présentes (comme au perso)");
  ok(await A.locator("[data-testid=chore-rotation] label").count() === 2, "rotation entre colocataires : une puce par membre");
  const addForm = (p) => p.locator("form", { has: p.locator("#ch-name") });
  await A.click("[data-testid=chore-presets] button:text-is('Vaisselle')");
  ok(await A.inputValue("#ch-name") === "Vaisselle", "une suggestion remplit le formulaire");
  await A.fill("#ch-steps", "Rincer"); await A.press("#ch-steps", "Enter"); await A.fill("#ch-steps", "Essuyer"); await A.press("#ch-steps", "Enter");
  await addForm(A).locator("button[type=submit]").click(); await sleep(1400);
  ok(await A.locator("tr", { hasText: "Vaisselle" }).count() === 1, "la corvée apparaît dans la matrice de la semaine");
  ok((await A.locator("tr", { hasText: "Vaisselle" }).innerText()).includes("Checklist · 2"), "checklist de 2 étapes enregistrée");
  await A.click("[data-testid=chore-presets] button:text-is('Cuisiner le dîner')"); await addForm(A).locator("button[type=submit]").click(); await sleep(1200);
  // Bob voit la même matrice, coche les étapes : la corvée passe « faite » toute seule (comme au perso)
  await reload(B); await nav(B, "Ménage"); await scope(B, "chores", "flat");
  ok(await B.locator("tr", { hasText: "Vaisselle" }).count() === 1, "Bob voit la corvée créée par Alice");
  await B.click("button[aria-label='Checklist de Vaisselle']"); await sleep(400);
  await B.locator("[role=dialog] button", { hasText: "Rincer" }).first().click(); await sleep(700);
  await B.locator("[role=dialog] button", { hasText: "Essuyer" }).first().click(); await sleep(1200);
  await B.keyboard.press("Escape"); await sleep(300);
  await nav(B, "Tableau de bord");
  ok(await B.locator("button[aria-label='Annuler Vaisselle']").count() === 1, "toutes les étapes cochées : la corvée est marquée faite");
  await reload(A); await nav(A, "Tableau de bord");
  ok(await A.locator("button[aria-label='Annuler Vaisselle']").count() === 1, "Alice voit la corvée faite par Bob");
  await nav(A, "Ménage"); await scope(A, "chores", "flat");
  // report d'un jour (comme au perso) : enregistré pour tous
  await A.locator("button[aria-label='Reporter Cuisiner le dîner']").first().click(); await sleep(1000);
  ok(await A.locator("tr", { hasText: "Cuisiner le dîner" }).locator("text=reportée").count() === 1, "« Reporter » : le jour est marqué reportée");
  await reload(B); await nav(B, "Ménage"); await scope(B, "chores", "flat");
  ok(await B.locator("tr", { hasText: "Cuisiner le dîner" }).locator("text=reportée").count() === 1, "Bob voit aussi le report");
  ok(await B.locator("text=À l'heure ?").count() === 1 && await B.locator("text=Historique · 4 semaines").count() === 1, "historique et compteur « à l'heure » présents");
  // suppression (confirmation) : Alice supprime ses deux corvées
  await A.locator("tr", { hasText: "Vaisselle" }).locator("button[aria-label='Supprimer la corvée']").click(); await sleep(900);
  await A.locator("tr", { hasText: "Cuisiner le dîner" }).locator("button[aria-label='Supprimer la corvée']").click(); await sleep(900);
  ok(await A.locator("text=Aucune corvée définie").count() === 1, "corvées supprimées");

  // ---- Tableau de bord, planning, ménage personnel
  await addForm(A).locator("#ch-name").fill("Balai");
  await A.locator("[data-testid=chore-rotation] label", { hasText: "Bob" }).click();   // rotation : Alice seule
  await A.selectOption("#ch-rec", "daily"); await addForm(A).locator("button[type=submit]").click(); await sleep(1200);
  await nav(A, "Tableau de bord");
  ok(await A.locator("text=Balai").count() >= 1, "tableau de bord d'Alice : « Balai » affichée");
  await nav(B, "Tableau de bord"); await sleep(21000);   // relecture automatique (20 s)
  ok(await B.locator("section", { hasText: "Ménage du jour" }).locator("text=Balai").count() >= 1 && await B.locator("section", { hasText: "Ménage du jour" }).locator("text=Alice").count() >= 1, "tableau de bord de Bob : la corvée est visible, attribuée à Alice");
  await nav(B, "Planning"); ok(await B.locator("text=Balai").count() === 0, "planning de Bob : pas de bloc pour la corvée d'Alice");
  await nav(A, "Planning"); ok(await A.locator("text=Balai").count() >= 1, "planning d'Alice : « Balai » placée dans la journée");
  await nav(A, "Ménage"); await scope(A, "chores", "perso");
  ok(await A.locator("text=Balai").count() === 0, "ménage personnel : la corvée commune n'y est pas");
  await nav(A, "Tableau de bord");
  await A.locator("button[aria-label='Marquer Balai comme faite']").click(); await sleep(1200);
  ok(await A.locator("button[aria-label='Annuler Balai']").count() === 1, "cochée tout de suite sur le tableau de bord");
  await reload(B); await nav(B, "Ménage"); await scope(B, "chores", "flat");
  ok(await B.locator("tr", { hasText: "Balai" }).locator("button.border-ok\\/40, button[class*='ok']").count() >= 1 || (await B.locator("tr", { hasText: "Balai" }).innerText()).includes("Alice"), "Bob voit la corvée du Balai faite par Alice");

  // ---- Quitter : retour à la version sans appartement
  await nav(B, "Colocation"); await B.click("[data-testid=flat-leave]"); await B.click("[role=dialog] button:text-is('Quitter')"); await sleep(1000);
  ok(await B.locator("text=Créer un appartement").count() === 1, "Bob quitte : retour aux formulaires");
  await nav(B, "Courses");
  ok(await B.locator("[data-testid=scope-groceries]").count() === 0 && await B.locator("#gr-name").count() === 1, "Bob hors appartement : Courses redevient la version sans sélecteur");
  await nav(B, "Tableau de bord"); ok(await B.locator("text=Balai").count() === 0, "plus de corvée commune dans son tableau de bord");
  await nav(A, "Colocation"); await reload(A); await nav(A, "Colocation");
  ok(await A.locator("ul li", { hasText: "Bob" }).count() === 0, "Bob n'apparaît plus dans les membres d'Alice");
  ok(A.errs.length + B.errs.length === 0, "aucune erreur JavaScript : " + [...A.errs, ...B.errs].join(" | "));
} catch (e) { fail++; console.log("  ✗ exception: " + e.message.split("\n")[0]); await A.screenshot({ path: "/tmp/flatA.png" }); await B.screenshot({ path: "/tmp/flatB.png" }); }
await b.close(); console.log(`${pass} ok, ${fail} échecs`);
if (fail) process.exit(1);
