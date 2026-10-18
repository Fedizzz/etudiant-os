/* Tests de la lecture de tickets : montants, total, date, magasin, articles, rapprochement avec la liste de courses,
 * préparation d'image. Les textes « OCR » ci-dessous sont soit écrits à la main pour reproduire des erreurs typiques,
 * soit des sorties réelles de Tesseract sur des tickets SYNTHÉTIQUES (images générées, pas de vraies photos). */
import test from "node:test";
import assert from "node:assert/strict";
import { parseReceipt, parseReceiptItems, toCents, toAmount, itemsTotalCents, totalDivergence, sameProduct, productKey, receiptFingerprint, applyReceiptToGroceries, reducer, blank } from "../src/core.ts";
import type { AppState, GroceryItem } from "../src/core.ts";
import { amountTokens } from "../src/receipt.ts";
import { flattenGray, targetScale, toGray } from "../src/imageprep.ts";

// ---------------------------------------------------------------- montants
test("toCents : formats courants", () => {
  assert.equal(toCents("12,47"), 1247);
  assert.equal(toCents("12.47"), 1247);
  assert.equal(toCents("12 ,47"), 1247);
  assert.equal(toCents("12,47 €"), 1247);
  assert.equal(toCents("€ 12,47"), 1247);
  assert.equal(toCents("12,47EUR"), 1247);
});
test("toCents : milliers", () => {
  assert.equal(toCents("1 234,50"), 123450);
  assert.equal(toCents("1.234,50"), 123450);
  assert.equal(toCents("1,234.50"), 123450);
  assert.equal(toCents("1 234,50"), 123450);
});
test("toCents : un seul chiffre après la virgule", () => {
  assert.equal(toCents("12,4"), 1240);
});
test("toCents : confusions OCR dans un jeton numérique seulement", () => {
  assert.equal(toCents("1O,47"), 1047);
  assert.equal(toCents("l2,47"), 1247);
  assert.equal(toCents("1S,50"), 1550);
  assert.equal(toCents("0,5O"), 50);
  assert.equal(toCents("O,5O"), null, "plus de lettres que de chiffres : refusé");
  assert.equal(toCents("SOS,5"), null, "pas un montant : aucun chiffre réel dans la partie entière");
  assert.equal(toCents("ABC"), null);
});
test("toCents : ambigu, refusé", () => {
  assert.equal(toCents("1.234"), null);
  assert.equal(toCents("1,234"), null);
  assert.equal(toCents("12"), null);
  assert.equal(toCents(""), null);
  assert.equal(toCents("12,4,7"), null);
});
test("toCents : négatifs et remises", () => {
  assert.equal(toCents("-0,50"), -50);
  assert.equal(toCents("0,50-"), -50);
  assert.equal(toCents("(0,50)"), -50);
  assert.equal(toCents("−0,50"), -50);
  assert.equal(toAmount("-2,10"), -2.1);
});
test("calculs en centimes : pas d'erreur de flottant", () => {
  const it = parseReceiptItems("LAIT 0,10\nPAIN 0,20\nRIZ 0,30\nBEURRE 0,35\nSEL 0,07");
  assert.equal(itemsTotalCents(it).cents, 102);
  assert.equal(totalDivergence(it, 1.02), 0);
  assert.equal(totalDivergence(it, 1.0), 2);
});
test("amountTokens : ignore les pourcentages et n'avale pas une date", () => {
  assert.deepEqual(amountTokens("TVA 5,5% 0,38").map((t) => t.cents), [38]);
  assert.deepEqual(amountTokens("14/10/2026 18:42").map((t) => t.cents), []);
  assert.deepEqual(amountTokens("LAIT 2 x 1,05 2,10").map((t) => t.cents), [105, 210]);
});

