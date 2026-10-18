/* Étudiant.OS — onglet « Colocation » : appartement partagé, courses communes, dépenses partagées, « qui doit combien à qui ».
 * Les données sont dans la base (pas dans l'état personnel) ; elles sont relues toutes les 15 s, au retour sur l'onglet et après chaque action. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn, Card, Empty, Field, Input, Pill, Plus, Select, Trash2, Users, X, guessAisle, useStore } from "./StudentOS.tsx";
import { supabase } from "./supabase.ts";
import { balances, centsFromInput, eurosOf, flatChoreAssignee, flatChoreOn, nameOf, settleUp, sharesFor } from "./flat.ts";
import type { Flat, FlatChore, FlatChoreDone, FlatExpense, FlatGrocery } from "./flat.ts";
import * as api from "./flatApi.ts";
import { FLAT_CHANGED } from "./useFlatChores.ts";
import { DAYS, DAYS_LONG, addDays, cx, fmtDate, iso, todayISO, weekday } from "./core.ts";

type Tab = "courses" | "depenses" | "menage" | "membres";

/** Fenêtre au centre (ne se ferme pas en touchant à côté : on perd rarement ce qu'on a saisi). */
const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px] animate-fade">
      <div className="inked sheet max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[22px] bg-panel p-5 animate-pop" role="dialog" aria-modal="true" aria-label={title}>
        <header className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold">{title}</h2><Btn variant="ghost" size="sm" onClick={onClose} aria-label="Fermer"><X size={14} /></Btn></header>
        {children}
      </div>
    </div>, document.body);
};

/** Choix du payeur et des participants (parts égales) : sert aux courses validées et aux dépenses. */
const SplitFields: React.FC<{ flat: Flat; paidBy: string; setPaidBy: (v: string) => void; who: string[]; setWho: (v: string[]) => void; idp: string }> = ({ flat, paidBy, setPaidBy, who, setWho, idp }) => {
  const active = flat.members.filter((m) => !m.left);
  return (
    <>
      <Field label="Payé par" htmlFor={`${idp}-payer`}><Select id={`${idp}-payer`} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}{m.user_id === flat.me ? " (moi)" : ""}</option>)}</Select></Field>
      <fieldset className="mt-2"><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Partagé entre</legend>
        <div className="flex flex-wrap gap-2">{active.map((m) => (
          <label key={m.user_id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold", who.includes(m.user_id) ? "border-fg bg-hi/60" : "border-line text-muted")}>
            <input type="checkbox" className="sr-only" checked={who.includes(m.user_id)} onChange={() => setWho(who.includes(m.user_id) ? who.filter((x) => x !== m.user_id) : [...who, m.user_id])} />{m.display_name}</label>))}</div>
      </fieldset>
    </>
  );
};

