/* Étudiant.OS — hôtes de l'interface : mode local (navigateur seul) ou compte synchronisé. */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { reducer, loadState, validateState, blank, STORAGE_KEY, type Action, type AppState, type ViewKey } from "./core.ts";
import { SyncEngine, mergeStates, summarize, isEmptyState, type ImportSummary } from "./sync.ts";
import { cloudTransport, localCache, watchRemote, cloudFiles, deleteAccount, displayNameOf, frError, appUrl } from "./supabase.ts";
import type { AppEnv, AccountApi } from "./env.ts";
import StudentOS, { fileSave, fileLoad, fileDelete, Btn, Pill, Modal, SYNC_LABEL, syncTone, X, AlertTriangle, FileText, Sparkles, Database } from "./StudentOS.tsx";
import type { Route, SupportPage } from "./router.ts";
import { SupportView, SUPPORT_TITLE, useNotifications } from "./support.tsx";
import { myRole, watchNotifications, unreadNotifications, isMine } from "./supportApi.ts";
import { BASE } from "./supabase.ts";

const localFiles = { save: fileSave, load: fileLoad, remove: fileDelete };

// ------------------------------------------------------------- Mode local (sans compte)
export function LocalHost({ view, onView }: { view: ViewKey; onView: (v: ViewKey) => void }) {
  const [boot] = useState(() => loadState());
  const [state, dispatch] = useReducer(reducer, boot.state);
  const [notice, setNotice] = useState<string | null>(boot.notice);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { setNotice("Enregistrement impossible dans ce navigateur (stockage plein ou bloqué). Exportez vos données depuis Réglages."); }
  }, [state]);
  const env = useMemo<AppEnv>(() => ({ mode: "local", ns: STORAGE_KEY, files: localFiles }), []);
  return <StudentOS state={state} dispatch={dispatch} env={env} view={view} onView={onView} notice={notice} />;
}

// ------------------------------------------------------------- Mode compte
/** Données locales de cet appareil (mode sans compte), si elles existent et sont valides. */
function readLocalData(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return null;
    const r = validateState(JSON.parse(raw));
    return r.ok && r.state.settings.onboarded && !isEmptyState(r.state) ? r.state : null;
  } catch { return null; }
}
const decisionKey = (uid: string) => `etudiant-os/import-decision/${uid}`;
const clientId = () => { try { let id = sessionStorage.getItem("etudiant-os/client"); if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("etudiant-os/client", id); } return id; } catch { return "web"; } };