// ---------------------------------------------------------------- total
const total = (t: string) => parseReceipt(t);
test("total : variantes simples", () => {
  assert.equal(total("TOTAL 12,47").amount, 12.47);
  assert.equal(total("TOTAL TTC 1O,47").amount, 10.47);
  assert.equal(total("TOTAL A PAYER 12 ,47").amount, 12.47);
  assert.equal(total("TOTAL À PAYER 12,47").amount, 12.47);
  assert.equal(total("NET A PAYER 12,47").amount, 12.47);
  assert.equal(total("TOTAL 12,4").amount, 12.4);
  assert.equal(total("TOTAL 1 234,50").amount, 1234.5);
  assert.equal(total("TOTAL 1.234,50").amount, 1234.5);
  assert.equal(total("TOTAL EUR 12,47").amount, 12.47);
  assert.equal(total("T0TAL 12,47").amount, 12.47, "zéro à la place du O dans le mot");
  assert.equal(total("TOTAL\n12,47").amount, 12.47, "montant sur la ligne suivante");
});
test("total : ticket payé en espèces avec rendu monnaie → le total, pas 20,00 ni 7,53", () => {
  const r = total("LAIT 1,05\nTOTAL A PAYER 12,47\nESPECES 20,00\nRENDU MONNAIE 7,53");
  assert.equal(r.amount, 12.47);
  assert.equal(r.totalStatus, "ok");
});
test("total : sans total imprimé, seul payé − rendu explicite est accepté", () => {
  const r = total("LAIT 1,05\nESPECES 20,00\nRENDU 7,53");
  assert.equal(r.amount, 12.47);
  assert.equal(r.totalStatus, "derived");
});
test("total : sans total ni couple payé/rendu → absent (jamais le plus gros montant, ni un paiement)", () => {
  assert.equal(total("LAIT 1,05\nPAIN 2,10\nVIANDE 15,90").amount, null);
  assert.equal(total("LAIT 1,05\nCB 12,47").amount, null, "un paiement n'est pas un total");
  assert.equal(total("LAIT 1,05\nESPECES 20,00").amount, null, "espèces sans rendu : on ne devine pas");
  assert.equal(total("LAIT 1,05\nPAIN 2,10").totalStatus, "absent");
  assert.equal(total("").totalStatus, "absent");
});
test("total : ni TVA, ni sous-total, ni pourcentage, ni prix unitaire", () => {
  const r = total("PAIN 1,20\nSOUS-TOTAL 11,00\nTVA 5,5% 0,60\nTVA 20% 1,10\nTOTAL TVA 1,70\nTOTAL A PAYER 12,47\nCB 12,47");
  assert.equal(r.amount, 12.47);
  assert.deepEqual(r.totalCandidates, [12.47]);
});
test("total : plusieurs taux de TVA dans un tableau récapitulatif (TOTAL HT TVA TTC)", () => {
  assert.equal(total("TOTAL 11,82 0,65 12,47").amount, 12.47, "dernier montant de la ligne = TTC");
});
test("total : deux totaux différents de même rang → conflit, rien n'est choisi à ta place", () => {
  const r = total("TOTAL 12,47\nTOTAL 14,00");
  assert.equal(r.amount, null);
  assert.equal(r.totalStatus, "conflict");
  assert.deepEqual(r.totalCandidates.sort(), [12.47, 14]);
});
test("total : le libellé le plus fort l'emporte (à payer > TOTAL)", () => {
  const r = total("TOTAL 14,00\nTOTAL A PAYER 12,47");
  assert.equal(r.amount, 12.47);
  assert.equal(r.totalStatus, "ok");
});
test("total : mêmes montants répétés ne sont pas un conflit", () => {
  const r = total("TOTAL TTC 12,47\nTOTAL A PAYER 12,47");
  assert.equal(r.amount, 12.47);
  assert.equal(r.totalStatus, "ok");
});
test("total : ticket de caisse existant (non-régression)", () => {
  const r = parseReceipt("CARREFOUR CITY\n14/10/2026 18:42\nLAIT 1,05\nSOUS-TOTAL 2,00\nTVA 0,10\nTOTAL A PAYER 12,47\nCB 12,47");
  assert.equal(r.amount, 12.47); assert.equal(r.date, "2026-10-14"); assert.equal(r.store, "CARREFOUR CITY");
});