export const FlatView: React.FC = () => {
  const { env, toast } = useStore();
  const sb = supabase;
  const [flat, setFlat] = useState<Flat | null | undefined>(undefined);
  const [groceries, setGroceries] = useState<FlatGrocery[]>([]);
  const [expenses, setExpenses] = useState<FlatExpense[]>([]);
  const [chores, setChores] = useState<FlatChore[]>([]);
  const [done, setDone] = useState<FlatChoreDone[]>([]);
  /** false tant que la migration du ménage partagé n'est pas appliquée : le reste de la colocation continue de fonctionner. */
  const [choresOk, setChoresOk] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("courses");
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!sb || busy.current) return;
    busy.current = true;
    try {
      const f = await api.loadFlat(sb);
      setFlat(f); setErr(null);
      if (f) {
        const [g, e, cd] = await Promise.all([api.loadGroceries(sb, f.id), api.loadExpenses(sb, f.id),
          Promise.all([api.loadChores(sb, f.id), api.loadChoreDone(sb, f.id)]).catch(() => null)]);
        setGroceries(g); setExpenses(e); setChoresOk(cd !== null); if (cd) { setChores(cd[0]); setDone(cd[1]); }
      } else { setGroceries([]); setExpenses([]); setChores([]); setDone([]); }
    } catch (e) { setErr(api.flatError(e)); setFlat((cur) => (cur === undefined ? null : cur)); }
    finally { busy.current = false; }
  }, [sb]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const v = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", v);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [refresh]);
  /** Exécute une action puis relit les données ; l'erreur est affichée en clair. */
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, "ok"); } catch (e) { toast(api.flatError(e), "bad"); }
    busy.current = false; await refresh();
    window.dispatchEvent(new Event(FLAT_CHANGED));
  };

  if (!sb || env.mode !== "cloud") return <Card><Empty icon={<Users size={18} />} title="Colocation : compte nécessaire" hint="Créez un compte (Réglages) pour partager une liste de courses et des dépenses avec vos colocataires. En mode local, les données restent sur cet appareil seulement." /></Card>;
  if (flat === undefined) return <Card><p className="py-8 text-center text-sm text-muted">Chargement…</p></Card>;
  if (flat === null) return <NoFlat err={err} defaultName={env.account?.displayName ?? ""} onCreate={(n, d) => act(() => api.createFlat(sb, n, d), "Appartement créé")} onJoin={async (c, d) => { try { const okj = await api.joinFlat(sb, c, d); if (!okj) { toast("Code d'invitation invalide.", "bad"); return; } toast("Vous avez rejoint l'appartement", "ok"); } catch (e) { toast(api.flatError(e), "bad"); } busy.current = false; await refresh(); window.dispatchEvent(new Event(FLAT_CHANGED)); }} />;

  const active = flat.members.filter((m) => !m.left);
  const iAmOwner = flat.members.find((m) => m.user_id === flat.me)?.role === "owner";
  return (
    <div className="flex flex-col gap-4" data-testid="flat-view">
      <Card title={<span className="flex items-center gap-2"><Users size={15} />{flat.name} <Pill tone="info">{active.length} membre{active.length > 1 ? "s" : ""}</Pill></span>}
        action={<div className="flex gap-1">{([["courses", "Courses"], ["depenses", "Dépenses"], ["menage", "Ménage"], ["membres", "Membres"]] as [Tab, string][]).map(([k, l]) => <Btn key={k} size="sm" variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)} data-testid={`flat-tab-${k}`}>{l}</Btn>)}</div>}>
        {err && <p role="alert" className="mb-2 rounded-lg bg-warn/15 px-3 py-2 text-xs">{err}</p>}
        {tab === "courses" && <FlatGroceries flat={flat} items={groceries} act={act} sb={sb} />}
        {tab === "depenses" && <FlatExpenses flat={flat} expenses={expenses} act={act} sb={sb} />}
        {tab === "menage" && !choresOk && <p className="rounded-lg bg-warn/15 px-3 py-2 text-xs" data-testid="flat-chores-off">Le ménage partagé n'est pas encore activé sur ce serveur (mise à jour de la base à appliquer). Le reste de la colocation fonctionne normalement.</p>}
        {tab === "menage" && choresOk && <FlatChores flat={flat} chores={chores} done={done} act={act} sb={sb} />}
        {tab === "membres" && <FlatMembers flat={flat} iAmOwner={iAmOwner} act={act} sb={sb} />}
      </Card>
    </div>
  );
};

