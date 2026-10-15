/* Étudiant.OS — pages d'authentification (Supabase Auth). */
import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cx } from "./core.ts";
import { Btn, Field, Input, Check, ListChecks, Sparkles, AlertTriangle } from "./StudentOS.tsx";
import { frError, appUrl } from "./supabase.ts";
import type { Route } from "./router.ts";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const passwordProblem = (p: string) => (p.length < 8 ? "8 caractères minimum." : !/[a-zA-Z]/.test(p) || !/\d/.test(p) ? "Ajoutez au moins une lettre et un chiffre." : null);

type Go = (r: Route, opts?: { replace?: boolean; next?: string }) => void;

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <a href="./" onClick={(e) => { if (onClick) { e.preventDefault(); onClick(); } }} className="flex items-center gap-2.5 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label="Étudiant.OS, accueil">
      <span className="sticker grid h-9 w-9 place-items-center rounded-xl border-2 border-fg bg-pink text-white shadow-[3px_3px_0_0_rgb(var(--ink))]"><ListChecks size={17} /></span>
      <span className="font-display text-[19px] font-extrabold leading-none tracking-tight">Étudiant<span className="text-accent">.</span>OS</span>
    </a>
  );
}

function AuthLayout({ title, subtitle, children, go }: { title: string; subtitle: string; children: React.ReactNode; go: Go }) {
  useEffect(() => { document.title = `${title} · Étudiant.OS`; }, [title]);
  return (
    <div className="min-h-full bg-bg px-4 py-6 sm:py-10" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
      <div className="mx-auto flex max-w-5xl items-center justify-between"><Logo onClick={() => go({ name: "landing" })} /></div>
      <main className="mx-auto mt-8 grid max-w-5xl items-start gap-8 lg:mt-14 lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:block">
          <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight">Tes études. Ton organisation. <span className="marker">Un seul espace.<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h2>
          <ul className="mt-8 flex max-w-md flex-col gap-3 text-[15px]">
            {["Planning qui répartit tes devoirs dans tes créneaux libres", "Minuteur de focus et temps par matière", "Budget, courses, ménage en coloc et sommeil", "Tes données sur tous tes appareils, isolées et protégées"].map((t) => (
              <li key={t} className="flex items-start gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-fg bg-hi text-[rgb(24_22_46)]"><Check size={12} strokeWidth={3} /></span>{t}</li>))}
          </ul>
        </section>
        <section className="inked rounded-[24px] bg-panel p-6 sm:p-8 animate-pop" aria-labelledby="auth-title">
          <h1 id="auth-title" className="font-display text-[28px] font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </section>
      </main>
    </div>
  );
}

function ErrorBox({ msg, children }: { msg: string | null; children?: React.ReactNode }) {
  if (!msg) return null;
  return <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border-2 border-bad/40 bg-bad/8 px-3 py-2.5 text-[13px] text-bad"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><div className="min-w-0">{msg}{children}</div></div>;
}
function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required aria-invalid={invalid || undefined} aria-describedby={describedBy} className="pr-24" />
      <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls={id} className="absolute inset-y-0 right-1 my-1 rounded-lg px-2.5 text-xs font-semibold text-muted hover:bg-sunken hover:text-fg">{show ? "Masquer" : "Afficher"}</button>
    </div>
  );
}
function GoogleButton({ sb, next }: { sb: SupabaseClient; next: string }) {
  if (!__GOOGLE_AUTH__) return null;
  return (<>
    <div className="my-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
    <Btn type="button" className="w-full" onClick={() => void sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: new URL(next, window.location.origin).toString() } })}>Continuer avec Google</Btn>
  </>);
}

export function LoginPage({ sb, go, next, initialError }: { sb: SupabaseClient; go: Go; next: string; initialError?: string | null }) {
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setInfo(null); setUnconfirmed(false);
    if (!EMAIL_RE.test(f.email.trim())) { setErr("Saisissez une adresse e-mail valide."); return; }
    if (!f.password) { setErr("Saisissez votre mot de passe."); return; }
    setBusy(true);
    const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    setBusy(false);
    if (error) { setErr(frError(error)); setUnconfirmed(/confirm/i.test(error.message)); return; }
    // la redirection est faite par l'écoute de session (main.tsx), vers `next`
  };
  const resend = async () => { const { error } = await sb.auth.resend({ type: "signup", email: f.email.trim(), options: { emailRedirectTo: appUrl("app") } }); setInfo(error ? frError(error) : "Nouveau lien de confirmation envoyé."); };
  return (
    <AuthLayout title="Se connecter" subtitle="Retrouve ton espace sur n'importe quel appareil." go={go}>
      <ErrorBox msg={err}>{unconfirmed && <button type="button" onClick={() => void resend()} className="mt-1 block font-semibold underline">Renvoyer l'e-mail de confirmation</button>}</ErrorBox>
      {info && <p role="status" className="mb-4 rounded-xl bg-ok/10 px-3 py-2 text-[13px] text-ok">{info}</p>}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Adresse e-mail" htmlFor="li-email"><Input id="li-email" type="email" autoComplete="email" inputMode="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Mot de passe" htmlFor="li-pw"><PasswordInput id="li-pw" autoComplete="current-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
        <div className="-mt-1 text-right"><a href="forgot-password" onClick={(e) => { e.preventDefault(); go({ name: "forgot" }); }} className="text-[13px] font-semibold text-accent hover:underline">Mot de passe oublié ?</a></div>
        <Btn type="submit" variant="primary" className="h-11 text-sm" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</Btn>
      </form>
      <GoogleButton sb={sb} next={next} />
      <p className="mt-6 text-center text-[13px] text-muted">Pas encore de compte ? <a href="signup" onClick={(e) => { e.preventDefault(); go({ name: "signup" }, { next }); }} className="font-semibold text-accent hover:underline">Créer un compte</a></p>
    </AuthLayout>
  );
}

