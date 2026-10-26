// Tests des nouvelles fonctions : reports avec historique, heures limites, plan de révision, routines au calendrier,
// livraisons à recevoir, argent de poche, dettes de colocation, conseils, PDF, thème automatique, recettes.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.ts";
import * as F from "../src/finance.ts";

const TODAY = "2026-10-15"; // jeudi
const base = () => C.blank({ name: "Test" }, 600);
const task = (p: Partial<C.Task> = {}): C.Task => ({ id: "t1", title: "T", courseId: null, kind: "devoir", status: "todo", deadline: "2026-10-20", estimate: 300, spent: 0, priority: 2, createdAt: TODAY, ...p });
const withTasks = (...t: C.Task[]) => ({ ...base(), tasks: t });
const roundtrip = (s: C.AppState) => { const r = C.validateState(JSON.parse(JSON.stringify(s))); assert.ok(r.ok); return (r as { ok: true; state: C.AppState }).state; };

test("report d'échéance : un seul devoir change, l'historique est conservé", () => {
  const s0 = withTasks(task({ id: "a", deadline: "2026-10-20" }), task({ id: "b", deadline: "2026-10-20" }), task({ id: "c", deadline: "2026-10-22" }));
  const s1 = C.reducer(s0, { type: "task/postpone", id: "a", to: "2026-10-25" });
  assert.equal(s1.tasks[0].deadline, "2026-10-25");
  assert.equal(s1.tasks[1].deadline, "2026-10-20"); assert.equal(s1.tasks[2].deadline, "2026-10-22");
  assert.deepEqual(s1.tasks[0].postponed?.map((p) => [p.from, p.to]), [["2026-10-20", "2026-10-25"]]);
  assert.equal(s1.tasks[1].postponed, undefined);
  const s2 = C.reducer(s1, { type: "task/postpone", id: "a", to: "2026-10-28" });
  assert.equal(s2.tasks[0].postponed?.length, 2);
  assert.deepEqual(C.reducer(s0, { type: "task/postpone", id: "a", to: "2026-10-20" }).tasks, s0.tasks); // même date : rien ne change
  assert.equal(roundtrip(s2).tasks[0].postponed?.length, 2);
});

test("retard manqué puis reporté : compté dans l'historique, pas un report anticipé", () => {
  const late = task({ id: "a", deadline: "2026-10-12", status: "todo" });
  const s = C.reducer(withTasks(late), { type: "task/postpone", id: "a", to: "2026-10-20" }); // décidé après la date (today réel)
  const t = { ...s.tasks[0], postponed: [{ from: "2026-10-12", to: "2026-10-20", at: "2026-10-14" }] };
  assert.equal(C.missedDeadline(t), "2026-10-12");
  assert.equal(C.missedDeadline({ postponed: [{ from: "2026-10-20", to: "2026-10-22", at: "2026-10-18" }] }), null); // report anticipé
  const done = { ...t, status: "done" as const, doneAt: "2026-10-19", doneTime: "10:00" };
  assert.equal(C.taskDoneLate(done), true);
  assert.deepEqual(C.taskOnTimeStats([done], TODAY), { ok: 0, late: 1 });
  const early = task({ status: "done", doneAt: "2026-10-19", deadline: "2026-10-20", postponed: [{ from: "2026-10-18", to: "2026-10-20", at: "2026-10-15" }] });
  assert.deepEqual(C.taskOnTimeStats([early], TODAY), { ok: 1, late: 0 });
});

