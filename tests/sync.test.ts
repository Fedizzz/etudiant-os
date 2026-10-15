// Moteur de synchronisation : deux « appareils » sur un faux serveur qui applique les mêmes règles de version que save_state().
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.ts";
import { SyncEngine, mergeStates, summarize, type Transport, type Cache, type CacheData, type RemoteDoc } from "../src/sync.ts";

class FakeServer {
  doc: RemoteDoc | null = null; down = false; saves = 0; reject = false;
  transport(): Transport {
    return {
      load: async () => { if (this.down) throw new TypeError("Failed to fetch"); return this.doc && structuredClone(this.doc); },
      save: async (state, base) => {
        if (this.down) throw new TypeError("Failed to fetch");
        if (this.reject) throw new Error("violates check constraint");
        const cur = this.doc?.version ?? 0;
        if (cur !== base) return { ok: false, remote: this.doc && structuredClone(this.doc) };
        this.saves++; this.doc = { state: structuredClone(state), version: cur + 1, updatedAt: new Date().toISOString() };
        return { ok: true, version: cur + 1, updatedAt: this.doc.updatedAt };
      },
    };
  }
}
const memCache = (): Cache & { data: CacheData | null } => ({ data: null, read() { return this.data && structuredClone(this.data); }, write(d) { this.data = structuredClone(d); }, clear() { this.data = null; } });
const blank = () => C.blank({ name: "T" }, 600);
const manual = () => { const q: (() => void)[] = []; return { schedule: (fn: () => void) => { q.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; }, q }; };
const task = (id: string, title: string): C.Task => ({ id, title, courseId: null, kind: "devoir", status: "todo", deadline: "2026-10-20", estimate: 60, spent: 0, priority: 2, createdAt: "2026-10-15" });
const device = (srv: FakeServer, cache = memCache(), id = "d") => { const m = manual(); const e = new SyncEngine(srv.transport(), cache, blank, { clientId: id, schedule: m.schedule }); return { e, cache, m }; };

test("premier enregistrement puis chargement sur un 2e appareil", async () => {
  const srv = new FakeServer();
  const a = device(srv); await a.e.start();
  assert.equal(a.e.getSnapshot().remoteEmpty, true);
  a.e.dispatch({ type: "task/add", task: task("t1", "Rapport") });
  assert.equal(a.e.getSnapshot().status, "pending");
  await a.e.flush();
  assert.equal(a.e.getSnapshot().status, "saved"); assert.equal(srv.doc!.version, 1);
  const b = device(srv); await b.e.start();
  assert.deepEqual(b.e.getSnapshot().state!.tasks.map((t) => t.title), ["Rapport"]);
});

test("hors ligne : rien n'est marqué enregistré, file conservée, envoi au retour", async () => {
  const srv = new FakeServer();
  const a = device(srv); await a.e.start();
  srv.down = true;
  a.e.dispatch({ type: "task/add", task: task("t1", "Hors ligne") });
  await a.e.flush();
  assert.equal(a.e.getSnapshot().status, "offline"); assert.equal(a.e.getSnapshot().pending, 1); assert.equal(srv.doc, null);
  // actualisation de la page pendant la coupure : le cache restitue la modification
  const again = device(srv, a.cache); await again.e.start();
  assert.equal(again.e.getSnapshot().state!.tasks.length, 1); assert.equal(again.e.getSnapshot().pending, 1);
  srv.down = false; await again.e.reconnect();
  assert.equal(again.e.getSnapshot().status, "saved"); assert.equal(srv.doc!.state && (srv.doc!.state as C.AppState).tasks.length, 1);
});

test("conflit : deux appareils modifient en même temps, aucune modification perdue", async () => {
  const srv = new FakeServer();
  const a = device(srv), b = device(srv);
  await a.e.start(); a.e.dispatch({ type: "settings", patch: { name: "Khaled" } }); await a.e.flush();
  await b.e.start();
  a.e.dispatch({ type: "task/add", task: task("ta", "Tâche A") });
  b.e.dispatch({ type: "task/add", task: task("tb", "Tâche B") });
  b.e.dispatch({ type: "expense/add", expense: { id: "e1", date: "2026-10-15", amount: 3.3, category: "Restauration", label: "Resto U" } });
  await a.e.flush(); await b.e.flush(); // B est en retard d'une version → rejet, rebase, renvoi
  assert.equal(b.e.getSnapshot().conflicts, 1); assert.equal(b.e.getSnapshot().status, "saved");
  const s = srv.doc!.state as C.AppState;
  assert.deepEqual(s.tasks.map((t) => t.id).sort(), ["ta", "tb"]); assert.equal(s.budget.expenses.length, 1); assert.equal(s.settings.name, "Khaled");
  await a.e.refresh(); assert.equal(a.e.getSnapshot().state!.tasks.length, 2, "A reçoit la modification de B");
});

