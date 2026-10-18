/* Étudiant.OS — lecture d'un ticket de caisse à partir du texte brut renvoyé par l'OCR (fonctions pures, sans navigateur).
 *
 * Principes :
 *  - les montants sont manipulés en centimes entiers (jamais de flottants pour additionner) ;
 *  - les confusions typiques de l'OCR (O↔0, I/l↔1, S↔5) ne sont corrigées QUE dans un jeton numérique
 *    (un montant ou une date identifiés par leur forme) ; jamais dans un mot ;
 *  - on ne devine jamais : total contradictoire, date invalide, magasin incertain, prix ambigu → on le signale
 *    (statuts et drapeaux) au lieu de choisir silencieusement ;
 *  - « confiance » = indicateur qualitatif (haute / moyenne / basse) fondé sur des règles, pas une probabilité. */

// ---------------------------------------------------------------- Montants
/** Caractères que l'OCR confond avec des chiffres, valables uniquement dans un jeton numérique. */
const CONFUSABLE = /[OoIl|S]/g;
const FIX: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", "|": "1", S: "5" };

/** « 12,47 », « 12.47 », « 12 ,47 », « 1 234,50 », « 1.234,50 », « 1O,47 », « 12,4 », « -0,50 », « 0,50- », « 12,47 € » → centimes entiers.
 *  Renvoie null si le jeton est ambigu ou n'est pas un montant (« 1.234 », « 12 », « SOS,5 »). */
export function toCents(raw: string): number | null {
  let s = String(raw ?? "").normalize("NFKC").replace(/[−–—]/g, "-").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (/^-/.test(s)) { neg = true; s = s.replace(/^-+\s*/, ""); }
  if (/-$/.test(s)) { neg = true; s = s.replace(/\s*-+$/, ""); }
  s = s.replace(/^[€$£]\s*/, "").replace(/\s*(?:€|\$|£|EUR(?:OS?)?)$/i, "").trim();
  if (!/^[\dOoIlS|.,\s]+$/.test(s)) return null;
  const digits = (s.match(/\d/g) ?? []).length, fuzzy = (s.match(CONFUSABLE) ?? []).length;
  if (digits === 0 || fuzzy > digits) return null; // trop de lettres : pas un montant
  s = s.replace(CONFUSABLE, (c) => FIX[c]);
  const m = /^(\d{1,3}(?:[ .,]\d{3})*|\d+)\s?[.,]\s?(\d{1,2})$/.exec(s);
  if (!m) return null;
  const int = m[1].replace(/[ .,]/g, "");
  if (int.length > 7) return null;
  const dec = m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2]);
  const c = Number(int) * 100 + dec;
  return neg ? -c : c;
}
/** Même chose en euros (nombre), ou null. */
export function toAmount(raw: string): number | null { const c = toCents(raw); return c === null ? null : c / 100; }

