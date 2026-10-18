/* Étudiant.OS — colocation : accès à la base (fonctions SQL de supabase/migrations/20261019000001_flats.sql).
 * Seule la clé publique est utilisée ; l'appartenance et la cohérence des montants sont vérifiées par la base. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { frError } from "./supabase.ts";
import type { Flat, FlatExpense, FlatGrocery } from "./flat.ts";

/** Message lisible : les erreurs métier de la base (déjà en français) sont affichées telles quelles ; le reste est traduit. */
export function flatError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "", m = String((e as { message?: string })?.message ?? "");
  if (code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(m)) return "La colocation n'est pas encore activée sur ce serveur (mise à jour de la base à appliquer).";
  if (code === "P0001" || code === "22023" || code === "42501") return m;
  if (code === "23514") return "Valeur refusée : vérifiez les champs saisis.";
  return frError(e);
}
const run = async <T,>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> => { const { data, error } = await p; if (error) throw error; return data; };

export const loadFlat = (sb: SupabaseClient) => run(sb.rpc("my_flat")) as Promise<Flat | null>;
export const createFlat = (sb: SupabaseClient, name: string, display: string) => run(sb.rpc("create_flat", { p_name: name, p_display_name: display })) as Promise<string>;
/** false si le code est inconnu (la base renvoie null pour que l'essai soit compté). */
export const joinFlat = async (sb: SupabaseClient, code: string, display: string) => !!(await run(sb.rpc("join_flat", { p_code: code, p_display_name: display })));
export const leaveFlat = (sb: SupabaseClient) => run(sb.rpc("leave_flat"));
export const regenerateCode = (sb: SupabaseClient) => run(sb.rpc("regenerate_invite_code")) as Promise<string>;
export const removeMember = (sb: SupabaseClient, user: string) => run(sb.rpc("remove_flat_member", { p_user: user }));

export const loadGroceries = (sb: SupabaseClient, flat: string) => run(sb.from("flat_groceries").select("*").eq("flat_id", flat).order("checked").order("updated_at", { ascending: false })) as Promise<FlatGrocery[]>;
export const addGrocery = (sb: SupabaseClient, name: string, aisle: string, qty: string, cents: number) => run(sb.rpc("add_flat_grocery", { p_name: name, p_aisle: aisle, p_qty: qty, p_price_cents: cents }));
export const setGrocery = (sb: SupabaseClient, id: string, checked: boolean | null, cents: number | null) => run(sb.rpc("set_flat_grocery", { p_id: id, p_checked: checked, p_price_cents: cents }));
export const removeGrocery = (sb: SupabaseClient, id: string) => run(sb.rpc("remove_flat_grocery", { p_id: id }));

export const loadExpenses = (sb: SupabaseClient, flat: string) => run(sb.from("flat_expenses").select("*").eq("flat_id", flat).order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(500)) as Promise<FlatExpense[]>;
export const addExpense = (sb: SupabaseClient, e: { cents: number; label: string; date: string; paidBy: string; shares: Record<string, number>; kind?: "expense" | "payment" }) =>
  run(sb.rpc("add_flat_expense", { p_amount_cents: e.cents, p_label: e.label, p_date: e.date, p_paid_by: e.paidBy, p_shares: e.shares, p_kind: e.kind ?? "expense", p_items: [] }));
export const removeExpense = (sb: SupabaseClient, id: string) => run(sb.rpc("remove_flat_expense", { p_id: id }));
export const checkoutGroceries = (sb: SupabaseClient, e: { cents: number; label: string; date: string; paidBy: string; shares: Record<string, number> }) =>
  run(sb.rpc("flat_checkout", { p_amount_cents: e.cents, p_label: e.label, p_date: e.date, p_paid_by: e.paidBy, p_shares: e.shares }));