const NoFlat: React.FC<{ err: string | null; defaultName: string; onCreate: (n: string, d: string) => void; onJoin: (c: string, d: string) => void }> = ({ err, defaultName, onCreate, onJoin }) => {
  const [name, setName] = useState(""), [me, setMe] = useState(defaultName), [code, setCode] = useState("");
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {err && <p role="alert" className="rounded-lg bg-warn/15 px-3 py-2 text-xs md:col-span-2">{err}</p>}
      <Card title="Créer un appartement">
        <p className="mb-3 text-xs text-muted">Une liste de courses commune, des dépenses partagées et le calcul « qui doit combien à qui ». Vous invitez ensuite vos colocataires avec un code.</p>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && me.trim()) onCreate(name.trim(), me.trim()); }}>
          <Field label="Nom de l'appartement" htmlFor="fl-name"><Input id="fl-name" placeholder="Ex. Coloc des Lilas" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Votre prénom (visible des colocataires)" htmlFor="fl-me"><Input id="fl-me" maxLength={80} value={me} onChange={(e) => setMe(e.target.value)} /></Field>
          <Btn type="submit" variant="primary" disabled={!name.trim() || !me.trim()}>Créer l'appartement</Btn>
        </form>
      </Card>
      <Card title="Rejoindre avec un code">
        <p className="mb-3 text-xs text-muted">Demandez le code à 10 caractères à un colocataire (onglet Membres).</p>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim() && me.trim()) onJoin(code.trim(), me.trim()); }}>
          <Field label="Code d'invitation" htmlFor="fl-code"><Input id="fl-code" className="font-mono uppercase" placeholder="ABCDE12345" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Votre prénom (visible des colocataires)" htmlFor="fl-me2"><Input id="fl-me2" maxLength={80} value={me} onChange={(e) => setMe(e.target.value)} /></Field>
          <Btn type="submit" variant="primary" disabled={!code.trim() || !me.trim()}>Rejoindre</Btn>
        </form>
      </Card>
    </div>
  );
};

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
type Sb = NonNullable<typeof supabase>;

const FlatGroceries: React.FC<{ flat: Flat; items: FlatGrocery[]; act: Act; sb: Sb }> = ({ flat, items, act, sb }) => {
  const [name, setName] = useState(""), [qty, setQty] = useState(""), [price, setPrice] = useState("");
  const [pay, setPay] = useState(false);
  const checked = items.filter((g) => g.checked);
  const total = checked.reduce((n, g) => n + g.price_cents, 0);
  return (
    <div>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const c = price.trim() ? centsFromInput(price) : 0; if (c === null) return; void act(() => api.addGrocery(sb, name.trim(), guessAisle(name), qty.trim(), c)); setName(""); setQty(""); setPrice(""); }}>
        <Input id="fg-name" aria-label="Article" placeholder="Ex. Lait, papier toilette…" className="min-w-0 flex-1" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Input id="fg-qty" aria-label="Quantité" placeholder="Qté" className="w-16" maxLength={40} value={qty} onChange={(e) => setQty(e.target.value)} />
        <Input id="fg-price" aria-label="Prix estimé" inputMode="decimal" placeholder="Prix" className="w-20" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Btn type="submit" variant="primary"><Plus size={14} />Ajouter</Btn>
      </form>
      {!items.length ? <Empty icon={<Users size={18} />} title="Liste commune vide" hint="Chaque colocataire peut ajouter et cocher des articles. Tout le monde voit la même liste." /> : (
        <ul className="flex flex-col" data-testid="flat-groceries">
          {items.map((g) => (
            <li key={g.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-sunken">
              <input type="checkbox" aria-label={g.checked ? "Décocher" : "Cocher"} checked={g.checked} onChange={() => void act(() => api.setGrocery(sb, g.id, !g.checked, null))} />
              <span className={cx("min-w-0 flex-1 truncate", g.checked && "text-muted line-through")}>{g.name}{g.qty && <span className="ml-2 font-mono text-xs text-muted">{g.qty}</span>}</span>
              <span className="text-[11px] text-muted">{nameOf(flat, g.added_by)}</span>
              {g.price_cents > 0 && <span className="font-mono text-xs tabular-nums text-muted">{eurosOf(g.price_cents)}</span>}
              <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label="Supprimer" onClick={() => void act(() => api.removeGrocery(sb, g.id))}><Trash2 size={12} /></button>
            </li>))}
        </ul>)}
      {checked.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-sm">{checked.length} coché{checked.length > 1 ? "s" : ""}{total > 0 && <> · estimé <b className="font-mono">{eurosOf(total)}</b></>}</p>
          <Btn variant="primary" onClick={() => setPay(true)} data-testid="flat-checkout">Valider les achats</Btn>
        </div>)}
      {pay && <ExpenseDialog flat={flat} title="Valider les achats communs" defaultLabel="Courses" defaultCents={total} onClose={() => setPay(false)} withDate
        onSubmit={async (e) => { await act(() => api.checkoutGroceries(sb, e), "Achats enregistrés : dépense partagée créée"); setPay(false); }} />}
    </div>
  );
};

