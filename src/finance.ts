/* Étudiant.OS — finances avancées (sans React) : argent de poche, reste par catégorie, dettes de colocation,
 * conseils non culpabilisants et analyse PDF détaillée. Toutes les fonctions sont pures et testées. */
import { addDays, daysBetween, debtRemaining, iso, monthKey, norm, parseISO, weekday, type Budget, type BudgetStats, type Debt, type Expense, type ExpenseCat, type PocketCfg } from "./core.ts";
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
  if (b.monthly > 0 && Object.keys(b.limits).length === 0 && b.expenses.length >= 3) out.push({ id: "limits", tone: "info", title: "Des plafonds par catégorie t'aideraient", text: "Tu as un budget mais aucun plafond par catégorie. Dans « Par catégorie », « Suggérer des plafonds » te propose une limite pour chacune, d'après ton budget et tes habitudes — tu gardes la main." });
  const rank = { warn: 0, info: 1, ok: 2 };
  return out.sort((a, c) => rank[a.tone] - rank[c.tone]).slice(0, 5);
}


// ---------------------------------------------------------------- Dettes entre personnes (hors colocation)
export interface PersonalDebts { owedToMe: { id: string; person: string; remaining: number; due?: string; late: boolean; label: string }[]; iOwe: PersonalDebts["owedToMe"]; totalOwedToMe: number; totalIOwe: number; net: number }
/** Prêts et emprunts en cours (soldés exclus), regroupés par sens ; « late » = échéance dépassée. */
export function personalDebts(b: Budget, today: string): PersonalDebts {
  const rows = (b.debts ?? []).map((d) => ({ d, remaining: debtRemaining(d) })).filter((x) => x.remaining > 0.004);
  const row = (x: { d: Debt; remaining: number }) => ({ id: x.d.id, person: x.d.person, remaining: x.remaining, ...(x.d.due ? { due: x.d.due } : {}), late: !!x.d.due && x.d.due < today, label: x.d.label });
  const owedToMe = rows.filter((x) => x.d.direction === "lent").map(row).sort((a, c) => c.remaining - a.remaining), iOwe = rows.filter((x) => x.d.direction === "borrowed").map(row).sort((a, c) => c.remaining - a.remaining);
  const sum = (a: { remaining: number }[]) => round2(a.reduce((n, x) => n + x.remaining, 0));
  return { owedToMe, iOwe, totalOwedToMe: sum(owedToMe), totalIOwe: sum(iOwe), net: round2(sum(owedToMe) - sum(iOwe)) };
}

// ---------------------------------------------------------------- Plafonds suggérés
/** Répartition par défaut du budget variable quand l'historique est insuffisant (parts relatives). */
export const DEFAULT_SHARES: Record<string, number> = { Courses: 30, Restauration: 14, Transport: 10, "Études": 10, Loisirs: 14, "Santé": 6, Autre: 10 };
export interface LimitSuggestion { cat: ExpenseCat; amount: number; basis: "fixe" | "historique" | "répartition"; avg: number | null; current: number | null; why: string }
const roundTo5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);
/**
 * Un plafond conseillé par catégorie, à partir du budget mensuel : les récurrentes (loyer, abonnements) sont réservées telles quelles,
 * le reste est réparti selon vos dépenses des 3 derniers mois (ou une répartition type sans historique), avec 5 % de marge dans « Autre ».
 * La somme des plafonds ne dépasse jamais le budget mensuel.
 */
