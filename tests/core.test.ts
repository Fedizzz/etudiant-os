// Tests des calculs et de la logique de données. Lancer : node --test --experimental-strip-types tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.ts";

const TODAY = "2026-10-15"; // jeudi
const base = () => C.blank({ name: "Test" }, 600);
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const course = (grades: [number, number][], coef = 1, id = "c1"): C.Course => ({ id, name: "M" + id, code: "", coef, color: "#000", grades: grades.map(([score, weight], i) => ({ id: String(i), label: "", score, weight })) });
const task = (p: Partial<C.Task> = {}): C.Task => ({ id: "t1", title: "T", courseId: null, kind: "devoir", status: "todo", deadline: "2026-10-20", estimate: 300, spent: 0, priority: 2, createdAt: TODAY, ...p });

test("durée de sommeil : passage de minuit", () => {
  assert.equal(C.sleepMinutes("23:30", "07:00"), 450);
  assert.equal(C.sleepMinutes("01:15", "08:00"), 405);
  assert.equal(C.sleepMinutes("22:00", "22:00"), 1440);
});

test("moyenne de module pondérée et normalisation signalée", () => {
  const c = course([[12, 40], [16, 20]]);
  const st = C.courseStats(c);
  close(st.avg, (12 * 40 + 16 * 20) / 60);
  assert.equal(st.normalized, true); // 60 % ≠ 100 %
  assert.equal(C.courseStats(course([[10, 50], [14, 50]])).normalized, false);
  assert.equal(C.courseStats(course([])).avg, null);
});

test("notes invalides écartées et comptées", () => {
  const st = C.courseStats(course([[25, 50], [12, 0], [14, 50], [NaN, 10]]));
  close(st.avg, 14); assert.equal(st.invalid, 3);
});

test("moyenne générale : coefficients, modules sans note et coef 0 exclus", () => {
  const cs = [course([[10, 100]], 2, "a"), course([[16, 100]], 1, "b"), course([], 3, "c"), course([[20, 100]], 0, "d")];
  const o = C.overallStats(cs);
  close(o.avg, (10 * 2 + 16 * 1) / 3);
  assert.deepEqual(o.noGrades.map((c) => c.id), ["c"]);
  assert.deepEqual(o.zeroCoef.map((c) => c.id), ["d"]);
  assert.equal(C.overallStats([]).avg, null);
});

test("note nécessaire pour atteindre l'objectif", () => {
  // 12 sur 40 % ; prochaine éval 60 % ; objectif 14 → x = (14·100 − 480)/60
  const n = C.neededGrade(course([[12, 40]]), 14, 60)!;
  close(n.grade, (1400 - 480) / 60); assert.equal(n.status, "ok");
  // vérification : remettre x donne bien 14
  close(C.courseStats(course([[12, 40], [n.grade, 60]])).avg, 14);
  assert.equal(C.neededGrade(course([[2, 80]]), 15, 20)!.status, "impossible");
  assert.equal(C.neededGrade(course([[19, 80]]), 10, 20)!.status, "acquis");
  assert.equal(C.neededGrade(course([[12, 40]]), 14, 0), null);
  close(C.neededGrade(course([]), 13, 50)!.grade, 13); // aucune note : il faut la cible
});

test("objectif général : moyenne requise sur les modules non notés", () => {
  const cs = [course([[10, 100]], 2, "a"), course([], 2, "b")];
  close(C.neededOnUngraded(cs, 12), 14);
  assert.equal(C.neededOnUngraded([course([[10, 100]])], 12), null);
});

test("focus : une session ne s'enregistre qu'une fois et met à jour la tâche", () => {
  let s = { ...base(), tasks: [task({ courseId: "m1" })] };
  const e = { id: "sess1", date: TODAY, minutes: 25, taskId: "t1" };
  s = C.logFocus(s, e); s = C.logFocus(s, e);
  assert.equal(s.focus.length, 1);
  assert.equal(s.tasks[0].spent, 25);
  assert.equal(s.tasks[0].status, "doing");
  assert.equal(s.focus[0].courseId, "m1");
});

