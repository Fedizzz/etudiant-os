/* Étudiant.OS — finances avancées (sans React) : argent de poche, reste par catégorie, dettes de colocation,
 * conseils non culpabilisants et analyse PDF détaillée. Toutes les fonctions sont pures et testées. */
import { addDays, daysBetween, iso, monthKey, norm, parseISO, weekday, type Budget, type BudgetStats, type Expense, type ExpenseCat, type PocketCfg } from "./core.ts";
import { balances, nameOf, settleUp, type Flat, type FlatExpense } from "./flat.ts";
import { MiniPdf } from "./pdf.ts";

/** Catégories « plaisir » comptées dans l'argent de poche tant que l'utilisateur n'en choisit pas d'autres. */
export const DEFAULT_POCKET_CATS: string[] = ["Restauration", "Loisirs", "Autre"];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PocketStats {
  cfg: PocketCfg; from: string; to: string; spent: number; remaining: number; daysLeft: number; perDay: number; pct: number; over: boolean;
  /** Part de l'enveloppe consommée vs part de la période écoulée (repère de rythme). */
  elapsedPct: number; ahead: boolean;
}
/** Argent de poche de la période en cours (semaine du lundi au dimanche, ou mois), avec ce qu'il reste par jour. */
export function pocketStats(b: Budget, today: string): PocketStats | null {
  const cfg = b.pocket; if (!cfg || !(cfg.amount > 0)) return null;
  const cats = new Set((cfg.cats.length ? cfg.cats : DEFAULT_POCKET_CATS).map(norm));
  const d = parseISO(today);
  const from = cfg.period === "week" ? iso(addDays(d, -weekday(d))) : `${monthKey(today)}-01`;
  const to = cfg.period === "week" ? iso(addDays(parseISO(from), 6)) : iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const spent = round2(b.expenses.filter((e) => e.date >= from && e.date <= to && e.source !== "recurrente" && cats.has(norm(e.category))).reduce((n, e) => n + e.amount, 0));
  const remaining = round2(cfg.amount - spent), total = daysBetween(from, to) + 1, daysLeft = Math.max(1, daysBetween(today, to) + 1);
  const pct = Math.min(999, Math.round((spent / cfg.amount) * 100)), elapsedPct = Math.round(((total - daysLeft + 1) / total) * 100);
  return { cfg, from, to, spent, remaining, daysLeft, perDay: round2(Math.max(0, remaining) / daysLeft), pct, over: remaining < 0, elapsedPct, ahead: pct > elapsedPct + 15 };
}

export interface CatLine { cat: ExpenseCat; spent: number; limit?: number; remaining: number | null; pct: number | null; over: boolean }
/** Reste par catégorie (plafond − dépensé) et part du budget non encore répartie en plafonds. */
export function categoryBreakdown(stats: Pick<BudgetStats, "byCat">, monthly: number, limits: Budget["limits"]): { lines: CatLine[]; allocated: number; unallocated: number } {
  const lines = stats.byCat.filter((c) => c.spent > 0 || c.limit).map((c): CatLine => ({
    cat: c.cat, spent: round2(c.spent), ...(c.limit ? { limit: c.limit } : {}), remaining: c.limit ? round2(c.limit - c.spent) : null, pct: c.limit ? Math.round((c.spent / c.limit) * 100) : null, over: c.over }));
  const allocated = round2(Object.values(limits).reduce<number>((n, v) => n + (typeof v === "number" && v > 0 ? v : 0), 0));
  return { lines, allocated, unallocated: round2(monthly - allocated) };
}

export interface FlatDebts { owedToMe: { name: string; cents: number }[]; iOwe: { name: string; cents: number }[]; totalOwedToMe: number; totalIOwe: number; net: number }
/** Qui me doit combien, et à qui je dois combien (calcul glouton de la colocation, centimes). */
export function flatDebts(flat: Pick<Flat, "me" | "members">, expenses: Pick<FlatExpense, "paid_by" | "amount_cents" | "shares">[]): FlatDebts {
  const tr = settleUp(balances(expenses));
  const owedToMe = tr.filter((t) => t.to === flat.me).map((t) => ({ name: nameOf(flat, t.from), cents: t.cents }));
  const iOwe = tr.filter((t) => t.from === flat.me).map((t) => ({ name: nameOf(flat, t.to), cents: t.cents }));
  const sum = (a: { cents: number }[]) => a.reduce((n, x) => n + x.cents, 0);
  return { owedToMe, iOwe, totalOwedToMe: sum(owedToMe), totalIOwe: sum(iOwe), net: sum(owedToMe) - sum(iOwe) };
}