// ---------------------------------------------------------------- date
test("date : formats valides", () => {
  assert.equal(parseReceipt("14/10/2026 18:42").date, "2026-10-14");
  assert.equal(parseReceipt("14.10.2026").date, "2026-10-14");
  assert.equal(parseReceipt("14-10-26").date, "2026-10-14");
  assert.equal(parseReceipt("2026-10-14").date, "2026-10-14");
  assert.equal(parseReceipt("Le 1/2/2026 à 10:05").date, "2026-02-01");
});
test("date : confusions O/0, l/1 dans une date", () => {
  assert.equal(parseReceipt("14/1O/2026").date, "2026-10-14");
  assert.equal(parseReceipt("l4/10/2O26").date, "2026-10-14");
});
test("date : date + heure sur la même ligne", () => {
  const r = parseReceipt("14/10/2026 18:42:07");
  assert.equal(r.date, "2026-10-14"); assert.equal(r.dateStatus, "ok");
});
test("date : invalide ou absente → null, avec statut", () => {
  assert.equal(parseReceipt("31/02/2026").date, null);
  assert.equal(parseReceipt("31/02/2026").dateStatus, "invalid");
  assert.equal(parseReceipt("45/13/2026").date, null);
  assert.equal(parseReceipt("TOTAL 12,47").date, null);
  assert.equal(parseReceipt("TOTAL 12,47").dateStatus, "none");
});
test("date : un numéro de carte, de transaction ou une heure n'est pas une date", () => {
  assert.equal(parseReceipt("CARTE XXXX 12/10/22 8412\nTRANSACTION 1234567890\nHEURE 18:42").date, null);
  assert.equal(parseReceipt("18.42.10").date, null);
  assert.equal(parseReceipt("N 123456789012").date, null);
});
test("date : deux dates différentes → ambiguë", () => {
  const r = parseReceipt("14/10/2026\nECHANGE AVANT LE 14/11/2026");
  assert.equal(r.dateStatus, "ambiguous");
});

// ---------------------------------------------------------------- magasin
test("magasin : enseigne connue reconnue (même avec 0 pour O)", () => {
  assert.equal(parseReceipt("LIDL\n12 rue X\nPAIN 1,00").storeConfidence, "high");
  assert.equal(parseReceipt("CARREF0UR MARKET\nPAIN 1,00").storeConfidence, "high");
  assert.equal(parseReceipt("E.LECLERC\nPAIN 1,00").store, "E.LECLERC");
});
test("magasin : une enseigne dans un nom de produit n'est pas le magasin", () => {
  const r = parseReceipt("TICKET\nPAIN 1,00\nYAOURT CARREFOUR BIO 2,00");
  assert.equal(r.storeConfidence === "high", false);
});
test("magasin : inconnu → confiance basse ; jamais « première ligne » par défaut quand ce n'est pas un nom", () => {
  const a = parseReceipt("BOULANGERIE DU COIN\nPAIN 1,00");
  assert.equal(a.store, "BOULANGERIE DU COIN"); assert.equal(a.storeConfidence, "low");
  const b = parseReceipt("TICKET DE CAISSE\n12 RUE DES LILAS\n75011\nPAIN 1,00");
  assert.equal(b.store, ""); assert.equal(b.storeConfidence, "none");
  const c = parseReceipt("TOTAL 12,47");
  assert.equal(c.store, ""); assert.equal(c.storeConfidence, "none");
});

