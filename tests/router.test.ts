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
test("routes support et administration", () => {
  const id = "3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  assert.deepEqual(parseRoute("/etudiant-os/app/report-problem", B), { name: "support", page: "report" });
  assert.deepEqual(parseRoute("/etudiant-os/app/help", B), { name: "support", page: "help" });
  assert.deepEqual(parseRoute("/etudiant-os/app/requests", B), { name: "support", page: "requests" });
  assert.deepEqual(parseRoute(`/etudiant-os/app/requests/${id}`, B), { name: "support", page: "requests", id });
  assert.deepEqual(parseRoute("/etudiant-os/app/requests/pas-un-uuid", B), { name: "notfound" });
  assert.deepEqual(parseRoute("/etudiant-os/app/help/x", B), { name: "notfound" });
  assert.deepEqual(parseRoute("/etudiant-os/admin", B), { name: "admin", section: "dashboard" });
  assert.deepEqual(parseRoute(`/etudiant-os/admin/users/${id}`, B), { name: "admin", section: "users", id });
  assert.deepEqual(parseRoute(`/etudiant-os/admin/tickets/${id}`, B), { name: "admin", section: "tickets", id });
  assert.deepEqual(parseRoute(`/etudiant-os/admin/audit/${id}`, B), { name: "notfound" });
  assert.deepEqual(parseRoute("/etudiant-os/admin/inconnu", B), { name: "notfound" });
  for (const p of ["/etudiant-os/admin", "/etudiant-os/admin/users", `/etudiant-os/admin/tickets/${id}`, "/etudiant-os/app/help", `/etudiant-os/app/requests/${id}`]) {
    assert.equal(routePath(parseRoute(p, B), B), p); assert.equal(isPrivate(parseRoute(p, B)), true);
  }
  assert.equal(safeNext("/etudiant-os/admin/tickets", B), "/etudiant-os/admin/tickets");
  assert.equal(safeNext("/etudiant-os/administrateur-pirate", B), "/etudiant-os/app");
});
