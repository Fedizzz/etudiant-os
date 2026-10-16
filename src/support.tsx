/* Étudiant.OS — pages de support : « Signaler un problème », « Besoin d'aide ? », « Mes demandes » (conversation). */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cx } from "./core.ts";
import { Card, Btn, Select, Pill, Empty, inputCls, AlertTriangle, Camera, Check, ChevronLeft, FileText, X, Sparkles, Search } from "./StudentOS.tsx";
import {
  BUG_CATEGORIES, HELP_CATEGORIES, MODULES, FREQUENCIES, IMPACTS, URGENCIES, STATUS_LABEL, STATUS_LABEL_USER, KIND_LABEL, LIMITS,
  validateBug, validateHelp, validateAttachment, techInfo, statusTone, priorityTone, PRIORITY_LABEL, categoryLabel, isOpen, fmtDateTime, fmtShort, NOTIF_LABEL,
  type BugForm, type HelpForm, type Errors, type TicketStatus,
} from "./supportModel.ts";
import {
  createTicket, uploadAttachment, attachmentUrl, myTickets, getTicket, getMessages, postMessage, setMyTicketState, markTicketRead, supportError,
  type Ticket, type Message, type Notification,
} from "./supportApi.ts";
import type { Route, SupportPage } from "./router.ts";

export const APP_VERSION = "2.1.0";
type Nav = (r: Route) => void;

// ------------------------------------------------------------- Petits composants partagés (aussi utilisés par l'administration)
export const FieldError: React.FC<{ id: string; msg?: string }> = ({ id, msg }) => msg ? <p id={id} className="text-[12px] font-medium text-bad">{msg}</p> : null;
export const Labeled: React.FC<{ label: string; htmlFor: string; hint?: string; error?: string; optional?: boolean; children: React.ReactNode; className?: string }> =
  ({ label, htmlFor, hint, error, optional, children, className }) => (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-semibold text-fg">{label}{optional && <span className="font-normal text-muted"> · facultatif</span>}</label>
      {hint && <p id={`${htmlFor}-hint`} className="-mt-0.5 text-[11.5px] text-muted">{hint}</p>}
      {children}
      <FieldError id={`${htmlFor}-err`} msg={error} />
    </div>
  );
export const TextArea = ({ max, value, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { max?: number; value: string }) => (
  <div className="relative">
    <textarea {...p} value={value} className={cx(inputCls, "h-auto min-h-[88px] resize-y py-2 leading-relaxed", p.className)} />
    {max && <span className={cx("pointer-events-none absolute bottom-1.5 right-2.5 text-[10px] tabular-nums", value.trim().length > max ? "text-bad" : "text-muted")}>{value.trim().length}/{max}</span>}
  </div>
);
const aria = (id: string, err?: string, hint?: boolean) => ({ id, "aria-invalid": err ? true : undefined, "aria-describedby": [hint && `${id}-hint`, err && `${id}-err`].filter(Boolean).join(" ") || undefined });
export const StatusPill: React.FC<{ status: TicketStatus; forUser?: boolean }> = ({ status, forUser }) => <Pill tone={statusTone(status)}>{(forUser ? STATUS_LABEL_USER : STATUS_LABEL)[status]}</Pill>;
const Banner: React.FC<{ tone: "bad" | "ok" | "info"; children: React.ReactNode }> = ({ tone, children }) => (
  <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-xl border-2 px-3.5 py-2.5 text-[13px]", tone === "bad" ? "border-bad/40 bg-bad/10 text-bad" : tone === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-accent/40 bg-accent/10 text-fg")}>{children}</div>
);
export { Banner };

/** Sélection d'une capture d'écran : vérifiée (format, taille) avant tout envoi, avec aperçu. */
export const AttachPicker: React.FC<{ file: File | null; onChange: (f: File | null) => void; error?: string; onError: (e: string | undefined) => void; label?: string }> = ({ file, onChange, error, onError, label = "Joindre une capture d'écran" }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { if (!file) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <input ref={ref} id={id} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="attach-input"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (!f) return; const err = validateAttachment(f); onError(err ?? undefined); onChange(err ? null : f); }} />
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border-2 border-line bg-sunken p-2">
          {preview && <img src={preview} alt="" className="h-12 w-16 rounded-lg border border-line object-cover" />}
          <div className="min-w-0 flex-1 text-[12px]"><p className="truncate font-semibold">{file.name}</p><p className="text-muted">{(file.size / 1024).toFixed(0)} Ko</p></div>
          <Btn type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Retirer la pièce jointe"><X size={14} /></Btn>
        </div>
      ) : (
        <Btn type="button" variant="soft" className="self-start" onClick={() => ref.current?.click()}><Camera size={15} />{label}</Btn>
      )}
      <p className="text-[11px] text-muted">PNG, JPEG ou WebP · 5 Mo maximum. Vérifie qu'elle ne montre pas d'informations privées.</p>
      {error && <p role="alert" className="text-[12px] font-medium text-bad">{error}</p>}
    </div>
  );
};

