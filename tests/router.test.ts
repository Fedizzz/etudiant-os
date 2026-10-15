import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routePath, safeNext, isPrivate } from "../src/router.ts";
const B = "/etudiant-os/";
test("routes publiques et privées", () => {
  assert.deepEqual(parseRoute("/etudiant-os/", B), { name: "landing" });
  assert.deepEqual(parseRoute("/etudiant-os/login", B), { name: "login" });
  assert.deepEqual(parseRoute("/etudiant-os/reset-password/", B), { name: "reset" });
  assert.deepEqual(parseRoute("/etudiant-os/app", B), { name: "app", view: "dashboard" });
  assert.deepEqual(parseRoute("/etudiant-os/app/menage", B), { name: "app", view: "chores" });
  assert.deepEqual(parseRoute("/etudiant-os/app/inconnu", B), { name: "notfound" });
  assert.deepEqual(parseRoute("/etudiant-os/n-importe-quoi", B), { name: "notfound" });
  assert.equal(isPrivate(parseRoute("/etudiant-os/app/budget", B)), true);
  assert.equal(isPrivate(parseRoute("/etudiant-os/login", B)), false);
});
test("aller-retour chemin ↔ route", () => {
  for (const p of ["/etudiant-os/", "/etudiant-os/signup", "/etudiant-os/app", "/etudiant-os/app/planning", "/etudiant-os/app/sommeil", "/etudiant-os/confidentialite"]) assert.equal(routePath(parseRoute(p, B), B), p);
  assert.equal(routePath({ name: "app", view: "settings" }, "/"), "/app/settings");
});
test("redirection après connexion limitée à l'application", () => {
  assert.equal(safeNext("/etudiant-os/app/budget", B), "/etudiant-os/app/budget");
  assert.equal(safeNext("https://evil.example", B), "/etudiant-os/app");
  assert.equal(safeNext("//evil.example/app", B), "/etudiant-os/app");
  assert.equal(safeNext("/etudiant-os/login", B), "/etudiant-os/app");
  assert.equal(safeNext(null, B), "/etudiant-os/app");
});