test("moment préféré : matin, midi, soir ; le travail est placé de préférence à ce moment, sans effet sur le retard", () => {
  assert.deepEqual(C.DUE_PRESETS.map((p) => p.time), ["09:00", "12:00", "15:00", "20:00"]);
  assert.deepEqual(C.preferredWindow("20:00"), [18 * 60, 23 * 60]); assert.deepEqual(C.preferredWindow("14:00"), [14 * 60, 17 * 60]);
  assert.deepEqual([C.momentLabel("09:00"), C.momentLabel("12:00"), C.momentLabel("20:00"), C.momentLabel("16:40")], ["le matin", "à midi", "le soir", "vers 16:40"]);
  const at = (dueTime?: string) => { const tk = task({ id: "w", title: "Fiche", deadline: "2026-10-18", estimate: 60, ...(dueTime ? { dueTime } : {}) });
    return C.planDay(withTasks(tk), "2026-10-16", undefined, TODAY).blocks.filter((b) => b.kind === "task").map((b) => [b.start, b.end]); };
  const none = at(), evening = at("20:00"), morning = at("09:00"), noon = at("12:00");
  assert.ok(none.length && evening.length && morning.length && noon.length);
  assert.ok(evening.every(([s]) => s >= 18 * 60), "soir : après 18 h");
  assert.ok(morning.every(([s, e]) => s >= 7 * 60 && e <= 12 * 60), "matin : avant midi");
  assert.ok(noon.every(([s]) => s >= 12 * 60 && s < 14 * 60 + 30), "midi : entre 12 h et 14 h 30");
  // plage préférée pleine : repli sur les créneaux libres ailleurs (jamais de travail perdu)
  const busy = { ...withTasks(task({ id: "w", deadline: "2026-10-18", estimate: 60, dueTime: "20:00" })), events: [{ id: "e", title: "Soirée", date: "2026-10-16", start: "17:00", end: "23:30", recurrence: "none" as const, until: null }] };
  const fb = C.planDay(busy, "2026-10-16", undefined, TODAY);
  assert.ok(fb.blocks.some((b) => b.kind === "task") && fb.overflow.length === 0);
  // terminer après le moment préféré n'est pas un retard
  C.setOnTimeMode("time");
  assert.equal(C.taskDoneLate(task({ status: "done", deadline: "2026-10-20", doneAt: "2026-10-20", doneTime: "23:00", dueTime: "09:00" })), false);
  C.setOnTimeMode("day");
  assert.equal(roundtrip(withTasks(task({ dueTime: "09:00" }))).tasks[0].dueTime, "09:00");
});

test("plan de révision : minutes des séances du jour, label avec le thème", () => {
  const exam = task({ id: "x", kind: "examen", title: "Maths", deadline: "2026-10-22", estimate: 240, revision: [
    { id: "r1", date: "2026-10-17", topic: "Algèbre", minutes: 90 }, { id: "r2", date: "2026-10-19", topic: "Analyse", minutes: 60 }, { id: "r3", date: "2026-10-19", topic: "Probas", minutes: 30, done: true }] });
  assert.equal(C.dailyQuota(exam, "2026-10-17", 240, TODAY), 90);
  assert.equal(C.dailyQuota(exam, "2026-10-19", 240, TODAY), 60); // séance faite exclue
  assert.equal(C.dailyQuota(exam, "2026-10-18", 240, TODAY), 0);
  const plan = C.planDay(withTasks(exam), "2026-10-17", undefined, TODAY);
  assert.ok(plan.blocks.some((b) => b.kind === "task" && b.label === "Révision · Maths — Algèbre"));
  assert.equal(plan.taskMin, 90);
  const gen = C.buildRevisionPlan(["2026-10-20", "2026-10-21", "2026-10-19"], 100, ["A", "B"], (() => { let i = 0; return () => `id${i++}`; })());
  assert.deepEqual(gen.map((r) => [r.date, r.minutes, r.topic]), [["2026-10-19", 35, "A"], ["2026-10-20", 35, "B"], ["2026-10-21", 30, "A"]]);
  assert.equal(gen.reduce((n, r) => n + r.minutes, 0), 100);
  assert.equal(roundtrip(withTasks(exam)).tasks[0].revision?.length, 3);
});