/** Image jointe : URL signée à durée limitée, obtenue seulement si la politique Storage l'autorise. */
export const Attachment: React.FC<{ sb: SupabaseClient; path: string }> = ({ sb, path }) => {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { let alive = true; void attachmentUrl(sb, path).then((u) => alive && setUrl(u)); return () => { alive = false; }; }, [sb, path]);
  if (url === undefined) return <span className="text-[11px] text-muted">Chargement de la pièce jointe…</span>;
  if (!url) return <span className="text-[11px] text-muted">Pièce jointe indisponible.</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit"><img src={url} alt="Pièce jointe" className="max-h-56 max-w-full rounded-xl border-2 border-line object-contain" /></a>;
};

/** Conversation d'un ticket (messages visibles par l'utilisateur ; les notes internes n'y figurent jamais). */
export const Thread: React.FC<{ sb: SupabaseClient; messages: Message[]; viewer: "user" | "admin"; ticket: Ticket }> = ({ sb, messages, viewer, ticket }) => (
  <ol className="flex flex-col gap-3" data-testid="thread">
    <li className="flex flex-col items-end">
      <div className={cx("max-w-[92%] rounded-2xl border-2 px-3.5 py-2.5 text-[13px] sm:max-w-[80%]", viewer === "user" ? "rounded-br-md border-fg bg-hi/40" : "rounded-bl-md border-line bg-sunken self-start")}>
        <p className="mb-1 text-[11px] font-semibold text-muted">{viewer === "user" ? "Toi" : "Utilisateur"} · demande initiale · {fmtDateTime(ticket.created_at)}</p>
        <p className="whitespace-pre-wrap break-words">{ticket.description}</p>
        {ticket.steps && <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px]"><b>Étapes :</b> {ticket.steps}</p>}
        {ticket.expected && <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px]"><b>Attendu :</b> {ticket.expected}</p>}
        {ticket.observed && <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px]"><b>Observé :</b> {ticket.observed}</p>}
        {ticket.attachment_path && <Attachment sb={sb} path={ticket.attachment_path} />}
      </div>
    </li>
    {messages.map((m) => {
      if (m.author_role === "system") return <li key={m.id} className="text-center text-[11.5px] text-muted"><span className="rounded-full bg-sunken px-3 py-1">{m.body} · {fmtShort(m.created_at)}</span></li>;
      const mine = (viewer === "user") === (m.author_role === "user");
      return (
        <li key={m.id} className={cx("flex flex-col", mine ? "items-end" : "items-start")} data-role={m.author_role}>
          <div className={cx("max-w-[92%] rounded-2xl border-2 px-3.5 py-2.5 text-[13px] sm:max-w-[80%]", mine ? "rounded-br-md border-fg bg-hi/40" : "rounded-bl-md border-accent/50 bg-accent/10")}>
            <p className="mb-1 text-[11px] font-semibold text-muted">{m.author_role === "admin" ? (viewer === "admin" && mine ? "Toi (équipe)" : "Équipe Étudiant.OS") : viewer === "user" ? "Toi" : "Utilisateur"} · {fmtDateTime(m.created_at)}</p>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            {m.attachment_path && <Attachment sb={sb} path={m.attachment_path} />}
          </div>
        </li>
      );
    })}
  </ol>
);