// ---------------------------------------------------------------- articles
const items = (t: string) => parseReceiptItems(t);
test("articles : plusieurs lignes simples", () => {
  const it = items("CARREFOUR\nLAIT 1,05\nPAIN 1,85\nBEURRE 2,10\nTOTAL 5,00");
  assert.deepEqual(it.map((i) => [i.name, i.price]), [["Lait", 1.05], ["Pain", 1.85], ["Beurre", 2.1]]);
  assert.ok(it.every((i) => i.kind === "item" && i.confidence === "high" && i.qty === 1));
});
test("articles : prix sur la ligne suivante (confiance moyenne)", () => {
  const it = items("BEURRE DEMI SEL\n2,10\nLAIT 1,05");
  assert.equal(it.length, 2);
  assert.equal(it[0].name, "Beurre demi sel"); assert.equal(it[0].price, 2.1);
  assert.deepEqual(it[0].flags, ["price_next_line"]); assert.equal(it[0].confidence, "medium");
});
test("articles : quantité « 2 x 1,05 » (x, ×, *), sur une ligne ou sur la ligne suivante", () => {
  for (const sep of ["x", "×", "X", "*"]) {
    const it = items(`YAOURT\n2 ${sep} 1,05    2,10`);
    assert.equal(it.length, 1, sep);
    assert.deepEqual([it[0].name, it[0].qty, it[0].unitPrice, it[0].price], ["Yaourt", 2, 1.05, 2.1], sep);
  }
  const inline = items("YAOURT 2 x 1,05   2,10");
  assert.deepEqual([inline[0].name, inline[0].qty, inline[0].price], ["Yaourt", 2, 2.1]);
  const only = items("YAOURT\n3 x 1,05");
  assert.equal(only[0].price, 3.15); assert.ok(only[0].flags.includes("qty_computed"));
});
test("articles : quantité collée au nom « x4 »", () => {
  const it = items("YAOURT NATURE x4     2,40");
  assert.deepEqual([it[0].name, it[0].qty, it[0].price, it[0].unitPrice], ["Yaourt nature", 4, 2.4, 0.6]);
});
test("articles : au poids « 0,345 kg x 3,20 €/kg »", () => {
  const it = items("JAMBON\n0,345 kg x 3,20 €/kg   1,10\nPOMMES\n0,845 kg x 2,49 EUR/kg     2,10");
  assert.deepEqual(it.map((i) => [i.name, i.weight, i.unitPrice, i.price, i.qty]), [["Jambon", 0.345, 3.2, 1.1, 1], ["Pommes", 0.845, 2.49, 2.1, 1]]);
  assert.ok(it.every((i) => i.confidence === "high"));
});
test("articles : poids incohérent → drapeau, ligne gardée", () => {
  const it = items("JAMBON\n0,345 kg x 3,20 €/kg   9,10");
  assert.equal(it[0].price, 9.1); assert.ok(it[0].flags.includes("qty_incoherent")); assert.equal(it[0].confidence, "low");
});
test("articles : remises (négatif, suffixe -, mot-clé) ; pas comptées comme des produits", () => {
  const it = items("LAIT 1,05\nREMISE FIDELITE -0,50\nPAIN 1,00\nPROMO 0,20-\nSOUS-TOTAL 1,35");
  assert.deepEqual(it.map((i) => [i.kind, i.price]), [["item", 1.05], ["discount", -0.5], ["item", 1], ["discount", -0.2]]);
  assert.equal(itemsTotalCents(it).cents, 135);
});
test("articles : remise après le sous-total conservée, mais pas le paiement", () => {
  const it = items("LAIT 1,05\nPAIN 1,00\nSOUS-TOTAL 2,05\nREMISE FIDELITE -0,50\nTOTAL A PAYER 1,55\nCB 1,55");
  assert.deepEqual(it.map((i) => i.price), [1.05, 1, -0.5]);
  assert.equal(totalDivergence(it, 1.55), 0);
});
test("articles : lignes TVA, total, paiement, date, transaction, pourcentages exclues", () => {
  const it = items([
    "CARREFOUR", "14/10/2026 18:42", "CAISSE 03 TRANSACTION 004512", "LAIT 1,05",
    "SOUS-TOTAL 1,05", "TVA 5,5% 0,06", "TOTAL A PAYER 1,05", "CB SANS CONTACT 1,05", "CARTE XXXX XXXX 1234", "ESPECES 20,00", "RENDU 18,95", "5,5%",
  ].join("\n"));
  assert.deepEqual(it.map((i) => i.name), ["Lait"]);
});
test("articles : nom illisible → ligne gardée, confiance basse", () => {
  const it = items("L@#T  1,35\n#?  2,00");
  assert.equal(it.length, 2);
  assert.ok(it.every((i) => i.confidence === "low"));
  assert.ok(it[1].flags.some((f) => f === "name_unclear" || f === "name_missing"));
});
test("articles : prix ambigu → ligne gardée sans prix, jamais inventé", () => {
  const it = items("CAFE 1.234\nLAIT 1,05");
  assert.equal(it[0].price, null); assert.ok(it[0].flags.includes("price_ambiguous")); assert.equal(it[0].confidence, "low");
  assert.equal(it[1].price, 1.05);
  assert.deepEqual(itemsTotalCents(it), { cents: 105, unknown: 1 });
});
test("articles : prix corrigé par l'OCR (O→0) → confiance moyenne ; un seul chiffre décimal → basse", () => {
  const a = items("LAIT 1,O5");
  assert.equal(a[0].price, 1.05); assert.ok(a[0].flags.includes("price_repaired")); assert.equal(a[0].confidence, "medium");
  const b = items("LAIT 1,5");
  assert.equal(b[0].price, 1.5); assert.equal(b[0].confidence, "low");
});
test("articles : code-barres en tête et lettre de TVA en fin de ligne retirés du nom", () => {
  const it = items("3017620422003 NUTELLA 400G 3,20 A");
  assert.equal(it[0].name, "Nutella 400g"); assert.equal(it[0].price, 3.2);
});
test("articles : ticket vide, ticket sans article, métadonnées seules", () => {
  assert.deepEqual(items(""), []);
  assert.deepEqual(items("   \n\n  "), []);
  assert.deepEqual(items("CARREFOUR CITY\n12 RUE DES LILAS\n75011 PARIS\n14/10/2026 18:42\nTOTAL A PAYER 12,47\nCB 12,47\nMERCI DE VOTRE VISITE"), []);
  assert.equal(parseReceipt("").amount, null);
  assert.equal(parseReceipt("").storeConfidence, "none");
});
test("articles : ne lance jamais d'exception sur du texte aberrant", () => {
  for (const t of ["\u0000\u0001", "€€€€", "1,2,3,4,5", "-,--", "x x x x", "0,00", "((((", "9".repeat(5000), "A ".repeat(3000) + "1,00"]) {
    assert.doesNotThrow(() => { parseReceipt(t); parseReceiptItems(t); });
  }
});
test("articles : sortie réelle de Tesseract sur un ticket synthétique (carrefour_clean, PSM 6, image préparée)", () => {
  const ocr = "CARREFOUR CITY\n\n12 RUE DES LILAS\n\n75011 PARIS\n\n14/10/2026 18:42\n\nLAIT DEMI ECREME 1L        1,05\nPAIN DE MIE COMPLET        1,85\n2 x 1,20\n\nYAOURT NATURE x4           2,40\nPOMMES GOLDEN\n\n0,845 kg x 2,49 EUR/kg     2,10\nREMISE FIDELITE           -0,50\nSOUS-TOTAL                 7,40\nTVA 5,5% 0,38\n\nTOTAL A PAYER              6,90\nESPECES                   20,00\nRENDU                     13,10\nMERCI DE VOTRE VISITE\n";
  const r = parseReceipt(ocr), it = parseReceiptItems(ocr);
  assert.deepEqual([r.amount, r.date, r.store, r.totalStatus], [6.9, "2026-10-14", "CARREFOUR CITY", "ok"]);
  assert.equal(it.length, 5);
  assert.equal(totalDivergence(it, r.amount), 0, "somme des lignes = total du ticket");
});
test("articles : sortie réelle (petit_skew) — « 3, 60 » avec espace", () => {
  const ocr = "BOULANGERIE DU COIN\n\n16/10/2026 08:20\n\nCROISSANT                 1,20\nPAIN AU CHOCOLAT          1,30\nBAGUETTE                  1,10\nTOTAL                     3, 60\nESPECES                   5,00\nRENDU                     1,40\n";
  assert.equal(parseReceipt(ocr).amount, 3.6);
  assert.equal(parseReceiptItems(ocr).length, 3);
});