export function SignupPage({ sb, go, next }: { sb: SupabaseClient; go: Go; next: string }) {
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", terms: false });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const problems = {
    name: !f.name.trim() ? "Indiquez un prénom ou un nom d'affichage." : f.name.trim().length > 80 ? "80 caractères maximum." : null,
    email: !EMAIL_RE.test(f.email.trim()) ? "Adresse e-mail invalide." : null,
    password: passwordProblem(f.password),
    confirm: f.confirm !== f.password ? "Les mots de passe ne correspondent pas." : null,
    terms: !f.terms ? "Acceptez les conditions pour créer un compte." : null,
  };
  const show = (k: keyof typeof problems) => touched && problems[k];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true); setErr(null);
    const first = Object.entries(problems).find(([, v]) => v);
    if (first) { document.getElementById(`su-${first[0]}`)?.focus(); return; }
    setBusy(true);
    const { data, error } = await sb.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { display_name: f.name.trim() }, emailRedirectTo: new URL(next, window.location.origin).toString() } });
    setBusy(false);
    if (error) { setErr(frError(error)); return; }
    // Adresse déjà utilisée : Supabase ne le révèle pas (identités vides) pour éviter l'énumération ; message neutre.
    if (!data.session) setSent(f.email.trim());
  };
  const resend = async () => { if (!sent) return; const { error } = await sb.auth.resend({ type: "signup", email: sent, options: { emailRedirectTo: appUrl("app") } }); setInfo(error ? frError(error) : "E-mail renvoyé."); };
  if (sent) return (
    <AuthLayout title="Vérifie ta boîte mail" subtitle="Plus qu'une étape pour activer ton compte." go={go}>
      <div className="flex flex-col gap-4 text-[14px]" role="status">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-fg bg-hi text-[rgb(24_22_46)] sticker"><Sparkles size={24} /></div>
        <p>Si l'adresse <b>{sent}</b> peut être utilisée, un lien de confirmation vient d'y être envoyé. Clique dessus pour activer ton compte : tu seras ensuite connecté automatiquement.</p>
        <p className="text-[13px] text-muted">Rien reçu ? Vérifie les courriers indésirables, ou renvoie l'e-mail. Ton compte n'est pas utilisable tant que l'adresse n'est pas confirmée.</p>
        {info && <p className="rounded-xl bg-ok/10 px-3 py-2 text-[13px] text-ok">{info}</p>}
        <div className="flex flex-wrap gap-2"><Btn onClick={() => void resend()}>Renvoyer l'e-mail</Btn><Btn variant="ghost" onClick={() => go({ name: "login" })}>J'ai confirmé, me connecter</Btn></div>
      </div>
    </AuthLayout>
  );
  const err1 = (k: keyof typeof problems) => show(k) ? <p id={`su-${k}-err`} className="text-[12px] text-bad">{problems[k]}</p> : null;
  return (
    <AuthLayout title="Créer mon compte" subtitle="Gratuit. Tes données restent les tiennes." go={go}>
      <ErrorBox msg={err} />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Prénom ou nom d'affichage" htmlFor="su-name"><Input id="su-name" autoComplete="given-name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!show("name") || undefined} aria-describedby="su-name-err" /></Field>{err1("name")}
        <Field label="Adresse e-mail" htmlFor="su-email"><Input id="su-email" type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={!!show("email") || undefined} aria-describedby="su-email-err" /></Field>{err1("email")}
        <Field label="Mot de passe" htmlFor="su-password"><PasswordInput id="su-password" autoComplete="new-password" value={f.password} onChange={(v) => setF({ ...f, password: v })} invalid={!!show("password")} describedBy="su-password-help" /></Field>
        <p id="su-password-help" className={cx("-mt-2 text-[12px]", show("password") ? "text-bad" : "text-muted")}>{show("password") || "8 caractères minimum, avec des lettres et des chiffres."}</p>
        <Field label="Confirmer le mot de passe" htmlFor="su-confirm"><PasswordInput id="su-confirm" autoComplete="new-password" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} invalid={!!show("confirm")} describedBy="su-confirm-err" /></Field>{err1("confirm")}
        <label htmlFor="su-terms" className="flex items-start gap-2.5 text-[13px]">
          <input id="su-terms" type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" aria-describedby="su-terms-err" />
          <span>J'accepte les <a href="conditions" target="_blank" rel="noopener" className="font-semibold text-accent underline">conditions d'utilisation</a> et la <a href="confidentialite" target="_blank" rel="noopener" className="font-semibold text-accent underline">politique de confidentialité</a>.</span>
        </label>{err1("terms")}
        <Btn type="submit" variant="primary" className="h-11 text-sm" disabled={busy}>{busy ? "Création…" : "Créer mon compte"}</Btn>
      </form>
      <GoogleButton sb={sb} next={next} />
      <p className="mt-6 text-center text-[13px] text-muted">Déjà inscrit ? <a href="login" onClick={(e) => { e.preventDefault(); go({ name: "login" }, { next }); }} className="font-semibold text-accent hover:underline">J'ai déjà un compte</a></p>
    </AuthLayout>
  );
}

