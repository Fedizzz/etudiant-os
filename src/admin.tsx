/* Étudiant.OS — espace administrateur.
 * L'accès est vérifié par la base (my_role / is_admin) avant tout chargement, et CHAQUE opération est revérifiée
 * côté serveur : masquer un bouton n'est qu'un confort d'interface. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { cx } from "./core.ts";
import { useFixedHeader, Card, Btn, Select, Pill, Empty, Modal, Stat, inputCls, LayoutDashboard, Users, FileText, Database, ChevronLeft, ChevronRight, AlertTriangle, Search, Sun, Moon } from "./StudentOS.tsx";
import { Thread, TextArea, AttachPicker, Banner, StatusPill, Labeled, useNotifications } from "./support.tsx";
import {
  admin, myRole, logAdminDenied, isMine, getMessages, postMessage, uploadAttachment, markTicketRead, watchNotifications, unreadNotifications, supportError,
  type AdminTicketRow, type AdminUserRow, type AuditEntry, type Message, type Ticket,
} from "./supportApi.ts";
import {
  STATUS_LABEL, PRIORITY_LABEL, KIND_LABEL, MODULES, FREQUENCIES, IMPACTS, URGENCIES, AUDIT_LABEL, categoryLabel, priorityTone, fmtDateTime, fmtShort, parsePath, LIMITS,
  type TicketPriority, type TicketStatus,
} from "./supportModel.ts";
import type { AdminSection, Route } from "./router.ts";
import { appUrl, frError } from "./supabase.ts";

type Nav = (r: Route) => void;
const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as TicketPriority[];

// ------------------------------------------------------------- Accès
export function AdminApp({ sb, session, section, id, nav }: { sb: SupabaseClient; session: Session; section: AdminSection; id?: string; nav: Nav }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    myRole(sb).then((r) => {
      if (!alive) return;
      setAllowed(r.is_admin);
      if (!r.is_admin) void logAdminDenied(sb, window.location.pathname).catch(() => {});
    }).catch(() => alive && setAllowed(false));
    return () => { alive = false; };
  }, [sb, session.user.id]);
  if (allowed === null) return <div id="boot" role="status">Vérification des droits…</div>;
  if (!allowed) return (
    <div className="grid min-h-full place-items-center bg-bg px-4 text-center text-fg" data-testid="admin-denied">
      <div className="inked max-w-md rounded-[24px] bg-panel p-8" role="alert">
        <h1 className="font-display text-2xl font-extrabold">Accès refusé</h1>
        <p className="mt-2 text-[14px] text-muted">Cet espace est réservé aux administrateurs d'Étudiant.OS. Aucune donnée d'administration n'a été chargée.</p>
        <Btn variant="primary" className="mt-5" onClick={() => nav({ name: "app", view: "dashboard" })}>Retour à mon espace</Btn>
      </div>
    </div>
  );
  return <AdminShell sb={sb} session={session} section={section} id={id} nav={nav} />;
}

// ------------------------------------------------------------- Cadre
function AdminShell({ sb, session, section, id, nav }: { sb: SupabaseClient; session: Session; section: AdminSection; id?: string; nav: Nav }) {
  const notif = useNotifications(sb, session.user.id, watchNotifications, unreadNotifications);
  const [headerRef, headerH] = useFixedHeader();
  // Thème : celui de l'application (data-theme), basculable ici pour la session seulement.
  const [dark, setDark] = useState(() => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; });
  const toggleTheme = () => { const d = !dark; setDark(d); document.documentElement.dataset.theme = d ? "dark" : "light"; };
  const items: { key: AdminSection; label: string; icon: React.FC<{ size?: number }>; badge?: number }[] = [
    { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard }, { key: "users", label: "Utilisateurs", icon: Users },
    { key: "tickets", label: "Support", icon: FileText, badge: notif.items.filter((n) => !isMine(n, session.user.id)).length }, { key: "audit", label: "Journal d'audit", icon: Database },
  ];
  const title = { dashboard: "Administration", users: id ? "Fiche utilisateur" : "Utilisateurs", tickets: id ? "Ticket" : "Support", audit: "Journal d'audit" }[section];
  return (
    <div className="flex min-h-full bg-bg text-fg" data-testid="admin-shell">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 p-3 md:flex">
        <div className="mb-5 flex items-center gap-2.5 px-2 pt-2"><div className="sticker grid h-9 w-9 place-items-center rounded-xl border-2 border-fg bg-pink text-white shadow-[3px_3px_0_0_rgb(var(--ink))]"><Database size={17} /></div>
          <span className="font-display text-[17px] font-extrabold leading-tight tracking-tight">Étudiant<span className="text-accent">.</span>OS<br /><span className="text-[12px] font-semibold text-muted">Administration</span></span></div>
        {items.map((n) => (
          <button key={n.key} onClick={() => nav({ name: "admin", section: n.key })} aria-current={section === n.key ? "page" : undefined}
            className={cx("flex h-10 items-center gap-2.5 rounded-xl border-2 px-3 text-[13px] transition", section === n.key ? "border-fg bg-hi font-bold text-[rgb(24_22_46)] shadow-[3px_3px_0_0_rgb(var(--ink))]" : "border-transparent text-muted hover:text-fg")}>
            <n.icon size={16} /><span className="flex-1 text-left">{n.label}</span>{!!n.badge && <span className="rounded-full bg-pink px-1.5 text-[11px] font-bold text-white">{n.badge}</span>}
          </button>))}
        <div className="mt-auto flex flex-col gap-2 text-[12px]">
          <p className="truncate px-2 text-muted" title={session.user.email}>{session.user.email}</p>
          <Btn variant="soft" onClick={() => nav({ name: "app", view: "dashboard" })}><ChevronLeft size={14} />Retour à l'application</Btn>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden className="md:hidden" style={{ height: headerH }} />
        <header ref={headerRef} className="fixed inset-x-0 top-0 z-30 border-b-2 border-dashed border-line bg-bg/85 backdrop-blur-md md:sticky md:inset-x-auto md:z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1"><p className="text-xs text-muted">Espace administrateur</p><h1 className="truncate font-display text-[21px] font-extrabold tracking-tight sm:text-[26px]">{title}</h1></div>
            <Btn variant="ghost" size="sm" onClick={toggleTheme} aria-label="Changer de thème">{dark ? <Sun size={15} /> : <Moon size={15} />}</Btn>
            <Btn variant="soft" size="sm" className="md:hidden" onClick={() => nav({ name: "app", view: "dashboard" })} aria-label="Retour à l'application"><ChevronLeft size={15} /></Btn>
          </div>
          <nav aria-label="Administration" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {items.map((n) => (
              <button key={n.key} onClick={() => nav({ name: "admin", section: n.key })} aria-current={section === n.key ? "page" : undefined}
                className={cx("inline-flex shrink-0 items-center gap-1.5 rounded-xl border-2 px-2.5 py-1.5 text-[12.5px] font-semibold", section === n.key ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-panel")}>
                <n.icon size={14} />{n.label}{!!n.badge && <span className="rounded-full bg-pink px-1.5 text-[10px] text-white">{n.badge}</span>}
              </button>))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-6">
          {section === "dashboard" && <Dashboard sb={sb} nav={nav} tick={notif.tick} />}
          {section === "users" && (id ? <UserDetail sb={sb} id={id} nav={nav} me={session.user.id} /> : <UsersList sb={sb} nav={nav} />)}
          {section === "tickets" && (id ? <TicketDetail sb={sb} id={id} nav={nav} tick={notif.tick} me={session.user.id} /> : <TicketsList sb={sb} nav={nav} tick={notif.tick} />)}
          {section === "audit" && <AuditLog sb={sb} nav={nav} />}
        </main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Utilitaires d'interface
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { setLoading(true); try { setData(await fn()); setErr(null); } catch (e) { setErr(supportError(e)); } finally { setLoading(false); } }, deps); // eslint-disable-line
  useEffect(() => { void reload(); }, [reload]);
  return { data, err, loading, reload, setData };
}
const Loading = () => <p role="status" className="py-10 text-center text-muted">Chargement…</p>;
const ErrorBox = ({ err, retry }: { err: string; retry: () => void }) => <Banner tone="bad">{err} <button className="font-semibold underline" onClick={retry}>Réessayer</button></Banner>;
const PriorityPill = ({ p }: { p: TicketPriority }) => <Pill tone={priorityTone(p)}>{p === "critical" && <AlertTriangle size={11} />}{PRIORITY_LABEL[p]}</Pill>;
const Pager = ({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) => total <= size ? null : (
  <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
    <span>{page * size + 1}–{Math.min(total, (page + 1) * size)} sur {total}</span>
    <div className="flex gap-1"><Btn size="sm" variant="soft" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Page précédente"><ChevronLeft size={13} /></Btn>
      <Btn size="sm" variant="soft" disabled={(page + 1) * size >= total} onClick={() => onPage(page + 1)} aria-label="Page suivante"><ChevronRight size={13} /></Btn></div>
  </div>
);
const auditText = (a: AuditEntry) => {
  const s = (a.summary ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (s.from !== undefined || s.to !== undefined) parts.push(`${JSON.stringify(s.from ?? null)} → ${JSON.stringify(s.to ?? null)}`);
  if (Array.isArray(s.path)) parts.push(`chemin : ${(s.path as string[]).join(" / ")}`);
  if (typeof s.email === "string") parts.push(s.email);
  return parts.join(" · ");
};
/** Saisie obligatoire d'une justification, puis confirmation explicite. */
function ReasonDialog({ title, intro, confirm, danger, minLength = 5, extra, onClose, onConfirm }: {
  title: string; intro: React.ReactNode; confirm: string; danger?: boolean; minLength?: number; extra?: (ok: (v: boolean) => void) => React.ReactNode;
  onClose: () => void; onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [extraOk, setExtraOk] = useState(!extra);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="flex flex-col gap-3 text-[13px]" onSubmit={async (e) => { e.preventDefault(); if (reason.trim().length < minLength || !extraOk) return; setBusy(true); const r = await onConfirm(reason.trim()); setBusy(false); if (r) setErr(r); else onClose(); }}>
        <div className="text-muted">{intro}</div>
        <Labeled label="Justification (journalisée)" htmlFor="reason" hint={`${minLength} caractères minimum. Ex. : « Ticket #12 : demande de l'utilisateur ».`}>
          <TextArea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} max={500} />
        </Labeled>
        {extra?.(setExtraOk)}
        {err && <Banner tone="bad">{err}</Banner>}
        <div className="flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn type="submit" variant={danger ? "danger" : "primary"} className={danger ? "border-2 border-bad" : ""} disabled={busy || reason.trim().length < minLength || !extraOk}>{busy ? "…" : confirm}</Btn></div>
      </form>
    </Modal>
  );
}
const run = async (fn: () => Promise<unknown>): Promise<string | null> => { try { await fn(); return null; } catch (e) { return supportError(e); } };