// ---------------------------------------------------------------- rapprochement avec la liste
test("sameProduct : prudent", () => {
  assert.ok(sameProduct("Lait demi-écrémé 1L", "LAIT DEMI ECREME"));
  assert.ok(sameProduct("Pâtes", "pates"));
  assert.ok(sameProduct("Yaourt nature", "Yaourt nature x4 bio"));
  assert.equal(sameProduct("Lait", "Lait de coco"), false, "un seul mot : pas d'inclusion");
  assert.equal(sameProduct("Beurre", "Beurre de cacahuète"), false);
  assert.equal(sameProduct("", "Lait"), false);
  assert.equal(productKey("Lait 1L (bio)"), "lait bio");
});
const g = (id: string, name: string, price = 0, checked = false): GroceryItem => ({ id, name, aisle: "Épicerie", qty: "", checked, price });
test("liste : article présent coché sans toucher au prix habituel ; absent ajouté coché", () => {
  let n = 0; const id = () => `n${++n}`;
  const r = applyReceiptToGroceries([g("a", "Lait", 1.2), g("b", "Pâtes", 0), g("c", "Riz", 2)], [
    { name: "LAIT", price: 1.05, qty: 1, aisle: "Frais" }, { name: "Pates", price: 0.89, qty: 1, aisle: "Épicerie" }, { name: "Chocolat", price: 2.5, qty: 2, aisle: "Épicerie" },
  ], id);
  assert.equal(r.matched, 2); assert.equal(r.added, 1);
  assert.deepEqual(r.groceries.map((x) => [x.name, x.checked, x.price]), [["Lait", true, 1.2], ["Pâtes", true, 0.89], ["Riz", false, 2], ["Chocolat", true, 2.5]]);
  assert.equal(r.groceries[3].qty, "x2");
});
test("liste : rejouer le même ticket ne crée aucun doublon", () => {
  let n = 0; const id = () => `n${++n}`;
  const lines = [{ name: "Lait", price: 1.05, qty: 1, aisle: "Frais" as const }, { name: "Chocolat", price: 2.5, qty: 1, aisle: "Épicerie" as const }, { name: "Lait", price: 1.05, qty: 1, aisle: "Frais" as const }];
  const once = applyReceiptToGroceries([], lines, id);
  assert.equal(once.groceries.length, 3, "deux « Lait » sur le ticket = deux achats");
  const twice = applyReceiptToGroceries(once.groceries, lines, id);
  assert.equal(twice.groceries.length, 3);
  assert.equal(twice.added, 0);
});
test("liste : lignes sans nom ignorées ; liste vide acceptée", () => {
  const r = applyReceiptToGroceries([], [{ name: "  ", price: 1, qty: 1, aisle: "Frais" }], () => "x");
  assert.deepEqual(r.groceries, []);
});