// ------------------------------------------------------------- En-tête de page de support
const SupportHeader: React.FC<{ page: SupportPage; nav: Nav; unread: number }> = ({ page, nav, unread }) => (
  <nav aria-label="Support" className="mb-4 flex flex-wrap gap-2">
    {([["report", "Signaler un problème", AlertTriangle], ["help", "Besoin d'aide ?", Sparkles], ["requests", "Mes demandes", FileText]] as const).map(([p, label, Icon]) => (
      <button key={p} onClick={() => nav({ name: "support", page: p })} aria-current={page === p ? "page" : undefined}
        className={cx("press inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-[13px] font-semibold", page === p ? "border-fg bg-hi text-[rgb(24_22_46)] shadow-[2px_2px_0_0_rgb(var(--ink))]" : "border-line bg-panel text-fg hover:border-fg/60")}>
        <Icon size={15} />{label}{p === "requests" && unread > 0 && <span className="rounded-full bg-pink px-1.5 text-[11px] text-white" aria-label={`${unread} non lue${unread > 1 ? "s" : ""}`}>{unread}</span>}
      </button>))}
  </nav>
);

// ------------------------------------------------------------- Confirmation après envoi
const Sent: React.FC<{ number: number; id: string; nav: Nav; kind: "bug" | "help"; reset: () => void }> = ({ number, id, nav, kind, reset }) => (
  <Card>
    <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="ticket-sent">
      <div className="sticker grid h-14 w-14 place-items-center rounded-2xl border-2 border-fg bg-ok/20 text-ok"><Check size={26} /></div>
      <h2 className="font-display text-xl font-extrabold">{kind === "bug" ? "Signalement envoyé" : "Demande envoyée"} · n° {number}</h2>
      <p className="max-w-md text-[13.5px] text-muted">{kind === "bug" ? "Ton signalement a bien été envoyé. Tu peux suivre son avancement dans Mes demandes." : "Ta demande a bien été envoyée. Tu retrouveras la réponse de l'équipe dans Mes demandes."}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Btn variant="primary" onClick={() => nav({ name: "support", page: "requests", id })}>Voir ma demande</Btn>
        <Btn variant="soft" onClick={() => nav({ name: "support", page: "requests" })}>Mes demandes</Btn>
        <Btn variant="ghost" onClick={reset}>{kind === "bug" ? "Signaler autre chose" : "Nouvelle demande"}</Btn>
      </div>
    </div>
  </Card>
);

