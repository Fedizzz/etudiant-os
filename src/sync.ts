/* Étudiant.OS — synchronisation compte ↔ appareil (sans React, testable).
 *
 * Stratégie :
 *  - Le serveur garde UN document (AppState) par utilisateur, avec un numéro de version.
 *  - Chaque modification locale est une Action du reducer (core.ts) : elle est appliquée tout de suite à
 *    l'interface et mise en file d'attente (persistée dans un cache local propre au compte → survit au hors-ligne
 *    et à l'actualisation).
 *  - Envoi : état courant + version de base. Si la version serveur a changé (autre appareil), le serveur refuse ;
 *    on repart alors de l'état serveur et on REJOUE les actions en attente dessus (aucune perte silencieuse).
 *  - « Enregistré » n'est affiché qu'après confirmation du serveur.
 */
import { reducer, validateState, norm, type Action, type AppState } from "./core.ts";

export type SyncStatus = "loading" | "saving" | "saved" | "pending" | "offline" | "error";
export interface RemoteDoc { state: unknown; version: number; updatedAt: string | null }
export type SaveResult = { ok: true; version: number; updatedAt: string | null } | { ok: false; remote: RemoteDoc | null };
export interface Transport {
  load(): Promise<RemoteDoc | null>;
  save(state: AppState, baseVersion: number, clientId: string): Promise<SaveResult>;
}
export interface CacheData { base: AppState | null; version: number; pending: Action[]; updatedAt: string | null; lastSyncedAt: number | null }
export interface Cache { read(): CacheData | null; write(d: CacheData): void; clear(): void }
export interface SyncSnapshot {
  state: AppState | null; status: SyncStatus; pending: number; version: number; lastSyncedAt: number | null;
  error: string | null; conflicts: number; remoteEmpty: boolean; ready: boolean;
}

export const isNetworkError = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e);
  return /fetch|network|Failed to fetch|NetworkError|Load failed|timeout|offline/i.test(m);
};

export interface SyncOptions { clientId: string; debounceMs?: number; now?: () => number; schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> }

export class SyncEngine {
  private base: AppState | null = null;
  private version = 0;
  private pending: Action[] = [];
  private state: AppState | null = null;
  private status: SyncStatus = "loading";
  private error: string | null = null;
  private conflicts = 0;
  private lastSyncedAt: number | null = null;
  private updatedAt: string | null = null;
  private remoteEmpty = false;
  private ready = false;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | number | null = null;
  private retry = 0;
  private listeners = new Set<() => void>();
  private snap: SyncSnapshot;
  online = true;

  private transport: Transport; private cache: Cache; private blank: () => AppState; private opts: SyncOptions;
  constructor(transport: Transport, cache: Cache, blank: () => AppState, opts: SyncOptions = { clientId: "client" }) {
    this.transport = transport; this.cache = cache; this.blank = blank; this.opts = opts;
    this.snap = this.makeSnap();
  }

  // ------------------------------------------------------------- abonnement (useSyncExternalStore)
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  private makeSnap(): SyncSnapshot {
    return { state: this.state, status: this.status, pending: this.pending.length, version: this.version, lastSyncedAt: this.lastSyncedAt, error: this.error, conflicts: this.conflicts, remoteEmpty: this.remoteEmpty, ready: this.ready };
  }
  private emit() { this.snap = this.makeSnap(); this.listeners.forEach((l) => l()); }
  private persist() { this.cache.write({ base: this.base, version: this.version, pending: this.pending, updatedAt: this.updatedAt, lastSyncedAt: this.lastSyncedAt }); }
  private replay(): AppState { return this.pending.reduce((s, a) => reducer(s, a), this.base ?? this.blank()); }
  private accept(doc: RemoteDoc): boolean {
    const v = validateState(doc.state);
    if (!v.ok) { this.status = "error"; this.error = "Les données du compte sont illisibles. Rien n'a été écrasé."; return false; }
    this.base = v.state; this.version = doc.version; this.updatedAt = doc.updatedAt;
    return true;
  }

