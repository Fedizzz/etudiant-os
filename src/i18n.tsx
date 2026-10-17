/* Étudiant.OS — traduction de l'interface (anglais, espagnol, arabe) à la volée.
 * L'application est écrite en français ; dans une autre langue, chaque texte affiché (nœuds texte + placeholder,
 * title, aria-label) est remplacé d'après un dictionnaire chargé à la demande (public/i18n/<langue>.json).
 * Les textes saisis par l'utilisateur (champs, titres de tâches…) ne sont pas traduits, sauf s'ils sont identiques
 * à un texte de l'interface. Les dates passent par la locale de la langue choisie. */
import React from "react";

export type Lang = "fr" | "en" | "es" | "ar";
export const LANGS: { k: Lang; label: string; short: string; locale: string }[] = [
  { k: "fr", label: "Français", short: "FR", locale: "fr-FR" },
  { k: "en", label: "English", short: "EN", locale: "en-GB" },
  { k: "es", label: "Español", short: "ES", locale: "es-ES" },
  { k: "ar", label: "العربية", short: "ع", locale: "ar" },
];
const KEY = "etudiant-os/lang";

export function getLang(): Lang {
  try { const v = localStorage.getItem(KEY); if (v && LANGS.some((l) => l.k === v)) return v as Lang; } catch { /* facultatif */ }
  return "fr";
}
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* facultatif */ }
  location.reload(); // tout est re-rendu proprement dans la nouvelle langue
}

import { compile, translate, type Dict } from "./i18nCore.ts";

const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);

/** Démarre la traduction automatique (à appeler avant le premier rendu). */
export async function initI18n(base: string) {
  const lang = getLang();
  const info = LANGS.find((l) => l.k === lang)!;
  document.documentElement.lang = lang;
  if (lang === "fr") return;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  // Dates : « fr-FR » demandé dans le code → locale de la langue choisie.
  const swap = (loc: unknown) => (typeof loc === "string" && loc.startsWith("fr") ? info.locale : loc);
  for (const m of ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"] as const) {
    const orig = Date.prototype[m];
    Date.prototype[m] = function (this: Date, loc?: unknown, o?: unknown) { return (orig as (l?: unknown, o?: unknown) => string).call(this, swap(loc), o); } as never;
  }
  let dict: Dict;
  try { dict = compile(await (await fetch(`${base}i18n/${lang}.json`)).json()); }
  catch { return; } // hors ligne sans cache : l'application reste en français
  const done = new WeakMap<Node, string>(); // dernière traduction posée (évite de retraduire en boucle)
  const text = (n: Text) => {
    const v = n.nodeValue ?? "";
    if (done.get(n) === v) return;
    const p = n.parentElement; if (!p || SKIP.has(p.tagName) || p.isContentEditable) return;
    const t = translate(dict, v);
    if (t !== null) { const lead = /^\s*/.exec(v)![0], trail = /\s*$/.exec(v)![0]; const nv = lead + t + trail; done.set(n, nv); n.nodeValue = nv; }
  };
  const attrs = (el: Element) => {
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (!v) continue;
      if (el.getAttribute(`data-i18n-${a}`) === v) continue;
      const t = translate(dict, v);
      if (t !== null) { el.setAttribute(`data-i18n-${a}`, t); el.setAttribute(a, t); }
    }
  };
  const walk = (root: Node) => {
    if (root.nodeType === 3) { text(root as Text); return; }
    if (root.nodeType !== 1 || SKIP.has((root as Element).tagName)) return;
    attrs(root as Element);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n as Text); else attrs(n as Element); }
  };
  const title = () => { const t = translate(dict, document.title); if (t) document.title = t; };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") text(m.target as Text);
      else if (m.type === "attributes") attrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.body); title();
  new MutationObserver(title).observe(document.querySelector("title") ?? document.head, { childList: true, characterData: true, subtree: true });
}

/** Sélecteur de langue (bouton globe + menu). */
export const LangSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const cur = getLang();
  return (
    <label className={`relative inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-fg hover:bg-sunken ${className ?? ""}`} title="Langue · Language · Idioma · اللغة">
      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" /></svg>
      <span translate="no">{LANGS.find((l) => l.k === cur)!.short}</span>
      <select aria-label="Langue · Language · Idioma · اللغة" value={cur} onChange={(e) => setLang(e.target.value as Lang)} className="absolute inset-0 cursor-pointer opacity-0">
        {LANGS.map((l) => <option key={l.k} value={l.k}>{l.label}</option>)}
      </select>
    </label>
  );
};
