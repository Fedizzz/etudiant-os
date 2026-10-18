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
