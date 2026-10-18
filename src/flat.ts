/* Étudiant.OS — colocation : calculs purs (centimes entiers) pour la répartition des dépenses et « qui doit combien à qui ».
 * La base (supabase/migrations/20261019000001_flats.sql) vérifie la même règle : la somme des parts = le montant. */

export interface FlatMember { user_id: string; display_name: string; role: "owner" | "member"; left: boolean }
export interface Flat { id: string; name: string; invite_code: string; me: string; members: FlatMember[] }
export interface FlatGrocery { id: string; flat_id: string; name: string; aisle: string; qty: string; checked: boolean; price_cents: number; added_by: string; updated_at: string }
export interface FlatExpense { id: string; flat_id: string; kind: "expense" | "payment"; paid_by: string; amount_cents: number; label: string; spent_on: string; shares: Record<string, number>; items: string[]; created_by: string; created_at: string }
export interface Transfer { from: string; to: string; cents: number }

/** Partage égal en centimes : le reste (quelques centimes) va aux premiers de la liste, un centime chacun. */
export function splitEqual(cents: number, userIds: string[]): Record<string, number> {
  const ids = [...new Set(userIds)];
  if (!ids.length || !Number.isInteger(cents) || cents < 1) return {};
  const base = Math.floor(cents / ids.length), rest = cents - base * ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, base + (i < rest ? 1 : 0)]));
}

/** Parts d'une dépense : les participants cochés se partagent le montant à parts égales. */
export const sharesFor = (cents: number, participants: string[]) => splitEqual(cents, participants);

/** Solde de chacun en centimes : > 0 = on lui doit de l'argent, < 0 = il doit de l'argent. La somme des soldes est toujours 0. */
export function balances(expenses: Pick<FlatExpense, "paid_by" | "amount_cents" | "shares">[]): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const e of expenses) {
    bal[e.paid_by] = (bal[e.paid_by] ?? 0) + e.amount_cents;
    for (const [u, c] of Object.entries(e.shares)) bal[u] = (bal[u] ?? 0) - c;
  }
  return bal;
}

/** Remboursements les moins nombreux qui remettent tous les soldes à zéro (le plus gros débiteur paie le plus gros créancier). */
export function settleUp(bal: Record<string, number>): Transfer[] {
  const debtors = Object.entries(bal).filter(([, c]) => c < 0).map(([id, c]) => ({ id, c: -c })).sort((a, b) => b.c - a.c || a.id.localeCompare(b.id));
  const creditors = Object.entries(bal).filter(([, c]) => c > 0).map(([id, c]) => ({ id, c })).sort((a, b) => b.c - a.c || a.id.localeCompare(b.id));
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const t = Math.min(debtors[i].c, creditors[j].c);
    if (t > 0) out.push({ from: debtors[i].id, to: creditors[j].id, cents: t });
    debtors[i].c -= t; creditors[j].c -= t;
    if (debtors[i].c === 0) i++;
    if (creditors[j].c === 0) j++;
  }
  return out;
}

/** « 12,50 € » à partir de centimes. */
export const eurosOf = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
/** Centimes à partir de ce que l'utilisateur tape (« 12,5 », « 12.50 ») ; null si invalide ou ≤ 0. */
export function centsFromInput(v: string): number | null {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(v);
  if (!m) return null;
  const c = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
  return c > 0 ? c : null;
}
/** Nom lisible d'un membre (ancien membre si sa ligne a disparu). */
export const nameOf = (flat: Pick<Flat, "members">, id: string) => flat.members.find((m) => m.user_id === id)?.display_name ?? "ancien membre";

// ---------------------------------------------------------------- Ménage partagé
import { choreAssignee, choreScheduledOn } from "./core.ts";
import type { Chore, Expense, ExpenseCat } from "./core.ts";

export interface FlatChore { id: string; flat_id: string; name: string; recurrence: "daily" | "weekly" | "biweekly" | "once"; day: number; due_on: string | null; minutes: number; time: string | null; steps: { id: string; text: string }[]; rotation: string[]; created_by: string }
/** État d'un jour d'une corvée : fait (done_by renseigné), reporté et/ou étapes cochées. ticked_on = jour réel du coche (null pour d'anciennes lignes). */
export interface FlatChoreDone { chore_id: string; flat_id: string; done_on: string; done_by: string | null; skipped?: boolean; steps_done?: string[]; ticked_on?: string | null }

/** Corvée commune sous la forme utilisée par le calendrier de l'application (la rotation = les membres encore présents, dans l'ordre choisi). */
const asLocal = (c: FlatChore, activeIds: string[]): Chore => ({
  id: c.id, name: c.name, recurrence: c.recurrence, day: c.day, minutes: c.minutes, done: [],
  ...(c.due_on ? { date: c.due_on } : {}), ...(c.time ? { time: c.time } : {}), ...(c.steps?.length ? { steps: c.steps } : {}), assignees: c.rotation.filter((u) => activeIds.includes(u)),
});
/** La corvée a-t-elle lieu ce jour-là ? (mêmes règles que le ménage personnel) */
export const flatChoreOn = (c: FlatChore, d: Date) => choreScheduledOn(asLocal(c, []), d);
/** Qui doit la faire ce jour-là (rotation entre les membres encore présents) ; null si personne n'est désigné. */
export function flatChoreAssignee(c: FlatChore, d: Date, activeIds: string[]): string | null {
  const l = asLocal(c, activeIds);
  return l.assignees.length ? choreAssignee(l, d) : null;
}

