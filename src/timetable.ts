/* Étudiant.OS — lecture d'emplois du temps PDF en GRILLE (jours en colonnes, heures en lignes, cours dans des cases).
 * Exemple : Cronos (UC3M), Hyperplanning, ADE… Logique pure (testée) : reçoit le texte et les rectangles de la page
 * en coordonnées « écran » (x vers la droite, y vers le bas), renvoie les créneaux détectés. */

export interface TItem { s: string; x: number; y: number; w: number; h: number }
export interface TRect { x0: number; y0: number; x1: number; y1: number }
export interface GridSlot { day: number; start: string; end: string; title: string; room: string; /** Dernière date indiquée dans la case (« 07.sep-05.oct… »), si présente. */ lastDate?: string; /** Périodes (dates incluses). */ ranges?: [string, string][] }

const MONTHS: Record<string, number> = { ene: 1, jan: 1, janv: 1, feb: 2, fev: 2, fevr: 2, mar: 3, mars: 3, abr: 4, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, ago: 8, aug: 8, aou: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
/** Périodes d'une liste « 07.sep-05.oct, 09.nov, 19.oct-26.oct » (dates seules = un jour). */
export function rangesIn(text: string, today: string): [string, string][] {
  const [ty, tm] = today.split("-").map(Number);
  const startYear = tm >= 8 ? ty : ty - 1;
  const date = (d: string, m: string) => { const mon = MONTHS[m.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()]; return mon && +d >= 1 && +d <= 31 ? `${mon >= 8 ? startYear : startYear + 1}-${pad(mon)}-${pad(+d)}` : null; };
  const out: [string, string][] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[./ ]([a-zA-Zéû]{3,5})\.?(?:\s*[-–]\s*(\d{1,2})[./ ]([a-zA-Zéû]{3,5})\.?)?/g)) {
    const a = date(m[1], m[2]); if (!a) continue;
    const b = m[3] ? date(m[3], m[4]) : a;
    if (b && b >= a) out.push([a, b]);
  }
  return out;
}
/** Dernière date d'une liste « 07.sep-05.oct, 19.oct-26.oct » (année scolaire déduite de `today`). */
export function lastDateIn(text: string, today: string): string | undefined {
  const [ty, tm] = today.split("-").map(Number);
  const startYear = tm >= 8 ? ty : ty - 1; // année scolaire : septembre → août
  let best: string | undefined;
  for (const m of text.matchAll(/\b(\d{1,2})[./ ]([a-zA-Zéû]{3,5})\.?/g)) {
    const mon = MONTHS[m[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
    if (!mon || +m[1] < 1 || +m[1] > 31) continue;
    const d = `${mon >= 8 ? startYear : startYear + 1}-${pad(mon)}-${pad(+m[1])}`;
    if (!best || d > best) best = d;
  }
  return best;
}

/** Jours en français, espagnol, catalan, anglais (formes longues et abrégées). */
export const DAY_WORDS: RegExp[] = [
  /\b(lundi|lun\.?|lunes|dilluns|monday|mon)\b/i, /\b(mardi|martes|dimarts|tuesday|tue)\b/i,
  /\b(mercredi|mer\.?|mi[eé]rcoles|dimecres|wednesday|wed)\b/i, /\b(jeudi|jeu\.?|jueves|dijous|thursday|thu)\b/i,
  /\b(vendredi|ven\.?|viernes|divendres|friday|fri)\b/i, /\b(samedi|sam\.?|s[aá]bado|dissabte|saturday|sat)\b/i,
  /\b(dimanche|dim\.?|domingo|diumenge|sunday|sun)\b/i,
];
export const dayOf = (t: string) => DAY_WORDS.findIndex((re) => re.test(t));

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const KIND_WORDS = /^(teor[ií]a|laboratorio|pr[aá]cticas?|seminario|tutor[ií]a|examen|cours|cm|td|tp|lecture|lab|tutorial|seminar)$/i;
const KIND_LABEL: Record<string, string> = { teoria: "", laboratorio: "Labo", practicas: "TP", practica: "TP", seminario: "Séminaire", tutoria: "Tutorat", examen: "Examen", td: "TD", tp: "TP", lab: "Labo" };
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Regroupe des fragments de texte en lignes (même hauteur à `tol` près), triées de haut en bas puis de gauche à droite. */
function lines(items: TItem[], tol = 3): TItem[][] {
  const out: TItem[][] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[0].y - it.y) <= tol) l.push(it); else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

export function parseGrid(items: TItem[], rects: TRect[], today = new Date().toISOString().slice(0, 10)): GridSlot[] {
  items = items.filter((i) => i.s.trim());
  // 1. En-têtes de jours : textes courts reconnus comme jours, alignés sur une même ligne.
  const heads = items.filter((i) => i.s.trim().length <= 12 && dayOf(i.s) >= 0).map((i) => ({ day: dayOf(i.s), cx: i.x + i.w / 2, y: i.y }));
  const row = heads.filter((h) => Math.abs(h.y - heads[0]?.y) < 6);
  const days = row.filter((h, i) => row.findIndex((o) => o.day === h.day) === i).sort((a, b) => a.cx - b.cx);
  if (days.length < 2) return [];
  const headY = Math.max(...days.map((d) => d.y));
  // Colonnes : bornes = milieux entre les en-têtes (corrigés par les cases d'en-tête quand elles existent).
  const cols = days.map((d, i) => {
    const cell = rects.filter((r) => r.x0 <= d.cx && r.x1 >= d.cx && r.y0 <= d.y + 2 && r.y1 >= d.y - 12 && r.y1 - r.y0 < 40)
      .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
    const prev = days[i - 1], next = days[i + 1];
    return { day: d.day, x0: cell ? cell.x0 : prev ? (prev.cx + d.cx) / 2 : d.cx - ((next?.cx ?? d.cx + 100) - d.cx) / 2, x1: cell ? cell.x1 : next ? (next.cx + d.cx) / 2 : d.cx + (d.cx - (prev?.cx ?? d.cx - 100)) / 2 };
  });
  const gridX0 = Math.min(...cols.map((c) => c.x0));
  // 2. Échelle des heures : étiquettes de la marge gauche (« 0900 - 0915 », « 9h00 », « 09:00 »…).
  const labelLines = lines(items.filter((i) => i.x + i.w <= gridX0 + 2 && i.y > headY + 2), 6);
  const rows: { y: number; start: number | null; end: number | null }[] = [];
  for (const l of labelLines) {
    const txt = l.map((i) => i.s).join(" ");
    const digits = txt.replace(/[^\d]/g, "");
    if (!digits) continue;
    const y = Math.max(...l.map((i) => i.y));
    let m = /^(\d{1,2})[h:.]?(\d{2})\s*[-–à>]+\s*(\d{1,2})[h:.]?(\d{2})/.exec(txt.replace(/\s+/g, " ").trim());
    if (!m && digits.length === 8) m = /^(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(digits);
    if (m) { const s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4]; rows.push({ y, start: +m[1] < 24 ? s : null, end: e > s ? e : null }); continue; }
    const one = /^(\d{1,2})[h:.]?(\d{2})?$/.exec(txt.replace(/\s+/g, ""));
    rows.push({ y, start: one && +one[1] < 24 ? +one[1] * 60 + +(one[2] ?? 0) : null, end: null });
  }
  const known = rows.filter((r) => r.start !== null) as { y: number; start: number; end: number | null }[];
  if (known.length < 2) return [];
  // Régression linéaire début = a·y + b (comble les étiquettes illisibles).
  const n = known.length, sx = known.reduce((t, r) => t + r.y, 0), sy = known.reduce((t, r) => t + r.start, 0);
  const sxx = known.reduce((t, r) => t + r.y * r.y, 0), sxy = known.reduce((t, r) => t + r.y * r.start, 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n;
  if (!(a > 0)) return [];
  const steps = known.filter((r) => r.end !== null).map((r) => r.end! - r.start).sort((x, y) => x - y);
  const step = steps.length ? steps[Math.floor(steps.length / 2)] : Math.round(a * (rows.length > 1 ? (rows[rows.length - 1].y - rows[0].y) / (rows.length - 1) : 20));
  const timeAt = (y: number) => Math.round((a * y + b) / 5) * 5;
  // 3. Cases de cours : rectangles de la grille (dédoublonnés) contenant du texte, sur au moins une ligne horaire.
  const seen = new Set<string>();
  const boxes = rects.filter((r) => r.x0 >= gridX0 - 2 && r.y0 > headY && r.x1 - r.x0 > 15)
    .filter((r) => { const k = [r.x0, r.y0, r.x1, r.y1].map((v) => Math.round(v)).join(","); if (seen.has(k)) return false; seen.add(k); return true; });
  const out: GridSlot[] = [];
  for (const r of boxes) {
    const inside = items.filter((i) => i.x >= r.x0 - 1 && i.x + Math.min(i.w, 4) <= r.x1 + 1 && i.y - i.h * 0.7 >= r.y0 - 1 && i.y <= r.y1 + 1);
    if (!inside.length) continue;
    const inRows = rows.filter((row) => row.y > r.y0 && row.y <= r.y1 + 2);
    if (!inRows.length) continue;
    // Une case plus petite contenue dans celle-ci et contenant du texte : c'est elle le cours (on ignore les conteneurs).
    if (boxes.some((o) => o !== r && o.x0 >= r.x0 - 1 && o.x1 <= r.x1 + 1 && o.y0 >= r.y0 - 1 && o.y1 <= r.y1 + 1 && (o.x1 - o.x0) * (o.y1 - o.y0) < (r.x1 - r.x0) * (r.y1 - r.y0) - 50
      && inside.some((i) => i.x >= o.x0 && i.x <= o.x1 && i.y >= o.y0 && i.y <= o.y1))) continue;
    const cx = (r.x0 + r.x1) / 2;
    const col = cols.find((c) => cx >= c.x0 && cx <= c.x1);
    if (!col) continue;
    const start = timeAt(inRows[0].y), end = timeAt(inRows[inRows.length - 1].y) + step;
    if (!(end > start) || start < 0 || end > 26 * 60) continue;
    // Texte : type (TEORÍA, TD…), intitulé, salle (« Aula X: dates », « Salle X »…).
    const ls = lines(inside).map((l) => l.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
    let kind = "";
    if (ls.length && KIND_WORDS.test(ls[0])) kind = KIND_LABEL[strip(ls.shift()!)] ?? "";
    const roomIdx = ls.findIndex((l) => /^(aula|salle|room|amphi|sala)\b/i.test(l));
    const roomLine = roomIdx >= 0 ? ls[roomIdx] : "";
    const titleLines = (roomIdx >= 0 ? ls.slice(0, roomIdx) : ls.slice(0, 3));
    let title = titleLines.join(" ")
      .replace(/\(\s*[\w.-]*\d[\w.-]*\s*\)/g, " ")                 // codes (490-12867)
      .replace(/,?\s*grp?\.?\s*\d+.*$/i, "")                        // « , grp.20 1º, Cuatr.1 »
      .replace(/\s+\d+º.*$/, "")
      .replace(/\s+/g, " ").replace(/[\s,;:·-]+$/, "").trim();
    if (!title) title = ls[0] ?? "Cours";
    // Chaque ligne « Aula X: dates » (+ lignes de dates qui la suivent) = une série de séances dans CETTE salle.
    const fullTitle = (kind ? `${title} (${kind})` : title).slice(0, 70);
    const groups: { room: string; text: string }[] = [];
    for (const l of roomIdx >= 0 ? ls.slice(roomIdx) : []) {
      if (/^(aula|salle|room|amphi|sala)\b/i.test(l)) groups.push({ room: l.replace(/^aula\s+/i, "").split(":")[0].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim(), text: l.includes(":") ? l.slice(l.indexOf(":") + 1) : "" });
      else if (groups.length) groups[groups.length - 1].text += ", " + l;
    }
    if (!groups.length) groups.push({ room: "", text: "" });
    for (const g of groups) {
      const ranges = rangesIn(g.text, today).sort((x, y) => x[0].localeCompare(y[0]));
      const lastDate = ranges.length ? ranges.reduce((m, r) => (r[1] > m ? r[1] : m), ranges[0][1]) : undefined;
      out.push({ day: col.day, start: hhmm(start), end: hhmm(end), title: fullTitle, room: g.room.slice(0, 50), ...(lastDate ? { lastDate, ranges } : {}) });
    }
  }
  return resolveOverlaps(out);
}

const addDaysIso = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const spanOf = (r: [string, string]) => (Date.parse(r[1]) - Date.parse(r[0])) / 864e5;
/**
 * Même créneau, séances différentes (théorie / labo / TP) : quand une date figure dans une période large
 * (« 21.oct-18.nov ») ET dans une période plus précise d'une autre case (« 11.nov »), la plus précise l'emporte.
 */
export function resolveOverlaps(slots: GridSlot[]): GridSlot[] {
  for (const a of slots) for (const b of slots) {
    if (a === b || !a.ranges || !b.ranges || a.day !== b.day || a.start !== b.start || a.end !== b.end) continue;
    for (const rb of b.ranges) {
      const next: [string, string][] = [];
      for (const ra of a.ranges) {
        if (rb[1] < ra[0] || rb[0] > ra[1] || spanOf(rb) >= spanOf(ra)) { next.push(ra); continue; }
        if (ra[0] < rb[0]) next.push([ra[0], addDaysIso(rb[0], -1)]);
        if (rb[1] < ra[1]) next.push([addDaysIso(rb[1], 1), ra[1]]);
      }
      a.ranges = next;
    }
  }
  for (const s of slots) if (s.ranges) { if (!s.ranges.length) { delete s.ranges; } else s.lastDate = s.ranges.reduce((m, r) => (r[1] > m ? r[1] : m), s.ranges[0][1]); }
  return slots;
}

/* ---- Extraction depuis pdf.js (navigateur ou Node) : texte + rectangles en coordonnées écran. ---- */
type M6 = number[];
interface PdfLib { OPS: Record<string, number>; Util: { transform(a: M6, b: M6): M6; applyTransform(p: number[], m: M6): number[] } }
interface PdfPageLike {
  getViewport(o: { scale: number }): { transform: M6 };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}
export async function pageGeometry(lib: PdfLib, page: PdfPageLike): Promise<{ items: TItem[]; rects: TRect[] }> {
  const { OPS, Util } = lib;
  const vp = page.getViewport({ scale: 1 });
  const items: TItem[] = [];
  for (const raw of (await page.getTextContent()).items as { str?: string; transform: M6; width: number; height: number }[]) {
    if (!raw.str || !raw.str.trim()) continue;
    const t = Util.transform(vp.transform, raw.transform);
    items.push({ s: raw.str, x: t[4], y: t[5], w: raw.width, h: raw.height || 8 });
  }
  const rects: TRect[] = [];
  try {
    const ops = await page.getOperatorList();
    let ctm: M6 = [1, 0, 0, 1, 0, 0]; const stack: M6[] = [];
    ops.fnArray.forEach((fn, i) => {
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = Util.transform(ctm, args as M6);
      else if (fn === OPS.constructPath) {
        const [po, co] = args as [number[], number[]];
        const M = Util.transform(vp.transform, ctm);
        let k = 0;
        for (const o of po) {
          if (o === OPS.rectangle) {
            const [x, y, w, h] = co.slice(k, k + 4); k += 4;
            const p1 = Util.applyTransform([x, y], M), p2 = Util.applyTransform([x + w, y + h], M);
            rects.push({ x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1]) });
          } else if (o === OPS.moveTo || o === OPS.lineTo) k += 2;
          else if (o === OPS.curveTo) k += 6;
          else if (o === OPS.curveTo2 || o === OPS.curveTo3) k += 4;
        }
      }
    });
  } catch { /* sans rectangles : la grille n'est pas lisible, l'appelant utilise la lecture par lignes */ }
  return { items, rects };
}