// ---------------------------------------------------------------- intégration (reducer)
const base = (): AppState => blank({ name: "Test" }, 600);
test("Courses : ticket → articles cochés → validation = une seule dépense, produits appris", () => {
  let s = base();
  s = reducer(s, { type: "grocery/add", item: g("a", "Lait", 1.2) });
  s = reducer(s, { type: "grocery/fromReceipt", lines: [{ name: "Lait", price: 1.05, qty: 1, aisle: "Frais" }, { name: "Chocolat", price: 2.5, qty: 1, aisle: "Épicerie" }] });
  assert.equal(s.groceries.filter((x) => x.checked).length, 2);
  s = reducer(s, { type: "grocery/checkout", amount: 12.47, date: "2026-10-14", ticket: receiptFingerprint("2026-10-14", 12.47) });
  const ex = s.budget.expenses;
  assert.equal(ex.length, 1);
  assert.deepEqual([ex[0].amount, ex[0].category, ex[0].ticket], [12.47, "Courses", "2026-10-14|1247"]);
  assert.deepEqual(ex[0].items, ["Lait", "Chocolat"]);
  assert.equal(s.groceries.length, 0);
  assert.ok(s.products.some((p) => p.name === "Chocolat"));
});
test("Courses : le total n'est pas enregistré deux fois (fromReceipt ne crée aucune dépense)", () => {
  let s = base();
  const before = s.budget.expenses.length;
  s = reducer(s, { type: "grocery/fromReceipt", lines: [{ name: "Lait", price: 1.05, qty: 1, aisle: "Frais" }] });
  s = reducer(s, { type: "grocery/fromReceipt", lines: [{ name: "Lait", price: 1.05, qty: 1, aisle: "Frais" }] });
  assert.equal(s.budget.expenses.length, before);
  assert.equal(s.groceries.length, 1);
});
test("Courses : validation possible même si des produits du ticket n'ont pas été identifiés (liste inchangée, montant payé)", () => {
  let s = base();
  s = reducer(s, { type: "grocery/add", item: { ...g("a", "Pain"), checked: true } });
  s = reducer(s, { type: "grocery/fromReceipt", lines: [] });
  s = reducer(s, { type: "grocery/checkout", amount: 8.4, date: "2026-10-14" });
  assert.equal(s.budget.expenses.length, 1); assert.equal(s.budget.expenses[0].amount, 8.4);
  assert.equal(s.budget.expenses[0].ticket, undefined);
});
test("Courses : annuler le scanner (aucune action) ne change rien ; OCR en erreur non plus", () => {
  const s = base();
  assert.deepEqual(reducer(s, { type: "grocery/fromReceipt", lines: [] }), s);
});
test("Courses : validation sans article coché ni montant valide → aucune dépense (comportement conservé)", () => {
  const s = reducer(base(), { type: "grocery/checkout", amount: 5, date: "2026-10-14" });
  assert.equal(s.budget.expenses.length, 0);
});
test("Budget : une dépense « ticket » conserve ses articles et son empreinte ; expense/add inchangé", () => {
  const s = reducer(base(), { type: "expense/add", expense: { id: "e1", date: "2026-10-14", amount: 12.47, category: "Courses", label: "CARREFOUR CITY", source: "ticket", items: ["Lait"], ticket: "2026-10-14|1247" } });
  assert.deepEqual([s.budget.expenses[0].source, s.budget.expenses[0].items, s.budget.expenses[0].ticket], ["ticket", ["Lait"], "2026-10-14|1247"]);
});
test("empreinte de ticket : date et centimes, vide si inconnus", () => {
  assert.equal(receiptFingerprint("2026-10-14", 12.47), "2026-10-14|1247");
  assert.equal(receiptFingerprint(null, 12.47), "");
  assert.equal(receiptFingerprint("2026-10-14", null), "");
});