const ExpenseDialog: React.FC<{ flat: Flat; title: string; defaultLabel: string; defaultCents: number; withDate?: boolean; onClose: () => void; onSubmit: (e: { cents: number; label: string; date: string; paidBy: string; shares: Record<string, number> }) => Promise<void> }> = ({ flat, title, defaultLabel, defaultCents, onClose, onSubmit }) => {
  const active = flat.members.filter((m) => !m.left);
  const [label, setLabel] = useState(defaultLabel), [amount, setAmount] = useState(defaultCents ? (defaultCents / 100).toFixed(2).replace(".", ",") : "");
  const [date, setDate] = useState(todayISO()), [paidBy, setPaidBy] = useState(flat.me), [who, setWho] = useState(active.map((m) => m.user_id));
  const [working, setWorking] = useState(false);
  const cents = centsFromInput(amount);
  const shares = cents && who.length ? sharesFor(cents, who) : null;
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Field label="Libellé" htmlFor="fe-label"><Input id="fe-label" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Montant payé (€)" htmlFor="fe-amount"><Input id="fe-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date" htmlFor="fe-date"><Input id="fe-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <SplitFields flat={flat} paidBy={paidBy} setPaidBy={setPaidBy} who={who} setWho={setWho} idp="fe" />
        {shares && <p className="text-xs text-muted" data-testid="fe-preview">{who.length} personne{who.length > 1 ? "s" : ""} · {Object.values(shares).every((v) => v === Object.values(shares)[0]) ? `${eurosOf(Object.values(shares)[0])} chacune` : `de ${eurosOf(Math.min(...Object.values(shares)))} à ${eurosOf(Math.max(...Object.values(shares)))} chacune`}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" data-testid="fe-submit" disabled={!shares || working || !date} onClick={async () => { if (!cents || !shares) return; setWorking(true); try { await onSubmit({ cents, label: label.trim(), date, paidBy, shares }); } finally { setWorking(false); } }}>Enregistrer</Btn>
        </div>
      </div>
    </Dialog>
  );
};