export function ForgotPage({ sb, go }: { sb: SupabaseClient; go: Go }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!EMAIL_RE.test(email.trim())) { setErr("Saisissez une adresse e-mail valide."); return; }
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl("reset-password") });
    setBusy(false);
    if (error && !/user not found/i.test(error.message)) { setErr(frError(error)); return; }
    setSent(true); // message identique que le compte existe ou non (pas d'énumération)
  };
  return (
    <AuthLayout title="Mot de passe oublié" subtitle="On t'envoie un lien pour en choisir un nouveau." go={go}>
      {sent ? (
        <div role="status" className="flex flex-col gap-4 text-[14px]">
          <p>Si un compte existe pour <b>{email.trim()}</b>, un e-mail avec un lien de réinitialisation vient d'être envoyé. Le lien est valable une heure et ne fonctionne qu'une fois.</p>
          <Btn variant="ghost" onClick={() => go({ name: "login" })}>Retour à la connexion</Btn>
        </div>
      ) : (<>
        <ErrorBox msg={err} />
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Adresse e-mail du compte" htmlFor="fp-email"><Input id="fp-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Btn type="submit" variant="primary" className="h-11 text-sm" disabled={busy}>{busy ? "Envoi…" : "Envoyer le lien"}</Btn>
        </form>
        <p className="mt-6 text-center text-[13px] text-muted"><a href="login" onClick={(e) => { e.preventDefault(); go({ name: "login" }); }} className="font-semibold text-accent hover:underline">Retour à la connexion</a></p>
      </>)}
    </AuthLayout>
  );
}

/** Arrivée depuis le lien de l'e-mail : Supabase a ouvert une session de récupération (jetons dans l'URL). */
export function ResetPage({ sb, go, recovery, linkError }: { sb: SupabaseClient; go: Go; recovery: boolean; linkError: string | null }) {
  const [f, setF] = useState({ a: "", b: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = passwordProblem(f.a); if (p) { setErr(p); return; }
    if (f.a !== f.b) { setErr("Les mots de passe ne correspondent pas."); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: f.a });
    setBusy(false);
    if (error) { setErr(frError(error)); return; }
    setDone(true);
  };
  if (!recovery) return (
    <AuthLayout title="Lien invalide" subtitle="Impossible de changer le mot de passe avec ce lien." go={go}>
      <ErrorBox msg={linkError ?? "Ce lien a expiré, a déjà été utilisé ou est incomplet."} />
      <Btn variant="primary" onClick={() => go({ name: "forgot" })}>Demander un nouveau lien</Btn>
    </AuthLayout>
  );
  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisis un mot de passe que tu n'utilises pas ailleurs." go={go}>
      {done ? (
        <div role="status" className="flex flex-col gap-4 text-[14px]"><p className="rounded-xl bg-ok/10 px-3 py-2 text-ok">Mot de passe modifié. Tu es connecté.</p><Btn variant="primary" onClick={() => go({ name: "app", view: "dashboard" })}>Ouvrir mon espace</Btn></div>
      ) : (<>
        <ErrorBox msg={err} />
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Nouveau mot de passe" htmlFor="rp-a"><PasswordInput id="rp-a" autoComplete="new-password" value={f.a} onChange={(v) => setF({ ...f, a: v })} describedBy="rp-help" /></Field>
          <p id="rp-help" className="-mt-2 text-[12px] text-muted">8 caractères minimum, avec des lettres et des chiffres.</p>
          <Field label="Confirmer" htmlFor="rp-b"><PasswordInput id="rp-b" autoComplete="new-password" value={f.b} onChange={(v) => setF({ ...f, b: v })} /></Field>
          <Btn type="submit" variant="primary" className="h-11 text-sm" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le mot de passe"}</Btn>
        </form>
      </>)}
    </AuthLayout>
  );
}