/** Corvées communes sous la forme des corvées personnelles (assignees = prénoms, « Moi » pour soi) : le planning et le tableau de bord les traitent comme les autres.
 *  `shared: true` les exclut des statistiques personnelles ; elles ne sont jamais enregistrées dans l'état de l'utilisateur. */
export function virtualChores(flat: Pick<Flat, "me" | "members">, chores: FlatChore[], done: FlatChoreDone[]): Chore[] {
  const active = flat.members.filter((m) => !m.left);
  const label = (id: string) => id === flat.me ? "Moi" : (() => { const n = active.find((m) => m.user_id === id)?.display_name ?? "?"; return n === "Moi" ? "Moi (colocataire)" : n; })();
  return chores.map((c) => {
    const l = asLocal(c, active.map((m) => m.user_id));
    const rows = done.filter((d) => d.chore_id === c.id);
    const ticked = rows.filter((d) => d.done_by);
    const stepsDone = Object.fromEntries(rows.filter((d) => d.steps_done?.length).map((d) => [d.done_on, d.steps_done!]));
    return { ...l, id: `flat:${c.id}`, shared: true, assignees: l.assignees.map(label),
      done: ticked.map((d) => d.done_on), doneBy: Object.fromEntries(ticked.map((d) => [d.done_on, label(d.done_by!)])),
      doneOn: Object.fromEntries(ticked.map((d) => [d.done_on, d.ticked_on ?? d.done_on])),
      skipped: rows.filter((d) => d.skipped).map((d) => d.done_on), ...(Object.keys(stepsDone).length ? { stepsDone } : {}) };
  });
}

/** Corvée (forme personnelle, prénoms) → paramètres de save_flat_chore : « Moi » = soi, les prénoms sont rapprochés des membres actifs. */
export function choreToRpc(flat: Pick<Flat, "me" | "members">, c: Pick<Chore, "name" | "recurrence" | "day" | "date" | "minutes" | "time" | "steps" | "assignees">) {
  const active = flat.members.filter((m) => !m.left);
  const ids = c.assignees.map((n) => n === "Moi" ? flat.me : (active.find((m) => m.display_name === n || (n === "Moi (colocataire)" && m.display_name === "Moi"))?.user_id ?? null)).filter((x): x is string => !!x);
  return { name: c.name.trim(), recurrence: c.recurrence, day: c.day, due: c.recurrence === "once" ? (c.date ?? null) : null, minutes: Math.max(1, Math.min(600, Math.round(c.minutes) || 20)),
    time: c.time ?? null, steps: (c.steps ?? []).map((x) => ({ id: x.id, text: x.text.trim() })).filter((x) => x.text).slice(0, 40), rotation: [...new Set(ids)] };
}

// ---------------------------------------------------------------- Budget personnel : ma part des dépenses communes
/** Catégorie du budget personnel pour une dépense commune : achats de la liste commune → Courses ; charges connues → Logement ; sinon Autre. */
export function flatExpenseCategory(e: Pick<FlatExpense, "label" | "items">): ExpenseCat {
  if (e.items?.length) return "Courses";
  if (/(?<!\p{L})(loyer|internet|wifi|box|fibre|[ée]lectricit[ée]|[ée]nergie|eau|gaz|charges|assurance|syndic)(?!\p{L})/iu.test(e.label)) return "Logement";
  if (/(?<!\p{L})(courses?|supermarch[ée]|carrefour|lidl|aldi|auchan|leclerc|intermarch[ée]|monoprix|franprix)(?!\p{L})/iu.test(e.label)) return "Courses";
  return "Autre";
}
/** MA part de chaque dépense commune (en euros), sous la forme des dépenses du budget personnel, pour l'affichage seulement.
 *  Modèle « consommation » : on compte ce que coûte chaque dépense à CHACUN (sa part), que ce soit lui ou un colocataire qui ait payé ;
 *  les remboursements entre colocataires ne sont donc PAS recomptés (sinon la même dépense compterait deux fois). */
export function virtualExpenses(me: string, expenses: FlatExpense[]): Expense[] {
  return expenses.filter((e) => e.kind === "expense" && (e.shares[me] ?? 0) > 0).map((e) => ({
    id: `flat:${e.id}`, date: e.spent_on, amount: e.shares[me] / 100, category: flatExpenseCategory(e),
    label: e.label || "Dépense partagée", source: "colocation" as const, shared: true,
    ...(e.items?.length ? { items: e.items } : {}),
  }));
}
