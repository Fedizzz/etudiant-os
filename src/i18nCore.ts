/* Étudiant.OS — dictionnaires de traduction (logique pure, testée). */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Dict { exact: Map<string, string>; tpl: { re: RegExp; out: string }[] }
/** Dictionnaire { "texte fr": "traduction" } → recherche exacte + modèles avec {0}, {1}… */
export function compile(entries: Record<string, string>): Dict {
  const exact = new Map<string, string>(), tpl: Dict["tpl"] = [];
  for (const [fr, t] of Object.entries(entries)) {
    if (!t) continue;
    if (/\{\d\}/.test(fr)) {
      const parts = norm(fr).split(/(\{\d\})/);
      const order: number[] = [];
      const src = parts.map((p) => { const m = /^\{(\d)\}$/.exec(p); if (m) { order.push(+m[1]); return "(.*?)"; } return esc(p.replace(/\s+/g, " ")).replace(/ /g, "\\s*"); }).join("");
      if (src.replace(/\(\.\*\?\)/g, "").length < 4) continue; // modèle trop vague
      let out = t; order.forEach((n, i) => { out = out.split(`{${n}}`).join(`\u0000${i}\u0000`); });
      tpl.push({ re: new RegExp(`^${src}$`), out });
    } else exact.set(norm(fr), t);
  }
  tpl.sort((a, b) => b.re.source.length - a.re.source.length); // les plus précis d'abord
  return { exact, tpl };
}
export function translate(d: Dict, s: string): string | null {
  const k = norm(s);
  if (!k || !/[A-Za-zÀ-ÿ]/.test(k)) return null;
  const hit = d.exact.get(k);
  if (hit !== undefined) return hit;
  for (const { re, out } of d.tpl) {
    const m = re.exec(k);
    if (m) return out.replace(/\u0000(\d)\u0000/g, (_, i) => { const v = m[+i + 1].trim(); return translate(d, v) ?? v; });
  }
  return null;
}

