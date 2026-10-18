import test from "node:test";
import assert from "node:assert/strict";
import { balances, centsFromInput, flatChoreAssignee, flatChoreOn, settleUp, splitEqual, virtualChores } from "../src/flat.ts";
import { choreAssignee, choreOnTimeStats, planFor, blank, xpOf, activeDays, reducer, withoutShared } from "../src/core.ts";
import type { FlatChore } from "../src/flat.ts";

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

const chore = (p: Partial<FlatChore> = {}): FlatChore => ({ id: "c", flat_id: "f", name: "Poubelles", recurrence: "weekly", day: 2, due_on: null, minutes: 10, rotation: ["a", "b"], created_by: "a", ...p });
test("corvée commune hebdomadaire : seulement le bon jour, rotation une semaine sur deux", () => {
  const wed1 = new Date(2026, 9, 14), wed2 = new Date(2026, 9, 21), thu = new Date(2026, 9, 15);  // mercredis consécutifs
  assert.equal(flatChoreOn(chore(), wed1), true);
  assert.equal(flatChoreOn(chore(), thu), false);
  const x = flatChoreAssignee(chore(), wed1, ["a", "b"]), y = flatChoreAssignee(chore(), wed2, ["a", "b"]);
  assert.ok(x && y && x !== y, "deux colocataires se relaient");
  assert.equal(flatChoreAssignee(chore(), new Date(2026, 9, 28), ["a", "b"]), x, "retour au premier au bout de deux semaines");
});
test("corvée commune : quotidienne, ponctuelle, bimensuelle", () => {
  assert.equal(flatChoreOn(chore({ recurrence: "daily" }), new Date(2026, 9, 17)), true);
  const once = chore({ recurrence: "once", due_on: "2026-10-20", rotation: ["b"] });
  assert.equal(flatChoreOn(once, new Date(2026, 9, 20)), true);
  assert.equal(flatChoreOn(once, new Date(2026, 9, 21)), false);
  assert.equal(flatChoreAssignee(once, new Date(2026, 9, 20), ["a", "b"]), "b");
  const bi = chore({ recurrence: "biweekly" });
  assert.notEqual(flatChoreOn(bi, new Date(2026, 9, 14)), flatChoreOn(bi, new Date(2026, 9, 21)));
});
test("corvée commune : un ancien membre est retiré de la rotation ; sans personne, pas de responsable", () => {
  const c = chore({ recurrence: "daily", rotation: ["a", "gone"] });
  for (let d = 1; d <= 6; d++) assert.equal(flatChoreAssignee(c, new Date(2026, 9, d), ["a"]), "a");
  assert.equal(flatChoreAssignee(chore({ rotation: [] }), new Date(2026, 9, 14), ["a", "b"]), null);
  assert.equal(flatChoreAssignee(chore({ rotation: ["gone"] }), new Date(2026, 9, 14), ["a"]), null);
});

const FLAT = { me: "a", members: [{ user_id: "a", display_name: "Alice", role: "owner" as const, left: false }, { user_id: "b", display_name: "Bob", role: "member" as const, left: false }] };
test("virtualChores : « Moi » pour soi, prénom pour les autres, fait par visible", () => {
  const v = virtualChores(FLAT, [chore({ recurrence: "daily" })], [{ chore_id: "c", flat_id: "f", done_on: "2026-10-14", done_by: "b" }]);
  assert.equal(v.length, 1);
  assert.equal(v[0].id, "flat:c"); assert.equal(v[0].shared, true);
  assert.deepEqual(v[0].assignees, ["Moi", "Bob"]);
  assert.deepEqual(v[0].done, ["2026-10-14"]);
  assert.equal(v[0].doneBy?.["2026-10-14"], "Bob");
  const who = new Set([0, 1, 2, 3].map((i) => choreAssignee(v[0], new Date(2026, 9, 10 + i))));
  assert.deepEqual([...who].sort(), ["Bob", "Moi"]);
});
test("virtualChores : l'ancien membre disparaît de la rotation ; le nom « Moi » d'un colocataire ne prête pas à confusion", () => {
  const f = { me: "a", members: [...FLAT.members, { user_id: "x", display_name: "Moi", role: "member" as const, left: false }, { user_id: "gone", display_name: "Zoé", role: "member" as const, left: true }] };
  const v = virtualChores(f, [chore({ rotation: ["a", "gone", "x"] })], []);
  assert.deepEqual(v[0].assignees, ["Moi", "Moi (colocataire)"]);
});
test("planning : la corvée commune apparaît à son tour, pas quand c'est le tour d'un autre ni quand elle est faite", () => {
  const base0 = blank({ name: "T" }, 600);
  const today = "2026-10-14";   // mercredi
  const v = virtualChores(FLAT, [chore({ recurrence: "daily", rotation: ["a"], minutes: 20 })], []);
  const has = (st: typeof base0, date: string) => planFor(st, date, today).blocks.some((b) => b.kind === "chore" && b.refId === "flat:c");
  assert.equal(has({ ...base0, chores: v }, today), true, "à faire aujourd'hui, pour moi");
  const other = virtualChores(FLAT, [chore({ recurrence: "daily", rotation: ["b"] })], []);
  assert.equal(has({ ...base0, chores: other }, today), false, "tour de Bob");
  const doneV = virtualChores(FLAT, [chore({ recurrence: "daily", rotation: ["a"] })], [{ chore_id: "c", flat_id: "f", done_on: today, done_by: "b" }]);
  assert.equal(has({ ...base0, chores: doneV }, today), false, "déjà faite par Bob");
});
test("statistiques personnelles : les corvées communes ne comptent pas", () => {
  const base0 = blank({ name: "T" }, 600);
  const v = virtualChores(FLAT, [chore({ recurrence: "daily", rotation: ["a"] })], [{ chore_id: "c", flat_id: "f", done_on: "2026-10-13", done_by: "a" }]);
  const st = { ...base0, chores: v };
  assert.equal(xpOf(st), xpOf(base0));
  assert.equal(activeDays(st).size, activeDays(base0).size);
  assert.deepEqual(choreOnTimeStats(v, "2026-10-14"), { ok: 0, late: 0 });
});

test("les corvées communes ne sont jamais enregistrées dans l'état personnel (replace / export)", () => {
  const base0 = blank({ name: "T" }, 600);
  const v = virtualChores(FLAT, [chore({ recurrence: "daily", rotation: ["a"] })], []);
  const merged = { ...base0, chores: [...base0.chores, ...v] };
  assert.equal(withoutShared(merged).chores.length, base0.chores.length);
  assert.equal(reducer(base0, { type: "replace", state: merged }).chores.some((c) => c.shared), false);
  assert.equal(withoutShared(base0), base0, "sans corvée commune : même objet, rien ne change");
});
test("sans appartement : aucune corvée ajoutée au planning ni aux statistiques", () => {
  const base0 = blank({ name: "T" }, 600);
  assert.deepEqual(virtualChores(FLAT, [], []), []);
  assert.equal(xpOf(base0), xpOf({ ...base0, chores: [...base0.chores, ...virtualChores(FLAT, [], [])] }));
});