test("routine dans le calendrier : bloc à l'heure, ou créneau libre sans heure ; absente si décochée", () => {
  const h: C.Habit = { id: "h1", name: "Sport", emoji: "🏋️", cat: "sport", days: [0, 1, 2, 3, 4, 5, 6], done: [], since: "2026-01-01", time: "18:00", inCalendar: true, duration: 45 };
  const s = { ...base(), habits: [h] };
  const plan = C.planDay(s, "2026-10-16", undefined, TODAY);
  const blk = plan.blocks.find((b) => b.kind === "habit");
  assert.deepEqual([blk?.start, blk?.end], [18 * 60, 18 * 60 + 45]);
  assert.equal(plan.habitMin, 45);
  assert.equal(C.planDay({ ...s, habits: [{ ...h, inCalendar: false }] }, "2026-10-16", undefined, TODAY).blocks.some((b) => b.kind === "habit"), false);
  assert.equal(C.planDay({ ...s, habits: [{ ...h, done: ["2026-10-16"] }] }, "2026-10-16", undefined, TODAY).blocks.some((b) => b.kind === "habit"), false);
  const free = C.planDay({ ...s, habits: [{ ...h, time: undefined }] }, "2026-10-16", undefined, TODAY);
  assert.equal(free.blocks.filter((b) => b.kind === "habit").reduce((n, b) => n + b.end - b.start, 0), 45);
  const back = roundtrip(s).habits![0]; assert.equal(back.inCalendar, true); assert.equal(back.duration, 45);
});

test("tâche perso : début sans fin = 30 min, fin masquée, report avec historique, heure limite", () => {
  const td: C.Todo = { id: "p1", text: "RDV banque", done: false, due: "2026-10-16", start: "10:00", createdAt: TODAY };
  const plan = C.planDay({ ...base(), todos: [td] }, "2026-10-16", undefined, TODAY);
  const b = plan.blocks.find((x) => x.label === "✓ RDV banque")!;
  assert.deepEqual([b.start, b.end, b.noEnd, b.refId], [600, 630, true, "p1"]);
  const hidden = C.planDay({ ...base(), todos: [{ ...td, end: "11:00", hideEnd: true }] }, "2026-10-16", undefined, TODAY).blocks.find((x) => x.refId === "p1")!;
  assert.deepEqual([hidden.end, hidden.noEnd], [660, true]);
  const s = C.reducer({ ...base(), todos: [td, { ...td, id: "p2" }] }, { type: "todo/postpone", id: "p1", to: "2026-10-18" });
  assert.equal(s.todos![0].due, "2026-10-18"); assert.equal(s.todos![1].due, "2026-10-16");
  assert.equal(s.todos![0].postponed?.[0].from, "2026-10-16");
  const rt = roundtrip({ ...base(), todos: [{ ...td, dueTime: "12:00", remind: 30, hideEnd: true, end: "11:00" }] }).todos![0];
  assert.deepEqual([rt.dueTime, rt.remind, rt.hideEnd], ["12:00", 30, true]);
});

test("événements : checklist, rappel, coche d'une étape", () => {
  const ev: C.PlanEvent = { id: "e1", title: "Dentiste", date: "2026-10-16", start: "09:00", end: "09:30", recurrence: "none", until: null, place: "Cabinet", steps: [{ id: "s1", text: "Carte vitale", done: false }], remind: 60 };
  const s = C.reducer({ ...base(), events: [ev] }, { type: "event/step", id: "e1", stepId: "s1" });
  assert.equal(s.events[0].steps![0].done, true);
  const rt = roundtrip(s).events[0]; assert.deepEqual([rt.place, rt.remind, rt.steps?.length], ["Cabinet", 60, 1]);
});

test("achats à recevoir : pas « à la maison » avant réception", () => {
  let s: C.AppState = { ...base(), groceries: [{ id: "g1", name: "Lait", aisle: "Frais", qty: "", checked: true, price: 1 }, { id: "g2", name: "Riz", aisle: "Épicerie", qty: "", checked: true, price: 2 }] };
  s = C.reducer(s, { type: "grocery/checkout", amount: 3, date: TODAY, pending: true });
  assert.equal(C.pantryItems(s, TODAY).length, 0);
  const pend = C.pendingReceipts(s); assert.equal(pend.length, 1); assert.deepEqual(pend[0].items, ["Lait", "Riz"]);
  s = C.reducer(s, { type: "expense/received", id: pend[0].expenseId });
  assert.equal(C.pantryItems(s, TODAY).length, 2); assert.equal(C.pendingReceipts(s).length, 0);
  assert.equal(s.budget.expenses[0].amount, 3); // la dépense, elle, est comptée dès l'achat
  const direct = C.reducer({ ...base(), groceries: [{ id: "g1", name: "Pain", aisle: "Épicerie", qty: "", checked: true, price: 1 }] }, { type: "grocery/checkout", amount: 1, date: TODAY });
  assert.equal(C.pantryItems(direct, TODAY).length, 1);
});