export function suggestLimits(b: Budget, today: string, cats: ExpenseCat[]): LimitSuggestion[] {
  const M = b.monthly; if (!(M > 0)) return [];
  const fixed = new Map<string, number>(); for (const r of b.recurring.filter((x) => x.active && x.amount > 0)) fixed.set(r.category, (fixed.get(r.category) ?? 0) + r.amount);
  const fixedTotal = [...fixed.values()].reduce((n, v) => n + v, 0);
  // Historique : 3 mois pleins avant le mois courant, dépenses variables seulement.
  const cur = monthKey(today), hist = new Map<string, number>(); const months = new Set<string>();
  for (const e of b.expenses) { const mk = monthKey(e.date); if (mk >= cur || e.source === "recurrente" || e.recurringId) continue; if (daysBetween(`${mk}-01`, `${cur}-01`) > 100) continue; months.add(mk); hist.set(e.category, (hist.get(e.category) ?? 0) + e.amount); }
  const nm = Math.max(1, months.size), avg = (c: string) => (hist.get(c) ?? 0) / nm;
  const histTotal = [...hist.values()].reduce((n, v) => n + v, 0), useHist = months.size > 0 && histTotal > 0;
  const varBudget = Math.max(0, M - fixedTotal), pool = varBudget * 0.95;
  const names = cats.map(String), variable = names.filter((c) => !fixed.has(c) || (hist.get(c) ?? 0) > 0);
  const w = (c: string) => (useHist ? avg(c) : DEFAULT_SHARES[c] ?? 4);
  const wTotal = variable.reduce((n, c) => n + w(c), 0) || 1;
  const out: LimitSuggestion[] = [];
  for (const c of names) {
    const f = fixed.get(c) ?? 0, v = variable.includes(c) ? (pool * w(c)) / wTotal : 0;
    let amount = f > 0 ? Math.ceil(f + v) : roundTo5(v + (c === "Autre" ? varBudget * 0.05 : 0));
    if (f > 0 && v > 0) amount = roundTo5(f + v);
    if (!(amount > 0)) continue;
    const basis = f > 0 && v < 1 ? "fixe" : useHist && avg(c) > 0 ? "historique" : "répartition";
    out.push({ cat: c, amount, basis, avg: useHist && avg(c) > 0 ? round2(avg(c)) : null, current: b.limits[c] ?? null,
      why: basis === "fixe" ? `Dépense récurrente prévue : ${f.toFixed(2).replace(".", ",")} €` : basis === "historique" ? `Vous dépensez en moyenne ${avg(c).toFixed(0)} € par mois` : "Répartition type du budget" });
  }
  // Jamais plus que le budget : on réduit proportionnellement les plafonds variables.
  let total = out.reduce((n, x) => n + x.amount, 0);
  if (total > M) { const fx = out.filter((x) => x.basis === "fixe").reduce((n, x) => n + x.amount, 0), vr = total - fx, k = vr > 0 ? Math.max(0, (M - fx) / vr) : 0; for (const x of out) if (x.basis !== "fixe") x.amount = Math.floor((x.amount * k) / 5) * 5; total = out.reduce((n, x) => n + x.amount, 0); }
  return out.filter((x) => x.amount > 0).sort((a, c) => c.amount - a.amount);
}

