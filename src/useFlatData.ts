/* Étudiant.OS — données de la colocation partagées par toute l'application (une seule lecture, relue toutes les 20 s,
 * au retour sur l'onglet et après chaque action). Actif seulement avec un compte : sinon status = "off" et rien ne change.
 * Sert : l'onglet Colocation (membres, code), les onglets Courses / Budget / Ménage (version colocation) et le planning (corvées). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Chore } from "./core.ts";
import type { AppEnv } from "./env.ts";
import { supabase } from "./supabase.ts";
import * as api from "./flatApi.ts";
import { virtualChores } from "./flat.ts";
import type { Flat, FlatChore, FlatChoreDone, FlatExpense, FlatGrocery } from "./flat.ts";

export interface FlatData {
  /** off = pas de compte · loading · none = compte sans appartement · in = dans un appartement */
  status: "off" | "loading" | "none" | "in";
  flat: Flat | null; groceries: FlatGrocery[]; expenses: FlatExpense[]; chores: FlatChore[]; done: FlatChoreDone[];
  /** false tant que la migration du ménage partagé n'est pas appliquée : le reste continue de fonctionner. */
  choresOk: boolean;
  err: string | null;
  refresh(): Promise<void>;
  /** Exécute une action puis relit tout ; l'erreur est affichée en clair. */
  act(fn: () => Promise<unknown>, ok?: string): Promise<void>;
  /** Corvées communes sous la forme des corvées personnelles (planning, tableau de bord). Vide hors appartement. */
  virtual: Chore[];
  /** Coche / décoche une corvée commune (id « flat:… ») ; affichage immédiat puis relecture. Renvoie un message d'erreur ou null. */
  toggleChore(id: string, date: string): Promise<string | null>;
  /** Fonction d'affichage des messages, branchée par l'application. */
  notify: { current: ((text: string, tone?: "ok" | "bad" | "info") => void) | null };
}
const OFF: FlatData = { status: "off", flat: null, groceries: [], expenses: [], chores: [], done: [], choresOk: true, err: null, refresh: async () => {}, act: async () => {}, virtual: [], toggleChore: async () => null, notify: { current: null } };

export function useFlatData(env: AppEnv): FlatData {
  const live = env.mode === "cloud" && !!supabase;
  const [status, setStatus] = useState<FlatData["status"]>(live ? "loading" : "off");
  const [flat, setFlat] = useState<Flat | null>(null);
  const [groceries, setGroceries] = useState<FlatGrocery[]>([]);
  const [expenses, setExpenses] = useState<FlatExpense[]>([]);
  const [chores, setChores] = useState<FlatChore[]>([]);
  const [done, setDone] = useState<FlatChoreDone[]>([]);
  const [choresOk, setChoresOk] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false), notify = useRef<FlatData["notify"]["current"]>(null);
  const last = useRef("");

  const refresh = useCallback(async () => {
    if (!live || !supabase || busy.current) return;
    busy.current = true;
    try {
      const f = await api.loadFlat(supabase);
      if (!f) { setFlat(null); setStatus("none"); setGroceries([]); setExpenses([]); setChores([]); setDone([]); setErr(null); return; }
      const [g, e, cd] = await Promise.all([api.loadGroceries(supabase, f.id), api.loadExpenses(supabase, f.id),
        Promise.all([api.loadChores(supabase, f.id), api.loadChoreDone(supabase, f.id)]).catch(() => null)]);
      const j = JSON.stringify([f, g, e, cd]);
      if (j !== last.current) { last.current = j; setFlat(f); setGroceries(g); setExpenses(e); setChoresOk(cd !== null); setChores(cd?.[0] ?? []); setDone(cd?.[1] ?? []); }
      setStatus("in"); setErr(null);
    } catch (e) { setErr(api.flatError(e)); setStatus((s) => (s === "loading" ? "none" : s)); }
    finally { busy.current = false; }
  }, [live]);
  useEffect(() => {
    if (!live) return;
    void refresh();
    const t = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000);
    const v = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", v);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [live, refresh]);

  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) notify.current?.(ok, "ok"); } catch (e) { notify.current?.(api.flatError(e), "bad"); }
    busy.current = false; await refresh();
  }, [refresh]);
  const virtual = useMemo(() => (flat && status === "in" ? virtualChores(flat, chores, done) : []), [flat, status, chores, done]);
  const toggleChore = useCallback(async (id: string, date: string) => {
    if (!supabase) return "Corvée introuvable.";
    const cid = id.slice(5), was = done.some((d) => d.chore_id === cid && d.done_on === date);
    if (!chores.some((c) => c.id === cid)) return "Corvée introuvable.";
    setDone((cur) => was ? cur.filter((d) => !(d.chore_id === cid && d.done_on === date)) : [...cur, { chore_id: cid, flat_id: flat?.id ?? "", done_on: date, done_by: flat?.me ?? "" }]);
    try { await api.setChoreDone(supabase, cid, date, !was); busy.current = false; await refresh(); return null; }
    catch (e) { busy.current = false; await refresh(); return api.flatError(e); }
  }, [done, chores, flat, refresh]);

  return useMemo(() => (!live ? OFF : { status, flat, groceries, expenses, chores, done, choresOk, err, refresh, act, virtual, toggleChore, notify }),
    [live, status, flat, groceries, expenses, chores, done, choresOk, err, refresh, act, virtual, toggleChore]);
}

export const FlatCtx = createContext<FlatData>(OFF);
export const useFlat = () => useContext(FlatCtx);