test("thème automatique : plage de nuit qui passe minuit", () => {
  assert.equal(C.isNightTime(21 * 60, "20:00", "07:00"), true);
  assert.equal(C.isNightTime(3 * 60, "20:00", "07:00"), true);
  assert.equal(C.isNightTime(12 * 60, "20:00", "07:00"), false);
  assert.equal(C.isNightTime(7 * 60, "20:00", "07:00"), false);
  assert.equal(C.isNightTime(23 * 60, "22:00", "23:30"), true);
  assert.equal(C.isNightTime(10 * 60, "08:00", "08:00"), false);
  const s = roundtrip({ ...base(), settings: { ...base().settings, theme: "auto", autoDark: { from: "21:00", to: "06:30" }, tutorialDone: false } });
  assert.deepEqual([s.settings.theme, s.settings.autoDark, s.settings.tutorialDone], ["auto", { from: "21:00", to: "06:30" }, false]);
  assert.equal(roundtrip({ ...base(), settings: { ...base().settings, theme: "nimportequoi" as never } }).settings.theme, "system");
});

test("recettes : ingrédients, quantités, minuteurs, enregistrement", () => {
  assert.deepEqual(C.parseIngredient("200 g de pâtes"), { qty: "200 g", name: "pâtes" });
  assert.deepEqual(C.parseIngredient("2 œufs"), { qty: "2", name: "œufs" });
  assert.deepEqual(C.parseIngredient("1,5 L de lait"), { qty: "1,5 L", name: "lait" });
  assert.deepEqual(C.parseIngredient("Sel"), { qty: "", name: "Sel" });
  assert.equal(C.scaleIngredient("200 g de pâtes", 1.5), "300 g de pâtes");
  assert.equal(C.scaleIngredient("2 œufs", 2), "4 œufs"); assert.equal(C.scaleIngredient("Sel", 3), "Sel");
  assert.equal(C.stepMinutes("Laisser mijoter 15 min"), 15); assert.equal(C.stepMinutes("Cuire 1 h 30"), 90); assert.equal(C.stepMinutes("Mélanger"), null);
  const r: C.Recipe = { id: "r1", name: "Pâtes", servings: 2, ingredients: ["200 g de pâtes"], steps: ["Cuire 10 min"] };
  let s = C.reducer(base(), { type: "recipe/save", recipe: r });
  s = C.reducer(s, { type: "recipe/save", recipe: { ...r, name: "Pâtes+" } });
  assert.equal(s.recipes!.length, 1); assert.equal(roundtrip(s).recipes![0].name, "Pâtes+");
  assert.equal(C.reducer(s, { type: "recipe/remove", id: "r1" }).recipes!.length, 0);
});