const options = (rec: Record<string, string>, placeholder?: string) => (
  <>{placeholder !== undefined && <option value="">{placeholder}</option>}{Object.entries(rec).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>
);

// ------------------------------------------------------------- Signaler un problème
const emptyBug = (): BugForm => ({ category: "", subject: "", description: "", steps: "", expected: "", observed: "", frequency: "", module: "", impact: "", includeTech: true });

export const ReportProblem: React.FC<{ sb: SupabaseClient; uid: string; nav: Nav }> = ({ sb, uid, nav }) => {
  const [f, setF] = useState<BugForm>(emptyBug);
  const [errors, setErrors] = useState<Errors>({});
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; number: number } | null>(null);
  const set = (k: keyof BugForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const tech = techInfo(navigator.userAgent, window.location.pathname, APP_VERSION);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFail(null);
    const errs = validateBug(f); setErrors(errs);
    if (Object.keys(errs).length || fileErr) { document.getElementById(`bug-${Object.keys(errs)[0]}`)?.focus(); return; }
    setBusy(true);
    try {
      const attachment_path = file ? await uploadAttachment(sb, uid, file) : null;
      const r = await createTicket(sb, { kind: "bug", category: f.category, subject: f.subject, description: f.description, module: f.module, steps: f.steps, expected: f.expected, observed: f.observed, frequency: f.frequency, impact: f.impact, attachment_path, tech: f.includeTech ? tech : null });
      setSent(r);
    } catch (err) { setFail(supportError(err)); } finally { setBusy(false); }
  };
  if (sent) return <Sent {...sent} kind="bug" nav={nav} reset={() => { setSent(null); setF(emptyBug()); setFile(null); }} />;
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="report-form">
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-xl font-extrabold">Signaler un problème</h2>
            <p className="mt-1 text-[13.5px] text-muted">Tu as rencontré un bug ou quelque chose ne fonctionne pas comme prévu ? Décris le problème pour que nous puissions l'examiner.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Type de problème" htmlFor="bug-category" error={errors.category}><Select {...aria("bug-category", errors.category)} value={f.category} onChange={set("category")}>{options(BUG_CATEGORIES, "Choisir…")}</Select></Labeled>
            <Labeled label="Module concerné" htmlFor="bug-module" error={errors.module} optional><Select {...aria("bug-module", errors.module)} value={f.module} onChange={set("module")}>{options(MODULES, "Je ne sais pas")}</Select></Labeled>
          </div>
          <Labeled label="Titre du problème" htmlFor="bug-subject" error={errors.subject} hint="En une phrase : « Le total du budget est faux », « Le planning ne s'affiche pas »…">
            <input {...aria("bug-subject", errors.subject, true)} className={inputCls} value={f.subject} onChange={set("subject")} maxLength={140} />
          </Labeled>
          <Labeled label="Description détaillée" htmlFor="bug-description" error={errors.description} hint="Avec tes propres mots : que s'est-il passé ?">
            <TextArea {...aria("bug-description", errors.description, true)} value={f.description} onChange={set("description")} max={LIMITS.description[1]} rows={4} />
          </Labeled>
          <Labeled label="Étapes pour reproduire" htmlFor="bug-steps" error={errors.steps} optional hint="1. J'ouvre Budget  2. J'ajoute une dépense  3. …">
            <TextArea {...aria("bug-steps", errors.steps, true)} value={f.steps} onChange={set("steps")} max={LIMITS.steps} rows={3} />
          </Labeled>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Résultat attendu" htmlFor="bug-expected" error={errors.expected} optional><TextArea {...aria("bug-expected", errors.expected)} value={f.expected} onChange={set("expected")} max={LIMITS.expected} rows={2} /></Labeled>
            <Labeled label="Résultat observé" htmlFor="bug-observed" error={errors.observed} optional><TextArea {...aria("bug-observed", errors.observed)} value={f.observed} onChange={set("observed")} max={LIMITS.observed} rows={2} /></Labeled>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="Fréquence" htmlFor="bug-frequency" error={errors.frequency}><Select {...aria("bug-frequency", errors.frequency)} value={f.frequency} onChange={set("frequency")}>{options(FREQUENCIES, "Choisir…")}</Select></Labeled>
            <Labeled label="Impact" htmlFor="bug-impact" error={errors.impact}><Select {...aria("bug-impact", errors.impact)} value={f.impact} onChange={set("impact")}>{options(IMPACTS, "Choisir…")}</Select></Labeled>
          </div>
          <div className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Capture d'écran <span className="font-normal text-muted">· facultatif</span></span>
            <AttachPicker file={file} onChange={setFile} error={fileErr} onError={setFileErr} /></div>
          {fail && <Banner tone="bad">{fail} Ton texte est conservé : tu peux réessayer.</Banner>}
          <div className="flex justify-end"><Btn type="submit" variant="primary" disabled={busy}>{busy ? "Envoi…" : "Envoyer le signalement"}</Btn></div>
        </div>
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Informations techniques">
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5 accent-[rgb(var(--accent))]" checked={f.includeTech} onChange={(e) => setF({ ...f, includeTech: e.target.checked })} />
            <span>Joindre ces informations (utile pour comprendre le bug)</span>
          </label>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid="tech-info">
            <dt className="text-muted">Navigateur</dt><dd>{tech.browser}</dd><dt className="text-muted">Système</dt><dd>{tech.os}</dd>
            <dt className="text-muted">Version</dt><dd>{tech.appVersion}</dd><dt className="text-muted">Page</dt><dd className="break-all">{tech.route}</dd>
          </dl>
          <p className="mt-3 text-[11.5px] text-muted">Rien d'autre n'est envoyé : ni mot de passe, ni session, ni tes notes, ton budget ou tes données académiques.</p>
        </Card>
        <Card title="Après l'envoi"><p className="text-[12.5px] text-muted">Tu reçois un numéro de ticket et tu peux suivre son statut et échanger avec l'équipe dans <b className="text-fg">Mes demandes</b>.</p></Card>
      </div>
    </form>
  );
};

// ------------------------------------------------------------- Besoin d'aide ?
const emptyHelp = (): HelpForm => ({ category: "", subject: "", description: "", module: "", urgency: "normal" });