  // ------------------------------------------------------------- cycle de vie
  /** Charge le cache local (affichage immédiat, y compris hors ligne) puis le serveur. */
  async start() {
    const c = this.cache.read();
    if (c) {
      this.base = c.base; this.version = c.version; this.pending = c.pending ?? []; this.updatedAt = c.updatedAt; this.lastSyncedAt = c.lastSyncedAt;
      this.state = this.replay(); this.ready = true; this.status = this.pending.length ? "pending" : "saved"; this.emit();
    }
    await this.refresh(true);
    if (this.pending.length) this.flushSoon(0);
  }

  /** Relit le document serveur (au démarrage, au retour en ligne, au retour sur l'onglet, sur notification temps réel). */
  async refresh(initial = false) {
    try {
      const doc = await this.transport.load();
      this.online = true;
      if (!doc) {
        this.remoteEmpty = this.version === 0;
        if (!this.state) this.state = this.replay();
      } else if (doc.version > this.version || !this.base) {
        this.remoteEmpty = false;
        if (this.accept(doc)) this.state = this.replay();
      }
      if (this.status === "loading" || this.status === "offline" || (this.status === "error" && !this.error?.includes("illisibles"))) {
        this.status = this.pending.length ? "pending" : "saved"; this.error = null;
      }
      this.ready = true; this.persist(); this.emit();
    } catch (e) {
      if (!this.state) this.state = this.replay();
      this.ready = true;
      if (isNetworkError(e)) { this.online = false; this.status = "offline"; }
      else { this.status = "error"; this.error = "Chargement impossible. Vos données locales restent disponibles."; }
      if (initial && !this.cache.read()) this.remoteEmpty = false; // inconnu : ne pas proposer d'import à tort
      this.emit();
    }
  }

  /** Applique une action : interface immédiate, file d'attente persistée, envoi différé. */
  dispatch = (a: Action) => {
    if (!this.state) return;
    const next = reducer(this.state, a);
    if (next === this.state) return; // action sans effet (ex. récurrentes déjà à jour) : rien à envoyer
    this.state = next;
    this.pending.push(a);
    if (this.status !== "offline") this.status = "pending";
    this.persist(); this.emit();
    this.flushSoon();
  };

  private flushSoon(ms = this.opts.debounceMs ?? 600) {
    if (this.timer) clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.timer = (this.opts.schedule ?? setTimeout)(() => { this.timer = null; void this.flush(); }, ms);
  }

  /** Envoie les modifications en attente. Une seule écriture à la fois. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight.then(() => (this.pending.length ? this.flush() : undefined));
    if (!this.pending.length || !this.state) return Promise.resolve();
    this.inflight = this.doFlush().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doFlush() {
    for (let attempt = 0; attempt < 5 && this.pending.length; attempt++) {
      const sentCount = this.pending.length;
      const sent = this.replay();
      this.status = "saving"; this.emit();
      let res: SaveResult;
      try { res = await this.transport.save(sent, this.version, this.opts.clientId); }
      catch (e) {
        if (isNetworkError(e)) { this.online = false; this.status = "offline"; this.error = null; }
        else { this.status = "error"; this.error = "Enregistrement refusé par le serveur. Vos modifications restent en attente sur cet appareil."; }
        this.emit(); this.scheduleRetry(); return;
      }
      this.online = true; this.retry = 0;
      if (res.ok) {
        this.base = sent; this.version = res.version; this.updatedAt = res.updatedAt;
        this.pending = this.pending.slice(sentCount);
        this.state = this.replay();
        this.lastSyncedAt = (this.opts.now ?? Date.now)(); this.remoteEmpty = false; this.error = null;
        this.status = this.pending.length ? "pending" : "saved";
        this.persist(); this.emit();
      } else {
        // Conflit : un autre appareil a écrit. On rebase les actions en attente sur la version serveur.
        this.conflicts++;
        if (res.remote) { if (!this.accept(res.remote)) { this.emit(); return; } }
        else { const doc = await this.transport.load().catch(() => null); if (doc && !this.accept(doc)) { this.emit(); return; } if (!doc) { this.base = null; this.version = 0; } }
        this.state = this.replay(); this.persist(); this.emit();
      }
    }
  }

  private scheduleRetry() {
    const ms = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.flushSoon(ms);
  }

  /** Appelé quand le navigateur repasse en ligne. */
  async reconnect() { this.online = true; await this.refresh(); await this.flush(); }

