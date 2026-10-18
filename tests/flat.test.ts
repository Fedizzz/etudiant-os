import test from "node:test";
import assert from "node:assert/strict";
import { balances, centsFromInput, settleUp, splitEqual } from "../src/flat.ts";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test("splitEqual : la somme des parts est toujours le montant", () => {
  assert.deepEqual(splitEqual(1000, ["a", "b"]), { a: 500, b: 500 });
  assert.deepEqual(splitEqual(1000, ["a", "b", "c"]), { a: 334, b: 333, c: 333 });
  assert.deepEqual(splitEqual(1, ["a", "b", "c"]), { a: 1, b: 0, c: 0 });
  for (let cents = 1; cents < 400; cents += 7) for (let n = 1; n <= 8; n++) assert.equal(sum(splitEqual(cents, Array.from({ length: n }, (_, i) => "u" + i))), cents);
});
test("splitEqual : entrées invalides", () => {
  assert.deepEqual(splitEqual(0, ["a"]), {});
  assert.deepEqual(splitEqual(100, []), {});
  assert.deepEqual(splitEqual(10.5, ["a"]), {});
  assert.deepEqual(splitEqual(100, ["a", "a"]), { a: 100 });
});
test("balances : A paie 30 € pour 3, B paie 9 € pour 3", () => {
  const b = balances([
    { paid_by: "a", amount_cents: 3000, shares: splitEqual(3000, ["a", "b", "c"]) },
    { paid_by: "b", amount_cents: 900, shares: splitEqual(900, ["a", "b", "c"]) },
  ]);
  assert.deepEqual(b, { a: 3000 - 1000 - 300, b: 900 - 1000 - 300, c: -1000 - 300 });
  assert.equal(sum(b), 0);
});
test("settleUp : remet tous les soldes à zéro avec peu de virements", () => {
  const b = balances([
    { paid_by: "a", amount_cents: 3000, shares: splitEqual(3000, ["a", "b", "c"]) },
    { paid_by: "b", amount_cents: 900, shares: splitEqual(900, ["a", "b", "c"]) },
  ]);
  const t = settleUp(b);
  assert.ok(t.length <= 2);
  const after = { ...b };
  for (const x of t) { after[x.from] += x.cents; after[x.to] -= x.cents; assert.ok(x.cents > 0); }
  assert.ok(Object.values(after).every((v) => v === 0));
});
test("settleUp : rien à rembourser quand tout est équilibré", () => {
  assert.deepEqual(settleUp({}), []);
  assert.deepEqual(settleUp({ a: 0, b: 0 }), []);
});
test("un remboursement (payment) solde la dette", () => {
  const exp = [{ paid_by: "a", amount_cents: 1000, shares: { a: 500, b: 500 } }];
  assert.deepEqual(settleUp(balances(exp)), [{ from: "b", to: "a", cents: 500 }]);
  const after = [...exp, { paid_by: "b", amount_cents: 500, shares: { a: 500 } }];
  assert.deepEqual(settleUp(balances(after)), []);
});
test("settleUp : plusieurs créanciers et débiteurs, aucun centime perdu", () => {
  const bal = { a: 1234, b: -500, c: -734, d: 0 };
  const t = settleUp(bal);
  assert.equal(t.reduce((s, x) => s + x.cents, 0), 1234);
});
test("centsFromInput", () => {
  assert.equal(centsFromInput("12,5"), 1250);
  assert.equal(centsFromInput("12.50"), 1250);
  assert.equal(centsFromInput(" 8 "), 800);
  assert.equal(centsFromInput("0"), null);
  assert.equal(centsFromInput("-3"), null);
  assert.equal(centsFromInput("1,234"), null);
  assert.equal(centsFromInput("abc"), null);
});