test("minuteur : départ, pause, reprise, fin et interruption", () => {
  let s = { ...base(), tasks: [task()] };
  s = C.reducer(s, { type: "timer/task", taskId: "t1" });
  const t0 = 1_000_000;
  s = C.reducer(s, { type: "timer/start", now: t0 });
  assert.equal(C.timerLeft(s.timer, t0 + 60_000), 50 * 60 - 60);
  s = C.reducer(s, { type: "timer/pause", now: t0 + 10 * 60_000 });
  assert.equal(s.timer.remaining, 40 * 60);
  assert.equal(C.timerLeft(s.timer, t0 + 99 * 60_000), 40 * 60); // en pause : le temps ne s'écoule pas
  s = C.reducer(s, { type: "timer/start", now: t0 + 20 * 60_000 });
  const end = t0 + 60 * 60_000;
  const s1 = C.reducer(s, { type: "timer/finish", now: end, date: TODAY });
  assert.equal(s1.focus.length, 1); assert.equal(s1.focus[0].minutes, 50); assert.equal(s1.focus[0].interrupted, false);
  assert.equal(s1.timer.phase, "short"); assert.equal(s1.timer.cycles, 1);
  // double fin : la session suivante (pause) ne crée pas d'entrée
  const s2 = C.reducer(s1, { type: "timer/finish", now: end, date: TODAY });
  assert.equal(s2.focus.length, 1); assert.equal(s2.timer.phase, "work");
  // arrêt après 12 min 30 : 12 min enregistrées, marquées interrompues, pas de cycle compté
  let i = C.reducer({ ...s2, focus: [] }, { type: "timer/start", now: 0 });
  i = C.reducer(i, { type: "timer/finish", now: 750_000, date: TODAY, secondsDone: 750 });
  assert.equal(i.focus[0].minutes, 12); assert.equal(i.focus[0].interrupted, true); assert.equal(i.timer.cycles, 1); assert.equal(i.timer.phase, "work");
  // moins d'une minute : rien
  const z = C.reducer(C.reducer({ ...s2, focus: [] }, { type: "timer/start", now: 0 }), { type: "timer/finish", now: 30_000, date: TODAY, secondsDone: 30 });
  assert.equal(z.focus.length, 0);
});

test("statistiques de focus : jour, semaine, matière, série", () => {
  const f: C.FocusEntry[] = [
    { id: "1", date: TODAY, minutes: 30, taskId: "t", courseId: "m" }, { id: "2", date: "2026-10-14", minutes: 60, taskId: null, courseId: null },
    { id: "3", date: "2026-10-07", minutes: 45, taskId: null }, { id: "4", date: "2026-10-01", minutes: 999, taskId: null },
  ];
  const st = C.focusStats(f, TODAY);
  assert.equal(st.today, 30); assert.equal(st.week, 90); assert.equal(st.prevWeek, 45);
  assert.deepEqual(st.byCourse.find((x) => x.courseId === "m")?.minutes, 30);
  assert.equal(st.streak, 2); assert.equal(st.byDay.length, 7); assert.equal(st.byDay[6].date, TODAY);
});

test("sommeil : moyennes, dette sur nuits saisies seulement, régularité", () => {
  const logs: C.SleepLog[] = [
    { date: "2026-10-15", bed: "23:00", wake: "07:00", quality: 3 }, { date: "2026-10-14", bed: "01:00", wake: "07:00", quality: 3 },
    { date: "2026-10-01", bed: "22:00", wake: "06:00", quality: 3 },
  ];
  const st = C.sleepStats(logs, 8, TODAY);
  assert.equal(st.nights7, 2); close(st.avg7, (480 + 360) / 2); assert.equal(st.debt7, 120);
  assert.equal(st.nights14, 2); // le 1er octobre est hors fenêtre de 14 jours
  close(st.bedSpread, 60); // 23:00 et 01:00 → écart type 1 h (minuit géré)
  assert.equal(st.avgBed, 0); // moyenne 00:00
  assert.equal(C.sleepStats([], 8, TODAY).avg7, null);
});