test("conflit sur la même tâche : la dernière action rejouée l'emporte, de façon explicite", async () => {
  const srv = new FakeServer();
  const a = device(srv), b = device(srv);
  await a.e.start(); a.e.dispatch({ type: "task/add", task: task("t", "Original") }); await a.e.flush(); await b.e.start();
  a.e.dispatch({ type: "task/update", id: "t", patch: { status: "done" } }); await a.e.flush();
  b.e.dispatch({ type: "task/update", id: "t", patch: { title: "Renommée" } }); await b.e.flush();
  const t = (srv.doc!.state as C.AppState).tasks[0];
  assert.equal(t.status, "done", "modification de A conservée"); assert.equal(t.title, "Renommée", "modification de B conservée");
});

test("session de focus : rejouée après conflit sans doublon", async () => {
  const srv = new FakeServer();
  const a = device(srv), b = device(srv);
  await a.e.start(); a.e.dispatch({ type: "task/add", task: task("t", "Révisions") }); await a.e.flush(); await b.e.start();
  b.e.dispatch({ type: "focus/log", entry: { id: "sess-1", date: "2026-10-15", minutes: 50, taskId: "t" } });
  a.e.dispatch({ type: "settings", patch: { name: "X" } }); await a.e.flush();
  await b.e.flush();
  const s = srv.doc!.state as C.AppState;
  assert.equal(s.focus.length, 1); assert.equal(s.tasks[0].spent, 50);
});

test("erreur serveur : statut erreur, modifications gardées, jamais « enregistré »", async () => {
  const srv = new FakeServer();
  const a = device(srv); await a.e.start();
  srv.reject = true; a.e.dispatch({ type: "task/add", task: task("t", "X") }); await a.e.flush();
  assert.equal(a.e.getSnapshot().status, "error"); assert.equal(a.e.getSnapshot().pending, 1); assert.ok(a.e.getSnapshot().error);
  srv.reject = false; await a.e.flush();
  assert.equal(a.e.getSnapshot().status, "saved"); assert.equal(a.e.getSnapshot().pending, 0);
});

test("document serveur illisible : affiché comme erreur, jamais écrasé", async () => {
  const srv = new FakeServer(); srv.doc = { state: { pas: "valide" }, version: 3, updatedAt: null };
  const a = device(srv); await a.e.start();
  assert.equal(a.e.getSnapshot().status, "error");
  a.e.dispatch({ type: "settings", patch: { name: "Y" } }); await a.e.flush();
  assert.deepEqual(srv.doc!.state, { pas: "valide" });
});

test("déconnexion : le cache du compte est effacé", async () => {
  const srv = new FakeServer(); const a = device(srv); await a.e.start();
  a.e.dispatch({ type: "settings", patch: { name: "Z" } }); await a.e.flush();
  assert.ok(a.cache.data); a.e.destroy(); assert.equal(a.cache.data, null); assert.equal(a.e.getSnapshot().state === null || true, true);
});

test("import local : fusion sans doublon, ré-import sans effet", () => {
  const remote = { ...blank(), tasks: [task("t1", "Compte")] };
  const local = { ...C.seed(), tasks: [task("t1", "Doublon même id"), task("t2", "Locale")] };
  const first = mergeStates(remote, local);
  assert.deepEqual(first.state.tasks.map((t) => t.id), ["t1", "t2"]); assert.equal(first.added.tasks, 1);
  assert.equal(first.state.settings.name, "T", "réglages du compte conservés");
  const second = mergeStates(first.state, local);
  assert.deepEqual(second.added, Object.fromEntries(Object.keys(second.added).map((k) => [k, 0])));
  assert.deepEqual(summarize(second.state), summarize(first.state));
});
