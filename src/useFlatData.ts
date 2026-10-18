/* Étudiant.OS — données de la colocation partagées par toute l'application (une seule lecture, relue toutes les 20 s,
 * au retour sur l'onglet et après chaque action). Actif seulement avec un compte : sinon status = "off" et rien ne change.
 * Sert : l'onglet Colocation (membres, code), les onglets Courses / Budget / Ménage (version colocation) et le planning (corvées). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { choreStepsDone } from "./core.ts";
import type { Action, Chore, Expense } from "./core.ts";
import type { AppEnv } from "./env.ts";
import { supabase } from "./supabase.ts";
import * as api from "./flatApi.ts";
import { choreToRpc, virtualChores, virtualExpenses } from "./flat.ts";
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
  /** Ma part des dépenses communes, sous la forme de dépenses du budget personnel (affichage seulement). Vide hors appartement. */
  virtualExpenses: Expense[];
  /** Action sur une corvée commune (ajout, coche, report, étape, modification, suppression) : même vocabulaire que le ménage personnel. Affichage immédiat quand c'est possible, puis relecture. Renvoie un message d'erreur ou null. */
  choreAction(a: Action): Promise<string | null>;
  /** Fonction d'affichage des messages, branchée par l'application. */
  notify: { current: ((text: string, tone?: "ok" | "bad" | "info") => void) | null };
}
const OFF: FlatData = { status: "off", flat: null, groceries: [], expenses: [], chores: [], done: [], choresOk: true, err: null, refresh: async () => {}, act: async () => {}, virtual: [], virtualExpenses: [], choreAction: async () => null, notify: { current: null } };

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
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
  const vexp = useMemo(() => (flat && status === "in" ? virtualExpenses(flat.me, expenses) : []), [flat, status, expenses]);
  const virtual = useMemo(() => (flat && status === "in" ? virtualChores(flat, chores, done) : []), [flat, status, chores, done]);
  /** Modifie localement l'état d'un jour (affichage immédiat avant la réponse de la base). */
  const patchDay = useCallback((cid: string, date: string, fn: (r: FlatChoreDone) => FlatChoreDone) => {
    setDone((cur) => {
      const i = cur.findIndex((d) => d.chore_id === cid && d.done_on === date);
      const base: FlatChoreDone = i >= 0 ? cur[i] : { chore_id: cid, flat_id: flat?.id ?? "", done_on: date, done_by: null, skipped: false, steps_done: [], ticked_on: null };
      const next = fn(base);
      const empty = !next.done_by && !next.skipped && !(next.steps_done?.length);
      return i >= 0 ? (empty ? cur.filter((_, k) => k !== i) : cur.map((d, k) => (k === i ? next : d))) : (empty ? cur : [...cur, next]);
    });
  }, [flat]);
  const choreAction = useCallback(async (a: Action): Promise<string | null> => {
    if (!supabase || !flat) return "Colocation indisponible.";
    const sb = supabase;
    const cid = "id" in a && typeof a.id === "string" ? a.id.replace(/^flat:/, "") : "";
    const cur = virtual.find((c) => c.id === `flat:${cid}`);
    const refreshAfter = async (err: unknown) => { busy.current = false; await refresh(); return err ? api.flatError(err) : null; };
    try {
      switch (a.type) {
        case "chore/add": await api.saveChore(sb, null, choreToRpc(flat, a.chore)); return await refreshAfter(null);
        case "chore/remove": await api.removeChore(sb, cid); return await refreshAfter(null);
        case "chore/update": {
          if (!cur) return "Corvée introuvable.";
          await api.saveChore(sb, cid, choreToRpc(flat, { ...cur, ...a.patch })); return await refreshAfter(null);
        }
        case "chore/toggle": {
          const was = done.some((d) => d.chore_id === cid && d.done_on === a.date && d.done_by);
          patchDay(cid, a.date, (r) => was ? { ...r, done_by: null, ticked_on: null } : { ...r, done_by: flat.me, skipped: false, ticked_on: todayLocal() });
          await api.setChoreDay(sb, cid, a.date, { done: !was }); return await refreshAfter(null);
        }
        case "chore/skip": {
          const was = done.some((d) => d.chore_id === cid && d.done_on === a.date && d.skipped);
          patchDay(cid, a.date, (r) => was ? { ...r, skipped: false } : { ...r, skipped: true, done_by: null, ticked_on: null });
          await api.setChoreDay(sb, cid, a.date, { skipped: !was }); return await refreshAfter(null);
        }
        case "chore/step": {
          if (!cur) return "Corvée introuvable.";
          const now = choreStepsDone(cur, a.date), next = now.includes(a.stepId) ? now.filter((x) => x !== a.stepId) : [...now, a.stepId];
          patchDay(cid, a.date, (r) => ({ ...r, steps_done: next }));
          await api.setChoreDay(sb, cid, a.date, { stepsDone: next }); return await refreshAfter(null);
        }
        default: return null;   // chore/pin : l'heure de la journée n'est pas enregistrée pour les corvées communes
      }
    } catch (e) { return await refreshAfter(e); }
  }, [flat, virtual, done, refresh, patchDay]);

  return useMemo(() => (!live ? OFF : { status, flat, groceries, expenses, chores, done, choresOk, err, refresh, act, virtual, virtualExpenses: vexp, choreAction, notify }),
    [live, status, flat, groceries, expenses, chores, done, choresOk, err, refresh, act, virtual, vexp, choreAction]);
}

export const FlatCtx = createContext<FlatData>(OFF);
export const useFlat = () => useContext(FlatCtx);