test("budget : récurrentes ajoutées une seule fois par mois, au bon jour", () => {
  let s = base();
  s = C.reducer(s, { type: "recurring/save", item: { id: "r", label: "Loyer", amount: 400, category: "Logement", day: 5, active: true, since: "2026-01-01" } });
  s = C.applyRecurring(s, "2026-10-04"); assert.equal(s.budget.expenses.length, 0);
  s = C.applyRecurring(s, "2026-10-05"); s = C.applyRecurring(s, "2026-10-20");
  assert.equal(s.budget.expenses.length, 1); assert.equal(s.budget.expenses[0].date, "2026-10-05");
  s = C.applyRecurring(s, "2026-11-30"); assert.equal(s.budget.expenses.length, 2);
  // suppression d'une échéance générée : pas recréée ce mois-ci, mais le mois suivant oui
  s = C.reducer(s, { type: "expense/remove", id: "rec-r-2026-11" }); s = C.applyRecurring(s, "2026-11-30");
  assert.equal(s.budget.expenses.length, 1);
  s = C.applyRecurring(s, "2026-12-05"); assert.equal(s.budget.expenses.length, 2);
  // jour 31 dans un mois de 30 jours → dernier jour
  let t = C.reducer(base(), { type: "recurring/save", item: { id: "x", label: "X", amount: 10, category: "Autre", day: 31, active: true, since: "" } });
  t = C.applyRecurring(t, "2026-11-30"); assert.equal(t.budget.expenses[0].date, "2026-11-30");
});

test("budget : projection sans extrapoler le loyer, dépassements, recalcul après suppression", () => {
  const b: C.Budget = {
    monthly: 700, limits: { Courses: 50 }, recurring: [{ id: "r", label: "Loyer", amount: 400, category: "Logement", day: 1, active: true, since: "" }],
    expenses: [
      { id: "rec-r-2026-10", date: "2026-10-01", amount: 400, category: "Logement", label: "Loyer", recurringId: "r" },
      { id: "a", date: "2026-10-03", amount: 60, category: "Courses", label: "" }, { id: "b", date: "2026-10-10", amount: 15, category: "Loisirs", label: "" },
      { id: "z", date: "2026-09-30", amount: 999, category: "Autre", label: "" },
    ],
  };
  const st = C.budgetStats(b, "2026-10", TODAY, ["Courses", "Logement", "Loisirs"]);
  close(st.spent, 475); close(st.remaining, 225); close(st.variable, 75);
  close(st.projection!, 400 + (75 / 15) * 31); // et non 475/15×31
  assert.deepEqual(st.overCats, ["Courses"]);
  assert.equal(st.daily[0], 400); assert.equal(st.daily.length, 31);
  const after = C.budgetStats({ ...b, expenses: b.expenses.filter((e) => e.id !== "a") }, "2026-10", TODAY, ["Courses"]);
  close(after.spent, 415); assert.deepEqual(after.overCats, []);
  assert.equal(C.budgetStats(b, "2026-12", TODAY, []).projection, null); // mois futur : pas de projection
});

test("courses → budget : une seule dépense, aucune si rien n'est coché", () => {
  let s = base();
  s = C.reducer(s, { type: "grocery/add", item: { id: "g1", name: "Lait", aisle: "Frais", qty: "", checked: true, price: 1.2 } });
  s = C.reducer(s, { type: "grocery/checkout", amount: 1.2, date: TODAY });
  s = C.reducer(s, { type: "grocery/checkout", amount: 1.2, date: TODAY }); // double clic
  assert.equal(s.budget.expenses.length, 1);
  assert.equal(s.budget.expenses[0].source, "courses"); assert.deepEqual(s.budget.expenses[0].items, ["Lait"]);
  assert.equal(s.groceries.length, 0);
  assert.equal(s.products[0].count, 1); // article mémorisé
});