export function CloudHost({ sb, session, view, onView, onSignedOut, support, nav }: { sb: SupabaseClient; session: Session; view: ViewKey; onView: (v: ViewKey) => void; onSignedOut: () => void; support?: { page: SupportPage; id?: string } | null; nav: (r: Route) => void }) {
  const uid = session.user.id;
  // Rôle et statut lus auprès de la base (indice d'affichage seulement : chaque opération est revérifiée côté serveur).
  const [role, setRole] = useState<{ is_admin: boolean; active: boolean } | null>(null);
  useEffect(() => { let alive = true; void myRole(sb).then((r) => alive && setRole(r)).catch(() => {}); return () => { alive = false; }; }, [sb, uid]);
  const notif = useNotifications(sb, uid, watchNotifications, unreadNotifications);
  const unread = notif.items.filter((n) => isMine(n, uid)).length;          // réponses sur mes demandes
  const adminUnread = notif.items.length - unread;                            // nouveaux tickets / messages (administrateurs)
  const engine = useMemo(() => new SyncEngine(cloudTransport(sb), localCache(uid), () => blank({ onboarded: false, name: displayNameOf(session.user) }, 600), { clientId: clientId() }), [sb, uid]);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [user, setUser] = useState(session.user);
  const [importOffer, setImportOffer] = useState<{ local: AppState; summary: ImportSummary } | null>(null);
  const [importing, setImporting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Démarrage + écoute des autres appareils (Realtime) + relecture au retour sur l'onglet / en ligne + filet de sécurité périodique.
  useEffect(() => {
    void engine.start();
    const stop = watchRemote(sb, uid, () => void engine.refresh());
    const onOnline = () => void engine.reconnect();
    const onVisible = () => { if (document.visibilityState === "visible") void engine.refresh().then(() => engine.flush()); };
    window.addEventListener("online", onOnline); document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void engine.refresh(); }, 60_000);
    return () => { stop(); window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); window.clearInterval(poll); };
  }, [engine, sb, uid]);
  // Avertit avant de fermer l'onglet si des modifications ne sont pas encore envoyées.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (engine.unsent) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [engine]);
  useEffect(() => sb.auth.onAuthStateChange((_e, s) => { if (s?.user) setUser(s.user); }).data.subscription.unsubscribe, [sb]);

  // Proposition d'import des données locales (jamais automatique).
  useEffect(() => {
    if (!snap.ready || snap.status === "loading" || snap.error) return;
    try { if (localStorage.getItem(decisionKey(uid))) return; } catch { return; }
    const local = readLocalData(); if (!local || !snap.state) return;
    const preview = snap.remoteEmpty ? summarize(local) : mergeStates(snap.state, local).added;
    if (Object.values(preview).every((n) => n === 0)) { try { localStorage.setItem(decisionKey(uid), "nothing-new"); } catch { /* ignore */ } return; }
    setImportOffer({ local, summary: preview });
  }, [snap.ready, snap.status, snap.remoteEmpty, uid]);

  const doImport = async () => {
    if (!importOffer || !snap.state) return;
    setImporting(true);
    try { localStorage.setItem(`etudiant-os/u/${uid}:backup-before-import`, JSON.stringify(snap.state)); } catch { /* sauvegarde facultative */ }
    const next = snap.remoteEmpty ? { ...importOffer.local, settings: { ...importOffer.local.settings, onboarded: true } } : mergeStates(snap.state, importOffer.local).state;
    engine.dispatch({ type: "replace", state: next });
    await engine.flush();
    setImporting(false);
    const s = engine.getSnapshot();
    if (s.status === "saved") { try { localStorage.setItem(decisionKey(uid), "imported"); } catch { /* ignore */ } setImportOffer(null); setNotice2("Données importées dans votre compte. Elles restent aussi sur cet appareil tant que vous ne les effacez pas."); }
    else setNotice2(s.status === "offline" ? "Import enregistré sur cet appareil : il sera envoyé à votre compte au retour de la connexion." : "L'import n'a pas pu être enregistré dans votre compte. Vos données locales n'ont pas été modifiées ; réessayez.");
  };
  const skipImport = (forever: boolean) => { if (forever) try { localStorage.setItem(decisionKey(uid), "declined"); } catch { /* ignore */ } setImportOffer(null); };
  const [notice2, setNotice2] = useState<string | null>(null);

  const reallySignOut = useCallback(async () => {
    engine.destroy(); // efface le cache local de ce compte
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(`etudiant-os/u/${uid}`)) localStorage.removeItem(k); } catch { /* ignore */ }
    await sb.auth.signOut({ scope: "local" });
    onSignedOut();
  }, [engine, sb, uid, onSignedOut]);
  const signOut = useCallback(async () => {
    if (engine.unsent) await engine.flush();
    if (engine.unsent) { setLeaving(true); return; }
    await reallySignOut();
  }, [engine, reallySignOut]);

  const account = useMemo<AccountApi>(() => ({
    id: uid, email: user.email ?? "", displayName: displayNameOf(user), pendingEmail: (user as { new_email?: string }).new_email ?? null,
    async updateName(name) {
      const a = await sb.auth.updateUser({ data: { display_name: name } }); if (a.error) return frError(a.error);
      const b = await sb.from("profiles").update({ display_name: name }).eq("id", uid); if (b.error) return frError(b.error);
      setUser(a.data.user); return null;
    },
    async updateEmail(email) { const r = await sb.auth.updateUser({ email }, { emailRedirectTo: appUrl("app/settings") }); if (r.error) return frError(r.error); setUser(r.data.user); return null; },
    async updatePassword(password) { const r = await sb.auth.updateUser({ password }); return r.error ? frError(r.error) : null; },
    signOut,
    async deleteAccount() { const err = await deleteAccount(sb, uid); if (!err) { engine.destroy(); try { localStorage.removeItem(decisionKey(uid)); } catch { /* ignore */ } onSignedOut(); } return err; },
  }), [sb, uid, user, signOut, engine, onSignedOut]);
  const isAdmin = !!role?.is_admin;
  const env = useMemo<AppEnv>(() => ({
    mode: "cloud", ns: `etudiant-os/u/${uid}`, files: cloudFiles(sb, uid), account,
    sync: { status: snap.status, pending: snap.pending, lastSyncedAt: snap.lastSyncedAt, error: snap.error, conflicts: snap.conflicts, online: snap.status !== "offline", retry: () => void engine.reconnect() },
    support: { isAdmin, unread, open: (page) => nav({ name: "support", page }), openAdmin: () => nav({ name: "admin", section: "dashboard" }) },
  }), [sb, uid, account, snap, engine, isAdmin, unread, nav]);

  if (role && !role.active) return <Suspended onSignOut={() => void reallySignOut()} />;
  if (!snap.ready || !snap.state) return <Splash text="Chargement de votre espace…" />;
  const st = snap.status;
  const badge = (
    <>
      <span role="status" aria-live="polite" title={snap.error ?? undefined} data-testid="sync-status">
        <Pill tone={syncTone(st)}>{SYNC_LABEL[st]}{snap.pending && st !== "saved" && st !== "saving" ? ` · ${snap.pending}` : ""}</Pill>
      </span>
      {unread > 0 && (
        <button onClick={() => nav({ name: "support", page: "requests" })} data-testid="notif-badge" aria-label={`${unread} réponse${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""} dans Mes demandes`}
          className="press inline-flex h-7 items-center gap-1 rounded-full border-2 border-fg bg-pink px-2 text-[11px] font-bold text-white shadow-[2px_2px_0_0_rgb(var(--ink))]">
          <FileText size={13} />{unread}
        </button>)}
      {isAdmin && adminUnread > 0 && (
        <button onClick={() => nav({ name: "admin", section: "tickets" })} data-testid="admin-badge" aria-label={`${adminUnread} notification${adminUnread > 1 ? "s" : ""} d'administration`}
          className="press hidden h-7 items-center gap-1 rounded-full border-2 border-fg bg-panel px-2 text-[11px] font-bold text-fg sm:inline-flex">
          <Database size={13} />{adminUnread}
        </button>)}
    </>
  );
  const item = "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-[14px] text-muted hover:bg-sunken";
  const menuExtra = (
    <>
      <button role="menuitem" onClick={() => nav({ name: "support", page: "help" })} className={item}><Sparkles size={17} />Besoin d'aide ?</button>
      <button role="menuitem" onClick={() => nav({ name: "support", page: "report" })} className={item}><AlertTriangle size={17} />Signaler un problème</button>
      <button role="menuitem" onClick={() => nav({ name: "support", page: "requests" })} className={item}><FileText size={17} />Mes demandes{unread > 0 && <span className="ml-auto rounded-full bg-pink px-1.5 text-[11px] text-white">{unread}</span>}</button>
      {isAdmin && <button role="menuitem" onClick={() => nav({ name: "admin", section: "dashboard" })} className={item} data-testid="admin-menu"><Database size={17} />Administration{adminUnread > 0 && <span className="ml-auto rounded-full bg-sunken px-1.5 text-[11px] text-fg">{adminUnread}</span>}</button>}
      <button role="menuitem" onClick={() => void signOut()} className={item}><X size={17} />Se déconnecter</button>
    </>
  );
  const override = support ? { key: `support-${support.page}-${support.id ?? ""}`, title: SUPPORT_TITLE[support.page],
    node: <SupportView sb={sb} uid={uid} page={support.page} id={support.id} nav={nav} unread={unread} refreshKey={notif.tick} openFaq={() => window.location.assign(BASE + "#faq")} /> } : null;
  return (
    <>
      <StudentOS state={snap.state} dispatch={engine.dispatch} env={env} view={view} onView={onView} headerExtra={badge} menuExtra={menuExtra} override={override} notice={notice2 ?? (st === "error" ? snap.error : null)} />
      {importOffer && (
        <Modal title="Importer les données de cet appareil ?" onClose={() => skipImport(false)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p>Des données Étudiant.OS utilisées <b>sans compte</b> existent sur cet appareil. {snap.remoteEmpty ? "Votre compte est vide : elles deviendront le contenu de votre compte." : "Elles seront ajoutées à votre compte, sans doublon (les éléments déjà présents sont ignorés)."}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-sunken p-3 text-xs sm:grid-cols-3" data-testid="import-preview">
              {([["tasks", "tâches"], ["courses", "modules"], ["classes", "créneaux"], ["expenses", "dépenses"], ["recurring", "récurrentes"], ["groceries", "articles"], ["chores", "corvées"], ["sleep", "nuits"], ["focus", "sessions"], ["templates", "listes"], ["products", "produits"], ["events", "événements"]] as [keyof ImportSummary, string][])
                .filter(([k]) => importOffer.summary[k]).map(([k, l]) => <li key={k}><b className="font-mono">{importOffer.summary[k]}</b> {l}</li>)}
            </ul>
            <p className="text-xs text-muted">Une copie de sécurité de votre compte est faite avant l'import. Les données locales ne sont jamais effacées automatiquement.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={() => skipImport(true)}>Ne plus proposer</Btn>
              <Btn variant="ghost" onClick={() => skipImport(false)}>Plus tard</Btn>
              <Btn variant="primary" disabled={importing} onClick={() => void doImport()}>{importing ? "Import…" : "Importer dans mon compte"}</Btn>
            </div>
          </div>
        </Modal>)}
      {leaving && (
        <Modal title="Modifications non envoyées" onClose={() => setLeaving(false)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p>{engine.unsent} modification{engine.unsent > 1 ? "s n'ont" : " n'a"} pas encore été envoyée{engine.unsent > 1 ? "s" : ""} à votre compte ({st === "offline" ? "vous êtes hors ligne" : "le serveur ne répond pas"}). Vous déconnecter maintenant les effacera de cet appareil.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Btn variant="ghost" onClick={() => setLeaving(false)}>Rester connecté</Btn>
              <Btn variant="danger" onClick={() => void reallySignOut()}>Se déconnecter quand même</Btn>
            </div>
          </div>
        </Modal>)}
    </>
  );
}

function Suspended({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 text-center text-fg">
      <div className="inked max-w-md rounded-[24px] bg-panel p-8" role="alert">
        <h1 className="font-display text-2xl font-extrabold">Compte suspendu</h1>
        <p className="mt-2 text-[14px] text-muted">L'accès à ce compte a été suspendu par l'administration. Tes données ne sont pas supprimées.</p>
        <Btn variant="primary" className="mt-5" onClick={onSignOut}>Se déconnecter</Btn>
      </div>
    </div>
  );
}

export function Splash({ text }: { text: string }) {
  return <div id="boot" role="status" aria-live="polite">{text}</div>;
}
