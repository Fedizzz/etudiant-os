/* Étudiant.OS — corvées de la colocation dans le planning et le tableau de bord.
 * Actif seulement avec un compte ET un appartement : sinon la liste est vide et rien ne change. Erreur ou migration absente : liste vide, silencieusement. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Chore } from "./core.ts";
import type { AppEnv } from "./env.ts";
import { supabase } from "./supabase.ts";
import * as api from "./flatApi.ts";
import { virtualChores } from "./flat.ts";

/** Évènement envoyé par l'onglet Colocation après chaque modification. */
export const FLAT_CHANGED = "etudiant-os:flat-changed";
export interface FlatChoresApi {
  chores: Chore[];
  /** Coche / décoche une corvée commune (id « flat:… ») pour un jour ; l'affichage est mis à jour tout de suite, puis relu. */
  toggle(id: string, date: string): Promise<string | null>;
}
export function useFlatChores(env: AppEnv): FlatChoresApi {
  const [chores, setChores] = useState<Chore[]>([]);
  const json = useRef("[]");
  const live = env.mode === "cloud" && !!supabase;
  const refresh = useCallback(async () => {
    if (!live || !supabase) return;
    try {
      const flat = await api.loadFlat(supabase);
      const next = flat ? virtualChores(flat, await api.loadChores(supabase, flat.id), await api.loadChoreDone(supabase, flat.id)) : [];
      const j = JSON.stringify(next);
      if (j !== json.current) { json.current = j; setChores(next); }   // pas de nouveau rendu si rien n'a changé
    } catch {
      if (json.current !== "[]") { json.current = "[]"; setChores([]); }
    }
  }, [live]);
  useEffect(() => {
    if (!live) return;
    void refresh();
    const t = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    const v = () => { if (!document.hidden) void refresh(); };
    const ch = () => void refresh();
    document.addEventListener("visibilitychange", v);
    window.addEventListener(FLAT_CHANGED, ch);   // la colocation vient de changer (ajout, coche, départ…) : relire tout de suite
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", v); window.removeEventListener(FLAT_CHANGED, ch); };
  }, [live, refresh]);
  const toggle = useCallback(async (id: string, date: string) => {
    const c = chores.find((x) => x.id === id);
    if (!c || !supabase) return "Corvée introuvable.";
    const was = c.done.includes(date);
    setChores((cur) => cur.map((x) => x.id !== id ? x : { ...x, done: was ? x.done.filter((d) => d !== date) : [...x.done, date], doneBy: { ...x.doneBy, ...(was ? {} : { [date]: "Moi" }) } }));
    try { await api.setChoreDone(supabase, id.slice(5), date, !was); await refresh(); return null; }
    catch (e) { await refresh(); return api.flatError(e); }
  }, [chores, refresh]);
  return { chores, toggle };
}