test("ménage : rotation stable, report et historique", () => {
  const c: C.Chore = { id: "c", name: "Vaisselle", recurrence: "daily", day: 0, minutes: 10, assignees: ["Moi", "A", "B"], done: [] };
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((d) => C.choreAssignee(c, C.parseISO(d)));
  assert.equal(new Set(days.slice(0, 3)).size, 3); assert.equal(days[3], days[0]);
  let s = { ...base(), chores: [c] };
  s = C.reducer(s, { type: "chore/toggle", id: "c", date: "2026-10-15", who: "A" });
  assert.equal(s.chores[0].doneBy!["2026-10-15"], "A");
  s = C.reducer(s, { type: "chore/skip", id: "c", date: "2026-10-15" });
  assert.deepEqual(s.chores[0].done, []); assert.deepEqual(s.chores[0].skipped, ["2026-10-15"]);
  s = C.reducer(s, { type: "chore/toggle", id: "c", date: "2026-10-14" });
  const h = C.choreHistory(s.chores, ["Moi", "A", "B"], TODAY, 1);
  assert.equal(h.reduce((n, r) => n + r.done, 0), 1); assert.equal(h.reduce((n, r) => n + r.assigned, 0), 7); assert.equal(h.reduce((n, r) => n + r.skipped, 0), 1);
});

test("planning : pas de double comptage sur plusieurs jours", () => {
  const s = { ...base(), tasks: [task({ estimate: 300, deadline: "2026-10-20" })] };
  const days = C.planRange(s, TODAY, 7, TODAY);
  const planned = days.reduce((n, p) => n + p.taskMin, 0);
  assert.ok(planned <= 300, `planifié ${planned} > 300`);
  assert.equal(planned, 300);
  assert.ok(days.slice(5).every((p) => p.taskMin === 0)); // rien après l'échéance
});

test("planning : retard réparti, jours passés sans bloc auto, indisponibilités et chevauchements", () => {
  const late = { ...base(), tasks: [task({ estimate: 600, deadline: "2026-10-10" })] };
  const p = C.planFor(late, TODAY, TODAY);
  assert.ok(p.taskMin <= 600 / C.OVERDUE_SPREAD + 5, `aujourd'hui ${p.taskMin}`);
  assert.equal(p.overdue.length, 1);
  assert.equal(C.planFor(late, "2026-10-14", TODAY).taskMin, 0); // passé
  const s = { ...base(),
    classes: [{ id: "a", courseId: "x", day: 3, start: "09:00", end: "11:00", room: "" }, { id: "b", courseId: "y", day: 3, start: "10:30", end: "12:00", room: "" }],
    settings: { ...base().settings, unavailable: [{ id: "u", day: 3, start: "14:00", end: "18:00", label: "Job" }] } };
  const q = C.planFor(s, TODAY, TODAY);
  assert.equal(q.conflicts.length, 0, "deux cours simultanés ne sont pas un conflit"); assert.equal(q.busyMin, 240);
  assert.ok(q.blocks.some((b) => b.kind === "busy"));
});

test("planning : les blocs ne se chevauchent jamais", () => {
  const s = { ...base(), tasks: [task({ estimate: 900, deadline: "2026-10-16", priority: 3 }), task({ id: "t2", estimate: 200, deadline: "2026-10-17" })],
    classes: [{ id: "a", courseId: "x", day: 3, start: "08:30", end: "10:30", room: "" }, { id: "b", courseId: "y", day: 3, start: "13:30", end: "16:30", room: "" }] };
  for (const p of C.planRange(s, TODAY, 5, TODAY)) {
    const bs = [...p.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < bs.length; i++) assert.ok(bs[i].start >= bs[i - 1].end, `${p.date} ${bs[i - 1].label} / ${bs[i].label}`);
  }
});

test("import : refus d'un fichier étranger, réparation des éléments invalides, compatibilité ancienne version", () => {
  assert.equal(C.validateState({ foo: 1 }).ok, false);
  assert.equal(C.validateState(null).ok, false);
  const old = { version: 1, courses: [{ id: "c", name: "Maths", code: "M", coef: 2, color: "#000", grades: [] }], classes: [], tasks: [{ id: "t", title: "X", deadline: "pas une date" }, task()],
    groceries: [{ id: "g", name: "Lait", aisle: "Frais", qty: "", checked: false }], chores: [], sleep: [], focus: [{ date: TODAY, minutes: 30, taskId: null }],
    budget: { monthly: 500, limits: {}, expenses: [] }, settings: { name: "Ancien" } };
  const r = C.validateState(old);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.state.tasks.length, 1); assert.match(r.repaired!, /1 tâches/);
  assert.equal(r.state.groceries[0].price, 0); assert.deepEqual(r.state.budget.recurring, []);
  assert.ok(r.state.focus[0].id); assert.equal(r.state.settings.focusGoal, 180); assert.equal(r.state.settings.name, "Ancien");
});