// ---------------------------------------------------------------- Analyse PDF professionnelle
export interface MonthPoint { month: string; spent: number; income: number }
export interface BudgetReport {
  month: string; name: string; cur: string; monthly: number; stats: BudgetStats; prevSpent: number | null; lines: CatLine[]; unallocated: number;
  pocket: PocketStats | null; insights: Insight[]; top: Expense[]; recurring: { label: string; amount: number; day: number }[]; debts: FlatDebts | null; generatedAt: string;
  /** Six derniers mois (du plus ancien au courant) : dépenses et revenus. */
  history?: MonthPoint[]; personal?: PersonalDebts | null; suggestions?: LimitSuggestion[]; savingsTotal?: number; expenseCount?: number;
}
type RGB = [number, number, number];
const INK: RGB = [24, 22, 46], MUTED: RGB = [110, 106, 140], GRID: RGB = [221, 218, 232], ACCENT: RGB = [52, 72, 240], PINK: RGB = [255, 72, 140], BAD: RGB = [226, 40, 80], OK: RGB = [0, 150, 105], WARN: RGB = [205, 120, 0], PAPER: RGB = [247, 246, 252], WHITE: RGB = [255, 255, 255];
const CAT_PALETTE: RGB[] = [[52, 72, 240], [0, 150, 105], [217, 130, 43], [194, 65, 122], [122, 90, 245], [29, 155, 181], [181, 101, 29], [91, 107, 140]];
const monthLabel = (mk: string, long = false) => parseISO(`${mk}-01`).toLocaleDateString("fr-FR", long ? { month: "long", year: "numeric" } : { month: "short" });
/** Analyse détaillée du mois en PDF (A4 portrait, plusieurs pages numérotées). Retourne les octets du fichier. */
export function buildBudgetPdf(r: BudgetReport): Uint8Array {
  const W = 210, H = 297, M = 14, CW = W - 2 * M;
  const doc = new MiniPdf(W, H); let y = 0;
  const m = (n: number) => eur(n, r.cur);
  const title = monthLabel(r.month, true).replace(/^./, (c) => c.toUpperCase());
  const head = () => {
    doc.rect(0, 0, W, 30, INK); doc.rect(0, 30, W, 1.6, PINK);
    doc.text(M, 14, "Analyse du budget", 20, WHITE, { bold: true });
    doc.text(M, 22.5, `${title}${r.name ? ` · ${r.name}` : ""}`, 10, [205, 202, 225]);
    doc.rect(W - M - 33, 8, 33, 9.5, PINK); doc.text(W - M - 16.5, 14.4, "Étudiant.OS", 9, WHITE, { bold: true, align: "center" });
    doc.text(W - M, 25, `Généré le ${new Date(r.generatedAt).toLocaleDateString("fr-FR")}`, 8, [205, 202, 225], { align: "right" });
    y = 40;
  };
  const runHead = () => { doc.rect(0, 0, W, 10, INK); doc.text(M, 6.6, `Analyse du budget · ${title}`, 8, WHITE, { bold: true }); y = 18; };
  const ensure = (h: number) => { if (y + h > H - 16) { doc.addPage(); runHead(); } };
  const section = (t: string, note?: string) => { ensure(18); doc.rect(M, y, 1.6, 6, ACCENT); doc.text(M + 4, y + 4.8, t, 12, INK, { bold: true }); if (note) doc.text(W - M, y + 4.6, note, 7.5, MUTED, { align: "right" }); y += 10; };
  const tableHead = (cols: [string, number, ("left" | "right")?][]) => { doc.rect(M, y, CW, 6.4, INK); let x = M; for (const [l, w, al] of cols) { doc.text(al === "right" ? x + w - 4 : x + 2, y + 4.4, l.toUpperCase(), 6.6, WHITE, { bold: true, align: al ?? "left" }); x += w; } y += 6.4; };
  const rowBg = (i: number, h: number) => { if (i % 2 === 0) doc.rect(M, y, CW, h, PAPER); };
  head();
  // Bilan
  const s = r.stats, pctSpent = r.monthly > 0 ? Math.round((s.spent / r.monthly) * 100) : 0;
  const over = s.remaining < 0, tone: RGB = over ? BAD : pctSpent > 90 ? WARN : OK;
  doc.rect(M, y, CW, 13, PAPER, GRID); doc.rect(M, y, 2.2, 13, tone);
  doc.text(M + 6, y + 5.4, over ? "Budget dépassé ce mois-ci" : pctSpent > 90 ? "Budget presque épuisé" : "Budget maîtrisé", 11, tone, { bold: true });
  doc.text(M + 6, y + 10.2, `${m(s.spent)} dépensés sur ${m(r.monthly)} prévus (${pctSpent} %)${over ? ` · ${m(-s.remaining)} au-dessus` : ` · il reste ${m(s.remaining)}`}`, 8.5, INK);
  y += 18;
  const kp: [string, string, string, RGB][] = [["Budget mensuel", m(r.monthly), "", ACCENT], ["Dépensé", m(s.spent), `${pctSpent} % du budget`, over ? BAD : INK], ["Restant", m(s.remaining), s.perDayLeft !== null ? `≈ ${m(Math.max(0, s.perDayLeft))} / jour` : "mois terminé", over ? BAD : OK], ["Projection fin de mois", s.projection === null ? "—" : m(s.projection), s.projection !== null && s.projection > r.monthly ? "au-dessus du budget" : "dans le budget", s.projection !== null && s.projection > r.monthly ? WARN : OK]];
  const kw = (CW - 9) / 4;
  kp.forEach(([l, v, sub, c], i) => { const x = M + i * (kw + 3); doc.rect(x, y, kw, 21, WHITE, GRID); doc.rect(x, y, kw, 1.4, c); doc.text(x + 3, y + 6.6, l.toUpperCase(), 6.2, MUTED, { bold: true }); doc.text(x + 3, y + 13.6, v, 11.5, INK, { bold: true }); doc.text(x + 3, y + 18, sub, 6.8, c === INK ? MUTED : c); });
  y += 25;
  const kp2: [string, string][] = [["Revenus reçus", m(s.income)], ["Mis de côté", m(s.saved)], ["Épargne totale", m(r.savingsTotal ?? s.savingsTotal)], ["Dépenses", `${r.expenseCount ?? 0} · moy. ${m(r.expenseCount ? s.spent / r.expenseCount : 0)}`]];
  kp2.forEach(([l, v], i) => { const x = M + i * (kw + 3); doc.rect(x, y, kw, 14, PAPER, GRID); doc.text(x + 3, y + 5, l.toUpperCase(), 6, MUTED, { bold: true }); doc.text(x + 3, y + 10.8, v, 9.2, INK, { bold: true }); });
  y += 20;
  if (r.prevSpent !== null && r.prevSpent > 0) { const d = s.spent - r.prevSpent; doc.text(M, y, `Mois précédent : ${m(r.prevSpent)} · ${d >= 0 ? "+" : "−"}${m(Math.abs(d))} (${d >= 0 ? "+" : "−"}${Math.round((Math.abs(d) / r.prevSpent) * 100)} %) ce mois-ci`, 8.5, MUTED); y += 7; }
  // Catégories
  section("Répartition par catégorie", "dépensé · plafond · reste");
  tableHead([["Catégorie", 52], ["Dépensé", 28, "right"], ["Plafond", 26, "right"], ["Reste", 28, "right"], ["Part", 48]]);
  r.lines.forEach((l, i) => {
    ensure(8); rowBg(i, 7.4); const c = CAT_PALETTE[i % CAT_PALETTE.length], share = s.spent > 0 ? l.spent / s.spent : 0;
    doc.rect(M + 2, y + 2.4, 2.6, 2.6, c); doc.text(M + 7, y + 5, l.cat, 8.4, INK, { bold: true });
    doc.text(M + 52 + 26, y + 5, m(l.spent), 8.4, INK, { align: "right" }); doc.text(M + 80 + 24, y + 5, l.limit ? m(l.limit) : "—", 8.4, MUTED, { align: "right" });
    doc.text(M + 106 + 26, y + 5, l.remaining === null ? "—" : l.remaining >= 0 ? m(l.remaining) : `−${m(-l.remaining)}`, 8.4, l.over ? BAD : OK, { bold: true, align: "right" });
    doc.rect(M + 136, y + 2.6, 36, 2.6, GRID); doc.rect(M + 136, y + 2.6, Math.max(0.4, 36 * (l.limit ? Math.min(1, l.spent / l.limit) : share)), 2.6, l.over ? BAD : c); doc.text(M + CW - 1, y + 5, `${Math.round(share * 100)} %`, 7, MUTED, { align: "right" });
    y += 7.4;
  });
  if (r.unallocated !== 0) { y += 2; doc.text(M, y + 3, r.unallocated > 0 ? `${m(r.unallocated)} du budget ne sont pas encore répartis en plafonds.` : `Les plafonds dépassent le budget de ${m(-r.unallocated)}.`, 8, MUTED); y += 6; }
  y += 5;
  // Historique 6 mois
  if (r.history && r.history.length > 1) {
    ensure(70);
    section("Évolution sur 6 mois", "dépenses · revenus"); const ch = 38, mx = Math.max(1, r.monthly, ...r.history.flatMap((p) => [p.spent, p.income])), n = r.history.length, gw = CW / n;
    for (let g = 0; g <= 4; g++) { const gy = y + ch - (g / 4) * (ch - 4); doc.line(M, gy, M + CW, gy, GRID, 0.12); doc.text(M, gy - 0.8, String(Math.round((mx * g) / 4)), 5.6, MUTED); }
    const by = y + ch - (r.monthly / mx) * (ch - 4); doc.line(M, by, M + CW, by, PINK, 0.25); doc.text(M + CW, by - 1, "budget", 5.8, PINK, { align: "right" });
    r.history.forEach((p, i) => { const x = M + i * gw + gw * 0.16, bw = gw * 0.3, h1 = (p.spent / mx) * (ch - 4), h2 = (p.income / mx) * (ch - 4);
      doc.rect(x, y + ch - h1, bw, Math.max(0.3, h1), p.month === r.month ? ACCENT : [140, 150, 235]); if (p.income > 0) doc.rect(x + bw + 0.8, y + ch - h2, bw, Math.max(0.3, h2), OK);
      doc.text(x + bw, y + ch + 4, monthLabel(p.month), 6.6, p.month === r.month ? INK : MUTED, { bold: p.month === r.month, align: "center" }); doc.text(x + bw * 0.5, y + ch - h1 - 1, String(Math.round(p.spent)), 5.8, INK, { align: "center" }); });
    y += ch + 9; doc.rect(M, y - 3, 3, 2.4, ACCENT); doc.text(M + 4.5, y - 1, "Dépenses", 6.6, MUTED); doc.rect(M + 22, y - 3, 3, 2.4, OK); doc.text(M + 26.5, y - 1, "Revenus", 6.6, MUTED); y += 6;
  }
  // Jour par jour
  ensure(66);
  section("Dépenses jour par jour", `budget journalier moyen ${m(r.monthly / s.dim)}`); { const ch = 34, n = s.daily.length, bw = CW / n, mx = Math.max(1, ...s.daily), goal = r.monthly / s.dim;
    for (let g = 0; g <= 3; g++) { const gy = y + ch - (g / 3) * (ch - 3); doc.line(M, gy, M + CW, gy, GRID, 0.12); doc.text(M, gy - 0.8, String(Math.round((mx * g) / 3)), 5.6, MUTED); }
    s.daily.forEach((v, i) => { if (v > 0) { const h = Math.max(0.5, (v / mx) * (ch - 3)); doc.rect(M + i * bw + 0.35, y + ch - h, bw - 0.7, h, v > goal * 2 ? BAD : ACCENT); } if ((i + 1) % 5 === 0 || i === 0) doc.text(M + i * bw + bw / 2, y + ch + 4, String(i + 1), 6, MUTED, { align: "center" }); });
    const gy = y + ch - Math.min(ch - 3, (goal / mx) * (ch - 3)); doc.line(M, gy, M + CW, gy, PINK, 0.25); y += ch + 9; }
  // Argent de poche
  if (r.pocket) {
    section(`Argent de poche (${r.pocket.cfg.period === "week" ? "semaine" : "mois"})`);
    doc.rect(M, y, CW, 5, GRID); doc.rect(M, y, Math.max(0.5, CW * Math.min(1, r.pocket.pct / 100)), 5, r.pocket.over ? BAD : r.pocket.ahead ? WARN : OK);
    doc.text(M, y + 10.5, `${m(r.pocket.spent)} utilisés sur ${m(r.pocket.cfg.amount)} (${r.pocket.pct} %) · ${r.pocket.remaining >= 0 ? `il reste ${m(r.pocket.remaining)}, soit environ ${m(r.pocket.perDay)} par jour` : `dépassé de ${m(-r.pocket.remaining)}`}`, 8.4, INK); y += 16;
  }
  // Plus grosses dépenses
  if (r.top.length) {
    section("Plus grosses dépenses"); tableHead([["Date", 22], ["Libellé", 84], ["Catégorie", 40], ["Montant", 36, "right"]]);
    r.top.forEach((e, i) => { ensure(7); rowBg(i, 6.6); doc.text(M + 2, y + 4.6, `${e.date.slice(8)}/${e.date.slice(5, 7)}`, 8, MUTED); doc.text(M + 24, y + 4.6, doc.wrap(e.label || e.category, 80, 8.4)[0] ?? "", 8.4, INK); doc.text(M + 108, y + 4.6, e.category, 8, MUTED); doc.text(M + CW - 2, y + 4.6, m(e.amount), 8.4, INK, { bold: true, align: "right" }); y += 6.6; });
    y += 5;
  }
  if (r.recurring.length) {
    section("Dépenses récurrentes", `${m(r.recurring.reduce((n, x) => n + x.amount, 0))} par mois`); tableHead([["Jour", 22], ["Libellé", 118], ["Montant", 36, "right"]]);
    r.recurring.forEach((e, i) => { ensure(7); rowBg(i, 6.6); doc.text(M + 2, y + 4.6, `le ${e.day}`, 8, MUTED); doc.text(M + 24, y + 4.6, e.label, 8.4, INK); doc.text(M + CW - 2, y + 4.6, m(e.amount), 8.4, INK, { bold: true, align: "right" }); y += 6.6; });
    y += 5;
  }
  // Dettes
  const pd = r.personal, fd = r.debts;
  if ((pd && (pd.owedToMe.length || pd.iOwe.length)) || (fd && (fd.owedToMe.length || fd.iOwe.length))) {
    section("Dettes et prêts"); tableHead([["Personne", 70], ["Sens", 46], ["Reste", 40, "right"], ["Échéance", 20, "right"]]);
    let i = 0; const line = (who: string, sens: string, amount: number, good: boolean, due?: string, late?: boolean) => { ensure(7); rowBg(i++, 6.6); doc.text(M + 2, y + 4.6, who, 8.4, INK, { bold: true }); doc.text(M + 72, y + 4.6, sens, 8, MUTED); doc.text(M + 156, y + 4.6, `${good ? "+" : "−"}${m(amount)}`, 8.4, good ? OK : BAD, { bold: true, align: "right" }); if (due) doc.text(M + CW - 1, y + 4.6, `${due.slice(8)}/${due.slice(5, 7)}`, 7.4, late ? BAD : MUTED, { align: "right" }); y += 6.6; };
    for (const d of pd?.owedToMe ?? []) line(d.person, d.label ? `te doit · ${d.label}` : "te doit", d.remaining, true, d.due, d.late);
    for (const d of pd?.iOwe ?? []) line(d.person, d.label ? `tu dois · ${d.label}` : "tu dois", d.remaining, false, d.due, d.late);
    for (const d of fd?.owedToMe ?? []) line(d.name, "colocation · te doit", d.cents / 100, true);
    for (const d of fd?.iOwe ?? []) line(d.name, "colocation · tu dois", d.cents / 100, false);
    const net = (pd?.net ?? 0) + (fd ? fd.net / 100 : 0); y += 2; doc.text(M + CW - 2, y + 3, `Solde net : ${net >= 0 ? "+" : "−"}${m(Math.abs(net))}`, 9, net >= 0 ? OK : BAD, { bold: true, align: "right" }); y += 9;
  }
  // Plafonds suggérés
  if (r.suggestions?.length) {
    section("Plafonds conseillés par catégorie", "d'après votre budget et vos habitudes"); tableHead([["Catégorie", 44], ["Actuel", 24, "right"], ["Conseillé", 28, "right"], ["Pourquoi", 86]]);
    r.suggestions.forEach((x, i) => { ensure(7); rowBg(i, 6.6); doc.text(M + 2, y + 4.6, x.cat, 8.4, INK, { bold: true }); doc.text(M + 66, y + 4.6, x.current ? m(x.current) : "—", 8, MUTED, { align: "right" }); doc.text(M + 94, y + 4.6, m(x.amount), 8.6, ACCENT, { bold: true, align: "right" }); doc.text(M + 98, y + 4.6, doc.wrap(x.why, 80, 7.6)[0] ?? "", 7.6, MUTED); y += 6.6; });
    y += 5;
  }
  // Conseils
  if (r.insights.length) {
    section("Repères et conseils");
    for (const i of r.insights) { const lines = doc.wrap(i.text, CW - 10, 8.4), h = 8 + lines.length * 4; ensure(h + 2); const c = i.tone === "warn" ? WARN : i.tone === "ok" ? OK : ACCENT;
      doc.rect(M, y, CW, h, PAPER, GRID); doc.rect(M, y, 1.8, h, c); doc.text(M + 5, y + 5, i.title, 9, INK, { bold: true }); lines.forEach((l, k) => doc.text(M + 5, y + 9.6 + k * 4, l, 8.4, MUTED)); y += h + 3; }
  }
  // Pied de page numéroté
  const n = doc.pageCount;
  for (let i = 0; i < n; i++) { doc.goto(i); doc.line(M, H - 11, W - M, H - 11, GRID, 0.2); doc.text(M, H - 6.5, "Étudiant.OS · Repères indicatifs fondés sur vos saisies, pas un conseil financier.", 6.8, MUTED); doc.text(W - M, H - 6.5, `Page ${i + 1} / ${n}`, 7, INK, { bold: true, align: "right" }); }
  return doc.bytes();
}
