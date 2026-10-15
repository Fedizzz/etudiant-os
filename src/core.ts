/* Étudiant OS — logique métier partagée (sans React).
 * Types, calculs, reducer, stockage : une seule source de vérité, testée dans tests/.
 */

// ---------------------------------------------------------------- Types
export type ID = string;
export type TaskStatus = "todo" | "doing" | "review" | "done";
export type TaskKind = "devoir" | "examen" | "projet";
export type Priority = 1 | 2 | 3;
export type Recurrence = "daily" | "weekly" | "biweekly";
export type Aisle = "Frais" | "Fruits & légumes" | "Épicerie" | "Boissons" | "Surgelés" | "Hygiène" | "Entretien";
export type ViewKey = "dashboard" | "planning" | "academic" | "focus" | "groceries" | "budget" | "chores" | "sleep" | "settings";
export type ExpenseCat = "Courses" | "Logement" | "Transport" | "Études" | "Restauration" | "Loisirs" | "Santé" | "Autre";

export interface Grade { id: ID; label: string; score: number; weight: number }
/** target : moyenne visée pour le module (facultatif). */
export interface Course { id: ID; name: string; code: string; coef: number; color: string; grades: Grade[]; target?: number | null }
export interface ClassSession { id: ID; courseId: ID; day: number; start: string; end: string; room: string }
export interface Task {
  id: ID; title: string; courseId: ID | null; kind: TaskKind; status: TaskStatus;
  deadline: string; estimate: number; spent: number; priority: Priority; createdAt: string; doneAt?: string;
}
export interface GroceryItem { id: ID; name: string; aisle: Aisle; qty: string; checked: boolean; price: number }
/** source et recurringId permettent de savoir d'où vient une dépense et d'éviter les doublons. */
export interface Expense { id: ID; date: string; amount: number; category: ExpenseCat; label: string; source?: "manuel" | "courses" | "recurrente" | "ticket"; recurringId?: ID; items?: string[] }
/** Dépense récurrente mensuelle (loyer, abonnement…) : ajoutée une seule fois par mois, au jour indiqué. */
export interface RecurringExpense { id: ID; label: string; amount: number; category: ExpenseCat; day: number; active: boolean; since: string; skipMonths?: string[] }
export interface Budget { monthly: number; limits: Partial<Record<ExpenseCat, number>>; expenses: Expense[]; recurring: RecurringExpense[] }
/** done : dates faites · doneBy : qui l'a faite ce jour-là · skipped : dates reportées. */
export interface Chore { id: ID; name: string; recurrence: Recurrence; day: number; minutes: number; assignees: string[]; done: string[]; doneBy?: Record<string, string>; skipped?: string[] }
export interface SleepLog { date: string; bed: string; wake: string; quality: 1 | 2 | 3 | 4 | 5 }
/** id = identifiant de session : un même id n'est jamais enregistré deux fois. */
export interface FocusEntry { id?: ID; date: string; minutes: number; taskId: ID | null; courseId?: ID | null; interrupted?: boolean }
export type Phase = "work" | "short" | "long";
/** Minuteur global : persiste entre pages et actualisations (endAt = horodatage de fin si en cours). */
export interface TimerState { phase: Phase; running: boolean; endAt: number | null; remaining: number; cycles: number; taskId: ID | null; sessionId: ID; courseId?: ID | null }
export interface Unavailability { id: ID; day: number; start: string; end: string; label: string }
export interface PomodoroCfg { work: number; short: number; long: number; longEvery: number }
export interface SettingsState {
  name: string; sleepGoal: number; wakeDefault: string; bedDefault: string; prepMinutes: number;
  fallAsleep: number; maxBlock: number; theme: "system" | "light" | "dark"; pomodoro: PomodoroCfg;
  onboarded: boolean; roommates: string[]; currency: string;
  accent: string; hiddenViews: ViewKey[]; quickExpenses: QuickExpense[];
  /** Objectif de moyenne générale, objectif de focus quotidien (min), indisponibilités hebdomadaires. */
  gradeTarget: number | null; focusGoal: number; unavailable: Unavailability[];
}
export interface QuickExpense { label: string; amount: number; category: ExpenseCat }
export interface TemplateItem { name: string; aisle: Aisle; qty: string; price: number }
export interface GroceryTemplate { id: ID; name: string; items: TemplateItem[] }
/** Base produits apprise : dernier prix payé, rayon, nombre d'achats. */
export interface Product { name: string; aisle: Aisle; price: number; count: number; last: string }
export interface AppState {
  version: 1; courses: Course[]; classes: ClassSession[]; tasks: Task[]; groceries: GroceryItem[];
  chores: Chore[]; sleep: SleepLog[]; focus: FocusEntry[]; budget: Budget; settings: SettingsState;
  templates: GroceryTemplate[]; products: Product[]; timer: TimerState;
}