test("chargement : une sauvegarde illisible est conservée, jamais écrasée", () => {
  const store = new Map<string, string>([[C.STORAGE_KEY, "{corrompu"]]);
  const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const r = C.loadState(st);
  assert.equal(store.get(C.CORRUPT_KEY), "{corrompu");
  assert.ok(r.notice); assert.equal(r.state.settings.onboarded, false);
  const good = new Map([[C.STORAGE_KEY, JSON.stringify(C.seed())]]);
  const r2 = C.loadState({ getItem: (k) => good.get(k) ?? null, setItem: () => {} });
  assert.equal(r2.notice, null); assert.ok(r2.state.tasks.length > 0);
});

test("lecture de ticket : total, date, magasin", () => {
  const r = C.parseReceipt("CARREFOUR CITY\n14/10/2026 18:42\nLAIT 1,05\nSOUS-TOTAL 2,00\nTVA 0,10\nTOTAL A PAYER 12,47\nCB 12,47");
  close(r.amount!, 12.47); assert.equal(r.date, "2026-10-14"); assert.equal(r.store, "CARREFOUR CITY");
});

test("événements : ponctuels et récurrents, occurrences retirées, fin de répétition", async () => {
  const { eventOn } = await import("../src/core.ts");
  const e = (recurrence: string, extra = {}) => ({ id: "e", title: "Foot", date: "2026-10-05", start: "18:00", end: "19:30", recurrence, until: null, ...extra }) as never;
  assert.equal(eventOn(e("none"), "2026-10-05"), true); assert.equal(eventOn(e("none"), "2026-10-12"), false);
  assert.equal(eventOn(e("weekly"), "2026-10-12"), true); assert.equal(eventOn(e("weekly"), "2026-10-13"), false); assert.equal(eventOn(e("weekly"), "2026-09-28"), false);
  assert.equal(eventOn(e("biweekly"), "2026-10-12"), false); assert.equal(eventOn(e("biweekly"), "2026-10-19"), true);
  assert.equal(eventOn(e("monthly"), "2026-11-05"), true); assert.equal(eventOn(e("daily"), "2026-10-09"), true);
  assert.equal(eventOn(e("weekly", { until: "2026-10-12" }), "2026-10-19"), false);
  assert.equal(eventOn(e("weekly", { skipped: ["2026-10-12"] }), "2026-10-12"), false);
});

test("planning : événement bloquant et corvée à heure fixe", async () => {
  const { planDay, blank, validateState } = await import("../src/core.ts");
  const s = blank({ name: "T" }, 600);
  s.events = [{ id: "ev", title: "Dentiste", date: "2026-10-14", start: "14:00", end: "15:00", recurrence: "none", until: null }];
  s.chores = [{ id: "ch", name: "Vaisselle", recurrence: "daily", day: 0, minutes: 20, assignees: ["Moi"], done: [], time: "21:00" }];
  s.tasks = [{ id: "t", title: "Projet", courseId: null, kind: "projet", deadline: "2026-10-15", estimate: 600, spent: 0, priority: 3, status: "todo" } as never];
  const p = planDay(s, "2026-10-14", undefined, "2026-10-14");
  const ev = p.blocks.find((b) => b.kind === "event")!;
  assert.deepEqual([ev.start, ev.end, ev.label], [14 * 60, 15 * 60, "Dentiste"]);
  const ch = p.blocks.find((b) => b.kind === "chore")!;
  assert.deepEqual([ch.start, ch.end], [21 * 60, 21 * 60 + 20]);
  for (const b of p.blocks.filter((x) => x.kind === "task")) assert.ok(b.end <= 14 * 60 || b.start >= 15 * 60 + 10, "travail placé pendant l'événement");
  assert.equal(planDay(s, "2026-10-15", undefined, "2026-10-14").blocks.some((b) => b.kind === "event"), false);
  const v = validateState(JSON.parse(JSON.stringify(s)));
  assert.ok(v.ok); if (v.ok) { assert.equal(v.state.events.length, 1); assert.equal(v.state.chores[0].time, "21:00"); }
  const bad = validateState(JSON.parse(JSON.stringify({ ...s, chores: [{ ...s.chores[0], time: "25:99" }], events: [{ id: "x", title: "y" }] })));
  assert.ok(bad.ok); if (bad.ok) { assert.equal(bad.state.chores[0].time, undefined); assert.equal(bad.state.events.length, 0); }
});