export const HelpCenter: React.FC<{ sb: SupabaseClient; uid: string; nav: Nav; openFaq: () => void }> = ({ sb, uid, nav, openFaq }) => {
  const [f, setF] = useState<HelpForm>(emptyHelp);
  const [errors, setErrors] = useState<Errors>({});
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; number: number } | null>(null);
  const set = (k: keyof HelpForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFail(null);
    const errs = validateHelp(f); setErrors(errs);
    if (Object.keys(errs).length || fileErr) { document.getElementById(`help-${Object.keys(errs)[0]}`)?.focus(); return; }
    setBusy(true);
    try {
      const attachment_path = file ? await uploadAttachment(sb, uid, file) : null;
      setSent(await createTicket(sb, { kind: "help", category: f.category, subject: f.subject, description: f.description, module: f.module, urgency: f.urgency, attachment_path }));
    } catch (err) { setFail(supportError(err)); } finally { setBusy(false); }
  };
  if (sent) return <Sent {...sent} kind="help" nav={nav} reset={() => { setSent(null); setF(emptyHelp()); setFile(null); }} />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form onSubmit={(e) => void submit(e)} noValidate data-testid="help-form">
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-display text-xl font-extrabold">Besoin d'aide ?</h2>
              <p className="mt-1 text-[13.5px] text-muted">Une question sur Étudiant.OS ? Décris ce dont tu as besoin et nous t'aiderons à trouver une solution.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Catégorie" htmlFor="help-category" error={errors.category}><Select {...aria("help-category", errors.category)} value={f.category} onChange={set("category")}>{options(HELP_CATEGORIES, "Choisir…")}</Select></Labeled>
              <Labeled label="Module concerné" htmlFor="help-module" error={errors.module} optional><Select {...aria("help-module", errors.module)} value={f.module} onChange={set("module")}>{options(MODULES, "Aucun en particulier")}</Select></Labeled>
            </div>
            <Labeled label="Sujet" htmlFor="help-subject" error={errors.subject}><input {...aria("help-subject", errors.subject)} className={inputCls} value={f.subject} onChange={set("subject")} maxLength={140} /></Labeled>
            <Labeled label="Description" htmlFor="help-description" error={errors.description} hint="Explique ce que tu cherches à faire ; pas besoin d'être technique.">
              <TextArea {...aria("help-description", errors.description, true)} value={f.description} onChange={set("description")} max={LIMITS.description[1]} rows={5} />
            </Labeled>
            <Labeled label="Urgence" htmlFor="help-urgency" error={errors.urgency}><Select {...aria("help-urgency", errors.urgency)} value={f.urgency} onChange={set("urgency")}>{options(URGENCIES)}</Select></Labeled>
            <div className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Pièce jointe <span className="font-normal text-muted">· facultatif</span></span>
              <AttachPicker file={file} onChange={setFile} error={fileErr} onError={setFileErr} /></div>
            {fail && <Banner tone="bad">{fail} Ton texte est conservé : tu peux réessayer.</Banner>}
            <div className="flex justify-end"><Btn type="submit" variant="primary" disabled={busy}>{busy ? "Envoi…" : "Envoyer ma demande"}</Btn></div>
          </div>
        </Card>
      </form>
      <div className="flex flex-col gap-4">
        <Card title="Autres façons d'avancer">
          <ul className="flex flex-col gap-2 text-[13px]">
            <li><button onClick={openFaq} className="flex w-full items-center gap-2 rounded-xl border-2 border-line px-3 py-2 text-left hover:border-fg/60"><Search size={15} />Questions fréquentes</button></li>
            <li><button onClick={() => nav({ name: "support", page: "report" })} className="flex w-full items-center gap-2 rounded-xl border-2 border-line px-3 py-2 text-left hover:border-fg/60"><AlertTriangle size={15} />C'est un bug ? Le signaler</button></li>
            <li><button onClick={() => nav({ name: "support", page: "requests" })} className="flex w-full items-center gap-2 rounded-xl border-2 border-line px-3 py-2 text-left hover:border-fg/60"><FileText size={15} />Suivre mes demandes</button></li>
          </ul>
        </Card>
        <Card title="Bon à savoir"><p className="text-[12.5px] text-muted">L'équipe te répond directement dans Mes demandes. Une pastille s'affiche quand une réponse arrive. Aucun e-mail n'est envoyé pour l'instant.</p></Card>
      </div>
    </div>
  );
};

// ------------------------------------------------------------- Mes demandes : liste
const unreadFor = (t: Ticket) => t.last_message_by === "admin" && new Date(t.last_message_at) > new Date(t.owner_read_at);