const FlatExpenses: React.FC<{ flat: Flat; expenses: FlatExpense[]; act: Act; sb: Sb }> = ({ flat, expenses, act, sb }) => {
  const [add, setAdd] = useState(false);
  const bal = useMemo(() => balances(expenses), [expenses]);
  const transfers = useMemo(() => settleUp(bal), [bal]);
  const myBal = bal[flat.me] ?? 0;
  const owner = flat.members.find((m) => m.user_id === flat.me)?.role === "owner";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" data-testid="flat-my-balance">{myBal === 0 ? "Vous êtes à l'équilibre." : myBal > 0 ? <>On vous doit <b className="font-mono text-ok">{eurosOf(myBal)}</b> au total.</> : <>Vous devez <b className="font-mono text-bad">{eurosOf(-myBal)}</b> au total.</>}</p>
        <Btn variant="primary" onClick={() => setAdd(true)} data-testid="flat-add-expense"><Plus size={14} />Ajouter une dépense</Btn>
      </div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Qui doit combien à qui</p>
      {!transfers.length ? <p className="mb-3 rounded-lg bg-sunken px-3 py-2 text-xs text-muted" data-testid="flat-settled">Tout est réglé : personne ne doit rien.</p> : (
        <ul className="mb-3 flex flex-col gap-1.5" data-testid="flat-transfers">
          {transfers.map((t) => (
            <li key={`${t.from}-${t.to}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-2 text-[13px]">
              <span><b>{nameOf(flat, t.from)}</b> doit <b className="font-mono">{eurosOf(t.cents)}</b> à <b>{nameOf(flat, t.to)}</b></span>
              {(t.from === flat.me || t.to === flat.me || owner) && <Btn size="sm" onClick={() => void act(() => api.addExpense(sb, { cents: t.cents, label: "Remboursement", date: todayISO(), paidBy: t.from, shares: { [t.to]: t.cents }, kind: "payment" }), "Remboursement enregistré")}>Marquer remboursé</Btn>}
            </li>))}
        </ul>)}
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Historique</p>
      {!expenses.length ? <Empty icon={<Users size={18} />} title="Aucune dépense" hint="Ajoutez une dépense ou validez les achats de la liste commune : le partage est calculé automatiquement." /> : (
        <ul className="flex flex-col" data-testid="flat-expenses">
          {expenses.map((e) => (
            <li key={e.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-sunken">
              <span className="w-20 shrink-0 font-mono text-[11px] text-muted">{fmtDate(e.spent_on)}</span>
              <span className="min-w-0 flex-1 truncate">{e.kind === "payment" ? <><b>{nameOf(flat, e.paid_by)}</b> a remboursé <b>{nameOf(flat, Object.keys(e.shares)[0])}</b></> : <>{e.label || "Dépense"} <span className="text-xs text-muted">payé par {nameOf(flat, e.paid_by)}</span></>}</span>
              <span className="font-mono text-xs tabular-nums">{eurosOf(e.amount_cents)}</span>
              {(e.created_by === flat.me || owner) && <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label="Supprimer la dépense" onClick={() => void act(() => api.removeExpense(sb, e.id))}><Trash2 size={12} /></button>}
            </li>))}
        </ul>)}
      {add && <ExpenseDialog flat={flat} title="Nouvelle dépense partagée" defaultLabel="" defaultCents={0} onClose={() => setAdd(false)} withDate
        onSubmit={async (e) => { await act(() => api.addExpense(sb, e), "Dépense ajoutée"); setAdd(false); }} />}
    </div>
  );
};

const FlatMembers: React.FC<{ flat: Flat; iAmOwner: boolean; act: Act; sb: Sb }> = ({ flat, iAmOwner, act, sb }) => {
  const [leave, setLeave] = useState(false);
  const active = flat.members.filter((m) => !m.left);
  return (
    <div>
      <ul className="mb-4 flex flex-col gap-1">
        {active.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-sunken">
            <span className="min-w-0 flex-1 truncate">{m.display_name}{m.user_id === flat.me && " (moi)"}</span>
            {m.role === "owner" && <Pill tone="info">propriétaire</Pill>}
            {iAmOwner && m.user_id !== flat.me && <Btn size="sm" variant="danger" onClick={() => { if (window.confirm(`Retirer ${m.display_name} de l'appartement ?`)) void act(() => api.removeMember(sb, m.user_id), "Membre retiré"); }}>Retirer</Btn>}
          </li>))}
      </ul>
      <div className="rounded-xl border-2 border-line p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Code d'invitation</p>
        <p className="my-1 font-mono text-xl font-bold tracking-widest" data-testid="flat-code">{flat.invite_code}</p>
        <p className="mb-2 text-xs text-muted">Donnez-le à vos colocataires : ils le saisissent dans Colocation → Rejoindre. Toute personne qui a le code peut rejoindre (8 membres maximum) : ne le publiez pas.</p>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => { void navigator.clipboard?.writeText(flat.invite_code).then(() => undefined, () => undefined); }}>Copier le code</Btn>
          {iAmOwner && <Btn size="sm" onClick={() => { if (window.confirm("Générer un nouveau code ? L'ancien ne fonctionnera plus.")) void act(() => api.regenerateCode(sb), "Nouveau code généré"); }}>Nouveau code</Btn>}
        </div>
      </div>
      <div className="mt-4"><Btn variant="danger" onClick={() => setLeave(true)} data-testid="flat-leave">Quitter l'appartement</Btn></div>
      {leave && <Dialog title="Quitter l'appartement ?" onClose={() => setLeave(false)}>
        <p className="text-sm text-muted">Vous ne verrez plus la liste ni les dépenses.{iAmOwner ? " Le plus ancien colocataire deviendra propriétaire." : ""} Si vous êtes le dernier membre, l'appartement et son historique sont supprimés. Pensez à régler vos dettes avant de partir.</p>
        <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setLeave(false)}>Rester</Btn><Btn variant="primary" onClick={async () => { await act(() => api.leaveFlat(sb), "Vous avez quitté l'appartement"); setLeave(false); }}>Quitter</Btn></div>
      </Dialog>}
    </div>
  );
};

