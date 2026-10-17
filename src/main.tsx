/* Étudiant.OS — point d'entrée : routes, session, protection des pages privées. */
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import type { ViewKey } from "./core.ts";
import { parseRoute, routePath, isPrivate, safeNext, type Route } from "./router.ts";
import { supabase, BASE, frError } from "./supabase.ts";
import { LocalHost, CloudHost, Splash } from "./hosts.tsx";
import { LoginPage, SignupPage, ForgotPage, ResetPage } from "./auth.tsx";
import { Landing, PrivacyPage, TermsPage, NotFound } from "./landing.tsx";
import { AdminApp } from "./admin.tsx";
import { PencilDefs } from "./StudentOS.tsx";
import { initI18n } from "./i18n.tsx";

// Fragment d'URL au chargement (jetons ou erreur d'un lien d'e-mail), capturé avant que Supabase ne le nettoie.
const initialHash = (window as unknown as { __INITIAL_HASH__?: string }).__INITIAL_HASH__ ?? window.location.hash;
const hashParams = new URLSearchParams(initialHash.replace(/^#/, ""));
const linkError = hashParams.get("error_description") ? frError({ message: hashParams.get("error_description"), code: hashParams.get("error_code") ?? "" }) : null;

type Go = (r: Route, opts?: { replace?: boolean; next?: string }) => void;

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, BASE));
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null); // undefined = vérification en cours
  const [recovery, setRecovery] = useState(hashParams.get("type") === "recovery");
  const nextParam = () => new URLSearchParams(window.location.search).get("next");

  const go: Go = useCallback((r, opts = {}) => {
    const url = routePath(r, BASE) + (opts.next ? `?next=${encodeURIComponent(opts.next)}` : "");
    if (opts.replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
    setRoute(r);
    if (r.name !== "app") window.scrollTo(0, 0);
  }, []);
  useEffect(() => { const onPop = () => setRoute(parseRoute(window.location.pathname, BASE)); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);

  // Session : vérifiée avant d'afficher quoi que ce soit de privé, puis suivie (connexion, renouvellement, déconnexion).
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session); }).catch(() => alive && setSession(null));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); go({ name: "reset" }, { replace: true }); }
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [go]);

  // Redirections dépendant de la session.
  useEffect(() => {
    if (!supabase || session === undefined) return;
    if (isPrivate(route) && !session) go({ name: "login" }, { replace: true, next: window.location.pathname });
    else if ((route.name === "login" || route.name === "signup") && session) { const n = safeNext(nextParam(), BASE); history.replaceState(null, "", n); setRoute(parseRoute(n, BASE)); }
  }, [route, session, go]);

  const onView = useCallback((v: ViewKey) => go({ name: "app", view: v }), [go]);
  const next = safeNext(nextParam(), BASE);

  switch (route.name) {
    case "landing": return <Landing go={go} signedIn={!!session} />;
    case "privacy": return <PrivacyPage go={go} />;
    case "terms": return <TermsPage go={go} />;
    case "notfound": return <NotFound go={go} />;
    case "app":
    case "support":
      if (!supabase) return route.name === "app" ? <LocalHost view={route.view} onView={onView} /> : <NotConfigured go={go} />; // build sans Supabase : mode local d'origine
      if (session === undefined) return <Splash text="Vérification de la session…" />;
      if (!session) return <Splash text="Redirection vers la connexion…" />;
      return <CloudHost key={session.user.id} sb={supabase} session={session} view={route.name === "app" ? route.view : "dashboard"} onView={onView} nav={go}
        support={route.name === "support" ? { page: route.page, id: route.id } : null}
        onSignedOut={() => { setSession(null); go({ name: "landing" }, { replace: true }); }} />;
    case "admin":
      if (!supabase) return <NotConfigured go={go} />;
      if (session === undefined) return <Splash text="Vérification de la session…" />;
      if (!session) return <Splash text="Redirection vers la connexion…" />;
      return <AdminApp key={session.user.id} sb={supabase} session={session} section={route.section} id={route.id} nav={go} />;
    default:
      if (!supabase) return <NotConfigured go={go} />;
      if (session === undefined) return <Splash text="Chargement…" />;
      if (route.name === "login") return <LoginPage sb={supabase} go={go} next={next} initialError={linkError} />;
      if (route.name === "signup") return <SignupPage sb={supabase} go={go} next={next} />;
      if (route.name === "forgot") return <ForgotPage sb={supabase} go={go} />;
      return <ResetPage sb={supabase} go={go} recovery={recovery && !!session} linkError={linkError} />;
  }
}

/** Site construit sans Supabase : les comptes ne sont pas disponibles, l'application reste utilisable en local. */
function NotConfigured({ go }: { go: Go }) {
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 text-center text-fg">
      <div className="inked max-w-md rounded-[24px] bg-panel p-8">
        <h1 className="font-display text-2xl font-extrabold">Comptes indisponibles</h1>
        <p className="mt-2 text-[14px] text-muted">Cette version du site n'est pas reliée à un serveur. Tu peux utiliser l'application en mode local : tes données restent dans ce navigateur.</p>
        <button className="press mt-5 rounded-xl border-2 border-fg bg-accent px-5 py-2.5 font-semibold text-onaccent" onClick={() => go({ name: "app", view: "dashboard" })}>Ouvrir en mode local</button>
      </div>
    </div>
  );
}

// Filtre « crayon » des icônes monté une fois pour toutes les pages (landing, connexion, app, admin).
// La langue est appliquée avant le premier rendu (pas de flash en français).
initI18n(BASE).finally(() => createRoot(document.getElementById("root")!).render(<><PencilDefs /><div className="status-cover" aria-hidden /><App /></>));
// Mode hors ligne + mises à jour : on vérifie s'il existe une nouvelle version au démarrage et au retour sur l'app ;
// quand elle est prête, un bandeau propose de recharger (rien n'est rechargé sans l'accord de l'utilisateur).
if ("serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", () => {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(BASE + "sw.js", { updateViaCache: "none" }).then((reg) => {
    const check = () => { if (document.visibilityState === "visible") void reg.update().catch(() => {}); };
    document.addEventListener("visibilitychange", check); window.setInterval(check, 30 * 60_000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) showUpdateBanner(); });
});
function showUpdateBanner() {
  if (document.getElementById("update-banner")) return;
  const b = document.createElement("button");
  b.id = "update-banner"; b.type = "button";
  b.textContent = "Nouvelle version disponible · Toucher pour mettre à jour";
  b.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:80;padding:10px 16px;border-radius:14px;border:2px solid rgb(var(--fg));background:rgb(var(--hi));color:rgb(24 22 46);font:600 14px var(--font-ui);box-shadow:3px 3px 0 0 rgb(var(--ink))");
  b.onclick = () => location.reload();
  document.body.appendChild(b);
}