export interface Insight { id: string; tone: "ok" | "info" | "warn"; title: string; text: string }
const eur = (n: number, cur: string) => `${n.toFixed(2).replace(".", ",")} ${cur}`;
/** Repères bienveillants sur les dépenses (jamais de jugement) : petits achats répétés, rythme, argent de poche, week-ends… */
export function budgetInsights(b: Budget, today: string, cur = "€"): Insight[] {
  const out: Insight[] = [];
  const mk = monthKey(today), ex: Expense[] = b.expenses.filter((e) => e.source !== "recurrente" && e.amount > 0);
  const pocketCats = new Set((b.pocket?.cats.length ? b.pocket.cats : DEFAULT_POCKET_CATS).map(norm));
  const week = ex.filter((e) => daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) < 7);
  const small = week.filter((e) => e.amount <= 15 && pocketCats.has(norm(e.category)));
  if (small.length >= 5) {
    const tot = small.reduce((n, e) => n + e.amount, 0);
    out.push({ id: "small", tone: "info", title: "Beaucoup de petits achats cette semaine", text: `${small.length} petits achats (${eur(tot, cur)} au total) : chacun est léger, mais ensemble ils comptent. Si tu veux souffler un peu, essaie un jour sans dépense ou un plafond hebdomadaire — sans pression.` });
  }
  const labels = new Map<string, number>();
  for (const e of ex.filter((x) => daysBetween(x.date, today) >= 0 && daysBetween(x.date, today) < 8 && x.label.trim())) labels.set(norm(e.label), (labels.get(norm(e.label)) ?? 0) + 1);
  const rep = [...labels.entries()].filter(([, n]) => n >= 3).sort((a, c) => c[1] - a[1])[0];
  if (rep) out.push({ id: "repeat", tone: "info", title: "Un même achat revient souvent", text: `« ${ex.find((e) => norm(e.label) === rep[0])!.label} » apparaît ${rep[1]} fois en 8 jours. Si c'est un vrai plaisir, super ; sinon, une courte pause de 24 h avant le prochain peut aider à voir si l'envie reste.` });
  const p = pocketStats(b, today);
  if (p) {
    if (p.over) out.push({ id: "pocket-over", tone: "warn", title: "Argent de poche dépassé", text: `Tu as dépassé ton enveloppe de ${eur(-p.remaining, cur)}. Ça arrive : tu peux la rééquilibrer en réduisant un peu les prochains jours ou en ajustant le montant dans le budget.` });
    else if (p.ahead) out.push({ id: "pocket-pace", tone: "warn", title: "Argent de poche : rythme rapide", text: `${p.pct} % de l'enveloppe est utilisé alors que ${p.elapsedPct} % de la ${p.cfg.period === "week" ? "semaine" : "période"} est écoulé. Pour tenir jusqu'au bout, vise environ ${eur(p.perDay, cur)} par jour.` });
    else out.push({ id: "pocket-ok", tone: "ok", title: "Argent de poche maîtrisé", text: `Il te reste ${eur(p.remaining, cur)} (environ ${eur(p.perDay, cur)} par jour). Tu es dans le rythme.` });
  }
  const month = ex.filter((e) => monthKey(e.date) === mk), total = month.reduce((n, e) => n + e.amount, 0);
  const big = [...month].sort((a, c) => c.amount - a.amount)[0];
  if (big && b.monthly > 0 && big.amount >= b.monthly * 0.25 && pocketCats.has(norm(big.category))) out.push({ id: "big", tone: "info", title: "Un achat important ce mois-ci", text: `« ${big.label || big.category} » (${eur(big.amount, cur)}) représente ${Math.round((big.amount / b.monthly) * 100)} % de ton budget mensuel. Pas un souci en soi : garde-le en tête pour répartir le reste du mois.` });
  const wk = ex.filter((e) => daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) < 28 && pocketCats.has(norm(e.category)));
  const wkTot = wk.reduce((n, e) => n + e.amount, 0), wkEnd = wk.filter((e) => weekday(parseISO(e.date)) >= 5).reduce((n, e) => n + e.amount, 0);
  if (wkTot >= 40 && wkEnd / wkTot >= 0.55) out.push({ id: "weekend", tone: "info", title: "Les week-ends concentrent tes dépenses plaisir", text: `${Math.round((wkEnd / wkTot) * 100)} % de tes dépenses plaisir sur 4 semaines tombent un samedi ou un dimanche. Prévoir une petite enveloppe de week-end peut rendre ces sorties plus sereines.` });
  const dim = new Date(parseISO(today).getFullYear(), parseISO(today).getMonth() + 1, 0).getDate(), day = parseISO(today).getDate();
  if (b.monthly > 0 && total > b.monthly) out.push({ id: "over", tone: "warn", title: "Budget du mois dépassé", text: `Tu es à ${eur(total, cur)} pour ${eur(b.monthly, cur)} prévus. Regarde les catégories ci-dessous pour voir où récupérer un peu de marge.` });
  else if (b.monthly > 0 && day >= 5 && total / day * dim > b.monthly * 1.1) out.push({ id: "pace", tone: "warn", title: "Rythme de dépenses un peu élevé", text: `À ce rythme, le mois finirait vers ${eur((total / day) * dim, cur)} pour ${eur(b.monthly, cur)} prévus. Un petit effort de ${eur((((total / day) * dim) - b.monthly) / Math.max(1, dim - day), cur)} par jour suffirait à rééquilibrer.` });
  else if (b.monthly > 0 && day >= 10 && month.length >= 3 && !out.some((i) => i.tone === "warn") && total <= b.monthly * (day / dim) * 0.9) out.push({ id: "good", tone: "ok", title: "Tu es dans les clous", text: "Tes dépenses sont plutôt sous le rythme prévu pour le mois. Bien joué : pense à mettre un peu de côté si tu le souhaites." });
  const rank = { warn: 0, info: 1, ok: 2 };
  return out.sort((a, c) => rank[a.tone] - rank[c.tone]).slice(0, 5);
}

