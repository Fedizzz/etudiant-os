import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBug, validateHelp, validateAttachment, techInfo, type BugForm } from "../src/supportModel.ts";

const okBug: BugForm = { category: "display", subject: "Bouton invisible", description: "Le bouton Ajouter disparaît.", steps: "", expected: "", observed: "", frequency: "often", module: "budget", impact: "medium", includeTech: true };
test("validation du signalement", () => {
  assert.deepEqual(validateBug(okBug), {});
  const e = validateBug({ ...okBug, category: "", subject: " a ", description: "court", frequency: "", impact: "x", steps: "x".repeat(3001) });
  assert.deepEqual(Object.keys(e).sort(), ["category", "description", "frequency", "impact", "steps", "subject"]);
  assert.match(validateBug({ ...okBug, subject: "x".repeat(121) }).subject!, /120/);
  assert.match(validateBug({ ...okBug, description: "x".repeat(5001) }).description!, /5000/);
});
test("validation de la demande d'aide", () => {
  assert.deepEqual(validateHelp({ category: "usage", subject: "Exporter", description: "Comment exporter mes données ?", module: "", urgency: "normal" }), {});
  assert.ok(validateHelp({ category: "display", subject: "Exporter", description: "Comment exporter mes données ?", module: "", urgency: "normal" }).category, "catégorie de bug acceptée pour une aide");
  assert.ok(validateHelp({ category: "usage", subject: "Ex", description: "Comment exporter mes données ?", module: "zz", urgency: "?" }).urgency);
});
test("pièces jointes : formats et taille", () => {
  assert.equal(validateAttachment({ type: "image/png", size: 1000, name: "capture.png" }), null);
  assert.equal(validateAttachment({ type: "image/jpeg", size: 1000, name: "photo.JPG" }), null);
  assert.match(validateAttachment({ type: "image/svg+xml", size: 100, name: "a.svg" })!, /Format/);
  assert.match(validateAttachment({ type: "application/pdf", size: 100, name: "a.pdf" })!, /Format/);
  assert.match(validateAttachment({ type: "image/png", size: 100, name: "a.png.exe" })!, /Format/);
  assert.match(validateAttachment({ type: "image/png", size: 6 * 1048576, name: "a.png" })!, /5 Mo/);
});
test("informations techniques : limitées et sans données privées", () => {
  const t = techInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "/etudiant-os/app/budget?token=abc#access_token=xyz", "2.0.0", new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(t, { browser: "Safari 17", os: "iOS", appVersion: "2.0.0", route: "/etudiant-os/app/budget", reportedAt: "2026-01-02T03:04:05.000Z" });
  assert.equal(techInfo("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0", "/", "1").browser, "Edge 120");
});