test("tâche à créneau précis : bloc fixe le jour choisi, pas de répartition automatique", async () => {
  const { planDay, blank, validateState } = await import("../src/core.ts");
  const s = blank({ name: "T" }, 600);
  s.tasks = [{ id: "t", title: "Exposé", courseId: null, kind: "projet", deadline: "2026-10-20", estimate: 90, spent: 0, priority: 2, status: "todo", createdAt: "2026-10-14", slot: { date: "2026-10-15", start: "14:00", end: "15:30" } }];
  const d1 = planDay(s, "2026-10-14", undefined, "2026-10-14"), d2 = planDay(s, "2026-10-15", undefined, "2026-10-14");
  assert.equal(d1.blocks.filter((b) => b.kind === "task").length, 0, "répartie automatiquement");
  const b = d2.blocks.find((x) => x.kind === "task")!;
  assert.deepEqual([b.start, b.end], [14 * 60, 15 * 60 + 30]); assert.equal(d2.taskMin, 90);
  const v = validateState(JSON.parse(JSON.stringify({ ...s, tasks: [{ ...s.tasks[0], slot: { date: "x", start: "14:00", end: "13:00" } }] })));
  assert.ok(v.ok); if (v.ok) assert.equal("slot" in v.state.tasks[0], false);
});