export interface BudgetReport {
  month: string; name: string; cur: string; monthly: number; stats: BudgetStats; prevSpent: number | null; lines: CatLine[]; unallocated: number;
  pocket: PocketStats | null; insights: Insight[]; top: Expense[]; recurring: { label: string; amount: number; day: number }[]; debts: FlatDebts | null; generatedAt: string;
}
/** Analyse détaillée du mois en PDF (A4 portrait). Retourne les octets du fichier. */
export function buildBudgetPdf(r: BudgetReport): Uint8Array {
  const W = 210, M = 14, ink: [number, number, number] = [24, 22, 46], muted: [number, number, number] = [110, 106, 140], grid: [number, number, number] = [215, 212, 228];
  const accent: [number, number, number] = [52, 72, 240], bad: [number, number, number] = [226, 40, 80], ok: [number, number, number] = [0, 150, 105];
  const doc = new MiniPdf(W, 297); let y = 18;
  const m = (n: number) => eur(n, r.cur);
  const title = new Date(parseISO(`${r.month}-01`)).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  doc.text(M, y, `Analyse du budget - ${title}`, 17, ink, { bold: true }); doc.text(W - M, y, "Etudiant.OS", 10, muted, { bold: true, align: "right" });
  y += 6; doc.text(M, y, `${r.name ? r.name + " - " : ""}genere le ${new Date(r.generatedAt).toLocaleDateString("fr-FR")}`, 8.5, muted);
  y += 8;
  const kpis: [string, string, [number, number, number]][] = [["Budget", m(r.monthly), ink], ["Depense", m(r.stats.spent), r.stats.spent > r.monthly ? bad : ink], ["Restant", m(r.stats.remaining), r.stats.remaining < 0 ? bad : ok], ["Projection", r.stats.projection === null ? "-" : m(r.stats.projection), muted]];
  const kw = (W - 2 * M - 9) / 4;
  kpis.forEach(([l, v, c], i) => { const x = M + i * (kw + 3); doc.rect(x, y, kw, 17, [247, 246, 252], grid); doc.text(x + 3, y + 5.5, l.toUpperCase(), 6.5, muted, { bold: true }); doc.text(x + 3, y + 13, v, 11, c, { bold: true }); });
  y += 24;
  if (r.prevSpent !== null && r.prevSpent > 0) { const diff = r.stats.spent - r.prevSpent; doc.text(M, y, `Mois precedent : ${m(r.prevSpent)} (${diff >= 0 ? "+" : "-"}${m(Math.abs(diff))} ce mois-ci)`, 8.5, muted); y += 7; }
  // Par catégorie
  doc.text(M, y, "Par categorie", 11, ink, { bold: true }); y += 5;
  const bw = 62;
  for (const l of r.lines) {
    if (y > 270) { doc.addPage(); y = 18; }
    doc.text(M, y + 3, l.cat, 8.5, ink, { bold: true });
    doc.rect(M + 40, y, bw, 3.6, [236, 234, 244]);
    const frac = l.limit ? Math.min(1, l.spent / l.limit) : r.stats.spent ? Math.min(1, l.spent / r.stats.spent) : 0;
    doc.rect(M + 40, y, Math.max(0.5, bw * frac), 3.6, l.over ? bad : accent);
    doc.text(M + 40 + bw + 4, y + 3, `${m(l.spent)}${l.limit ? ` / ${m(l.limit)}` : ""}`, 8, ink);
    doc.text(W - M, y + 3, l.remaining === null ? "sans plafond" : l.remaining >= 0 ? `reste ${m(l.remaining)}` : `depasse de ${m(-l.remaining)}`, 8, l.remaining !== null && l.remaining < 0 ? bad : muted, { align: "right" });
    y += 6.2;
  }
  if (r.unallocated !== 0) { doc.text(M, y + 2, r.unallocated > 0 ? `${m(r.unallocated)} du budget ne sont pas encore repartis en plafonds.` : `Les plafonds depassent le budget de ${m(-r.unallocated)}.`, 8, muted); y += 8; } else y += 3;
  // Dépenses par jour
  if (y > 225) { doc.addPage(); y = 18; }
  doc.text(M, y, "Depenses par jour", 11, ink, { bold: true }); y += 4;
  const ch = 28, cw = W - 2 * M, max = Math.max(1, ...r.stats.daily), goal = r.monthly / r.stats.dim, n = r.stats.daily.length, bwd = cw / n;
  doc.rect(M, y, cw, ch, undefined, grid);
  r.stats.daily.forEach((v, i) => { if (v > 0) { const h = Math.max(0.6, (v / max) * (ch - 3)); doc.rect(M + i * bwd + 0.4, y + ch - h, bwd - 0.8, h, v > goal * 2 ? bad : accent); } });
  const gy = y + ch - Math.min(ch - 3, (goal / max) * (ch - 3)); doc.line(M, gy, M + cw, gy, muted, 0.15);
  doc.text(M, y + ch + 4, "1", 6.5, muted); doc.text(M + cw, y + ch + 4, String(n), 6.5, muted, { align: "right" }); doc.text(M + cw / 2, y + ch + 4, `ligne : budget journalier moyen ${m(goal)}`, 6.5, muted, { align: "center" });
  y += ch + 11;
  // Argent de poche
  if (r.pocket) {
    if (y > 250) { doc.addPage(); y = 18; }
    doc.text(M, y, `Argent de poche (${r.pocket.cfg.period === "week" ? "semaine" : "mois"})`, 11, ink, { bold: true }); y += 5;
    doc.text(M, y, `${m(r.pocket.spent)} utilises sur ${m(r.pocket.cfg.amount)} - ${r.pocket.remaining >= 0 ? `reste ${m(r.pocket.remaining)} (environ ${m(r.pocket.perDay)} par jour)` : `depasse de ${m(-r.pocket.remaining)}`}`, 8.5, ink); y += 8;
  }
  // Gros postes
  if (r.top.length) {
    if (y > 235) { doc.addPage(); y = 18; }
    doc.text(M, y, "Plus grosses depenses", 11, ink, { bold: true }); y += 5;
    for (const e of r.top) { doc.text(M, y, e.date.slice(8) + "/" + e.date.slice(5, 7), 8, muted); doc.text(M + 14, y, `${e.label || e.category} (${e.category})`, 8.5, ink); doc.text(W - M, y, m(e.amount), 8.5, ink, { bold: true, align: "right" }); y += 5; }
    y += 3;
  }
  if (r.recurring.length) {
    if (y > 245) { doc.addPage(); y = 18; }
    doc.text(M, y, "Depenses recurrentes", 11, ink, { bold: true }); y += 5;
    for (const e of r.recurring) { doc.text(M, y, `le ${e.day}`, 8, muted); doc.text(M + 14, y, e.label, 8.5, ink); doc.text(W - M, y, m(e.amount), 8.5, ink, { bold: true, align: "right" }); y += 5; }
    y += 3;
  }
  if (r.debts && (r.debts.owedToMe.length || r.debts.iOwe.length)) {
    if (y > 245) { doc.addPage(); y = 18; }
    doc.text(M, y, "Colocation", 11, ink, { bold: true }); y += 5;
    for (const d of r.debts.owedToMe) { doc.text(M, y, `${d.name} te doit`, 8.5, ink); doc.text(W - M, y, m(d.cents / 100), 8.5, ok, { bold: true, align: "right" }); y += 5; }
    for (const d of r.debts.iOwe) { doc.text(M, y, `Tu dois a ${d.name}`, 8.5, ink); doc.text(W - M, y, m(d.cents / 100), 8.5, bad, { bold: true, align: "right" }); y += 5; }
    y += 3;
  }
  if (r.insights.length) {
    if (y > 235) { doc.addPage(); y = 18; }
    doc.text(M, y, "Reperes et conseils", 11, ink, { bold: true }); y += 5;
    for (const i of r.insights) {
      const lines = doc.wrap(i.text, W - 2 * M - 4, 8.5); if (y + 6 + lines.length * 4 > 285) { doc.addPage(); y = 18; }
      doc.text(M, y, i.title, 9, i.tone === "warn" ? bad : i.tone === "ok" ? ok : ink, { bold: true }); y += 4.5;
      for (const l of lines) { doc.text(M + 2, y, l, 8.5, muted); y += 4; } y += 2.5;
    }
  }
  doc.text(M, 291, "Reperes indicatifs fondes sur tes saisies - pas un conseil financier.", 7, muted);
  return doc.bytes();
}