// ------------------------------------------------------------- Tableau de bord
function Dashboard({ sb, nav, tick }: { sb: SupabaseClient; nav: Nav; tick: number }) {
  const { data: s, err, reload } = useLoad(() => admin.stats(sb), [sb, tick]);
  if (err && !s) return <ErrorBox err={err} retry={() => void reload()} />;
  if (!s) return <Loading />;
  const TicketLine = ({ t }: { t: AdminTicketRow }) => (
    <li><button onClick={() => nav({ name: "admin", section: "tickets", id: t.id })} className={cx("flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-sunken", t.priority === "critical" && "border-l-4 border-bad")}>
      <span className="font-mono text-[11px] text-muted">#{t.number}</span><span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.subject}</span>
      <PriorityPill p={t.priority} /><StatusPill status={t.status} /></button></li>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="admin-dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Utilisateurs" value={String(s.users_total)} sub={`${s.suspended} suspendu${s.suspended > 1 ? "s" : ""}`} />
        <Stat label="Inscriptions (7 j)" value={String(s.signups_7d)} sub={`${s.signups_30d} sur 30 jours`} />
        <Stat label="Actifs (7 j)" value={String(s.active_7d)} sub="connexion ou synchro ≤ 7 j" />
        <Stat label="Tickets critiques" value={String(s.critical_open)} tone={s.critical_open ? "bad" : undefined} sub="non résolus" />
        <Stat label="Bugs ouverts" value={String(s.bugs_open)} />
        <Stat label="Demandes d'aide" value={String(s.help_open)} sub="ouvertes" />
        <Stat label="En attente de réponse" value={String(s.awaiting_reply)} tone={s.awaiting_reply ? "warn" : undefined} sub="dernier message : utilisateur" />
        <Stat label="Résolus" value={String(s.resolved)} tone="ok" sub="résolus ou fermés" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" onClick={() => nav({ name: "admin", section: "tickets" })}><FileText size={14} />Tous les tickets</Btn>
        <Btn onClick={() => nav({ name: "admin", section: "users" })}><Users size={14} />Utilisateurs</Btn>
        <Btn onClick={() => nav({ name: "admin", section: "audit" })}><Database size={14} />Journal d'audit</Btn>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tickets prioritaires">{s.priority_tickets.length ? <ul className="-mx-2">{s.priority_tickets.map((t) => <TicketLine key={t.id} t={t} />)}</ul> : <p className="text-[13px] text-muted">Aucun ticket haute priorité ou critique en cours.</p>}</Card>
        <Card title="Tickets récents">{s.recent_tickets.length ? <ul className="-mx-2">{s.recent_tickets.map((t) => <TicketLine key={t.id} t={t} />)}</ul> : <p className="text-[13px] text-muted">Aucun ticket pour l'instant.</p>}</Card>
      </div>
      <Card title="Dernières activités administratives">
        {s.recent_audit.length ? <ul className="flex flex-col gap-1.5 text-[12.5px]">{s.recent_audit.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2"><span className="text-muted">{fmtShort(a.created_at)}</span><b>{AUDIT_LABEL[a.action] ?? a.action}</b><span className="text-muted">par {a.actor_email ?? "système"}{a.target_email ? ` · ${a.target_email}` : ""}</span></li>))}</ul>
          : <p className="text-[13px] text-muted">Aucune activité.</p>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- Utilisateurs
function UsersList({ sb, nav }: { sb: SupabaseClient; nav: Nav }) {
  const [f, setF] = useState({ q: "", role: "", status: "", from: "", to: "", sort: "created_desc", page: 0 });
  const [q, setQ] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setF((x) => (x.q === q ? x : { ...x, q, page: 0 })), 300); return () => window.clearTimeout(t); }, [q]);
  const { data, err, loading, reload } = useLoad(() => admin.users(sb, f), [sb, JSON.stringify(f)]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, page: 0 });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Recherche
            <span className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className={cx(inputCls, "pl-8")} placeholder="E-mail, nom ou identifiant" value={q} onChange={(e) => setQ(e.target.value)} data-testid="user-search" /></span></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Rôle<Select value={f.role} onChange={set("role")}><option value="">Tous</option><option value="user">Utilisateur</option><option value="admin">Administrateur</option></Select></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Statut<Select value={f.status} onChange={set("status")}><option value="">Tous</option><option value="active">Actif</option><option value="suspended">Suspendu</option></Select></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Inscrit depuis<input type="date" className={inputCls} value={f.from} onChange={set("from")} /></label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Jusqu'au<input type="date" className={inputCls} value={f.to} onChange={set("to")} /></label>
          <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted lg:col-span-2">Tri<Select value={f.sort} onChange={set("sort")}>
            <option value="created_desc">Inscription récente</option><option value="created_asc">Inscription ancienne</option><option value="activity_desc">Dernière activité</option><option value="email_asc">E-mail (A → Z)</option><option value="tickets_desc">Tickets ouverts</option></Select></label>
        </div>
      </Card>
      {err && <ErrorBox err={err} retry={() => void reload()} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty icon={<Users size={22} />} title="Aucun utilisateur trouvé" hint="Modifie la recherche ou les filtres." /> : (
        <Card title={<span>{data.total} utilisateur{data.total > 1 ? "s" : ""}{loading ? " · …" : ""}</span>}>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="hidden w-full text-left text-[12.5px] md:table" data-testid="users-table">
              <thead className="text-[11px] uppercase tracking-wider text-muted"><tr><th className="py-2 pr-3">Utilisateur</th><th className="pr-3">Inscription</th><th className="pr-3">Activité</th><th className="pr-3">Statut</th><th className="pr-3">Rôle</th><th className="pr-3 text-right">Tickets</th></tr></thead>
              <tbody>{data.rows.map((u) => (
                <tr key={u.id} className="cursor-pointer border-t border-line hover:bg-sunken" onClick={() => nav({ name: "admin", section: "users", id: u.id })}>
                  <td className="py-2 pr-3"><button className="text-left" onClick={() => nav({ name: "admin", section: "users", id: u.id })}><span className="block font-semibold">{u.display_name || "—"}</span><span className="block text-muted">{u.email}</span><span className="font-mono text-[10px] text-muted">{u.id.slice(0, 8)}</span></button></td>
                  <td className="pr-3">{fmtShort(u.created_at)}</td><td className="pr-3">{fmtShort(u.last_activity)}</td>
                  <td className="pr-3"><UserStatus u={u} /></td><td className="pr-3">{u.role === "admin" ? <Pill tone="info">Admin</Pill> : "Utilisateur"}</td><td className="pr-3 text-right tabular-nums">{u.open_tickets}</td>
                </tr>))}</tbody>
            </table>
            <ul className="flex flex-col gap-2 md:hidden">{data.rows.map((u) => (
              <li key={u.id}><button onClick={() => nav({ name: "admin", section: "users", id: u.id })} className="w-full rounded-xl border-2 border-line p-3 text-left text-[12.5px]">
                <span className="flex items-center justify-between gap-2"><b className="truncate">{u.display_name || u.email}</b><UserStatus u={u} /></span>
                <span className="block truncate text-muted">{u.email}</span>
                <span className="mt-1 block text-[11px] text-muted">Inscrit {fmtShort(u.created_at)} · activité {fmtShort(u.last_activity)} · {u.open_tickets} ticket{u.open_tickets > 1 ? "s" : ""}{u.role === "admin" ? " · admin" : ""}</span>
              </button></li>))}</ul>
          </div>
          <Pager page={f.page} size={25} total={data.total} onPage={(p) => setF({ ...f, page: p })} />
        </Card>)}
    </div>
  );
}
const UserStatus = ({ u }: { u: Pick<AdminUserRow, "status" | "email_confirmed_at"> }) => u.status === "suspended" ? <Pill tone="bad">Suspendu</Pill> : !u.email_confirmed_at ? <Pill tone="warn">Non confirmé</Pill> : <Pill tone="ok">Actif</Pill>;