const exp = (id: string, date: string, amount: number, category: string, label = "x", source?: C.Expense["source"]): C.Expense => ({ id, date, amount, category, label, ...(source ? { source } : {}) });
test("argent de poche : semaine, mois, catégories, reste par jour", () => {
  const b: C.Budget = { monthly: 600, limits: {}, recurring: [], pocket: { amount: 40, period: "week", cats: [] }, expenses: [
    exp("1", "2026-10-12", 10, "Restauration"), exp("2", "2026-10-14", 12.5, "Loisirs"), exp("3", "2026-10-14", 99, "Logement"), exp("4", "2026-10-11", 30, "Restauration"), exp("5", "2026-10-13", 5, "Autre", "r", "recurrente")] };
  const p = F.pocketStats(b, TODAY)!;
  assert.equal(p.from, "2026-10-12"); assert.equal(p.to, "2026-10-18");
  assert.equal(p.spent, 22.5); assert.equal(p.remaining, 17.5); assert.equal(p.daysLeft, 4); assert.equal(p.perDay, 4.38);
  assert.equal(p.over, false);
  const m = F.pocketStats({ ...b, pocket: { amount: 50, period: "month", cats: ["Restauration"] } }, TODAY)!;
  assert.equal(m.from, "2026-10-01"); assert.equal(m.to, "2026-10-31"); assert.equal(m.spent, 40); assert.equal(m.remaining, 10);
  assert.equal(F.pocketStats({ ...b, pocket: null }, TODAY), null);
  assert.equal(F.pocketStats({ ...b, pocket: { amount: 20, period: "week", cats: [] } }, TODAY)!.over, true);
  const back = roundtrip({ ...base(), budget: { ...base().budget, pocket: { amount: 40, period: "week", cats: ["Loisirs"] } } }).budget.pocket;
  assert.deepEqual(back, { amount: 40, period: "week", cats: ["Loisirs"] });
  assert.equal(roundtrip({ ...base(), budget: { ...base().budget, pocket: { amount: -3, period: "year" as never, cats: [] } } }).budget.pocket, null);
});

test("reste par catégorie et part du budget non répartie", () => {
  const b: C.Budget = { monthly: 600, limits: { Courses: 200, Loisirs: 50 }, recurring: [], expenses: [exp("1", "2026-10-02", 120, "Courses"), exp("2", "2026-10-03", 70, "Loisirs"), exp("3", "2026-10-04", 30, "Transport")] };
  const bs = C.budgetStats(b, "2026-10", TODAY, ["Courses", "Loisirs", "Transport"]);
  const cb = F.categoryBreakdown(bs, 600, b.limits);
  const by = Object.fromEntries(cb.lines.map((l) => [l.cat, l]));
  assert.equal(by.Courses.remaining, 80); assert.equal(by.Loisirs.remaining, -20); assert.equal(by.Loisirs.over, true); assert.equal(by.Transport.remaining, null);
  assert.equal(cb.allocated, 250); assert.equal(cb.unallocated, 350);
});

test("dettes de colocation : qui me doit, à qui je dois", () => {
  const flat = { me: "a", members: [{ user_id: "a", display_name: "Alice", role: "owner" as const, left: false }, { user_id: "b", display_name: "Bob", role: "member" as const, left: false }, { user_id: "c", display_name: "Cléo", role: "member" as const, left: false }] };
  const e = (paid_by: string, amount_cents: number, shares: Record<string, number>) => ({ paid_by, amount_cents, shares });
  const d = F.flatDebts(flat, [e("a", 900, { a: 300, b: 300, c: 300 }), e("b", 600, { a: 300, b: 300 })]);
  assert.deepEqual(d.owedToMe, [{ name: "Cléo", cents: 300 }]); assert.deepEqual(d.iOwe, []);
  assert.equal(d.net, 300);
  const d2 = F.flatDebts({ ...flat, me: "c" }, [e("a", 900, { a: 300, b: 300, c: 300 })]);
  assert.deepEqual(d2.iOwe, [{ name: "Alice", cents: 300 }]); assert.equal(d2.totalIOwe, 300);
  assert.deepEqual(F.flatDebts(flat, []), { owedToMe: [], iOwe: [], totalOwedToMe: 0, totalIOwe: 0, net: 0 });
});

test("conseils : bienveillants, déclenchés par des situations réelles", () => {
  const many: C.Expense[] = Array.from({ length: 6 }, (_, i) => exp(`s${i}`, `2026-10-${String(10 + i).padStart(2, "0")}`, 4, "Restauration", i % 2 ? "Café" : "Kebab"));
  const ins = F.budgetInsights({ monthly: 600, limits: {}, recurring: [], expenses: many }, TODAY);
  assert.ok(ins.some((i) => i.id === "small"), "petits achats répétés");
  for (const i of ins) assert.doesNotMatch(i.text, /gaspill|irresponsable|honte|tu dois arrêter|mauvais/i);
  const over = F.budgetInsights({ monthly: 100, limits: {}, recurring: [], expenses: [exp("1", "2026-10-03", 150, "Courses")] }, TODAY);
  assert.ok(over.some((i) => i.id === "over" && i.tone === "warn"));
  const pocket = F.budgetInsights({ monthly: 600, limits: {}, recurring: [], pocket: { amount: 20, period: "week", cats: [] }, expenses: [exp("1", "2026-10-12", 25, "Loisirs")] }, TODAY);
  assert.ok(pocket.some((i) => i.id === "pocket-over"));
  assert.ok(F.budgetInsights({ monthly: 600, limits: {}, recurring: [], expenses: [] }, TODAY).length === 0);
});