  /** Modifications non envoyées (à signaler avant une déconnexion). */
  get unsent() { return this.pending.length; }

  /** Efface toute trace locale de ce compte (déconnexion sur un appareil partagé). */
  destroy() { if (this.timer) clearTimeout(this.timer as ReturnType<typeof setTimeout>); this.cache.clear(); this.listeners.clear(); this.state = null; }
}

// ------------------------------------------------------------- Import des données locales dans un compte
export interface ImportSummary { tasks: number; courses: number; classes: number; expenses: number; recurring: number; groceries: number; chores: number; sleep: number; focus: number; templates: number; products: number; events: number }
const byKey = <T,>(remote: T[], local: T[], key: (x: T) => string) => {
  const seen = new Set(remote.map(key));
  const add = local.filter((x) => !seen.has(key(x)));
  return { list: [...remote, ...add], added: add.length };
};
/**
 * Fusionne des données locales dans celles du compte, sans doublon (clé = identifiant, date pour le sommeil,
 * nom pour les produits). Les réglages du compte sont conservés. Rejouer l'import n'ajoute rien.
 */
export function mergeStates(remote: AppState, local: AppState): { state: AppState; added: ImportSummary } {
  const id = <T extends { id: string }>(x: T) => x.id;
  const tasks = byKey(remote.tasks, local.tasks, id), courses = byKey(remote.courses, local.courses, id), classes = byKey(remote.classes, local.classes, id);
  const expenses = byKey(remote.budget.expenses, local.budget.expenses, id), recurring = byKey(remote.budget.recurring, local.budget.recurring, id);
  const groceries = byKey(remote.groceries, local.groceries, id), chores = byKey(remote.chores, local.chores, id);
  const sleep = byKey(remote.sleep, local.sleep, (l) => l.date), focus = byKey(remote.focus, local.focus, (f) => f.id ?? `${f.date}-${f.minutes}-${f.taskId}`);
  const events = byKey(remote.events ?? [], local.events ?? [], id);
  const templates = byKey(remote.templates, local.templates, id), products = byKey(remote.products, local.products, (p) => norm(p.name));
  return {
    state: {
      ...remote, tasks: tasks.list, courses: courses.list, classes: classes.list, groceries: groceries.list, chores: chores.list, sleep: sleep.list, focus: focus.list,
      templates: templates.list, products: products.list, events: events.list,
      budget: { ...remote.budget, expenses: expenses.list, recurring: recurring.list, limits: { ...local.budget.limits, ...remote.budget.limits } },
    },
    added: { tasks: tasks.added, courses: courses.added, classes: classes.added, expenses: expenses.added, recurring: recurring.added, groceries: groceries.added, chores: chores.added, sleep: sleep.added, focus: focus.added, templates: templates.added, products: products.added, events: events.added },
  };
}
export function summarize(s: AppState): ImportSummary {
  return { tasks: s.tasks.length, courses: s.courses.length, classes: s.classes.length, expenses: s.budget.expenses.length, recurring: s.budget.recurring.length, groceries: s.groceries.length, chores: s.chores.length, sleep: s.sleep.length, focus: s.focus.length, templates: s.templates.length, products: s.products.length, events: (s.events ?? []).length };
}
export const isEmptyState = (s: AppState) => Object.values(summarize(s)).every((n) => n === 0);