function UserDetail({ sb, id, nav, me }: { sb: SupabaseClient; id: string; nav: Nav; me: string }) {
  const { data: d, err, reload } = useLoad(() => admin.user(sb, id), [sb, id]);
  const [dialog, setDialog] = useState<null | "name" | "suspend" | "reactivate" | "reset" | "begin-delete" | "delete">(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState(""); const [noteErr, setNoteErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [revert, setRevert] = useState<AuditEntry | null>(null);
  if (err && !d) return <div className="flex flex-col gap-3"><Back nav={nav} section="users" /><ErrorBox err={err} retry={() => void reload()} /></div>;
  if (!d) return <Loading />;
  const u = d.user, isAdminTarget = u.role === "admin", self = u.id === me;
  const deleting = !!d.profile?.status_reason?.startsWith("Suppression en cours");
  const done = (text: string) => { setMsg({ tone: "ok", text }); void reload(); };
  return (
    <div className="flex flex-col gap-4" data-testid="user-detail">
      <Back nav={nav} section="users" />
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profil" className="lg:col-span-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Nom d'affichage</dt><dd className="flex flex-wrap items-center gap-2"><b data-testid="user-name">{u.display_name || "—"}</b>
              <Btn size="sm" variant="ghost" onClick={() => { setName(u.display_name); setDialog("name"); }}>Modifier</Btn></dd>
            <dt className="text-muted">E-mail</dt><dd className="break-all">{u.email} {u.email_confirmed_at ? <Pill tone="ok">confirmé</Pill> : <Pill tone="warn">non confirmé</Pill>}</dd>
            {d.account.new_email && <><dt className="text-muted">Changement</dt><dd>vers {d.account.new_email} (non confirmé)</dd></>}
            <dt className="text-muted">Identifiant</dt><dd className="break-all font-mono text-[11.5px]">{u.id}</dd>
            <dt className="text-muted">Inscription</dt><dd>{fmtDateTime(u.created_at)}</dd>
            <dt className="text-muted">Dernière connexion</dt><dd>{fmtDateTime(d.account.last_sign_in_at)}</dd>
            <dt className="text-muted">Dernière activité</dt><dd>{fmtDateTime(u.last_activity)}</dd>
            <dt className="text-muted">Profil modifié</dt><dd>{fmtDateTime(u.profile_updated_at)}</dd>
            <dt className="text-muted">Connexion via</dt><dd>{(d.account.providers ?? []).join(", ") || "—"}</dd>
            <dt className="text-muted">Rôle</dt><dd>{isAdminTarget ? "Administrateur" : "Utilisateur"}</dd>
            <dt className="text-muted">Statut</dt><dd className="flex flex-wrap items-center gap-2"><UserStatus u={u} />{d.profile?.status_reason && <span className="text-[12px] text-muted">« {d.profile.status_reason} » · {fmtShort(d.profile.status_changed_at)}</span>}</dd>
          </dl>
        </Card>
        <Card title="Actions sur le compte">
          {isAdminTarget || self ? <p className="text-[12.5px] text-muted">{self ? "C'est ton propre compte : utilise Réglages > Mon compte." : "Les comptes administrateurs ne peuvent pas être suspendus ni supprimés depuis l'interface."}</p> : (
            <div className="flex flex-col gap-2">
              {u.status === "active" ? <Btn onClick={() => setDialog("suspend")}>Suspendre le compte</Btn> : !deleting && <Btn onClick={() => setDialog("reactivate")}>Réactiver le compte</Btn>}
              <Btn onClick={() => setDialog("reset")}>Envoyer un lien de réinitialisation</Btn>
              {!deleting ? <Btn variant="danger" onClick={() => setDialog("begin-delete")}>Lancer la suppression…</Btn>
                : <><Btn variant="danger" className="border-2 border-bad" onClick={() => setDialog("delete")}>Supprimer définitivement…</Btn><Btn variant="ghost" onClick={() => setDialog("reactivate")}>Annuler la suppression (réactiver)</Btn></>}
              <p className="text-[11px] text-muted">Aucun mot de passe n'est jamais visible. Chaque action est journalisée.</p>
            </div>)}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Données (résumé)">
          {d.data ? <div className="text-[12.5px]">
            <p className="text-muted">Version {d.data.version} · synchronisée {fmtShort(d.data.updated_at)}{d.data.updated_by === "admin" ? " (correction admin)" : ""}</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">{Object.entries(d.data.counts ?? {}).map(([k, n]) => <li key={k}><span className="text-muted">{k}</span> <b className="tabular-nums">{n}</b></li>)}<li><span className="text-muted">dépenses</span> <b>{d.data.expenses}</b></li></ul>
            <p className="mt-2 text-[11px] text-muted">Seuls des totaux sont affichés : le contenu (notes, budget…) n'est pas consulté.</p>
          </div> : <p className="text-[12.5px] text-muted">Aucune donnée synchronisée.</p>}
          {d.preferences && <p className="mt-2 text-[12px] text-muted">Préférences : thème {String(d.preferences.theme ?? "—")}, devise {String(d.preferences.currency ?? "—")}, onboarding {d.preferences.onboarded ? "terminé" : "non terminé"}{Array.isArray(d.preferences.hiddenViews) && d.preferences.hiddenViews.length ? `, modules masqués : ${(d.preferences.hiddenViews as string[]).join(", ")}` : ""}</p>}
        </Card>
        <Card title={`Tickets (${d.tickets.length})`} action={d.tickets.length > 0 && <Btn size="sm" variant="ghost" onClick={() => nav({ name: "admin", section: "tickets" })}>Support</Btn>}>
          {d.tickets.length ? <ul className="-mx-2">{d.tickets.map((t) => (
            <li key={t.id}><button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-sunken" onClick={() => nav({ name: "admin", section: "tickets", id: t.id })}>
              <span className="font-mono text-[11px] text-muted">#{t.number}</span><span className="min-w-0 flex-1 truncate">{t.subject}</span><StatusPill status={t.status} /></button></li>))}</ul>
            : <p className="text-[12.5px] text-muted">Aucun ticket.</p>}
        </Card>
        <Card title="Notes internes de support">
          <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; const r = await run(() => admin.addUserNote(sb, id, note)); if (r) setNoteErr(r); else { setNote(""); setNoteErr(null); void reload(); } }}>
            <TextArea aria-label="Nouvelle note interne" value={note} onChange={(e) => setNote(e.target.value)} rows={2} max={2000} placeholder="Visible uniquement par les administrateurs" />
            {noteErr && <Banner tone="bad">{noteErr}</Banner>}
            <Btn type="submit" size="sm" className="self-end" disabled={!note.trim()}>Ajouter la note</Btn>
          </form>
          <ul className="mt-3 flex flex-col gap-2">{d.notes.map((n) => <li key={n.id} className="rounded-xl border-2 border-warn/40 bg-warn/10 p-2.5 text-[12.5px]"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-[11px] text-muted">{n.author ?? "—"} · {fmtShort(n.created_at)}</p></li>)}</ul>
        </Card>
      </div>
      {d.data && <DataFixTool sb={sb} id={id} email={u.email} onDone={(t) => done(t)} />}
      <Card title="Historique des actions administratives">
        {d.audit.length ? <ul className="flex flex-col gap-2 text-[12.5px]" data-testid="user-audit">{d.audit.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-dashed border-line pb-1.5">
            <span className="text-muted">{fmtDateTime(a.created_at)}</span><b>{AUDIT_LABEL[a.action] ?? a.action}</b><span className="text-muted">par {a.actor_email ?? "système"}</span>
            {auditText(a) && <span className="break-all font-mono text-[11px]">{auditText(a)}</span>}{a.reason && <span className="italic text-muted">« {a.reason} »</span>}
            {a.action === "data_fixed" && <Btn size="sm" variant="ghost" onClick={() => setRevert(a)}>Annuler cette correction</Btn>}
          </li>))}</ul> : <p className="text-[12.5px] text-muted">Aucune action.</p>}
      </Card>

      {dialog === "name" && <ReasonDialog title="Modifier le nom d'affichage" confirm="Enregistrer" onClose={() => setDialog(null)}
        intro={<div className="flex flex-col gap-2"><p>Utilisateur : <b>{u.email}</b> · valeur actuelle : <b>{u.display_name || "—"}</b></p>
          <Labeled label="Nouveau nom" htmlFor="new-name"><input id="new-name" className={inputCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Labeled></div>}
        onConfirm={(r) => run(() => admin.updateProfile(sb, id, name, r)).then((e) => { if (!e) done("Nom d'affichage modifié et journalisé."); return e; })} />}
      {dialog === "suspend" && <ReasonDialog title="Suspendre le compte" confirm="Suspendre" danger onClose={() => setDialog(null)}
        intro={<p><b>{u.email}</b> ne pourra plus se connecter ; ses sessions sont fermées et ses écritures refusées. Ses données sont conservées. Réversible.</p>}
        onConfirm={(r) => run(() => admin.setStatus(sb, id, "suspended", r)).then((e) => { if (!e) done("Compte suspendu."); return e; })} />}
      {dialog === "reactivate" && <ReasonDialog title="Réactiver le compte" confirm="Réactiver" onClose={() => setDialog(null)}
        intro={<p><b>{u.email}</b> pourra de nouveau se connecter.{deleting ? " La procédure de suppression est annulée." : ""}</p>}
        onConfirm={(r) => run(() => admin.setStatus(sb, id, "active", r)).then((e) => { if (!e) done("Compte réactivé."); return e; })} />}
      {dialog === "reset" && <ReasonDialog title="Réinitialisation du mot de passe" confirm="Envoyer le lien" onClose={() => setDialog(null)}
        intro={<p>Un e-mail de réinitialisation (lien à usage unique, parcours standard de Supabase) sera envoyé à <b>{u.email}</b>. Tu ne vois jamais le mot de passe.</p>}
        onConfirm={async (r) => { try { const email = await admin.requestReset(sb, id, r); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl("reset-password") }); if (error) return frError(error); done(`Lien de réinitialisation envoyé à ${email}.`); return null; } catch (e) { return supportError(e); } }} />}
      {dialog === "begin-delete" && <ReasonDialog title="Lancer la suppression du compte" confirm="Lancer la procédure" danger onClose={() => setDialog(null)}
        intro={<div className="flex flex-col gap-1.5"><p>Étape 1 sur 2 pour <b>{u.email}</b> : le compte est <b>suspendu immédiatement</b> (connexion impossible) et marqué « suppression en cours ».</p><p>L'étape 2 supprimera définitivement le compte, ses données synchronisées, ses fichiers et ses tickets. Tu peux encore annuler entre les deux étapes (réactivation).</p></div>}
        onConfirm={(r) => run(() => admin.beginDeletion(sb, id, r)).then((e) => { if (!e) done("Procédure de suppression lancée : compte suspendu."); return e; })} />}
      {dialog === "delete" && <ReasonDialog title="Supprimer définitivement" confirm="Supprimer définitivement" danger onClose={() => setDialog(null)}
        intro={<p><b>Irréversible.</b> Le compte <b>{u.email}</b>, ses données, ses fichiers (PDF, captures) et ses tickets seront supprimés. Le journal d'audit conserve une trace de l'opération.</p>}
        extra={(ok) => <ConfirmEmail email={u.email} ok={ok} />}
        onConfirm={async (r) => { const typed = (document.getElementById("confirm-email") as HTMLInputElement | null)?.value ?? ""; const e = await run(() => admin.deleteUser(sb, id, typed, r)); if (!e) nav({ name: "admin", section: "users" }); return e; }} />}
      {revert && <ReasonDialog title="Annuler une correction" confirm="Rétablir l'ancienne valeur" minLength={10} onClose={() => setRevert(null)}
        intro={<p>Rétablit <span className="font-mono">{JSON.stringify((revert.summary as { from?: unknown })?.from)}</span> à la place de <span className="font-mono">{JSON.stringify((revert.summary as { to?: unknown })?.to)}</span>, seulement si la valeur n'a pas changé depuis.</p>}
        onConfirm={(r) => run(() => admin.revertFix(sb, revert.id, r)).then((e) => { if (!e) done("Correction annulée."); return e; })} />}
    </div>
  );
}
function ConfirmEmail({ email, ok }: { email: string; ok: (v: boolean) => void }) {
  const [v, setV] = useState("");
  return <Labeled label={`Tape l'adresse ${email} pour confirmer`} htmlFor="confirm-email"><input id="confirm-email" className={inputCls} autoComplete="off" value={v} onChange={(e) => { setV(e.target.value); ok(e.target.value.trim().toLowerCase() === email.toLowerCase()); }} /></Labeled>;
}
const Back = ({ nav, section }: { nav: Nav; section: AdminSection }) => <div><Btn variant="ghost" size="sm" onClick={() => nav({ name: "admin", section })}><ChevronLeft size={14} />{section === "users" ? "Utilisateurs" : "Support"}</Btn></div>;

/** Correction ciblée d'une valeur : lecture justifiée (journalisée), nouvelle valeur, confirmation, journal, annulation possible. */
function DataFixTool({ sb, id, email, onDone }: { sb: SupabaseClient; id: string; email: string; onDone: (t: string) => void }) {
  const [path, setPath] = useState("settings / name");
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState<{ path: string[]; value: unknown } | null>(null);
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => { try { return { ok: true as const, v: JSON.parse(next) as unknown }; } catch { return { ok: false as const }; } }, [next]);
  const read = async () => {
    setErr(null); setCurrent(null);
    if (reason.trim().length < 10) { setErr("Justification de 10 caractères minimum requise (elle est journalisée)."); return; }
    setBusy(true);
    try { const p = parsePath(path); const v = await admin.readData(sb, id, p, reason); setCurrent({ path: p, value: v }); setNext(JSON.stringify(v, null, 2)); }
    catch (e) { setErr(supportError(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!current || !parsed.ok) return;
    setBusy(true);
    try { await admin.fixData(sb, id, current.path, current.value, parsed.v, reason); setConfirm(false); setCurrent(null); setNext(""); onDone("Valeur corrigée et journalisée. L'appareil de l'utilisateur la recevra à la prochaine synchronisation."); }
    catch (e) { setErr(supportError(e)); setConfirm(false); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><AlertTriangle size={15} />Correction ciblée des données (accès exceptionnel)</span>}>
      <div className="flex flex-col gap-3 text-[12.5px]">
        <p className="text-muted">À n'utiliser que pour résoudre un problème signalé. La lecture et la modification sont journalisées avec ta justification. Utilisateur concerné : <b className="text-fg">{email}</b>.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Labeled label="Donnée ciblée (chemin)" htmlFor="fix-path" hint="Ex. : settings / name · tasks / id:abc123 / title · budget / monthly">
            <input id="fix-path" className={cx(inputCls, "font-mono")} value={path} onChange={(e) => { setPath(e.target.value); setCurrent(null); }} /></Labeled>
          <Labeled label="Justification" htmlFor="fix-reason" hint="Ex. : « Ticket #12 : titre corrompu après import »"><input id="fix-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labeled>
        </div>
        <Btn className="self-start" onClick={() => void read()} disabled={busy}>Lire la valeur actuelle (journalisé)</Btn>
        {err && <Banner tone="bad">{err}</Banner>}
        {current && <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 font-semibold">Valeur actuelle</p><pre className="max-h-48 overflow-auto rounded-xl bg-sunken p-2.5 font-mono text-[11.5px]">{JSON.stringify(current.value, null, 2)}</pre></div>
          <div><p className="mb-1 font-semibold">Nouvelle valeur (JSON)</p><TextArea aria-label="Nouvelle valeur" className="font-mono text-[11.5px]" value={next} onChange={(e) => setNext(e.target.value)} rows={5} />
            {!parsed.ok && <p className="text-[11.5px] text-bad">JSON invalide (un texte s'écrit entre guillemets : "Mon titre").</p>}
            <Btn className="mt-2" variant="primary" disabled={!parsed.ok || JSON.stringify(parsed.ok && parsed.v) === JSON.stringify(current.value)} onClick={() => setConfirm(true)}>Vérifier et enregistrer…</Btn></div>
        </div>}
      </div>
      {confirm && current && parsed.ok && (
        <Modal title="Confirmer la correction" onClose={() => setConfirm(false)}>
          <div className="flex flex-col gap-3 text-[13px]">
            <p>Utilisateur : <b>{email}</b><br />Donnée : <span className="font-mono">{current.path.join(" / ")}</span><br />Justification : « {reason} »</p>
            <div className="grid gap-2 sm:grid-cols-2"><div><p className="text-[11px] font-semibold uppercase text-muted">Avant</p><pre className="overflow-auto rounded-lg bg-sunken p-2 font-mono text-[11px]">{JSON.stringify(current.value, null, 2)}</pre></div>
              <div><p className="text-[11px] font-semibold uppercase text-muted">Après</p><pre className="overflow-auto rounded-lg bg-hi/40 p-2 font-mono text-[11px]">{JSON.stringify(parsed.v, null, 2)}</pre></div></div>
            <p className="text-[12px] text-muted">L'enregistrement est refusé si la valeur a changé entre-temps. Tu pourras annuler depuis l'historique.</p>
            <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setConfirm(false)}>Annuler</Btn><Btn variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Confirmer la correction"}</Btn></div>
          </div>
        </Modal>)}
    </Card>
  );
}

// ------------------------------------------------------------- Tickets
function TicketsList({ sb, nav, tick }: { sb: SupabaseClient; nav: Nav; tick: number }) {
  const [f, setF] = useState({ q: "", kind: "", status: "active", priority: "", assigned: "", sort: "activity", page: 0, owner: new URLSearchParams(window.location.search).get("owner") ?? "" });
  const [q, setQ] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setF((x) => (x.q === q ? x : { ...x, q, page: 0 })), 300); return () => window.clearTimeout(t); }, [q]);
  const { data, err, loading, reload } = useLoad(() => admin.tickets(sb, f), [sb, JSON.stringify(f), tick]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value, page: 0 });
  const lab = "flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
          <label className={cx(lab, "col-span-2")}>Recherche<span className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className={cx(inputCls, "pl-8")} placeholder="Sujet, texte, e-mail ou #numéro" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ticket-search" /></span></label>
          <label className={lab}>Type<Select value={f.kind} onChange={set("kind")}><option value="">Tous</option><option value="bug">Signalements</option><option value="help">Assistance</option></Select></label>
          <label className={lab}>Statut<Select value={f.status} onChange={set("status")} data-testid="ticket-status-filter"><option value="active">Non résolus</option><option value="">Tous</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></label>
          <label className={lab}>Priorité<Select value={f.priority} onChange={set("priority")}><option value="">Toutes</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></label>
          <label className={lab}>Assigné<Select value={f.assigned} onChange={set("assigned")}><option value="">Tous</option><option value="me">À moi</option><option value="none">Non assignés</option></Select></label>
          <label className={lab}>Tri<Select value={f.sort} onChange={set("sort")}><option value="activity">Dernière activité</option><option value="new">Plus récents</option><option value="old">Plus anciens</option><option value="priority">Priorité</option></Select></label>
        </div>
        {f.owner && <p className="mt-3 text-[12px]">Filtré sur un utilisateur · <button className="font-semibold underline" onClick={() => { history.replaceState(null, "", window.location.pathname); setF({ ...f, owner: "" }); }}>retirer le filtre</button></p>}
      </Card>
      {err && <ErrorBox err={err} retry={() => void reload()} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty icon={<FileText size={22} />} title="Aucun ticket" hint="Aucun ticket ne correspond à ces filtres." /> : (
        <Card title={<span>{data.total} ticket{data.total > 1 ? "s" : ""}{loading ? " · …" : ""}</span>}>
          <ul className="-mx-2 flex flex-col gap-1" data-testid="tickets-list">{data.rows.map((t) => (
            <li key={t.id}>
              <button onClick={() => nav({ name: "admin", section: "tickets", id: t.id })} data-priority={t.priority}
                className={cx("flex w-full flex-col gap-1 rounded-xl border-2 px-3 py-2.5 text-left hover:bg-sunken sm:flex-row sm:items-center sm:gap-3", t.priority === "critical" ? "border-bad bg-bad/5" : "border-transparent")}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {t.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-pink" aria-label="Nouveau message" />}
                  <span className="font-mono text-[11px] text-muted">#{t.number}</span>
                  <span className={cx("min-w-0 truncate text-[13px]", t.unread ? "font-bold" : "font-semibold")}>{t.subject}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span className="max-w-[180px] truncate">{t.owner_email}</span><span>· {KIND_LABEL[t.kind]}</span><span>· {fmtShort(t.last_message_at)}</span>
                  {t.assigned_email && <span>· {t.assigned_email.split("@")[0]}</span>}
                  <PriorityPill p={t.priority} /><StatusPill status={t.status} />
                </span>
              </button>
            </li>))}</ul>
          <Pager page={f.page} size={25} total={data.total} onPage={(p) => setF({ ...f, page: p })} />
        </Card>)}
    </div>
  );
}

function TicketDetail({ sb, id, nav, tick, me }: { sb: SupabaseClient; id: string; nav: Nav; tick: number; me: string }) {
  const { data: d, err, reload } = useLoad(() => admin.ticket(sb, id), [sb, id, tick]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [admins, setAdmins] = useState<{ id: string; email: string }[]>([]);
  const [body, setBody] = useState(""); const [after, setAfter] = useState<"" | TicketStatus>(""); const [file, setFile] = useState<File | null>(null); const [fileErr, setFileErr] = useState<string>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const loadMsgs = useCallback(async () => { try { setMsgs(await getMessages(sb, id)); void markTicketRead(sb, id).catch(() => {}); } catch (e) { setMsg({ tone: "bad", text: supportError(e) }); } }, [sb, id]);
  useEffect(() => { void loadMsgs(); }, [loadMsgs, tick]);
  useEffect(() => { void admin.admins(sb).then(setAdmins).catch(() => {}); }, [sb]);
  if (err && !d) return <div className="flex flex-col gap-3"><Back nav={nav} section="tickets" /><ErrorBox err={err} retry={() => void reload()} /></div>;
  if (!d) return <Loading />;
  const t = d.ticket;
  const update = async (p: { status?: TicketStatus; priority?: TicketPriority; assigned?: string | null }, label: string) => {
    setBusy("upd"); const e = await run(() => admin.updateTicket(sb, id, p)); setBusy(null);
    setMsg(e ? { tone: "bad", text: e } : { tone: "ok", text: label }); if (!e) { void reload(); void loadMsgs(); }
  };
  const reply = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null);
    const text = body.trim(); if (!text) { setMsg({ tone: "bad", text: "Écris une réponse avant d'envoyer." }); return; }
    if (text.length > LIMITS.message) { setMsg({ tone: "bad", text: "5000 caractères maximum." }); return; }
    setBusy("reply");
    try {
      const path = file ? await uploadAttachment(sb, me, file) : null;
      await postMessage(sb, id, text, path, after || null);
      setBody(""); setFile(null); setAfter(""); setMsg({ tone: "ok", text: "Réponse envoyée : l'utilisateur la voit dans Mes demandes." });
      void reload(); void loadMsgs();
    } catch (e) { setMsg({ tone: "bad", text: supportError(e) + " La réponse n'a PAS été envoyée ; ton texte est conservé." }); } finally { setBusy(null); }
  };
  const addNote = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!note.trim()) return;
    setBusy("note"); const e = await run(() => admin.addTicketNote(sb, id, note)); setBusy(null);
    if (e) setMsg({ tone: "bad", text: e }); else { setNote(""); void reload(); }
  };
  return (
    <div className="flex flex-col gap-4" data-testid="admin-ticket">
      <Back nav={nav} section="tickets" />
      <Card className={t.priority === "critical" ? "!border-bad" : ""}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] text-muted"><span className="font-mono">#{t.number}</span> · {KIND_LABEL[t.kind]} · {categoryLabel(t.category)}{t.module ? ` · ${MODULES[t.module]}` : ""}</p>
            <h2 className="mt-0.5 break-words font-display text-xl font-extrabold">{t.subject}</h2>
            <p className="mt-1 text-[12.5px]">De <button className="font-semibold underline" onClick={() => nav({ name: "admin", section: "users", id: t.owner_id })}>{t.owner_name || t.owner_email}</button> <span className="text-muted">({t.owner_email}{t.owner_status === "suspended" ? ", suspendu" : ""})</span></p>
            <p className="mt-0.5 text-[12px] text-muted">Créé le {fmtDateTime(t.created_at)} · dernière activité {fmtShort(t.last_message_at)}{t.resolved_at ? ` · résolu le ${fmtDateTime(t.resolved_at)}` : ""}</p>
            {t.kind === "bug" && <p className="mt-1 text-[12px]">Fréquence : <b>{FREQUENCIES[t.frequency ?? ""] ?? "—"}</b> · Impact : <b>{IMPACTS[t.impact ?? ""] ?? "—"}</b></p>}
            {t.kind === "help" && t.urgency && <p className="mt-1 text-[12px]">Urgence indiquée : <b>{URGENCIES[t.urgency]}</b></p>}
            {t.tech && <p className="mt-1 break-all text-[11.5px] text-muted">Technique : {Object.entries(t.tech).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>}
          </div>
          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[460px]">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Statut
              <Select value={t.status} disabled={busy === "upd"} onChange={(e) => void update({ status: e.target.value as TicketStatus }, "Statut mis à jour.")} data-testid="admin-status">{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Priorité
              <Select value={t.priority} disabled={busy === "upd"} onChange={(e) => void update({ priority: e.target.value as TicketPriority }, "Priorité mise à jour.")} data-testid="admin-priority">{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Assigné à
              <Select value={t.assigned_to ?? ""} disabled={busy === "upd"} onChange={(e) => void update({ assigned: e.target.value || null }, "Assignation mise à jour.")}><option value="">Personne</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.id === me ? "Moi" : a.email}</option>)}</Select></label>
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              {t.status !== "resolved" && t.status !== "closed" ? <Btn size="sm" onClick={() => void update({ status: "resolved" }, "Ticket marqué comme résolu.")}>Marquer résolu</Btn>
                : <Btn size="sm" onClick={() => void update({ status: "open" }, "Ticket rouvert.")}>Rouvrir</Btn>}
              {!t.assigned_to && <Btn size="sm" variant="ghost" onClick={() => void update({ assigned: me }, "Ticket assigné à toi.")}>M'assigner</Btn>}
            </div>
          </div>
        </div>
      </Card>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <Card title="Conversation (visible par l'utilisateur)"><Thread sb={sb} messages={msgs} viewer="admin" ticket={t as Ticket} /></Card>
          <form onSubmit={(e) => void reply(e)} noValidate data-testid="admin-reply">
            <Card title="Répondre à l'utilisateur">
              <div className="flex flex-col gap-3">
                <TextArea aria-label="Réponse à l'utilisateur" value={body} onChange={(e) => setBody(e.target.value)} rows={4} max={LIMITS.message} placeholder="Ta réponse sera visible par l'utilisateur dans Mes demandes." />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <AttachPicker file={file} onChange={setFile} error={fileErr} onError={setFileErr} label="Joindre une image" />
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Statut après l'envoi
                    <Select value={after} onChange={(e) => setAfter(e.target.value as TicketStatus | "")} data-testid="reply-status"><option value="">Inchangé{t.status === "new" ? " (→ Ouvert)" : ""}</option>
                      <option value="in_progress">En cours</option><option value="waiting_user">En attente de l'utilisateur</option><option value="resolved">Résolu</option><option value="closed">Fermé</option></Select></label>
                </div>
                <div className="flex justify-end"><Btn type="submit" variant="primary" disabled={busy === "reply"}>{busy === "reply" ? "Envoi…" : "Envoyer la réponse"}</Btn></div>
              </div>
            </Card>
          </form>
        </div>
        <div className="flex flex-col gap-4">
          <Card title={<span className="flex items-center gap-2">Notes internes <Pill tone="warn">jamais visibles par l'utilisateur</Pill></span>}>
            <form onSubmit={(e) => void addNote(e)} className="flex flex-col gap-2" data-testid="admin-note">
              <TextArea aria-label="Note interne" value={note} onChange={(e) => setNote(e.target.value)} rows={2} max={LIMITS.message} placeholder="Piste, contexte, lien vers un correctif…" />
              <Btn type="submit" size="sm" className="self-end" disabled={!note.trim() || busy === "note"}>Ajouter la note</Btn>
            </form>
            <ul className="mt-3 flex flex-col gap-2">{d.notes.map((n) => <li key={n.id} className="rounded-xl border-2 border-warn/40 bg-warn/10 p-2.5 text-[12.5px]"><p className="whitespace-pre-wrap break-words">{n.body}</p><p className="mt-1 text-[11px] text-muted">{n.author ?? "—"} · {fmtShort(n.created_at)}</p></li>)}</ul>
          </Card>
          <Card title="Historique">
            {d.audit.length ? <ul className="flex flex-col gap-1.5 text-[12px]">{d.audit.map((a) => <li key={a.id}><span className="text-muted">{fmtShort(a.created_at)}</span> · <b>{AUDIT_LABEL[a.action] ?? a.action}</b> <span className="text-muted">par {a.actor_email}</span>{auditText(a) && <span className="block font-mono text-[11px]">{auditText(a)}</span>}</li>)}</ul>
              : <p className="text-[12.5px] text-muted">Aucune action pour l'instant.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Journal d'audit
function AuditLog({ sb, nav }: { sb: SupabaseClient; nav: Nav }) {
  const [f, setF] = useState({ action: "", page: 0 });
  const { data, err, reload } = useLoad(() => admin.audit(sb, f), [sb, f.action, f.page]);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Action
            <Select value={f.action} onChange={(e) => setF({ action: e.target.value, page: 0 })}><option value="">Toutes</option>{Object.entries(AUDIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          <p className="text-[12px] text-muted">Le journal est en lecture seule : il ne peut être ni modifié ni effacé, y compris par un administrateur.</p>
        </div>
      </Card>
      {err && <ErrorBox err={err} retry={() => void reload()} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty icon={<Database size={22} />} title="Journal vide" hint="Aucune entrée pour ce filtre." /> : (
        <Card title={`${data.total} entrée${data.total > 1 ? "s" : ""}`}>
          <ul className="flex flex-col" data-testid="audit-list">{data.rows.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 border-b border-dashed border-line py-2 text-[12.5px] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
              <span className="text-muted">{fmtDateTime(a.created_at)}</span><b>{AUDIT_LABEL[a.action] ?? a.action}</b><span className="text-muted">par {a.actor_email ?? "système"}</span>
              {a.target_email && <button className="text-left underline" onClick={() => a.target_user && nav({ name: "admin", section: "users", id: a.target_user })}>{a.target_email}</button>}
              {a.target_ticket && <button className="text-left underline" onClick={() => nav({ name: "admin", section: "tickets", id: a.target_ticket! })}>ticket</button>}
              {auditText(a) && <span className="break-all font-mono text-[11px]">{auditText(a)}</span>}{a.reason && <span className="italic text-muted">« {a.reason} »</span>}
            </li>))}</ul>
          <Pager page={f.page} size={50} total={data.total} onPage={(p) => setF({ ...f, page: p })} />
        </Card>)}
    </div>
  );
}