test("analyse PDF : fichier valide, plusieurs sections", () => {
  const b: C.Budget = { monthly: 600, limits: { Courses: 200 }, recurring: [], expenses: [exp("1", "2026-10-02", 120, "Courses", "Courses Lidl"), exp("2", "2026-10-09", 40, "Loisirs", "Cinéma")] };
  const bs = C.budgetStats(b, "2026-10", TODAY, ["Courses", "Loisirs"]);
  const cb = F.categoryBreakdown(bs, 600, b.limits);
  const bytes = F.buildBudgetPdf({ month: "2026-10", name: "Test", cur: "€", monthly: 600, stats: bs, prevSpent: 100, lines: cb.lines, unallocated: cb.unallocated, pocket: null,
    history: [{ month: "2026-08", spent: 300, income: 500 }, { month: "2026-09", spent: 450, income: 500 }, { month: "2026-10", spent: 160, income: 0 }], savingsTotal: 50, expenseCount: 2,
    personal: F.personalDebts({ ...b, debts: [{ id: "d1", person: "Inès", amount: 30, direction: "lent", label: "Resto", date: TODAY, due: "2026-10-01", repaid: [] }] }, TODAY), suggestions: F.suggestLimits({ ...b, limits: {} }, TODAY, ["Courses", "Loisirs"]),
    insights: F.budgetInsights(b, TODAY), top: b.expenses, recurring: [{ label: "Loyer", amount: 420, day: 1 }], debts: { owedToMe: [{ name: "Bob", cents: 500 }], iOwe: [], totalOwedToMe: 500, totalIOwe: 0, net: 500 }, generatedAt: "2026-10-15T10:00:00Z" });
  const txt = Buffer.from(bytes).toString("latin1");
  assert.ok(txt.startsWith("%PDF-1.4") && txt.trimEnd().endsWith("%%EOF"));
  assert.ok(txt.includes("Analyse du budget") && txt.includes("Répartition par catégorie") && txt.includes("Dettes et prêts") && txt.includes("Loyer"));
  assert.ok(txt.includes("\x80") && txt.includes("Page 1 / "), "symbole € et numéros de page");
  assert.ok(bytes.length > 3000);
});

test("séances à heure choisie (examen ou projet) : blocs fixes début–fin, les autres restent automatiques", () => {
  const proj = task({ id: "p", kind: "projet", title: "Rapport", deadline: "2026-10-22", estimate: 150, revision: [
    { id: "r1", date: "2026-10-17", topic: "Plan", minutes: 90, start: "16:00" }, { id: "r2", date: "2026-10-17", topic: "Rédaction", minutes: 60 }, { id: "r3", date: "2026-10-18", topic: "Relecture", minutes: 30, start: "10:15" }] });
  assert.equal(C.dailyQuota(proj, "2026-10-17", 150, TODAY), 60); // seule la séance sans heure est répartie
  const day = C.planDay(withTasks(proj), "2026-10-17", undefined, TODAY).blocks.filter((b) => b.kind === "task");
  const fixed = day.find((b) => b.label === "Rapport — Plan")!;
  assert.deepEqual([fixed.start, fixed.end], [16 * 60, 17 * 60 + 30]);
  assert.ok(day.some((b) => b.label === "Rapport — Rédaction"));
  const d2 = C.planDay(withTasks(proj), "2026-10-18", undefined, TODAY).blocks.find((b) => b.label === "Rapport — Relecture")!;
  assert.deepEqual([d2.start, d2.end], [10 * 60 + 15, 10 * 60 + 45]);
  assert.equal(roundtrip(withTasks(proj)).tasks[0].revision![0].start, "16:00");
});