const FlatChores: React.FC<{ flat: Flat; chores: FlatChore[]; done: FlatChoreDone[]; act: Act; sb: Sb }> = ({ flat, chores, done, act, sb }) => {
  const [offset, setOffset] = useState(0), [add, setAdd] = useState(false);
  const active = flat.members.filter((m) => !m.left), activeIds = active.map((m) => m.user_id);
  const today = todayISO();
  const monday = addDays(new Date(), offset * 7 - weekday(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const doneBy = (id: string, date: string) => done.find((d) => d.chore_id === id && d.done_on === date)?.done_by;
  const owner = flat.members.find((m) => m.user_id === flat.me)?.role === "owner";
  const mineToday = chores.filter((c) => flatChoreOn(c, new Date()) && flatChoreAssignee(c, new Date(), activeIds) === flat.me && !doneBy(c.id, today)).length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" data-testid="flat-chores-summary">{mineToday ? <>Aujourd'hui, <b>{mineToday}</b> corvée{mineToday > 1 ? "s" : ""} pour vous.</> : "Rien à faire pour vous aujourd'hui."}</p>
        <Btn variant="primary" onClick={() => setAdd(true)} data-testid="flat-add-chore"><Plus size={14} />Ajouter une corvée</Btn>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <Btn size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Semaine précédente">←</Btn>
        <span className="text-xs font-semibold text-muted">{offset === 0 ? "Cette semaine" : fmtDate(iso(days[0]))}</span>
        <Btn size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Semaine suivante">→</Btn>
      </div>
      {!chores.length ? <Empty icon={<Users size={18} />} title="Aucune corvée commune" hint="Ajoutez une corvée (vaisselle, poubelles…) et choisissez qui se relaie : tous les colocataires la voient et la cochent." /> : (
        <div className="flex flex-col gap-3" data-testid="flat-chores-week">
          {days.map((d) => {
            const date = iso(d), list = chores.filter((c) => flatChoreOn(c, d));
            if (!list.length) return null;
            return (
              <div key={date}>
                <p className={cx("mb-1 text-[11px] font-semibold uppercase tracking-wider", date === today ? "text-fg" : "text-muted")}>{DAYS_LONG[weekday(d)]} {d.getDate()}{date === today && " · aujourd'hui"}</p>
                <ul className="flex flex-col">{list.map((c) => {
                  const who = flatChoreAssignee(c, d, activeIds), by = doneBy(c.id, date), mine = who === flat.me;
                  return (
                    <li key={c.id} data-testid="flat-chore-row" className={cx("flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-sunken", mine && !by && "bg-hi/30")}>
                      <input type="checkbox" aria-label={by ? "Décocher" : "Cocher"} checked={!!by} onChange={() => void act(() => api.setChoreDone(sb, c.id, date, !by))} />
                      <span className={cx("min-w-0 flex-1 truncate", by && "text-muted line-through")}>{c.name} <span className="font-mono text-[10px] text-muted">{c.minutes} min</span></span>
                      <span className="text-[11px] text-muted">{by ? <>fait par {nameOf(flat, by)}</> : who ? (mine ? <b className="text-fg">à vous</b> : nameOf(flat, who)) : "—"}</span>
                    </li>);
                })}</ul>
              </div>);
          })}
        </div>)}
      {chores.length > 0 && (
        <details className="mt-4 rounded-lg border border-line px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold">Gérer les corvées ({chores.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">{chores.map((c) => (
            <li key={c.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{c.name} · {c.recurrence === "daily" ? "chaque jour" : c.recurrence === "once" ? (c.due_on ? fmtDate(c.due_on) : "une fois") : `${c.recurrence === "weekly" ? "chaque" : "une semaine sur deux,"} ${DAYS_LONG[c.day].toLowerCase()}`}</span>
              {(c.created_by === flat.me || owner) && <button className="text-muted hover:text-bad" aria-label="Supprimer la corvée" onClick={() => { if (window.confirm(`Supprimer la corvée « ${c.name} » ?`)) void act(() => api.removeChore(sb, c.id), "Corvée supprimée"); }}><Trash2 size={12} /></button>}</li>))}</ul>
        </details>)}
      {add && <ChoreDialog flat={flat} onClose={() => setAdd(false)} onSubmit={async (c) => { await act(() => api.addChore(sb, c), "Corvée ajoutée"); setAdd(false); }} />}
    </div>
  );
};

const ChoreDialog: React.FC<{ flat: Flat; onClose: () => void; onSubmit: (c: { name: string; recurrence: FlatChore["recurrence"]; day: number; due: string | null; minutes: number; rotation: string[] }) => Promise<void> }> = ({ flat, onClose, onSubmit }) => {
  const active = flat.members.filter((m) => !m.left);
  const [name, setName] = useState(""), [rec, setRec] = useState<FlatChore["recurrence"]>("weekly"), [day, setDay] = useState((weekday(new Date()) + 1) % 7);
  const [due, setDue] = useState(todayISO()), [minutes, setMinutes] = useState("20"), [who, setWho] = useState(active.map((m) => m.user_id)), [working, setWorking] = useState(false);
  const mins = Math.min(600, Math.max(1, parseInt(minutes, 10) || 20));
  return (
    <Dialog title="Nouvelle corvée commune" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Field label="Nom" htmlFor="fc-name"><Input id="fc-name" placeholder="Ex. Sortir les poubelles" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fréquence" htmlFor="fc-rec"><Select id="fc-rec" value={rec} onChange={(e) => setRec(e.target.value as FlatChore["recurrence"])}><option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option><option value="biweekly">Une semaine sur deux</option><option value="once">Une seule fois</option></Select></Field>
          {rec === "once" ? <Field label="Date" htmlFor="fc-due"><Input id="fc-due" type="date" min={todayISO()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            : rec === "daily" ? <Field label="Durée (min)" htmlFor="fc-min"><Input id="fc-min" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
            : <Field label="Jour" htmlFor="fc-day"><Select id="fc-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>}
        </div>
        {rec !== "daily" && <Field label="Durée (min)" htmlFor="fc-min2"><Input id="fc-min2" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>}
        <fieldset><legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{rec === "once" ? "Qui la fait" : "Rotation entre"}</legend>
          <div className="flex flex-wrap gap-2">{active.map((m) => (
            <label key={m.user_id} className={cx("flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold", who.includes(m.user_id) ? "border-fg bg-hi/60" : "border-line text-muted")}>
              <input type="checkbox" className="sr-only" checked={who.includes(m.user_id)} onChange={() => setWho(rec === "once" ? [m.user_id] : who.includes(m.user_id) ? who.filter((x) => x !== m.user_id) : [...who, m.user_id])} />{m.display_name}</label>))}</div>
          {rec !== "once" && <p className="mt-1 text-[11px] text-muted">Les personnes cochées se relaient dans l'ordre de la liste.</p>}
        </fieldset>
        <div className="mt-2 flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" data-testid="fc-submit" disabled={!name.trim() || working || (rec === "once" && !due)} onClick={async () => { setWorking(true); try { await onSubmit({ name: name.trim(), recurrence: rec, day, due: rec === "once" ? due : null, minutes: mins, rotation: active.map((m) => m.user_id).filter((u) => who.includes(u)) }); } finally { setWorking(false); } }}>Ajouter</Btn>
        </div>
      </div>
    </Dialog>
  );
};