export const MyRequests: React.FC<{ sb: SupabaseClient; uid: string; nav: Nav; refreshKey: number }> = ({ sb, uid, nav, refreshKey }) => {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "done" | "all">("all");
  const load = useCallback(async () => { try { setList(await myTickets(sb, uid)); setErr(null); } catch (e) { setErr(supportError(e)); } }, [sb, uid]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  if (err && !list) return <Banner tone="bad">{err} <button className="underline" onClick={() => void load()}>Réessayer</button></Banner>;
  if (!list) return <p role="status" className="py-10 text-center text-muted">Chargement de tes demandes…</p>;
  if (!list.length) return <Empty icon={<FileText size={22} />} title="Aucune demande pour l'instant" hint="Quand tu signales un problème ou demandes de l'aide, tu retrouves ici le suivi et les réponses de l'équipe."
    action={<div className="mt-2 flex flex-wrap justify-center gap-2"><Btn variant="primary" onClick={() => nav({ name: "support", page: "help" })}>Demander de l'aide</Btn><Btn variant="soft" onClick={() => nav({ name: "support", page: "report" })}>Signaler un problème</Btn></div>} />;
  const shown = list.filter((t) => filter === "all" || (filter === "active") === isOpen(t.status));
  return (
    <Card title={<span>Mes demandes <span className="text-muted">· {list.length}</span></span>} action={
      <div role="tablist" aria-label="Filtrer" className="flex gap-1 rounded-xl bg-sunken p-1 text-[12px]">
        {([["all", "Toutes"], ["active", "En cours"], ["done", "Terminées"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cx("rounded-lg px-2.5 py-1 font-semibold", filter === k ? "bg-panel text-fg shadow-sm" : "text-muted")}>{l}</button>)}
      </div>}>
      {err && <div className="mb-3"><Banner tone="bad">{err}</Banner></div>}
      <ul className="-mx-2 flex flex-col" data-testid="requests-list">
        {shown.map((t) => {
          const unread = unreadFor(t);
          return (
            <li key={t.id}>
              <button onClick={() => nav({ name: "support", page: "requests", id: t.id })} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-sunken">
                <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", unread ? "bg-pink" : "bg-transparent")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[11px] text-muted">#{t.number}</span>
                    <span className={cx("truncate text-[13.5px]", unread ? "font-bold" : "font-semibold")}>{t.subject}</span>
                    {unread && <Pill tone="info">Nouvelle réponse</Pill>}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">{KIND_LABEL[t.kind]} · {categoryLabel(t.category)} · créée {fmtShort(t.created_at)} · dernière réponse {fmtShort(t.last_message_at)}</span>
                </span>
                <StatusPill status={t.status} forUser />
              </button>
            </li>);
        })}
        {!shown.length && <li className="px-2 py-6 text-center text-[13px] text-muted">Aucune demande dans cette catégorie.</li>}
      </ul>
    </Card>
  );
};

// ------------------------------------------------------------- Mes demandes : conversation
export const RequestDetail: React.FC<{ sb: SupabaseClient; uid: string; id: string; nav: Nav; refreshKey: number }> = ({ sb, uid, id, nav, refreshKey }) => {
  const [t, setT] = useState<Ticket | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const found = await getTicket(sb, id);
      const tk = found && found.owner_id === uid ? found : null; // « Mes demandes » : uniquement les siennes (un admin passe par l'administration)
      setT(tk);
      if (tk) { setMsgs(await getMessages(sb, id)); void markTicketRead(sb, id).catch(() => {}); }
      setErr(null);
    } catch (e) { setErr(supportError(e)); }
  }, [sb, id, uid]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setSendErr(null);
    const text = body.trim();
    if (!text) { setSendErr("Écris un message avant d'envoyer."); return; }
    if (text.length > LIMITS.message) { setSendErr("5000 caractères maximum."); return; }
    setBusy(true);
    try {
      const path = file ? await uploadAttachment(sb, uid, file) : null;
      await postMessage(sb, id, text, path);
      setBody(""); setFile(null); await load();
    } catch (er) { setSendErr(supportError(er) + " Ton message n'a pas été envoyé ; il est conservé ci-dessus."); } finally { setBusy(false); }
  };
  const state = async (a: "resolve" | "reopen") => { try { await setMyTicketState(sb, id, a); await load(); } catch (er) { setErr(supportError(er)); } };
  const back = <Btn variant="ghost" size="sm" onClick={() => nav({ name: "support", page: "requests" })}><ChevronLeft size={14} />Mes demandes</Btn>;
  if (err && t === undefined) return <div className="flex flex-col gap-3">{back}<Banner tone="bad">{err}</Banner></div>;
  if (t === undefined) return <p role="status" className="py-10 text-center text-muted">Chargement…</p>;
  if (t === null) return <div className="flex flex-col gap-3">{back}<Empty icon={<FileText size={22} />} title="Demande introuvable" hint="Cette demande n'existe pas ou ne t'appartient pas." /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div>{back}</div>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-muted"><span className="font-mono">#{t.number}</span> · {KIND_LABEL[t.kind]} · {categoryLabel(t.category)}{t.module ? ` · ${MODULES[t.module]}` : ""}</p>
            <h2 className="mt-0.5 break-words font-display text-xl font-extrabold" data-testid="ticket-subject">{t.subject}</h2>
            <p className="mt-1 text-[12px] text-muted">Créée le {fmtDateTime(t.created_at)} · dernière activité {fmtShort(t.last_message_at)}</p>
          </div>
          <div className="flex flex-col items-end gap-2"><span data-testid="ticket-status"><StatusPill status={t.status} forUser /></span>
            {isOpen(t.status) ? <Btn size="sm" variant="ghost" onClick={() => void state("resolve")}><Check size={13} />Mon problème est résolu</Btn>
              : <Btn size="sm" variant="soft" onClick={() => void state("reopen")}>Rouvrir la demande</Btn>}
          </div>
        </div>
        {t.status === "waiting_user" && <div className="mt-3"><Banner tone="info">L'équipe attend une précision de ta part : réponds ci-dessous.</Banner></div>}
        {err && <div className="mt-3"><Banner tone="bad">{err}</Banner></div>}
      </Card>
      <Card title="Conversation"><Thread sb={sb} messages={msgs} viewer="user" ticket={t} /></Card>
      {t.status === "closed" ? (
        <Banner tone="info">Cette demande est fermée. Rouvre-la pour écrire à nouveau, ou crée une nouvelle demande.</Banner>
      ) : (
        <form onSubmit={(e) => void send(e)} noValidate data-testid="reply-form">
          <Card title="Ajouter un message">
            <div className="flex flex-col gap-3">
              <label htmlFor="reply-body" className="sr-only">Ton message</label>
              <TextArea id="reply-body" value={body} onChange={(e) => setBody(e.target.value)} max={LIMITS.message} rows={3} placeholder="Une précision, une réponse à l'équipe…" />
              <AttachPicker file={file} onChange={setFile} error={fileErr} onError={setFileErr} label="Joindre une image" />
              {sendErr && <Banner tone="bad">{sendErr}</Banner>}
              <div className="flex justify-end"><Btn type="submit" variant="primary" disabled={busy}>{busy ? "Envoi…" : "Envoyer"}</Btn></div>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
};

// ------------------------------------------------------------- Page de support (dans le cadre de l'application)
export const SupportView: React.FC<{ sb: SupabaseClient; uid: string; page: SupportPage; id?: string; nav: Nav; unread: number; refreshKey: number; openFaq: () => void }> = ({ sb, uid, page, id, nav, unread, refreshKey, openFaq }) => (
  <div>
    <SupportHeader page={page} nav={nav} unread={unread} />
    {page === "report" && <ReportProblem sb={sb} uid={uid} nav={nav} />}
    {page === "help" && <HelpCenter sb={sb} uid={uid} nav={nav} openFaq={openFaq} />}
    {page === "requests" && (id ? <RequestDetail sb={sb} uid={uid} id={id} nav={nav} refreshKey={refreshKey} /> : <MyRequests sb={sb} uid={uid} nav={nav} refreshKey={refreshKey} />)}
  </div>
);
export const SUPPORT_TITLE: Record<SupportPage, string> = { report: "Signaler un problème", help: "Besoin d'aide ?", requests: "Mes demandes" };

/** Notifications non lues de l'utilisateur : Realtime (RLS) + relecture périodique (repli). */
export function useNotifications(sb: SupabaseClient, uid: string, watch: (sb: SupabaseClient, uid: string, cb: () => void) => () => void, load: (sb: SupabaseClient, uid: string) => Promise<Notification[]>) {
  const [items, setItems] = useState<Notification[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(async () => { try { setItems(await load(sb, uid)); setTick((n) => n + 1); } catch { /* hors ligne : on garde l'état */ } }, [sb, uid, load]);
  useEffect(() => {
    void refresh();
    const stop = watch(sb, uid, () => void refresh());
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 45_000);
    const vis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop(); window.clearInterval(poll); document.removeEventListener("visibilitychange", vis); };
  }, [sb, uid, watch, refresh]);
  return { items, refresh, tick };
}
export { NOTIF_LABEL };