test("dettes entre personnes : ajout, remboursement partiel, solde, jamais négatif", () => {
  const d: C.Debt = { id: "d1", person: "Inès", amount: 50, direction: "lent", label: "Concert", date: TODAY, repaid: [] };
  let s = C.reducer(base(), { type: "debt/save", debt: d });
  s = C.reducer(s, { type: "debt/save", debt: { ...d, id: "d2", person: "Hugo", amount: 20, direction: "borrowed", due: "2026-10-01" } });
  let pd = F.personalDebts(s.budget, TODAY);
  assert.deepEqual([pd.totalOwedToMe, pd.totalIOwe, pd.net], [50, 20, 30]); assert.equal(pd.iOwe[0].late, true);
  s = C.reducer(s, { type: "debt/repay", id: "d1", amount: 15, date: TODAY });
  assert.equal(C.debtRemaining(s.budget.debts!.find((x) => x.id === "d1")!), 35);
  s = C.reducer(s, { type: "debt/repay", id: "d1", amount: 999, date: TODAY }); // plafonné au reste dû
  assert.equal(C.debtRemaining(s.budget.debts!.find((x) => x.id === "d1")!), 0);
  pd = F.personalDebts(s.budget, TODAY); assert.equal(pd.owedToMe.length, 0); assert.equal(pd.totalIOwe, 20);
  assert.equal(roundtrip(s).budget.debts!.length, 2);
  assert.equal(C.reducer(s, { type: "debt/remove", id: "d2" }).budget.debts!.length, 1);
  assert.equal(roundtrip({ ...base(), budget: { ...base().budget, debts: [{ ...d, amount: -5 }, { ...d, id: "x", direction: "zz" as never }] } }).budget.debts!.length, 0);
});

test("plafonds suggérés : récurrentes réservées, somme ≤ budget, historique pris en compte", () => {
  const b: C.Budget = { monthly: 800, limits: {}, expenses: [], recurring: [{ id: "r", label: "Loyer", amount: 420, category: "Logement", day: 1, active: true, since: "2026-01-01" }] };
  const cats = ["Courses", "Restauration", "Logement", "Loisirs", "Autre"];
  const base0 = F.suggestLimits(b, TODAY, cats);
  const by0 = Object.fromEntries(base0.map((x) => [x.cat, x]));
  assert.equal(by0.Logement.amount, 420); assert.equal(by0.Logement.basis, "fixe");
  assert.ok(base0.reduce((n, x) => n + x.amount, 0) <= 800); assert.ok(by0.Courses.amount > by0.Loisirs.amount); assert.equal(by0.Courses.basis, "répartition");
  const withHist = F.suggestLimits({ ...b, expenses: [exp("1", "2026-09-05", 200, "Restauration"), exp("2", "2026-09-10", 50, "Courses"), exp("3", "2026-08-12", 200, "Restauration"), exp("4", "2026-08-20", 50, "Courses")] }, TODAY, cats);
  const h = Object.fromEntries(withHist.map((x) => [x.cat, x]));
  assert.equal(h.Restauration.basis, "historique"); assert.ok(h.Restauration.amount > h.Courses.amount); assert.equal(h.Restauration.avg, 200);
  assert.ok(withHist.reduce((n, x) => n + x.amount, 0) <= 800); assert.ok(withHist.every((x) => x.amount % 5 === 0 || x.cat === "Logement"));
  assert.deepEqual(F.suggestLimits({ ...b, monthly: 0 }, TODAY, cats), []);
  const tight = F.suggestLimits({ ...b, monthly: 450 }, TODAY, cats); assert.ok(tight.reduce((n, x) => n + x.amount, 0) <= 450);
  assert.ok(F.budgetInsights({ ...b, expenses: [exp("1", "2026-10-02", 10, "Courses"), exp("2", "2026-10-03", 10, "Courses"), exp("3", "2026-10-04", 10, "Courses")] }, TODAY).some((i) => i.id === "limits"));
});