// ---------------------------------------------------------------- préparation d'image
test("targetScale : grand côté ramené vers 2000 px seulement hors de [1400 ; 2400]", () => {
  assert.equal(targetScale(1800, 1000), 1);
  assert.equal(targetScale(4000, 3000), 0.5);
  assert.equal(targetScale(700, 500), 2000 / 700);
  assert.equal(targetScale(1400, 100), 1);
  assert.equal(targetScale(2401, 100), 2000 / 2401);
});
test("flattenGray : un éclairage inégal est aplati, le texte reste plus sombre que le fond", () => {
  const w = 160, h = 120, g = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const light = 255 - 110 * (x / w);                       // dégradé : le côté droit est nettement plus sombre
    const ink = (y % 20 < 4 && x > 20 && x < 140) ? 0.45 : 1; // « lignes de texte »
    g[y * w + x] = Math.round(light * ink);
  }
  const bgSpread = (a: Uint8ClampedArray) => { const left: number[] = [], right: number[] = []; for (let y = 8; y < h; y += 20) { left.push(a[y * w + 4]); right.push(a[y * w + w - 4]); } const m = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length; return Math.abs(m(left) - m(right)); };
  const out = flattenGray(g, w, h);
  assert.ok(bgSpread(g) > 80, "avant : écart d'éclairage gauche/droite important");
  assert.ok(bgSpread(out) < bgSpread(g) / 2, `après : écart réduit (${bgSpread(out).toFixed(1)})`);
  const textPx = out[1 * w + 80], bgPx = out[10 * w + 80];
  assert.ok(textPx < bgPx - 60, "le texte reste bien plus sombre que le fond");
  assert.equal(out.length, g.length);
});
test("flattenGray : image uniforme renvoyée telle quelle (pas de bruit amplifié)", () => {
  const g = new Uint8ClampedArray(50 * 50).fill(200);
  assert.deepEqual([...flattenGray(g, 50, 50)], [...g]);
});
test("toGray : luminance", () => {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  assert.deepEqual([...toGray(px, 2, 1)], [255, 0]);
});