test("cours simultanés : côte à côte (colonnes), sans alerte de chevauchement ; alerte seulement avec une indisponibilité", async () => {
  const { layoutLanes, planDay, blank } = await import("../src/core.ts");
  const L = layoutLanes([{ start: 510, end: 600 }, { start: 645, end: 750 }, { start: 645, end: 765 }, { start: 645, end: 765 }, { start: 800, end: 860 }]);
  assert.deepEqual([L[0], L[4]], [{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
  assert.deepEqual(L.slice(1, 4).map((x) => x.lanes), [3, 3, 3]); assert.deepEqual(L.slice(1, 4).map((x) => x.lane).sort(), [0, 1, 2]);
  const s = blank({ name: "T" }, 600);
  s.courses = [{ id: "c", name: "Maths", code: "M", coef: 1, color: "#000", grades: [] } as never];
  s.classes = [{ id: "a", courseId: "c", day: 0, start: "10:45", end: "12:30", room: "B6d" }, { id: "b", courseId: "c", day: 0, start: "10:45", end: "12:45", room: "B5b" }];
  assert.equal(planDay(s, "2026-10-19", undefined, "2026-10-19").conflicts.length, 0);
  s.settings.unavailable = [{ id: "u", day: 0, start: "12:00", end: "14:00", label: "Job" }];
  assert.ok(planDay(s, "2026-10-19", undefined, "2026-10-19").conflicts.length > 0);
});

test("budget : revenus du mois et épargne pris en compte dans le restant", async () => {
  const { budgetStats, validateState, blank } = await import("../src/core.ts");
  const b = { monthly: 600, limits: { Courses: 100 }, expenses: [{ id: "e", date: "2026-10-05", amount: 150, category: "Courses", label: "" }], recurring: [],
    incomes: [{ id: "i", date: "2026-10-01", amount: 450, source: "Job / paye", label: "" }, { id: "j", date: "2026-09-30", amount: 999, source: "Autre", label: "" }],
    savings: [{ id: "s", date: "2026-10-02", amount: 90, label: "" }, { id: "t", date: "2026-10-20", amount: -20, label: "" }, { id: "u", date: "2026-09-01", amount: 100, label: "" }] };
  const s = budgetStats(b, "2026-10", "2026-10-16", ["Courses"]);
  assert.equal(s.income, 450); assert.equal(s.saved, 70); assert.equal(s.savingsTotal, 170);
  assert.equal(s.remaining, 600 + 450 - 150 - 70);
  assert.deepEqual(s.overCats, ["Courses"]);
  const st = blank({ name: "T" }, 600); st.budget = { ...st.budget, ...b, savingsGoal: { name: "Vacances", target: 500 } } as never;
  const v = validateState(JSON.parse(JSON.stringify({ ...st, budget: { ...st.budget, incomes: [...b.incomes, { id: "x", date: "bad", amount: 5 }] } })));
  assert.ok(v.ok); if (v.ok) { assert.equal(v.state.budget.incomes!.length, 2); assert.equal(v.state.budget.savings!.length, 3); assert.equal(v.state.budget.savingsGoal!.target, 500); }
});

test("checklists : étapes de tâche et de corvée (par date), nettoyage", () => {
  let s = { ...base(), tasks: [task({ steps: [{ id: "a", text: "Lire", done: false }, { id: "b", text: "Exos", done: false }] })] };
  s = C.reducer(s, { type: "task/step", id: "t1", stepId: "b" });
  assert.deepEqual(s.tasks[0].steps!.map((x) => x.done), [false, true]);
  const chore: C.Chore = { id: "c", name: "Frigo", recurrence: "weekly", day: 3, minutes: 20, assignees: ["Moi"], done: [], steps: [{ id: "x", text: "Vider" }, { id: "y", text: "Laver" }] };
  s = C.reducer({ ...s, chores: [chore] }, { type: "chore/step", id: "c", date: TODAY, stepId: "x" });
  assert.deepEqual(C.choreStepsDone(s.chores[0], TODAY), ["x"]);
  assert.deepEqual(C.choreStepsDone(s.chores[0], "2026-10-22"), []); // nouvelle occurrence : tout décoché
  s = C.reducer(s, { type: "chore/step", id: "c", date: TODAY, stepId: "x" });
  assert.deepEqual(C.choreStepsDone(s.chores[0], TODAY), []);
  const v = C.validateState(JSON.parse(JSON.stringify({ ...s, tasks: [task({ steps: [{ id: "a", text: "  ok ", done: 1 }, { id: "b", text: "  " }, { text: "sans id" }] as never })] })));
  assert.ok(v.ok);
  if (v.ok) { assert.deepEqual(v.state.tasks[0].steps, [{ id: "a", text: "ok", done: true }]); assert.equal(v.state.chores[0].steps!.length, 2); }
});

test("sommeil à l'heure : proposition automatique et compteurs", () => {
  assert.deepEqual(C.onTimeGuess("23:40", "07:30", "23:30", "07:30"), { bedOk: true, wakeOk: true });
  assert.deepEqual(C.onTimeGuess("00:10", "07:50", "23:30", "07:30"), { bedOk: false, wakeOk: false }); // après minuit = en retard
  assert.deepEqual(C.onTimeGuess("22:50", "06:00", "23:30", "07:30"), { bedOk: true, wakeOk: true }); // en avance = à l'heure
  const L = (date: string, bedOk?: boolean, wakeOk?: boolean): C.SleepLog => ({ date, bed: "23:00", wake: "07:00", quality: 3, bedOk, wakeOk });
  const logs = [L("2026-08-01", false, false), L("2026-10-12", true, false), L("2026-10-13", true, true), L("2026-10-14"), L("2026-10-15", true, true)];
  const all = C.onTimeStats(logs, TODAY), d30 = C.onTimeStats(logs, TODAY, 30);
  assert.deepEqual(all.bed, { ok: 3, late: 1 }); assert.deepEqual(all.wake, { ok: 2, late: 2 });
  assert.deepEqual(d30.bed, { ok: 3, late: 0 });
  assert.equal(all.streak, 2); // 15 et 13 (le 14 non renseigné ne casse pas la série), arrêt au 12
  const v = C.validateState(JSON.parse(JSON.stringify({ ...base(), sleep: [L("2026-10-15", true, "x" as never)] })));
  assert.ok(v.ok && v.state.sleep[0].bedOk === true && !("wakeOk" in v.state.sleep[0]));
});

test("tâches et ménage à l'heure : compteurs", () => {
  const ts = [task({ id: "a", status: "done", deadline: "2026-10-10", doneAt: "2026-10-09" }), task({ id: "b", status: "done", deadline: "2026-10-10", doneAt: "2026-10-12" }),
    task({ id: "c", deadline: "2026-10-14" }), task({ id: "d", deadline: TODAY }), task({ id: "e", status: "done", deadline: "2026-01-10", doneAt: "2026-01-10" })];
  assert.deepEqual(C.taskOnTimeStats(ts, TODAY), { ok: 2, late: 2 });
  assert.deepEqual(C.taskOnTimeStats(ts, TODAY, 30), { ok: 1, late: 2 });
  // Corvée quotidienne : 1re trace le 12 ; faite 12 et 14, oubliée 13, reportée… rien avant le 12, aujourd'hui pas encore en retard.
  const c: C.Chore = { id: "c", name: "Vaisselle", recurrence: "daily", day: 0, minutes: 10, assignees: ["Moi"], done: ["2026-10-12", "2026-10-14"], skipped: [] };
  assert.deepEqual(C.choreOnTimeStats([c], TODAY), { ok: 2, late: 1 });
  assert.deepEqual(C.choreOnTimeStats([{ ...c, done: [] }], TODAY), { ok: 0, late: 0 }); // aucune trace : rien compté
});

test("traduction : textes exacts et modèles {0}", async () => {
  const { compile, translate } = await import("../src/i18nCore.ts");
  const d = compile({ "Tâches à l'heure ?": "Tasks on time?", "{0} nuits d'affilée": "{0} nights in a row", "Échéance reportée au {0}": "Due date moved to {0}", "Ignoré": "" });
  assert.equal(translate(d, "  Tâches   à l'heure ? "), "Tasks on time?");
  assert.equal(translate(d, "3 nuits d'affilée"), "3 nights in a row");
  assert.equal(translate(d, "Échéance reportée au lun. 19 oct."), "Due date moved to lun. 19 oct.");
  assert.equal(translate(d, "Rapport TP"), null);
  assert.equal(translate(d, "Ignoré"), null);
  assert.equal(translate(d, "42"), null);
});

test("routines : jours prévus, stats, série, étapes, nettoyage", () => {
  // TODAY = jeudi 15/10 ; créée le lundi 12, prévue lun→ven.
  const h: C.Habit = { id: "h", name: "Médicaments", emoji: "💊", cat: "santé", days: [0, 1, 2, 3, 4], done: ["2026-10-12", "2026-10-14"], since: "2026-10-12" };
  assert.equal(C.habitOn(h, "2026-10-17"), false); // samedi
  assert.equal(C.habitOn(h, "2026-10-09"), false); // avant création
  assert.deepEqual(C.habitStats([h], TODAY), { ok: 2, late: 1 }); // 13 oublié, aujourd'hui pas encore compté
  assert.equal(C.habitStreak(h, TODAY), 1);
  let s = C.reducer({ ...base(), habits: [h] }, { type: "habit/toggle", id: "h", date: TODAY });
  assert.equal(C.habitStreak(s.habits![0], TODAY), 2);
  s = C.reducer({ ...s, habits: [{ ...s.habits![0], steps: [{ id: "a", text: "Matin" }] }] }, { type: "habit/step", id: "h", date: TODAY, stepId: "a" });
  assert.deepEqual(C.habitStepsDone(s.habits![0], TODAY), ["a"]);
  const v = C.validateState(JSON.parse(JSON.stringify({ ...s, habits: [...s.habits!, { id: "x", name: "Eau", done: ["bad"], days: [9], cat: "zz" }] })));
  assert.ok(v.ok);
  if (v.ok) { const x = v.state.habits![1]; assert.deepEqual(x.days, [0, 1, 2, 3, 4, 5, 6]); assert.equal(x.cat, "autre"); assert.deepEqual(x.done, []); }
});