// ---------------------------------------------------------------- Utilitaires date / temps
export const uid = (): ID => Math.random().toString(36).slice(2, 10);
export const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const todayISO = () => iso(new Date());
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const fmtDur = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h${m ? ` ${pad(m)}` : ""}` : `${m} min`; };
export const daysBetween = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
export const weekday = (d: Date) => (d.getDay() + 6) % 7; // 0 = lundi
export const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const DAYS_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const fmtDate = (s: string) => parseISO(s).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
export const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
};
export const sleepMinutes = (bed: string, wake: string) => { let d = toMin(wake) - toMin(bed); if (d <= 0) d += 1440; return d; };
export const money = (n: number, cur = "€") => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
export const parseAmount = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));
export const monthKey = (s: string) => s.slice(0, 7);
export const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Données initiales réalistes
export function seed(): AppState {
  const t = new Date();
  const d = (n: number) => iso(addDays(t, n));
  const courses: Course[] = [
    { id: "c-alg", name: "Algèbre linéaire", code: "MATH201", coef: 4, color: "#2f6fed", grades: [{ id: uid(), label: "Partiel", score: 13.5, weight: 40 }, { id: uid(), label: "TD noté", score: 16, weight: 20 }] },
    { id: "c-algo", name: "Algorithmique avancée", code: "INFO210", coef: 5, color: "#0f9d76", grades: [{ id: uid(), label: "Projet 1", score: 15, weight: 30 }] },
    { id: "c-eco", name: "Microéconomie", code: "ECO120", coef: 3, color: "#d9822b", grades: [{ id: uid(), label: "QCM", score: 11, weight: 25 }] },
    { id: "c-ang", name: "Anglais scientifique", code: "LANG105", coef: 2, color: "#c2417a", grades: [{ id: uid(), label: "Oral", score: 14, weight: 50 }] },
    { id: "c-phy", name: "Physique statistique", code: "PHYS230", coef: 4, color: "#7a5af5", grades: [] },
  ];
  const cls = (courseId: ID, day: number, start: string, end: string, room: string): ClassSession => ({ id: uid(), courseId, day, start, end, room });
  const classes: ClassSession[] = [
    cls("c-alg", 0, "08:30", "10:30", "Amphi B"), cls("c-algo", 0, "13:30", "16:30", "Salle 214"),
    cls("c-eco", 1, "10:00", "12:00", "Amphi C"), cls("c-phy", 1, "14:00", "16:00", "Labo 3"),
    cls("c-algo", 2, "08:00", "11:00", "Salle 214"), cls("c-ang", 2, "14:00", "15:30", "Salle 102"),
    cls("c-alg", 3, "09:00", "12:00", "Amphi B"), cls("c-phy", 3, "13:30", "15:30", "Amphi A"),
    cls("c-eco", 4, "08:30", "10:30", "Amphi C"), cls("c-ang", 4, "11:00", "12:30", "Salle 102"),
  ];
  const task = (title: string, courseId: ID, kind: TaskKind, status: TaskStatus, dl: number, estimate: number, priority: Priority, spent = 0): Task =>
    ({ id: uid(), title, courseId, kind, status, deadline: d(dl), estimate, spent, priority, createdAt: d(-5) });
  const tasks: Task[] = [
    task("Feuille d'exercices 6 — diagonalisation", "c-alg", "devoir", "doing", 2, 150, 2, 60),
    task("Partiel d'algorithmique (graphes, DP)", "c-algo", "examen", "todo", 6, 480, 3),
    task("Projet : moteur de recherche (indexation)", "c-algo", "projet", "doing", 9, 720, 3, 180),
    task("Fiche de lecture — théorie du consommateur", "c-eco", "devoir", "review", 3, 90, 1, 70),
    task("Essay: AI and scientific writing", "c-ang", "devoir", "todo", 5, 120, 2),
    task("TP Ising — rapport", "c-phy", "projet", "todo", 4, 240, 2),
    task("Révisions chapitre 3 — espaces euclidiens", "c-alg", "examen", "todo", 11, 300, 2),
    task("Exposé oral — préparation slides", "c-ang", "projet", "done", -1, 120, 1, 130),
    task("Exercices élasticité-prix", "c-eco", "devoir", "done", -2, 60, 1, 55),
  ];
  tasks[7].doneAt = d(-1); tasks[8].doneAt = d(-3);
  const g = (name: string, aisle: Aisle, qty: string, checked = false, price = 0): GroceryItem => ({ id: uid(), name, aisle, qty, checked, price });
  const groceries: GroceryItem[] = [
    g("Yaourts nature", "Frais", "x8", false, 2.1), g("Œufs", "Frais", "x12", false, 3.4), g("Emmental râpé", "Frais", "200 g", true, 2.3),
    g("Bananes", "Fruits & légumes", "1 kg", false, 1.9), g("Épinards", "Fruits & légumes", "500 g", false, 2.5), g("Oignons", "Fruits & légumes", "x3", false, 1.2),
    g("Pâtes complètes", "Épicerie", "2 paquets", false, 2.6), g("Riz basmati", "Épicerie", "1 kg", false, 3.2), g("Café moulu", "Épicerie", "250 g", false, 4.5),
    g("Eau pétillante", "Boissons", "6 x 1 L", false, 2.9), g("Petits pois", "Surgelés", "1 sachet", false, 1.8),
    g("Dentifrice", "Hygiène", "x1", false, 2.4), g("Liquide vaisselle", "Entretien", "x1", false, 1.7), g("Sacs poubelle 30 L", "Entretien", "1 rouleau", false, 2.2),
  ];
  const chore = (name: string, recurrence: Recurrence, day: number, minutes: number, assignees: string[]): Chore => ({ id: uid(), name, recurrence, day, minutes, assignees, done: [] });
  const chores: Chore[] = [
    chore("Vaisselle", "daily", 0, 15, ["Moi", "Inès", "Hugo"]),
    chore("Sortir les poubelles", "weekly", 1, 10, ["Hugo", "Moi", "Inès"]),
    chore("Aspirateur parties communes", "weekly", 5, 30, ["Inès", "Hugo", "Moi"]),
    chore("Salle de bain", "weekly", 6, 40, ["Moi", "Inès", "Hugo"]),
    chore("Lessive draps", "biweekly", 6, 20, ["Moi"]),
    chore("Frigo : tri & nettoyage", "biweekly", 3, 25, ["Inès", "Hugo", "Moi"]),
  ];
  const sl: [string, string, 1 | 2 | 3 | 4 | 5][] = [
    ["00:40", "07:10", 2], ["23:30", "07:30", 4], ["01:15", "08:00", 2], ["23:50", "07:00", 3],
    ["00:20", "09:30", 4], ["23:10", "07:20", 5], ["00:05", "06:50", 3], ["23:40", "07:15", 4],
    ["01:00", "07:00", 2], ["23:20", "07:30", 4], ["00:30", "07:10", 3], ["23:45", "07:00", 3], ["00:10", "07:20", 4],
  ];
  const sleep: SleepLog[] = sl.map(([bed, wake, quality], i) => ({ date: d(-(sl.length - i)), bed, wake, quality }));
  const focus: FocusEntry[] = [];
  [95, 140, 60, 175, 120, 30, 150, 110, 85, 160, 45, 130, 100].forEach((m, i) => focus.push({ id: `seed-${i}`, date: d(-(13 - i)), minutes: m, taskId: null }));
  const ex = (n: number, amount: number, category: ExpenseCat, label: string): Expense => ({ id: uid(), date: d(-n), amount, category, label });
  const day = t.getDate();
  const expenses: Expense[] = [
    ex(Math.min(day - 1, 2), 38.4, "Courses", "Supermarché"), ex(Math.min(day - 1, 6), 24.9, "Courses", "Marché + boulangerie"),
    ex(Math.min(day - 1, 3), 3.3, "Restauration", "Resto U"), ex(Math.min(day - 1, 1), 3.3, "Restauration", "Resto U"), ex(Math.min(day - 1, 4), 12, "Loisirs", "Cinéma"),
    ex(Math.min(day - 1, 8), 25, "Transport", "Pass mensuel"), ex(Math.min(day - 1, 5), 17.5, "Études", "Photocopies + classeur"), ex(0, 4.2, "Restauration", "Café + viennoiserie"),
  ];
  return {
    version: 1, courses, classes, tasks, groceries, chores, sleep, focus,
    budget: { monthly: 750, limits: { Courses: 180, Restauration: 60, Loisirs: 50, Transport: 30 }, expenses, recurring: [{ id: "rec-loyer", label: "Loyer (part)", amount: 420, category: "Logement", day: 1, active: true, since: d(-40) }] }, templates: [], products: [], timer: newTimer(DEFAULT_SETTINGS.pomodoro),
    settings: { ...DEFAULT_SETTINGS, name: "Camille", roommates: ["Inès", "Hugo"] },
  };
}
export const DEFAULT_SETTINGS: SettingsState = {
  name: "", sleepGoal: 8, wakeDefault: "07:30", bedDefault: "23:30", prepMinutes: 50, fallAsleep: 14,
  maxBlock: 90, theme: "system", pomodoro: { work: 50, short: 10, long: 25, longEvery: 3 }, onboarded: false, roommates: [], currency: "€",
  accent: "cobalt", hiddenViews: [], gradeTarget: null, focusGoal: 180, unavailable: [],
  quickExpenses: [
    { label: "Resto U", amount: 3.3, category: "Restauration" }, { label: "Café", amount: 1.5, category: "Restauration" },
    { label: "Ticket transport", amount: 2.1, category: "Transport" }, { label: "Boulangerie", amount: 2.4, category: "Courses" },
  ],
};
/** Espace vierge personnalisé : rien d'inventé, seulement les réglages de l'utilisateur. */
export function blank(settings: Partial<SettingsState>, monthly: number): AppState {
  return {
    version: 1, courses: [], classes: [], tasks: [], groceries: [], chores: [], sleep: [], focus: [],
    budget: { monthly, limits: {}, expenses: [], recurring: [] }, settings: { ...DEFAULT_SETTINGS, onboarded: true, ...settings }, templates: [], products: [], timer: newTimer(DEFAULT_SETTINGS.pomodoro),
  };
}

// ---------------------------------------------------------------- Store (reducer + context)
export type Action =
  | { type: "replace"; state: AppState }
  | { type: "task/add"; task: Task } | { type: "task/update"; id: ID; patch: Partial<Task> } | { type: "task/remove"; id: ID }
  | { type: "course/add"; course: Course } | { type: "course/update"; id: ID; patch: Partial<Course> } | { type: "course/remove"; id: ID }
  | { type: "class/add"; session: ClassSession } | { type: "class/remove"; id: ID }
  | { type: "grocery/add"; item: GroceryItem } | { type: "grocery/update"; id: ID; patch: Partial<GroceryItem> } | { type: "grocery/checkout"; amount: number; date: string } | { type: "grocery/toggle"; id: ID } | { type: "grocery/remove"; id: ID } | { type: "grocery/clearChecked" }
  | { type: "chore/add"; chore: Chore } | { type: "chore/toggle"; id: ID; date: string; who?: string } | { type: "chore/remove"; id: ID }
  | { type: "sleep/upsert"; log: SleepLog } | { type: "sleep/remove"; date: string }
  | { type: "focus/log"; entry: FocusEntry }
  | { type: "expense/add"; expense: Expense } | { type: "expense/remove"; id: ID } | { type: "budget/set"; patch: Partial<Omit<Budget, "expenses">> }
  | { type: "settings"; patch: Partial<SettingsState> }
  | { type: "template/save"; template: GroceryTemplate } | { type: "template/remove"; id: ID }
  | { type: "grocery/addMany"; items: GroceryItem[] }
  | { type: "product/upsert"; product: Omit<Product, "count" | "last"> } | { type: "product/remove"; name: string }
  | { type: "class/addMany"; sessions: ClassSession[]; courses: Course[] }
  | { type: "expense/update"; id: ID; patch: Partial<Expense> }
  | { type: "recurring/save"; item: RecurringExpense } | { type: "recurring/remove"; id: ID } | { type: "recurring/sync"; today: string }
  | { type: "chore/skip"; id: ID; date: string }
  | { type: "timer/start"; now: number } | { type: "timer/pause"; now: number } | { type: "timer/reset" }
  | { type: "timer/phase"; phase: Phase } | { type: "timer/task"; taskId: ID | null } | { type: "timer/course"; courseId: ID | null }
  | { type: "timer/finish"; now: number; secondsDone?: number; date: string }
  | { type: "timer/sync"; cfg: PomodoroCfg };

export const norm = (x: string) => x.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function learnProduct(list: Product[], p: Omit<Product, "count" | "last">, bought = false): Product[] {
  const k = norm(p.name); if (!k) return list;
  const prev = list.find((x) => norm(x.name) === k);
  const next: Product = { name: prev?.name ?? p.name.trim(), aisle: p.aisle, price: p.price > 0 ? Math.round(p.price * 100) / 100 : prev?.price ?? 0,
    count: (prev?.count ?? 0) + (bought ? 1 : 0), last: bought ? todayISO() : prev?.last ?? "" };
  return [next, ...list.filter((x) => norm(x.name) !== k)];
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "replace": return a.state;
    case "task/add": return { ...s, tasks: [a.task, ...s.tasks] };
    case "task/update": return {
      ...s, tasks: s.tasks.map((t) => {
        if (t.id !== a.id) return t;
        const next = { ...t, ...a.patch };
        if (a.patch.status === "done" && t.status !== "done") next.doneAt = todayISO();
        if (a.patch.status && a.patch.status !== "done") delete next.doneAt;
        return next;
      }),
    };
    case "task/remove": return { ...s, tasks: s.tasks.filter((t) => t.id !== a.id), timer: s.timer.taskId === a.id ? { ...s.timer, taskId: null } : s.timer };
    case "course/add": return { ...s, courses: [...s.courses, a.course] };
    case "course/update": return { ...s, courses: s.courses.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) };
    case "course/remove": return {
      ...s, courses: s.courses.filter((c) => c.id !== a.id), classes: s.classes.filter((c) => c.courseId !== a.id),
      tasks: s.tasks.map((t) => (t.courseId === a.id ? { ...t, courseId: null } : t)),
    };
    case "class/add": return { ...s, classes: [...s.classes, a.session] };
    case "class/remove": return { ...s, classes: s.classes.filter((c) => c.id !== a.id) };
    case "grocery/add": return {
      ...s, groceries: [...s.groceries, a.item],
      products: a.item.price > 0 ? learnProduct(s.products, { name: a.item.name, aisle: a.item.aisle, price: a.item.price }) : s.products,
    };
    case "grocery/toggle": return { ...s, groceries: s.groceries.map((g) => (g.id === a.id ? { ...g, checked: !g.checked } : g)) };
    case "grocery/remove": return { ...s, groceries: s.groceries.filter((g) => g.id !== a.id) };
    case "grocery/update": return { ...s, groceries: s.groceries.map((g) => (g.id === a.id ? { ...g, ...a.patch } : g)) };
    case "grocery/checkout": {
      const n = s.groceries.filter((g) => g.checked).length;
      if (!n || !(a.amount > 0)) return s; // rien de coché ou montant invalide : aucune dépense (évite les doublons)
      const bought = s.groceries.filter((g) => g.checked);
      const expense: Expense = { id: uid(), date: a.date, amount: Math.round(a.amount * 100) / 100, category: "Courses", label: `Courses (${n} article${n > 1 ? "s" : ""})`, source: "courses", items: bought.map((g) => g.name) };
      const products = bought.reduce((ps, g) => learnProduct(ps, { name: g.name, aisle: g.aisle, price: g.price }, true), s.products);
      return { ...s, groceries: s.groceries.filter((g) => !g.checked), budget: { ...s.budget, expenses: [...s.budget.expenses, expense] }, products };
    }
    case "expense/add": return { ...s, budget: { ...s.budget, expenses: [...s.budget.expenses, a.expense] } };
    case "expense/remove": {
      const gone = s.budget.expenses.find((e) => e.id === a.id);
      // Supprimer une échéance récurrente générée : elle n'est pas recréée ce mois-ci.
      const recurring = gone?.recurringId ? s.budget.recurring.map((r) => (r.id === gone.recurringId ? { ...r, skipMonths: [...(r.skipMonths ?? []), monthKey(gone.date)] } : r)) : s.budget.recurring;
      return { ...s, budget: { ...s.budget, expenses: s.budget.expenses.filter((e) => e.id !== a.id), recurring } };
    }
    case "budget/set": return { ...s, budget: { ...s.budget, ...a.patch } };
    case "grocery/clearChecked": return { ...s, groceries: s.groceries.filter((g) => !g.checked) };
    case "chore/add": return { ...s, chores: [...s.chores, a.chore] };
    case "chore/toggle": return {
      ...s, chores: s.chores.map((c) => {
        if (c.id !== a.id) return c;
        const was = c.done.includes(a.date);
        const doneBy = { ...(c.doneBy ?? {}) };
        if (was) delete doneBy[a.date]; else doneBy[a.date] = a.who ?? choreAssignee(c, parseISO(a.date));
        return { ...c, done: was ? c.done.filter((x) => x !== a.date) : [...c.done, a.date], doneBy, skipped: (c.skipped ?? []).filter((x) => x !== a.date) };
      }),
    };
    case "chore/remove": return { ...s, chores: s.chores.filter((c) => c.id !== a.id) };
    case "sleep/upsert": return { ...s, sleep: [...s.sleep.filter((l) => l.date !== a.log.date), a.log].sort((x, y) => x.date.localeCompare(y.date)) };
    case "sleep/remove": return { ...s, sleep: s.sleep.filter((l) => l.date !== a.date) };
    case "focus/log": return logFocus(s, a.entry);
    case "expense/update": return { ...s, budget: { ...s.budget, expenses: s.budget.expenses.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)) } };
    case "recurring/save": return { ...s, budget: { ...s.budget, recurring: [...s.budget.recurring.filter((r) => r.id !== a.item.id), a.item] } };
    case "recurring/remove": return { ...s, budget: { ...s.budget, recurring: s.budget.recurring.filter((r) => r.id !== a.id) } };
    case "recurring/sync": return applyRecurring(s, a.today);
    case "chore/skip": return {
      ...s, chores: s.chores.map((c) => {
        if (c.id !== a.id) return c;
        const sk = c.skipped ?? [];
        return { ...c, skipped: sk.includes(a.date) ? sk.filter((x) => x !== a.date) : [...sk, a.date], done: c.done.filter((x) => x !== a.date) };
      }),
    };
    case "timer/start": return { ...s, timer: timerStart(s.timer, a.now) };
    case "timer/pause": return { ...s, timer: timerPause(s.timer, a.now) };
    case "timer/reset": return { ...s, timer: { ...newTimer(s.settings.pomodoro), cycles: s.timer.cycles, taskId: s.timer.taskId, phase: s.timer.phase, remaining: phaseSeconds(s.settings.pomodoro, s.timer.phase) } };
    case "timer/phase": return { ...s, timer: { ...s.timer, phase: a.phase, running: false, endAt: null, remaining: phaseSeconds(s.settings.pomodoro, a.phase), sessionId: uid() } };
    case "timer/task": return { ...s, timer: { ...s.timer, taskId: a.taskId, courseId: a.taskId ? s.tasks.find((t) => t.id === a.taskId)?.courseId ?? null : s.timer.courseId ?? null } };
    case "timer/course": return { ...s, timer: { ...s.timer, courseId: a.courseId, taskId: a.courseId && s.timer.taskId && s.tasks.find((t) => t.id === s.timer.taskId)?.courseId !== a.courseId ? null : s.timer.taskId } };
    case "timer/finish": return timerFinish(s, a.now, a.date, a.secondsDone);
    case "timer/sync": return s.timer.running ? s : { ...s, timer: { ...s.timer, remaining: phaseSeconds(a.cfg, s.timer.phase) } };
    case "settings": {
      const settings = { ...s.settings, ...a.patch };
      // Durées Pomodoro modifiées : le minuteur à l'arrêt prend la nouvelle durée.
      const timer = a.patch.pomodoro && !s.timer.running ? { ...s.timer, remaining: phaseSeconds(settings.pomodoro, s.timer.phase) } : s.timer;
      return { ...s, settings, timer };
    }
    case "template/save": return { ...s, templates: [...s.templates.filter((t) => t.id !== a.template.id), a.template] };
    case "template/remove": return { ...s, templates: s.templates.filter((t) => t.id !== a.id) };
    case "grocery/addMany": return { ...s, groceries: [...s.groceries, ...a.items] };
    case "product/upsert": return { ...s, products: learnProduct(s.products, a.product) };
    case "product/remove": return { ...s, products: s.products.filter((x) => norm(x.name) !== norm(a.name)) };
    case "class/addMany": return { ...s, courses: [...s.courses, ...a.courses], classes: [...s.classes, ...a.sessions] };
  }
}

export const STORAGE_KEY = "etudiant-os/v1";
export const BACKUP_KEY = STORAGE_KEY + ":backup";
export const CORRUPT_KEY = STORAGE_KEY + ":corrupt";
export interface LoadResult { state: AppState; notice: string | null }
/**
 * Lecture sûre : une sauvegarde illisible n'est JAMAIS écrasée silencieusement.
 * Elle est copiée dans CORRUPT_KEY avant de repartir d'un espace vierge, et l'utilisateur est prévenu.
 */
export function loadState(storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): LoadResult {
  let raw: string | null = null;
  try { raw = storage?.getItem(STORAGE_KEY) ?? null; } catch { return { state: blank({ onboarded: false }, 600), notice: "Le stockage du navigateur est indisponible : vos données ne seront pas conservées après fermeture." }; }
  if (!raw) return { state: blank({ onboarded: false }, 600), notice: null };
  try {
    const r = validateState(JSON.parse(raw));
    if (r.ok) return { state: r.state, notice: r.repaired ? `Données réparées au chargement : ${r.repaired}.` : null };
  } catch { /* JSON illisible : traité ci-dessous */ }
  try { storage?.setItem(CORRUPT_KEY, raw); } catch { /* quota */ }
  return { state: blank({ onboarded: false }, 600), notice: "Vos données enregistrées étaient illisibles. Une copie a été conservée (Réglages → Sauvegarde) avant de repartir de zéro." };
}
export function isAppState(x: unknown): x is AppState {
  const o = x as AppState;
  return !!o && typeof o === "object" && o.version === 1 && Array.isArray(o.tasks) && Array.isArray(o.courses) && Array.isArray(o.classes)
    && Array.isArray(o.groceries) && Array.isArray(o.chores) && Array.isArray(o.sleep) && Array.isArray(o.focus) && !!o.settings && typeof o.settings === "object";
}
const isNum = (x: unknown): x is number => typeof x === "number" && isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isDate = (x: unknown): x is string => isStr(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(parseISO(x).getTime());
const isTime = (x: unknown): x is string => isStr(x) && /^\d{1,2}:\d{2}$/.test(x) && toMin(x) < 1440;
/**
 * Valide et répare une sauvegarde (chargement ou import) : les éléments invalides sont écartés
 * plutôt que de casser l'application, et le nombre d'éléments retirés est signalé.
 * Compatible avec les sauvegardes des versions précédentes (champs ajoutés complétés).
 */
export function validateState(x: unknown): { ok: true; state: AppState; repaired: string | null } | { ok: false; error: string } {
  if (!isAppState(x)) return { ok: false, error: "Ce fichier n'est pas une sauvegarde Étudiant OS (version 1)." };
  const p = x as AppState & Record<string, unknown>;
  const dropped: string[] = [];
  const keep = <T,>(label: string, arr: unknown[], ok: (v: T) => boolean): T[] => { const out = (arr as T[]).filter((v) => { try { return !!v && ok(v); } catch { return false; } }); if (out.length < arr.length) dropped.push(`${arr.length - out.length} ${label}`); return out; };
  const settings: SettingsState = { ...DEFAULT_SETTINGS, ...(p.settings as Partial<SettingsState>) };
  settings.pomodoro = { ...DEFAULT_SETTINGS.pomodoro, ...(settings.pomodoro ?? {}) };
  for (const k of ["work", "short", "long", "longEvery"] as const) if (!isNum(settings.pomodoro[k]) || settings.pomodoro[k] < 1) settings.pomodoro[k] = DEFAULT_SETTINGS.pomodoro[k];
  if (!isNum(settings.sleepGoal) || settings.sleepGoal < 3 || settings.sleepGoal > 14) settings.sleepGoal = DEFAULT_SETTINGS.sleepGoal;
  if (!isTime(settings.wakeDefault)) settings.wakeDefault = DEFAULT_SETTINGS.wakeDefault;
  if (!isTime(settings.bedDefault)) settings.bedDefault = DEFAULT_SETTINGS.bedDefault;
  settings.roommates = Array.isArray(settings.roommates) ? settings.roommates.filter(isStr) : [];
  settings.hiddenViews = Array.isArray(settings.hiddenViews) ? settings.hiddenViews : [];
  settings.quickExpenses = Array.isArray(settings.quickExpenses) ? settings.quickExpenses.filter((q) => q && isStr(q.label) && isNum(q.amount)) : DEFAULT_SETTINGS.quickExpenses;
  settings.unavailable = Array.isArray(settings.unavailable) ? settings.unavailable.filter((u) => u && isTime(u.start) && isTime(u.end) && isNum(u.day)) : [];
  if (!isNum(settings.focusGoal) || settings.focusGoal < 0) settings.focusGoal = DEFAULT_SETTINGS.focusGoal;
  if (settings.gradeTarget !== null && !(isNum(settings.gradeTarget) && settings.gradeTarget >= 0 && settings.gradeTarget <= 20)) settings.gradeTarget = null;
  if (typeof settings.onboarded !== "boolean") settings.onboarded = false;
  const b = (p.budget ?? {}) as Partial<Budget>;
  const courses = keep<Course>("modules", p.courses, (c) => isStr(c.id) && isStr(c.name)).map((c) => ({
    ...c, coef: isNum(c.coef) && c.coef >= 0 ? c.coef : 1, code: isStr(c.code) ? c.code : "", color: isStr(c.color) ? c.color : "#2f6fed",
    grades: Array.isArray(c.grades) ? c.grades.filter((g) => g && isNum(g.score) && isNum(g.weight)) : [], target: isNum(c.target) ? c.target : null,
  }));
  const state: AppState = {
    version: 1, courses,
    classes: keep<ClassSession>("créneaux", p.classes, (c) => isStr(c.id) && isNum(c.day) && isTime(c.start) && isTime(c.end)),
    tasks: keep<Task>("tâches", p.tasks, (t) => isStr(t.id) && isStr(t.title) && isDate(t.deadline)).map((t) => ({ ...t, estimate: isNum(t.estimate) && t.estimate > 0 ? t.estimate : 60, spent: isNum(t.spent) && t.spent >= 0 ? t.spent : 0, priority: ([1, 2, 3].includes(t.priority) ? t.priority : 2) as Priority, status: (["todo", "doing", "review", "done"].includes(t.status) ? t.status : "todo") as TaskStatus })),
    groceries: keep<GroceryItem>("articles", p.groceries, (g) => isStr(g.id) && isStr(g.name)).map((g) => ({ ...g, price: isNum(g.price) && g.price >= 0 ? g.price : 0, checked: !!g.checked, qty: isStr(g.qty) ? g.qty : "" })),
    chores: keep<Chore>("corvées", p.chores, (c) => isStr(c.id) && isStr(c.name) && Array.isArray(c.assignees)).map((c) => ({ ...c, done: Array.isArray(c.done) ? c.done.filter(isDate) : [], skipped: Array.isArray(c.skipped) ? c.skipped.filter(isDate) : [], doneBy: c.doneBy && typeof c.doneBy === "object" ? c.doneBy : {} })),
    sleep: keep<SleepLog>("nuits", p.sleep, (l) => isDate(l.date) && isTime(l.bed) && isTime(l.wake)),
    focus: keep<FocusEntry>("sessions de focus", p.focus, (f) => isDate(f.date) && isNum(f.minutes) && f.minutes > 0 && f.minutes < 24 * 60).map((f, i) => ({ ...f, id: f.id ?? `legacy-${i}-${f.date}` })),
    budget: {
      monthly: isNum(b.monthly) && b.monthly >= 0 ? b.monthly : 600, limits: b.limits && typeof b.limits === "object" ? b.limits : {},
      expenses: keep<Expense>("dépenses", Array.isArray(b.expenses) ? b.expenses : [], (e) => isStr(e.id) && isDate(e.date) && isNum(e.amount)),
      recurring: keep<RecurringExpense>("dépenses récurrentes", Array.isArray(b.recurring) ? b.recurring : [], (r) => isStr(r.id) && isNum(r.amount) && isNum(r.day)),
    },
    settings,
    templates: Array.isArray(p.templates) ? keep<GroceryTemplate>("listes", p.templates, (t) => isStr(t.name) && Array.isArray(t.items)) : [],
    products: Array.isArray(p.products) ? keep<Product>("produits", p.products, (x) => isStr(x.name)) : [],
    timer: newTimer(settings.pomodoro),
  };
  const t = p.timer as TimerState | undefined;
  if (t && (t.phase === "work" || t.phase === "short" || t.phase === "long") && isNum(t.remaining)) {
    state.timer = { ...state.timer, ...t, endAt: isNum(t.endAt) ? t.endAt : null, running: !!t.running && isNum(t.endAt), taskId: t.taskId && state.tasks.some((x) => x.id === t.taskId) ? t.taskId : null, sessionId: isStr(t.sessionId) ? t.sessionId : uid() };
  }
  return { ok: true, state, repaired: dropped.length ? dropped.join(", ") + " invalides écartés" : null };
}
/** Compatibilité : complète une sauvegarde plus ancienne (utilisé par l'ancien code d'import). */
export function migrate(p: AppState): AppState { const r = validateState(p); return r.ok ? r.state : blank({ onboarded: false }, 600); }



// ---------------------------------------------------------------- Focus : minuteur et journal (une seule source)
export const phaseSeconds = (cfg: PomodoroCfg, p: Phase) => (p === "work" ? cfg.work : p === "short" ? cfg.short : cfg.long) * 60;
export function newTimer(cfg: PomodoroCfg): TimerState {
  return { phase: "work", running: false, endAt: null, remaining: cfg.work * 60, cycles: 0, taskId: null, sessionId: uid() };
}
/** Secondes restantes à l'instant `now`, que le minuteur tourne ou non. */
export const timerLeft = (t: TimerState, now: number) => (t.running && t.endAt ? Math.max(0, Math.round((t.endAt - now) / 1000)) : t.remaining);
export function timerStart(t: TimerState, now: number): TimerState {
  if (t.running) return t;
  return { ...t, running: true, endAt: now + t.remaining * 1000 };
}
export function timerPause(t: TimerState, now: number): TimerState {
  if (!t.running) return t;
  return { ...t, running: false, endAt: null, remaining: timerLeft(t, now) };
}
/** Enregistre une session de focus et met à jour la tâche liée, en une seule opération. Un id déjà présent est ignoré. */
export function logFocus(s: AppState, entry: FocusEntry): AppState {
  if (entry.minutes < 1 || (entry.id && s.focus.some((f) => f.id === entry.id))) return s;
  const task = entry.taskId ? s.tasks.find((t) => t.id === entry.taskId) : undefined;
  const e: FocusEntry = { ...entry, id: entry.id ?? uid(), courseId: task?.courseId ?? entry.courseId ?? null };
  return {
    ...s, focus: [...s.focus, e],
    tasks: task ? s.tasks.map((t) => (t.id === task.id ? { ...t, spent: t.spent + e.minutes, status: t.status === "todo" ? "doing" : t.status } : t)) : s.tasks,
  };
}
/**
 * Termine la phase en cours. Travail : enregistre les minutes réellement faites
 * (session complète, ou partielle si secondsDone est fourni = interruption), puis passe à la pause.
 * Pause : revient au travail. Rejouer la même fin ne crée pas de doublon (sessionId).
 */
export function timerFinish(s: AppState, now: number, date: string, secondsDone?: number): AppState {
  const t = s.timer, cfg = s.settings.pomodoro;
  if (t.phase !== "work") return { ...s, timer: { ...t, phase: "work", running: false, endAt: null, remaining: phaseSeconds(cfg, "work"), sessionId: uid() } };
  const full = phaseSeconds(cfg, "work");
  const done = secondsDone ?? (full - timerLeft(t, now));
  const minutes = Math.floor(Math.min(done, full) / 60);
  let next = minutes >= 1 ? logFocus(s, { id: t.sessionId, date, minutes, taskId: t.taskId, courseId: t.courseId ?? undefined, interrupted: done < full - 1 }) : s;
  const completed = done >= full - 1;
  const cycles = completed ? t.cycles + 1 : t.cycles;
  const phase: Phase = completed ? (cycles % cfg.longEvery === 0 ? "long" : "short") : "work";
  next = { ...next, timer: { ...t, phase, cycles, running: false, endAt: null, remaining: phaseSeconds(cfg, phase), sessionId: uid() } };
  return next;
}
export interface FocusStats {
  today: number; week: number; prevWeek: number; byDay: { date: string; minutes: number }[];
  byCourse: { courseId: ID | null; minutes: number }[]; byTask: { taskId: ID; minutes: number }[]; sessionsToday: number; streak: number;
}
export function focusStats(focus: FocusEntry[], today: string): FocusStats {
  const days = (n: number, off = 0) => Array.from({ length: n }, (_, i) => iso(addDays(parseISO(today), i - n + 1 - off)));
  const sum = (ds: string[]) => focus.filter((f) => ds.includes(f.date)).reduce((n, f) => n + f.minutes, 0);
  const week = days(7);
  const byCourse = new Map<ID | null, number>(), byTask = new Map<ID, number>();
  focus.filter((f) => week.includes(f.date)).forEach((f) => {
    byCourse.set(f.courseId ?? null, (byCourse.get(f.courseId ?? null) ?? 0) + f.minutes);
    if (f.taskId) byTask.set(f.taskId, (byTask.get(f.taskId) ?? 0) + f.minutes);
  });
  let streak = 0;
  for (let i = 0; i < 365; i++) { const d = iso(addDays(parseISO(today), -i)); if (focus.some((f) => f.date === d)) streak++; else if (i > 0) break; }
  return {
    today: sum([today]), week: sum(week), prevWeek: sum(days(7, 7)), byDay: week.map((d) => ({ date: d, minutes: sum([d]) })),
    byCourse: [...byCourse.entries()].map(([courseId, minutes]) => ({ courseId, minutes })).sort((a, b) => b.minutes - a.minutes),
    byTask: [...byTask.entries()].map(([taskId, minutes]) => ({ taskId, minutes })).sort((a, b) => b.minutes - a.minutes),
    sessionsToday: focus.filter((f) => f.date === today).length, streak,
  };
}

// ---------------------------------------------------------------- Académique : moyennes et objectifs
export interface CourseStats { avg: number | null; weightSum: number; count: number; normalized: boolean; invalid: number }
/** Moyenne pondérée des notes valides (0–20, pondération > 0). normalized = les pondérations ne totalisent pas 100 %. */
export function courseStats(c: Course): CourseStats {
  const ok = c.grades.filter((g) => isFinite(g.score) && g.score >= 0 && g.score <= 20 && isFinite(g.weight) && g.weight > 0);
  const w = ok.reduce((n, g) => n + g.weight, 0);
  return { avg: w ? ok.reduce((n, g) => n + g.score * g.weight, 0) / w : null, weightSum: w, count: ok.length, normalized: w > 0 && Math.abs(w - 100) > 0.01, invalid: c.grades.length - ok.length };
}
export interface OverallStats { avg: number | null; coefSum: number; included: Course[]; noGrades: Course[]; zeroCoef: Course[] }
/** Moyenne générale = Σ(moyenne module × coef) / Σ coef, sur les modules notés de coefficient > 0. */
export function overallStats(courses: Course[]): OverallStats {
  const zeroCoef = courses.filter((c) => !(c.coef > 0));
  const noGrades = courses.filter((c) => c.coef > 0 && courseStats(c).avg === null);
  const included = courses.filter((c) => c.coef > 0 && courseStats(c).avg !== null);
  const coefSum = included.reduce((n, c) => n + c.coef, 0);
  return { avg: coefSum ? included.reduce((n, c) => n + courseStats(c).avg! * c.coef, 0) / coefSum : null, coefSum, included, noGrades, zeroCoef };
}
/**
 * Note à obtenir sur la prochaine évaluation (pondération `weight`) pour que la moyenne du module atteigne `target`.
 * nouvelle moyenne = (Σ wᵢ·nᵢ + weight·x) / (Σ wᵢ + weight)  ⇒  x = (target·(W + weight) − Σ wᵢ·nᵢ) / weight
 */
export function neededGrade(c: Course, target: number, weight: number): { grade: number; status: "ok" | "impossible" | "acquis" } | null {
  if (!(weight > 0) || !isFinite(target)) return null;
  const st = courseStats(c);
  const sum = st.avg === null ? 0 : st.avg * st.weightSum;
  const x = (target * (st.weightSum + weight) - sum) / weight;
  return { grade: x, status: x > 20 ? "impossible" : x <= 0 ? "acquis" : "ok" };
}
/** Moyenne à obtenir sur les modules pas encore notés pour atteindre l'objectif général. */
export function neededOnUngraded(courses: Course[], target: number): number | null {
  const o = overallStats(courses);
  const rest = o.noGrades.reduce((n, c) => n + c.coef, 0);
  if (!rest) return null;
  return (target * (o.coefSum + rest) - (o.avg ?? 0) * o.coefSum) / rest;
}
export function courseAverage(c: Course): number | null { return courseStats(c).avg; }
export function overallAverage(courses: Course[]): number | null { return overallStats(courses).avg; }

// ---------------------------------------------------------------- Sommeil
export interface SleepStats { avg7: number | null; avg14: number | null; nights7: number; nights14: number; debt7: number; onGoal7: number; bedSpread: number | null; wakeSpread: number | null; avgBed: number | null; avgWake: number | null }
const circ = (m: number) => (m < 720 ? m + 1440 : m); // coucher après minuit compté comme 24 h + …
const std = (xs: number[]) => { if (xs.length < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / xs.length); };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Statistiques sur les nuits saisies uniquement (une nuit non saisie n'est jamais comptée comme 0 h). */
export function sleepStats(logs: SleepLog[], goalHours: number, today: string): SleepStats {
  const win = (n: number) => { const from = iso(addDays(parseISO(today), -n + 1)); return logs.filter((l) => l.date >= from && l.date <= today); };
  const l7 = win(7), l14 = win(14), goal = goalHours * 60;
  const dur = (ls: SleepLog[]) => ls.map((l) => sleepMinutes(l.bed, l.wake));
  const beds14 = l14.map((l) => circ(toMin(l.bed))), wakes14 = l14.map((l) => toMin(l.wake));
  const ab = mean(beds14);
  return {
    avg7: mean(dur(l7)), avg14: mean(dur(l14)), nights7: l7.length, nights14: l14.length,
    debt7: dur(l7).reduce((n, m) => n + (goal - m), 0), onGoal7: dur(l7).filter((m) => m >= goal - 15).length,
    bedSpread: std(beds14), wakeSpread: std(wakes14), avgBed: ab === null ? null : ab % 1440, avgWake: mean(wakes14),
  };
}
export function sleepDebt(state: AppState, days = 7): number {
  const goal = state.settings.sleepGoal * 60, today = todayISO();
  return state.sleep.filter((l) => daysBetween(l.date, today) < days && l.date <= today).reduce((n, l) => n + (goal - sleepMinutes(l.bed, l.wake)), 0);
}
export function sleepRegularity(logs: SleepLog[]): number { return std(logs.map((l) => circ(toMin(l.bed)))) ?? 0; }

// ---------------------------------------------------------------- Budget
/** Ajoute une fois par mois les dépenses récurrentes dont le jour est atteint (idempotent : id déterministe). */
export function applyRecurring(s: AppState, today: string): AppState {
  const mk = monthKey(today), day = Number(today.slice(8, 10));
  const add: Expense[] = [];
  for (const r of s.budget.recurring) {
    if (!r.active || !(r.amount > 0)) continue;
    const dim = daysInMonth(parseISO(today));
    const due = Math.min(Math.max(1, r.day), dim);
    const id = `rec-${r.id}-${mk}`;
    if (day < due || s.budget.expenses.some((e) => e.id === id) || (r.since && monthKey(r.since) > mk) || (r.skipMonths ?? []).includes(mk)) continue;
    add.push({ id, date: `${mk}-${pad(due)}`, amount: r.amount, category: r.category, label: r.label, source: "recurrente", recurringId: r.id });
  }
  return add.length ? { ...s, budget: { ...s.budget, expenses: [...s.budget.expenses, ...add] } } : s;
}
export interface BudgetStats {
  spent: number; remaining: number; daily: number[]; byCat: { cat: ExpenseCat; spent: number; limit?: number; over: boolean }[];
  recurringPlanned: number; recurringPaid: number; variable: number; projection: number | null; perDayLeft: number | null; elapsed: number; dim: number; overCats: ExpenseCat[];
}
/**
 * Statistiques d'un mois (yyyy-mm). Projection = récurrentes du mois (prévues) + dépenses variables extrapolées au rythme actuel.
 * Les dépenses récurrentes ne sont pas extrapolées : le loyer n'est payé qu'une fois.
 */
export function budgetStats(b: Budget, month: string, today: string, cats: ExpenseCat[]): BudgetStats {
  const exp = b.expenses.filter((e) => monthKey(e.date) === month && isFinite(e.amount));
  const ref = parseISO(month + "-01"), dim = daysInMonth(ref);
  const isCur = monthKey(today) === month, isPast = month < monthKey(today);
  const elapsed = isCur ? Number(today.slice(8, 10)) : isPast ? dim : 0;
  const spent = exp.reduce((n, e) => n + e.amount, 0);
  const recurringPaid = exp.filter((e) => e.recurringId).reduce((n, e) => n + e.amount, 0);
  const recurringPlanned = b.recurring.filter((r) => r.active && (!r.since || monthKey(r.since) <= month)).reduce((n, r) => n + r.amount, 0);
  const variable = spent - recurringPaid;
  const projection = !elapsed ? null : isPast ? spent : Math.max(recurringPlanned, recurringPaid) + (variable / elapsed) * dim;
  const byCat = cats.map((cat) => { const v = exp.filter((e) => e.category === cat).reduce((n, e) => n + e.amount, 0); const limit = b.limits[cat]; return { cat, spent: v, limit, over: !!limit && v > limit }; });
  const remaining = b.monthly - spent;
  return {
    spent, remaining, daily: Array.from({ length: dim }, (_, i) => exp.filter((e) => Number(e.date.slice(8, 10)) === i + 1).reduce((n, e) => n + e.amount, 0)),
    byCat, recurringPlanned, recurringPaid, variable, projection, elapsed, dim,
    perDayLeft: isCur ? (remaining - Math.max(0, recurringPlanned - recurringPaid)) / (dim - elapsed + 1) : null,
    overCats: byCat.filter((c) => c.over).map((c) => c.cat),
  };
}

// ---------------------------------------------------------------- Ménage : historique et équité
export function choreHistory(chores: Chore[], people: string[], today: string, weeks = 4) {
  const from = iso(addDays(parseISO(today), -weeks * 7 + 1));
  const rows = people.map((p) => ({ person: p, done: 0, minutes: 0, assigned: 0, skipped: 0 }));
  const row = (p: string) => rows.find((r) => r.person === p);
  for (const c of chores) {
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(parseISO(from), i), k = iso(d);
      if (k > today || !choreScheduledOn(c, d)) continue;
      const who = choreAssignee(c, d);
      const r = row(who); if (r) r.assigned++;
      if ((c.skipped ?? []).includes(k) && r) r.skipped++;
    }
    for (const k of c.done) { if (k < from || k > today) continue; const r = row(c.doneBy?.[k] ?? choreAssignee(c, parseISO(k))); if (r) { r.done++; r.minutes += c.minutes; } }
  }
  return rows;
}

// ---------------------------------------------------------------- Moteur de planification
export interface Block { start: number; end: number; kind: "class" | "task" | "chore" | "meal" | "sleep" | "busy"; label: string; color?: string; refId?: ID }
export interface Conflict { a: string; b: string; start: number; end: number }
export interface DayPlan {
  date: string; wake: number; bed: number; blocks: Block[]; classMin: number; taskMin: number; choreMin: number;
  awakeMin: number; load: number; overflow: { task: Task; minutes: number }[]; level: "calme" | "équilibré" | "chargé" | "surcharge";
  busyMin: number; conflicts: Conflict[]; overdue: Task[]; past: boolean;
}
/** Jours de rattrapage pour une tâche en retard : son reste est réparti sur cette fenêtre au lieu d'être tout mis aujourd'hui. */
export const OVERDUE_SPREAD = 3;

/**
 * Minutes à placer pour une tâche un jour donné : reste ÷ jours restants avant l'échéance
 * (on vise la veille), ajusté par la priorité, arrondi à 5 min.
 * Tâche en retard : reste réparti sur OVERDUE_SPREAD jours à partir d'aujourd'hui (jamais tout d'un coup).
 */
export function dailyQuota(t: Task, date: string, remaining = Math.max(0, t.estimate - t.spent), today = date): number {
  if (!(remaining > 0)) return 0;
  const left = daysBetween(date, t.deadline);
  const spread = left < 0 ? Math.max(1, OVERDUE_SPREAD - daysBetween(today, date)) : Math.max(1, left);
  const factor = t.priority === 3 ? 1.25 : t.priority === 1 ? 0.85 : 1;
  return Math.min(remaining, Math.ceil(((remaining / spread) * factor) / 5) * 5);
}
export function choreScheduledOn(c: Chore, d: Date): boolean {
  if (c.recurrence === "daily") return true;
  if (weekday(d) !== c.day) return false;
  return c.recurrence === "weekly" || isoWeek(d) % 2 === 0;
}
export function choreAssignee(c: Chore, d: Date): string {
  if (!c.assignees.length) return "—";
  // Index de jour calculé sur la date locale (indépendant du fuseau et de l'heure d'été).
  const dayIdx = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const idx = c.recurrence === "daily" ? dayIdx : c.recurrence === "weekly" ? isoWeek(d) : Math.floor(isoWeek(d) / 2);
  return c.assignees[idx % c.assignees.length];
}

/**
 * Plan d'une journée. `remaining` = reste à faire par tâche (simulation multi-jours) ;
 * les journées passées ne reçoivent aucun bloc automatique.
 */
export function planDay(state: AppState, date: string, remaining?: Map<ID, number>, today = todayISO()): DayPlan {
  const d = parseISO(date);
  const { settings, classes, courses, tasks, chores } = state;
  const wd = weekday(d);
  const dayClasses = classes.filter((c) => c.day === wd).sort((a, b) => toMin(a.start) - toMin(b.start));
  const nextDay = addDays(d, 1);
  const tomorrowFirst = classes.filter((c) => c.day === weekday(nextDay)).map((c) => toMin(c.start)).sort((a, b) => a - b)[0];
  const wake = dayClasses.length ? Math.min(toMin(settings.wakeDefault), toMin(dayClasses[0].start) - settings.prepMinutes) : toMin(settings.wakeDefault) + 60;
  let bed = toMin(settings.bedDefault);
  if (tomorrowFirst !== undefined) {
    const idealBed = tomorrowFirst - settings.prepMinutes - 5 * 90 - settings.fallAsleep + 1440;
    bed = Math.min(bed < 600 ? bed + 1440 : bed, idealBed);
  } else if (bed < 600) bed += 1440;
  const color = (id: ID | null) => courses.find((c) => c.id === id)?.color;

  const fixed: Block[] = [
    ...dayClasses.map((c): Block => ({ start: toMin(c.start), end: toMin(c.end), kind: "class", label: `${courses.find((x) => x.id === c.courseId)?.name ?? "Cours"} · ${c.room}`, color: color(c.courseId), refId: c.id })),
    { start: 12 * 60 + 15, end: 13 * 60, kind: "meal" as const, label: "Déjeuner" },
    { start: 19 * 60 + 45, end: 20 * 60 + 30, kind: "meal" as const, label: "Dîner" },
    ...(settings.unavailable ?? []).filter((u) => u.day === wd && toMin(u.end) > toMin(u.start)).map((u): Block => ({ start: toMin(u.start), end: toMin(u.end), kind: "busy", label: u.label || "Indisponible", refId: u.id })),
  ].filter((b) => !(b.kind === "meal" && [...dayClasses.map((c) => [toMin(c.start), toMin(c.end)]), ...(settings.unavailable ?? []).filter((u) => u.day === wd).map((u) => [toMin(u.start), toMin(u.end)])].some(([s0, e0]) => s0 < b.end && e0 > b.start)));
  // Chevauchements entre cours et indisponibilités (jamais déplacés automatiquement : seulement signalés).
  const hard = fixed.filter((b) => b.kind === "class" || b.kind === "busy").sort((x, y) => x.start - y.start);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < hard.length; i++) for (let j = i + 1; j < hard.length; j++) {
    if (hard[j].start < hard[i].end) conflicts.push({ a: hard[i].label, b: hard[j].label, start: hard[j].start, end: Math.min(hard[i].end, hard[j].end) });
  }
  const past = date < today;

  // Créneaux libres = journée éveillée moins les blocs fixes, avec 10 min de tampon après chaque cours.
  const busy = fixed.map((b) => [b.start, b.kind === "class" || b.kind === "busy" ? b.end + 10 : b.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = wake + 30;
  for (const [s, e] of busy) { if (s > cursor) free.push([cursor, Math.min(s, bed)]); cursor = Math.max(cursor, e); }
  if (cursor < bed - 30) free.push([cursor, bed - 30]);

  const due = past ? [] : chores.filter((c) => choreScheduledOn(c, d) && choreAssignee(c, d) === "Moi" && !c.done.includes(date) && !(c.skipped ?? []).includes(date));
  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.deadline < today && (remaining?.get(t.id) ?? t.estimate - t.spent) > 0);
  const queue = (past ? [] : open)
    .map((t) => ({ t, q: dailyQuota(t, date, remaining ? remaining.get(t.id) ?? 0 : Math.max(0, t.estimate - t.spent), today) }))
    .filter((x) => x.q > 0)
    .sort((a, b) => daysBetween(date, a.t.deadline) - daysBetween(date, b.t.deadline) || b.t.priority - a.t.priority);

  const blocks: Block[] = [...fixed];
  const place = (minutes: number, mk: (s: number, e: number) => Block): number => {
    let left = minutes;
    for (const slot of free) {
      while (left > 0 && slot[1] - slot[0] >= 15) {
        const len = Math.min(left, settings.maxBlock, slot[1] - slot[0]);
        blocks.push(mk(slot[0], slot[0] + len));
        slot[0] += len + 10; left -= len;
      }
      if (left <= 0) break;
    }
    return Math.max(0, left);
  };
  let choreMin = 0;
  for (const c of due) { const rest = place(c.minutes, (s, e) => ({ start: s, end: e, kind: "chore", label: c.name, refId: c.id })); choreMin += c.minutes - rest; }
  const overflow: DayPlan["overflow"] = [];
  let taskMin = 0;
  for (const { t, q } of queue) {
    const rest = place(q, (s, e) => ({ start: s, end: e, kind: "task", label: t.kind === "examen" ? `Révision · ${t.title}` : t.title, color: color(t.courseId), refId: t.id }));
    taskMin += q - rest;
    if (rest > 0) overflow.push({ task: t, minutes: rest });
  }
  blocks.sort((a, b) => a.start - b.start);
  const classMin = dayClasses.reduce((n, c) => n + toMin(c.end) - toMin(c.start), 0);
  const busyMin = fixed.filter((b) => b.kind === "busy").reduce((n, b) => n + b.end - b.start, 0);
  const awakeMin = Math.max(1, bed - wake);
  const overflowMin = overflow.reduce((n, o) => n + o.minutes, 0);
  // Saturation : temps engagé / temps éveillé « productif » (on réserve 30 % à la récupération).
  const load = (classMin + busyMin + taskMin + choreMin + overflowMin) / (awakeMin * 0.7);
  const level = load > 1 ? "surcharge" : load > 0.85 ? "chargé" : load > 0.5 ? "équilibré" : "calme";
  return { date, wake, bed, blocks, classMin, taskMin, choreMin, awakeMin, load, overflow, level, busyMin, conflicts, overdue, past };
}
/**
 * Plans de `n` jours à partir de `start`, en simulant l'avancement : ce qui est planifié un jour
 * est retiré du reste à faire des jours suivants (pas de double comptage de la charge).
 */
export function planRange(state: AppState, start: string, n: number, today = todayISO()): DayPlan[] {
  const rem = new Map(state.tasks.filter((t) => t.status !== "done").map((t) => [t.id, Math.max(0, t.estimate - t.spent)] as [ID, number]));
  const out: DayPlan[] = [];
  const first = start < today ? today : start;
  // Les jours entre aujourd'hui et `start` consomment aussi du travail.
  for (let i = 0; i < daysBetween(first, start); i++) consume(planDay(state, iso(addDays(parseISO(first), i)), rem, today), rem);
  for (let i = 0; i < n; i++) { const p = planDay(state, iso(addDays(parseISO(start), i)), rem, today); if (!p.past) consume(p, rem); out.push(p); }
  return out;
}
function consume(p: DayPlan, rem: Map<ID, number>) {
  for (const b of p.blocks) if (b.kind === "task" && b.refId) rem.set(b.refId, Math.max(0, (rem.get(b.refId) ?? 0) - (b.end - b.start)));
}
/** Plan d'un jour donné, cohérent avec la simulation depuis aujourd'hui. */
export function planFor(state: AppState, date: string, today = todayISO()): DayPlan {
  return date <= today ? planDay(state, date, undefined, today) : planRange(state, date, 1, today)[0];
}

// ---------------------------------------------------------------- Calculs dérivés
export function lastNDays(n: number): string[] { const t = new Date(); return Array.from({ length: n }, (_, i) => iso(addDays(t, i - n + 1))); }
export function bedtimeOptions(wakeMin: number, fallAsleep: number) {
  return [6, 5, 4].map((cycles) => ({ cycles, bed: wakeMin - cycles * 90 - fallAsleep, hours: (cycles * 90) / 60 }));
}


export interface ReceiptResult { amount: number | null; date: string | null; store: string; text: string }
export function parseReceipt(text: string): ReceiptResult {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const amountsIn = (l: string) => [...l.matchAll(/(\d{1,4})[.,](\d{2})(?!\d)/g)].map((m) => Number(m[1] + "." + m[2]));
  let amount: number | null = null;
  const totalLine = [...lines].reverse().find((l) => /(total|a\s*payer|à\s*payer|net\s*a|montant|ttc|carte|cb\b|esp[eè]ces)/i.test(l) && !/sous[-\s]?total|tva|remise|rendu/i.test(l) && amountsIn(l).length);
  if (totalLine) amount = amountsIn(totalLine).pop() ?? null;
  if (amount === null) { const all = lines.flatMap(amountsIn).filter((v) => v < 2000); amount = all.length ? Math.max(...all) : null; }
  const dm = text.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  let date: string | null = null;
  if (dm) { const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]); const d = new Date(y, Number(dm[2]) - 1, Number(dm[1])); if (!isNaN(d.getTime()) && y > 2000) date = iso(d); }
  const store = (lines.find((l) => /[a-z]{3,}/i.test(l) && !/\d{2}[/.]\d{2}/.test(l)) ?? "").replace(/[^\p{L}\d '&-]/gu, "").trim().slice(0, 32);
  return { amount, date, store, text };
}