export interface AmountToken { raw: string; cents: number | null; start: number; end: number; repaired: boolean; partial: boolean }
const NUM = "[\\dOoIlS|]";
const AMOUNT_RE = new RegExp(`(?<![\\p{L}\\d.,])([-−–(]\\s?)?((?:${NUM}{1,3}(?:[ .,]\\d{3})+|${NUM}{1,6})\\s?[.,]\\s?${NUM}{1,2})(?![\\dOoIl|]|[.,]\\d)(\\s?-(?![\\w]))?\\)?`, "gu");
/** Jetons « montant » d'une ligne (les pourcentages sont ignorés ; cents = null si ambigu). */
export function amountTokens(line: string): AmountToken[] {
  const out: AmountToken[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const end = m.index! + m[0].length;
    if (/^\s?%/.test(line.slice(end))) continue;
    if (!/\d/.test(m[2])) continue;
    const raw = m[0];
    out.push({ raw, cents: toCents(raw), start: m.index!, end, repaired: CONFUSABLE.test(m[2]) && (CONFUSABLE.lastIndex = 0, true), partial: /[.,]\s?[\dOoIlS|]$/.test(m[2]) && !/[.,]\s?[\dOoIlS|]{2}$/.test(m[2]) });
  }
  CONFUSABLE.lastIndex = 0;
  // « 1.234 » / « 1,234 » : milliers ou 3 décimales ? Ambigu : jeton signalé sans valeur (jamais deviné).
  for (const m of line.matchAll(/(?<![\p{L}\d.,])\d{1,3}[.,]\d{3}(?![\d]|[.,]\d)/gu)) {
    const start = m.index!, end = start + m[0].length;
    if (out.some((t) => start < t.end && end > t.start)) continue;
    if (/^\s?%/.test(line.slice(end))) continue;
    out.push({ raw: m[0], cents: null, start, end, repaired: false, partial: false });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- Étiquettes (texte d'une ligne sans ses montants)
const stripAccents = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Libellé en majuscules sans accents ni ponctuation, montants retirés. */
function label(line: string, toks: AmountToken[]): string {
  let s = line;
  for (const t of [...toks].reverse()) s = s.slice(0, t.start) + " " + s.slice(t.end);
  return stripAccents(s).toUpperCase().replace(/[^A-Z0-9%]/g, " ").replace(/\s+/g, " ").trim();
}
const TOTAL = "T[O0]T[A4][LI1]";
const PAYER = "[A4] ?P[A4]Y[E3]R";
const NOT_TOTAL = new RegExp(`\\bS ?${TOTAL}\\b|SOUS ?${TOTAL}|\\bST\\b|\\bHT\\b|\\bTVA\\b|\\bTAXES?\\b|\\bREMISES?\\b|\\bECONOMIES?\\b|\\bCUMUL|\\bESPECES?\\b|\\bCARTES?\\b|\\bCB\\b|\\bVISA\\b|\\bMASTERCARD\\b|\\bRENDU|\\bMONNAIE|\\bRECU\\b|\\bVERSE\\b|\\bARTICLES?\\b|\\bARTS?\\b|\\bNB\\b|\\bQTE\\b|\\bPOINTS?\\b|\\bAVOIR\\b|\\bFIDELITE\\b|\\bCOUPONS?\\b|\\bBONS?\\b`);
/** Force du libellé comme « vrai total » : 5 = à payer, 4 = TTC, 3 = TOTAL seul, 0 = autre. */
export function totalStrength(lab: string): number {
  if (!lab || NOT_TOTAL.test(lab)) return 0;
  if (new RegExp(`\\b${PAYER}\\b|\\b${TOTAL} DU\\b`).test(lab)) return 5;
  if (new RegExp(`\\b${TOTAL} T[TI]C\\b|\\bMONTANT T[TI]C\\b|\\bNET T[TI]C\\b`).test(lab)) return 4;
  const rest = lab.replace(new RegExp(`\\b${TOTAL}\\b`), "").trim();
  if (rest !== lab && /^((EUROS?|EUR|E|GENERAL|CAISSE|DES ACHATS|PANIER) ?)*$/.test(rest)) return 3;
  return 0;
}

export type TotalStatus = "ok" | "derived" | "conflict" | "absent";
export interface TotalCandidate { amount: number; strength: number; line: number }

// ---------------------------------------------------------------- Date
const pad = (n: number) => String(n).padStart(2, "0");
const FIXNUM = (s: string) => s.replace(CONFUSABLE, (c) => FIX[c]);
export type DateStatus = "ok" | "ambiguous" | "invalid" | "none";
function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > dim ? null : `${y}-${pad(m)}-${pad(d)}`;
}
const NOT_DATE_LINE = /\b(CARTE|CB|VISA|MASTERCARD|TRANSACTION|TRANS|EXP|EXPIRATION|VALIDITE|AID|ARQC|CONTACTLESS)\b/;
function findDates(all: string): { dates: string[]; invalid: number } {
  // lignes de carte bancaire / transaction exclues (date d'expiration, numéros)
  const text = all.split("\n").filter((l) => !NOT_DATE_LINE.test(stripAccents(l).toUpperCase().replace(/[^A-Z0-9]/g, " "))).join("\n");
  const dates: string[] = []; let invalid = 0;
  const D = "[\\dOoIlS]";
  const guard = "(?<![\\dOoIlS:/.,-])", after = "(?![\\dOoIlS]|[:/])";
  const dmy = new RegExp(`${guard}(${D}{1,2})\\s?([/.\\-])\\s?(${D}{1,2})\\s?\\2\\s?(${D}{4}|${D}{2})${after}`, "g");
  for (const m of text.matchAll(dmy)) {
    if ((m[0].match(/\d/g) ?? []).length < 3) continue; // trop de lettres : pas une date
    let y = Number(FIXNUM(m[4])); if (m[4].length === 2) y += 2000;
    const r = validDate(y, Number(FIXNUM(m[3])), Number(FIXNUM(m[1])));
    if (r) dates.push(r); else invalid++;
  }
  const ymd = new RegExp(`${guard}(${D}{4})([/.\\-])(${D}{1,2})\\2(${D}{1,2})${after}`, "g");
  for (const m of text.matchAll(ymd)) {
    if ((m[0].match(/\d/g) ?? []).length < 3) continue;
    const r = validDate(Number(FIXNUM(m[1])), Number(FIXNUM(m[3])), Number(FIXNUM(m[4])));
    if (r) dates.push(r); else invalid++;
  }
  return { dates, invalid };
}

// ---------------------------------------------------------------- Magasin
const CHAINS = /\b(CARREFOUR|LECLERC|AUCHAN|LIDL|ALDI|INTERMARCHE|MONOPRIX|FRANPRIX|CASINO|SUPER U|HYPER U|U EXPRESS|MARCHE U|CORA|PICARD|BIOCOOP|NORMA|G20|SIMPLY|COLRUYT|GRAND FRAIS|NETTO|LEADER PRICE|CULTURA|DECATHLON|FNAC|GIFI|BOULANGER|MCDONALD'?S?|KFC|QUICK|SUBWAY|STARBUCKS|SPAR|VIVAL|PROXI|CHAMPION|COCCINELLE|SUPECO|FOIR FOUILLE|ACTION|NATURALIA|LA VIE CLAIRE|CASH CONVERTERS)\b/;
const NOT_STORE = /\b(TICKET|FACTURE|CAISSE|CAISSIER|MERCI|BIENVENUE|TEL|TELEPHONE|SIRET|SIREN|TVA|RUE|AVENUE|AV|BD|BOULEVARD|CLIENT|DATE|WWW|HTTP|CODE|POSTAL|CEDEX|DUPLICATA|COPIE|ARTICLES?|TOTAL|EURO|EUR)\b/;
const cleanStore = (l: string) => l.replace(/[^\p{L}\d '&.\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 32);
export type StoreConfidence = "high" | "low" | "none";

// ---------------------------------------------------------------- parseReceipt
export interface ReceiptResult {
  amount: number | null; date: string | null; store: string; text: string;
  /** ok = total explicite ; derived = payé − rendu ; conflict = plusieurs totaux différents ; absent = rien de fiable. */
  totalStatus: TotalStatus; totalCandidates: number[];
  dateStatus: DateStatus; storeConfidence: StoreConfidence;
}
const nonEmptyLines = (text: string) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const onlyAmount = (line: string, toks: AmountToken[]) => toks.length === 1 && label(line, toks).replace(/\b(EUR|EUROS?|E|A|B|C|D)\b/g, "").trim() === "";

export function parseReceipt(text: string): ReceiptResult {
  const lines = nonEmptyLines(text);
  const toks = lines.map(amountTokens), labs = lines.map((l, i) => label(l, toks[i]));
  const valid = (i: number) => toks[i].filter((t) => t.cents !== null && t.cents > 0);

  // --- total
  const cands: (TotalCandidate & { cents: number })[] = [];
  lines.forEach((l, i) => {
    const s = totalStrength(labs[i]); if (!s) return;
    let v = valid(i).pop();
    if (!v && i + 1 < lines.length && onlyAmount(lines[i + 1], toks[i + 1])) v = valid(i + 1).pop();
    if (v) cands.push({ cents: v.cents!, amount: v.cents! / 100, strength: s, line: i });
  });
  let amount: number | null = null, totalStatus: TotalStatus = "absent";
  if (cands.length) {
    const top = Math.max(...cands.map((c) => c.strength));
    const decisive = top >= 4 ? cands.filter((c) => c.strength >= 4) : cands;
    const distinct = new Set(decisive.map((c) => c.cents));
    if (distinct.size === 1) { amount = decisive[0].amount; totalStatus = "ok"; } else totalStatus = "conflict";
  } else {
    // Pas de total explicite : seul « payé en espèces − rendu » (les deux explicites) est accepté.
    const paid: number[] = [], change: number[] = [];
    lines.forEach((_, i) => {
      const v = valid(i).pop(); if (!v) return;
      if (/\b(RENDU|MONNAIE|A RENDRE|RENDRE)\b/.test(labs[i])) change.push(v.cents!);
      else if (/\b(ESPECES?|LIQUIDE|CASH|RECU|VERSE|DONNE)\b/.test(labs[i])) paid.push(v.cents!);
    });
    if (paid.length === 1 && change.length === 1 && paid[0] > change[0]) { amount = (paid[0] - change[0]) / 100; totalStatus = "derived"; }
  }
  const totalCandidates = [...new Set(cands.map((c) => c.amount))];

  // --- date
  const { dates, invalid } = findDates(lines.join("\n"));
  const uniq = [...new Set(dates)];
  const date = uniq[0] ?? null;
  const dateStatus: DateStatus = uniq.length > 1 ? "ambiguous" : uniq.length === 1 ? "ok" : invalid ? "invalid" : "none";

  // --- magasin : en-tête = lignes avant le premier montant (10 max)
  const first = toks.findIndex((t) => t.some((x) => x.cents !== null));
  const head = lines.slice(0, Math.min(10, first < 0 ? lines.length : first));
  const fuzz = (s: string) => s.replace(/0/g, "O").replace(/1/g, "I");
  let store = "", storeConfidence: StoreConfidence = "none";
  const hit = head.find((l) => { const u = stripAccents(l).toUpperCase(); return CHAINS.test(u) || CHAINS.test(fuzz(u)); });
  if (hit && cleanStore(hit).length >= 3) { store = cleanStore(hit); storeConfidence = "high"; }
  else {
    const guess = head.slice(0, 5).find((l) => {
      const u = stripAccents(l).toUpperCase(), letters = (u.match(/[A-Z]/g) ?? []).length, chars = u.replace(/\s/g, "").length;
      return letters >= 3 && letters / Math.max(1, chars) >= 0.7 && !NOT_STORE.test(u.replace(/[^A-Z0-9 ]/g, " ")) && !findDates(l).dates.length;
    });
    if (guess) { store = cleanStore(guess); storeConfidence = "low"; }
  }
  return { amount, date, store, text, totalStatus, totalCandidates, dateStatus, storeConfidence };
}

// ---------------------------------------------------------------- Articles
export interface ReceiptItem {
  name: string;
  /** Prix de la ligne en euros (négatif pour une remise) ; null si illisible ou ambigu. */
  price: number | null;
  qty: number;
  unitPrice: number | null;
  /** Poids en kg quand la ligne est vendue au poids. */
  weight?: number;
  kind: "item" | "discount";
  /** Indicateur qualitatif fondé sur des règles (pas une probabilité). */
  confidence: "high" | "medium" | "low";
  /** Raisons d'incertitude : price_next_line, price_repaired, price_partial, price_ambiguous, price_high, qty_computed, qty_incoherent, name_unclear, name_missing. */
  flags: string[];
  raw: string;
}
const META = /\b(TOTAL|T[O0]T[A4][LI1]|SOUS|TVA|TAXES?|HT|TTC|CARTE|CB|ESPECES?|VISA|MASTERCARD|RENDU|MONNAIE|PAYER|PAIEMENT|PAYE|DATE|HEURE|TICKET|TRANSACTION|TRANS|CAISSE|CAISSIER|SIRET|TEL|MERCI|ARTICLES?|CUMUL|POINTS?|CONTACTLESS|SANS CONTACT|AID|ARQC|AUTORISATION|RECU|VERSE|NB)\b/;
const DISCOUNT = /\b(REMISES?|REDUCTION|PROMO|PROMOTION|COUPON|AVANTAGE|BON DE REDUCTION|RABAIS|DEDUCTION)\b/;
const TIME = /\b\d{1,2}\s?[:hH]\s?\d{2}\b/;
const lettersOf = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const round2 = (x: number) => Math.round(x * 100) / 100;
const pretty = (s: string) => { const t = s.trim(); return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

function cleanName(s: string): string {
  return pretty(s.replace(/^\s*\d{4,}\s+/, "").replace(/^\s*\d{1,2}\s*[x×*]\s+/i, "").replace(/\s*\b[x×]\s?\d{1,2}\s*$/i, "")
    .replace(/[^\p{L}\d '&.%\-/]/gu, " ").replace(/\s+/g, " ").replace(/[\s.\-/]+$/, "").trim());
}
/** « 2 x 1,20 », « 0,345 kg x 3,20 €/kg » : renvoie ce qui précède, la quantité/le poids et le reste de la ligne. */
const QTY_RE = /(?:^|\s)(\d+(?:[.,]\d{1,3})?)\s*(kg|g|l)?\s*[x×*]\s*(?=[\dOoIl])/i;
const UNITS = /^(EUR|EUROS?|E|KG|G|L|PAR|PER|KILO|LITRE|A|B|C|D)?( (EUR|EUROS?|E|KG|G|L|PAR|PER|KILO|LITRE))*$/;

export function parseReceiptItems(text: string): ReceiptItem[] {
  const lines = nonEmptyLines(text).map((l) => l.replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1 x "));
  const items: ReceiptItem[] = [];
  const toks = lines.map(amountTokens), labs = lines.map((l, i) => label(l, toks[i]));
  // fin de la zone des articles : premier sous-total / total
  let end = lines.findIndex((_, i) => /\b(SOUS ?T[O0]T[A4][LI1]|S ?T[O0]T[A4][LI1]|ST)\b/.test(labs[i]) || totalStrength(labs[i]) > 0 || /\b(PAYER)\b/.test(labs[i]));
  if (end < 0) end = lines.length;

  let pend = null as { name: string; raw: string } | null;
  let last = null as ReceiptItem | null;
  const push = (it: ReceiptItem) => {
    if (it.price !== null && Math.abs(it.price) >= 1000) { it.flags.push("price_high"); it.confidence = "low"; }
    if (it.kind === "item" && !it.name) { it.flags.push("name_missing"); it.confidence = "low"; }
    items.push(it); last = it; pend = null;
  };
  const conf = (flags: string[]): ReceiptItem["confidence"] =>
    flags.some((f) => ["price_partial", "price_ambiguous", "qty_incoherent", "name_unclear", "name_missing", "price_high"].includes(f)) ? "low" : flags.length ? "medium" : "high";

  for (let i = 0; i < lines.length; i++) {
    const inRegion = i < end;
    const line = lines[i], tk = toks[i], lab = labs[i];
    const isDiscount = DISCOUNT.test(lab) && !/\bT[O0]T[A4][LI1]\b|\bCUMUL|\bECONOMIES?\b/.test(lab);
    if (!inRegion && !isDiscount) continue; // après le total : paiement, TVA… (sauf remises)
    if (!isDiscount && (META.test(lab) || TIME.test(line) || findDates(line).dates.length || /X{4}|\*{4}/i.test(line))) { pend = null; continue; }
    if (isDiscount && /\b(TVA|CB|CARTE|ESPECES?)\b/.test(lab)) continue;
    const prices = tk.filter((t) => !(t.cents === null && !/[.,]/.test(t.raw)));

    // ligne de quantité / poids : « 2 x 1,20  2,40 » (seule) ou « NOM 2 x 1,05  2,10 » (avec nom)
    const q = QTY_RE.exec(line);
    if (q && !isDiscount) {
      const before = line.slice(0, q.index).trim(), rest = line.slice(q.index + q[0].length);
      const rt = amountTokens(rest);
      const restLab = label(rest, rt);
      const nameOnLine = lettersOf(before.replace(/\b(kg|g|l)\b/gi, "")) >= 2;
      if (rt.length && rt[0].cents !== null && UNITS.test(restLab)) {
        const n = Number(q[1].replace(",", ".")), unit = (q[2] ?? "").toLowerCase();
        const flags: string[] = [];
        const uCents = rt[0].cents!, tCents = rt.length > 1 ? rt[rt.length - 1].cents : null;
        const weighed = unit === "kg" || unit === "g" || unit === "l" || !Number.isInteger(n);
        const w = unit === "g" ? n / 1000 : n;
        const qty = weighed ? 1 : n;
        let total: number | null = tCents;
        const expected = Math.round((weighed ? w : n) * uCents);
        if (total === null) { total = expected; flags.push("qty_computed"); }
        else if (Math.abs(total - expected) > (weighed ? 2 : 0)) flags.push("qty_incoherent");
        if (rt.some((t) => t.repaired)) flags.push("price_repaired");
        const apply = (it: ReceiptItem) => { it.qty = qty; it.unitPrice = uCents / 100; if (weighed) it.weight = w; };
        if (nameOnLine) {
          const it: ReceiptItem = { name: cleanName(before), price: total / 100, qty, unitPrice: uCents / 100, kind: "item", confidence: "high", flags, raw: line };
          if (weighed) it.weight = w;
          if (lettersOf(it.name) < 2) flags.push("name_unclear");
          it.confidence = conf(flags); push(it); continue;
        }
        if (pend) {
          const it: ReceiptItem = { name: pend.name, price: total / 100, qty, unitPrice: uCents / 100, kind: "item", confidence: "high", flags, raw: `${pend.raw}\n${line}` };
          if (weighed) it.weight = w;
          it.confidence = conf(flags); push(it); continue;
        }
        if (last && last.kind === "item" && last.price !== null && last.qty === 1 && last.weight === undefined) {
          // la ligne précise la quantité de l'article précédent
          if (tCents !== null && tCents !== Math.round(last.price * 100)) { last.flags.push("qty_incoherent"); }
          else { apply(last); if (tCents === null && expected !== Math.round(last.price * 100)) last.flags.push("qty_incoherent"); }
          last.confidence = conf(last.flags);
        }
        continue;
      }
    }

    // ligne avec prix
    const priced = prices.filter((t) => t.cents !== null);
    if (prices.length) {
      const p = prices[prices.length - 1];
      const firstTok = prices[0];
      let nameRaw = line.slice(0, firstTok.start);
      const after = line.slice(p.end).trim();
      if (lettersOf(nameRaw) < 2 && lettersOf(after) >= 3) nameRaw = after; // prix en tête de ligne
      const name = cleanName(nameRaw);
      const nameBare = nameRaw.replace(/[^\p{L}\d]/gu, "");
      if (isDiscount) {
        if (p.cents === null) continue;
        const cents = -Math.abs(p.cents);
        push({ name: name || "Remise", price: cents / 100, qty: 1, unitPrice: null, kind: "discount", confidence: conf(p.repaired ? ["price_repaired"] : []), flags: p.repaired ? ["price_repaired"] : [], raw: line });
        continue;
      }
      if (p.cents !== null && p.cents < 0) {
        push({ name: name || "Remise", price: p.cents / 100, qty: 1, unitPrice: null, kind: "discount", confidence: "medium", flags: ["negative_price"], raw: line });
        continue;
      }
      const blankName = /^[\s€$£*.\-:,]*$/.test(nameRaw);
      if (nameBare.length < 2 && (blankName || pend)) {
        // prix seul : il appartient à l'article de la ligne précédente (nom sans prix)
        if (pend && p.cents !== null && priced.length === 1) {
          const flags = ["price_next_line"]; if (p.repaired) flags.push("price_repaired"); if (p.partial) flags.push("price_partial");
          push({ name: pend.name, price: p.cents / 100, qty: 1, unitPrice: p.cents / 100, kind: "item", confidence: conf(flags), flags, raw: `${pend.raw}\n${line}` });
        } else if (pend && p.cents === null) {
          push({ name: pend.name, price: null, qty: 1, unitPrice: null, kind: "item", confidence: "low", flags: ["price_next_line", "price_ambiguous"], raw: `${pend.raw}\n${line}` });
        }
        continue;
      }
      const flags: string[] = [];
      let qty = 1;
      const lead = /^\s*(\d{1,2})\s*[x×*]\s+\p{L}/iu.exec(nameRaw) ?? /\b[x×]\s?(\d{1,2})\s*$/i.exec(nameRaw);
      if (lead) qty = Number(lead[1]);
      if (p.cents === null) flags.push("price_ambiguous"); else { if (p.repaired) flags.push("price_repaired"); if (p.partial) flags.push("price_partial"); }
      const cents = p.cents;
      if (lettersOf(name) < 3 || lettersOf(name) / Math.max(1, name.replace(/\s/g, "").length) < 0.5) flags.push("name_unclear");
      push({ name, price: cents === null ? null : cents / 100, qty, unitPrice: cents === null ? null : round2(cents / 100 / qty), kind: "item", confidence: conf(flags), flags, raw: line });
      continue;
    }

    // ligne sans montant : nom en attente du prix (ligne suivante)
    if (lettersOf(line) >= 3 && inRegion) pend = { name: cleanName(line), raw: line };
  }
  return items;
}

/** Somme des lignes (centimes) ; les lignes sans prix sont comptées à part. */
export function itemsTotalCents(items: ReceiptItem[]): { cents: number; unknown: number } {
  let cents = 0, unknown = 0;
  for (const it of items) { if (it.price === null) unknown++; else cents += Math.round(it.price * 100); }
  return { cents, unknown };
}
/** Écart entre la somme des lignes et le total du ticket (centimes), ou null si l'un des deux est inconnu. */
export function totalDivergence(items: ReceiptItem[], ticketTotal: number | null): number | null {
  if (ticketTotal === null || !items.length) return null;
  return itemsTotalCents(items).cents - Math.round(ticketTotal * 100);
}

// ---------------------------------------------------------------- Rapprochement prudent avec les produits connus
/** Clé de comparaison : sans accents, sans quantités/unités (« 1L », « 500g »), sans ponctuation. */
export function productKey(name: string): string {
  return stripAccents(name).toLowerCase().replace(/\b\d+([.,]\d+)?\s?(kg|g|l|cl|ml)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
/** Même produit si clés identiques, ou si les mots de l'un sont tous dans l'autre (au moins 2 mots). */
export function sameProduct(a: string, b: string): boolean {
  const ka = productKey(a), kb = productKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = ka.split(" "), tb = kb.split(" ");
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return s.length >= 2 && s.every((w) => l.includes(w));
}
/** Empreinte « date|centimes » pour signaler un ticket déjà enregistré (avertissement, pas un blocage). */
export const receiptFingerprint = (date: string | null, amount: number | null) => date && amount !== null ? `${date}|${Math.round(amount * 100)}` : "";
