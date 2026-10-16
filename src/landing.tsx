/* Étudiant.OS — page d'accueil publique, pages légales, 404. */
import React, { useEffect, useState } from "react";
import { cx } from "./core.ts";
import { useFixedHeader, Btn, CalendarClock, GraduationCap, Timer, Wallet, ShoppingCart, Home, Moon, LayoutDashboard, Check, MoreVertical, X, Sparkles, Users, Zap, Database, Repeat, FileText } from "./StudentOS.tsx";
import { Logo } from "./auth.tsx";
import { BASE, supabase } from "./supabase.ts";
import type { Route } from "./router.ts";

type Go = (r: Route, opts?: { replace?: boolean; next?: string }) => void;
const img = (name: string) => `${BASE}screens/${name}`;
const REPO = "https://github.com/Fedizzz/etudiant-os";

function Nav({ go, signedIn }: { go: Go; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [headerRef, headerH] = useFixedHeader();
  const links: [string, string][] = [["#fonctionnalites", "Fonctionnalités"], ["#comment", "Comment ça marche"], ["#avantages", "Avantages"], ["#faq", "FAQ"]];
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return (
    <>
    <div aria-hidden style={{ height: headerH }} />
    <header ref={headerRef} className="fixed inset-x-0 top-0 z-40 border-b-2 border-dashed border-line bg-bg/85 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6" aria-label="Navigation principale">
        <Logo onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
        <ul className="ml-6 hidden gap-1 lg:flex">{links.map(([h, l]) => <li key={h}><a href={h} className="rounded-lg px-3 py-2 text-[14px] font-semibold text-muted transition hover:bg-sunken hover:text-fg">{l}</a></li>)}</ul>
        <div className="ml-auto flex items-center gap-2">
          {signedIn || !supabase ? <Btn variant="primary" onClick={() => go({ name: "app", view: "dashboard" })}>{signedIn ? "Ouvrir mon espace" : "Ouvrir l'application"}</Btn> : <>
            <Btn variant="ghost" className="hidden sm:inline-flex" onClick={() => go({ name: "login" })}>Se connecter</Btn>
            <Btn variant="primary" onClick={() => go({ name: "signup" })}><span className="hidden min-[400px]:inline">Commencer gratuitement</span><span className="min-[400px]:hidden">S'inscrire</span></Btn>
          </>}
          <Btn variant="soft" size="sm" className="lg:hidden" aria-label="Menu" aria-expanded={open} aria-controls="land-menu" onClick={() => setOpen(!open)}>{open ? <X size={17} /> : <MoreVertical size={18} strokeWidth={3} />}</Btn>
        </div>
      </nav>
      {open && (
        <div id="land-menu" className="inked mx-4 mb-3 flex flex-col gap-1 rounded-[20px] bg-panel p-2 lg:hidden animate-pop">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="rounded-xl px-3 py-2.5 font-semibold hover:bg-sunken">{l}</a>)}
          {!signedIn && supabase && <button onClick={() => go({ name: "login" })} className="rounded-xl px-3 py-2.5 text-left font-semibold text-accent hover:bg-sunken">Se connecter</button>}
        </div>)}
    </header>
    </>
  );
}

const FEATURES: { icon: React.FC<{ size?: number }>; title: string; color: string; points: string[] }[] = [
  { icon: LayoutDashboard, title: "Tableau de bord", color: "#3448f0", points: ["Tes tâches prévues aujourd'hui, avec un bouton pour lancer le focus", "Retards, échéances et charge des 7 prochains jours", "Sommeil, budget restant et ménage du jour en un coup d'œil"] },
  { icon: CalendarClock, title: "Planning", color: "#0f9d76", points: ["Emploi du temps fixe et indisponibilités (job, sport…)", "Tes devoirs répartis automatiquement dans tes créneaux libres", "Alerte de surcharge et chevauchements signalés, rien n'est déplacé sans toi"] },
  { icon: GraduationCap, title: "Académique", color: "#7a5af5", points: ["Modules, devoirs, examens et projets", "Tableau À faire · En cours · En révision · Terminé", "Import de l'emploi du temps depuis le PDF de ton école"] },
  { icon: Timer, title: "Focus", color: "#d9822b", points: ["Minuteur Pomodoro réglable et mode plein écran", "Sessions liées à une tâche ou à une matière", "Temps de travail par jour, semaine et matière"] },
  { icon: Wallet, title: "Budget & courses", color: "#c2417a", points: ["Budget mensuel, plafonds par catégorie, dépenses récurrentes", "Liste de courses par rayon avec prix appris de tes achats", "Lecture du ticket de caisse en photo (à vérifier avant d'enregistrer)"] },
  { icon: Home, title: "Ménage", color: "#1d9bb5", points: ["Corvées quotidiennes, hebdomadaires ou bimensuelles", "Rotation automatique entre colocataires", "Report sans pénalité et historique de qui a fait quoi"] },
  { icon: Moon, title: "Sommeil", color: "#4f46b8", points: ["Heure de coucher conseillée selon ton premier cours", "Moyennes sur 7 et 14 jours, régularité des horaires", "Repères indicatifs, sans prétention médicale"] },
];

const FAQ: [string, React.ReactNode][] = [
  ["Qu'est-ce qu'Étudiant.OS ?", "Une application web qui rassemble l'organisation d'un étudiant : planning, tâches, sessions de focus, budget, courses, ménage en colocation et sommeil, dans un seul tableau de bord."],
  ["À qui s'adresse l'application ?", "Aux étudiants qui jonglent entre cours, devoirs, job, budget serré et vie en colocation, et qui veulent un seul outil au lieu de cinq."],
  ["L'application est-elle gratuite ?", "Oui : l'inscription et l'utilisation sont gratuites aujourd'hui, et aucun moyen de paiement n'est demandé. Si une offre payante apparaissait un jour, elle serait annoncée à l'avance et ne concernerait pas l'accès à tes données."],
  ["Mes données sont-elles sauvegardées ?", "Oui. Avec un compte, chaque modification est enregistrée dans une base de données hébergée par Supabase. L'indicateur en haut de l'écran affiche « Enregistré » uniquement quand le serveur l'a confirmé. Tu peux aussi exporter toutes tes données en un clic."],
  ["Puis-je retrouver mes données sur plusieurs appareils ?", "Oui : connecte-toi avec le même compte sur ton ordinateur, ta tablette et ton téléphone. Les modifications sont synchronisées ; si deux appareils modifient en même temps, les deux changements sont conservés."],
  ["Et sans connexion internet ?", "Les données déjà chargées restent consultables et tu peux continuer à les modifier : les changements sont mis en attente sur l'appareil et envoyés au retour de la connexion. Certaines fonctions (lecture de ticket, import de PDF, création de compte) nécessitent internet."],
  ["Dois-je installer quelque chose ?", "Non, tout fonctionne dans le navigateur. Tu peux aussi l'ajouter à l'écran d'accueil de ton téléphone (Safari : Partager → Sur l'écran d'accueil ; Chrome : Installer l'application)."],
  ["Qui peut voir mes données ?", "Toi seul. Chaque ligne de la base est liée à ton compte et protégée par des règles d'accès (Row Level Security) testées : un autre utilisateur ne peut ni la lire, ni la modifier."],
  ["Comment supprimer mon compte ?", "Réglages → Mon compte → Supprimer mon compte. Ton compte, tes données synchronisées et tes fichiers sont supprimés définitivement. Pense à exporter tes données avant si tu veux les garder."],
];

function Shot({ src, alt, w, h, className, eager }: { src: string; alt: string; w: number; h: number; className?: string; eager?: boolean }) {
  return <img src={img(src)} alt={alt} width={w} height={h} loading={eager ? "eager" : "lazy"} decoding="async" className={cx("block h-auto w-full", className)} />;
}

export function Landing({ go, signedIn }: { go: Go; signedIn: boolean }) {
  const [tab, setTab] = useState(0);
  const tabs: [string, string, string][] = [["Tableau de bord", "dashboard-desktop.jpg", "Le tableau de bord avec les tâches du jour, le focus, le sommeil, la charge de la semaine et le ménage du jour"], ["Planning", "planning-desktop.jpg", "Le planning de la journée avec les cours et les blocs de travail placés automatiquement"], ["Focus", "focus-desktop.jpg", "Le minuteur de focus et le temps par matière"], ["Budget", "budget-desktop.jpg", "Le budget du mois avec dépenses par jour, récurrentes et plafonds"]];
  useEffect(() => { document.title = "Étudiant.OS — Tes études, ton organisation, un seul espace"; }, []);
  const start = () => go(signedIn || !supabase ? { name: "app", view: "dashboard" } : { name: "signup" });
  return (
    <div className="min-h-full bg-bg text-fg">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-hi focus:px-3 focus:py-2 focus:text-[rgb(24_22_46)]">Aller au contenu</a>
      <Nav go={go} signedIn={signedIn} />
      <main id="contenu">
        {/* ---------------------------------------------------------------- Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-16">
          <div className="stagger-self">
            <span className="sticker inline-flex items-center gap-1.5 rounded-full border-2 border-fg bg-hi px-3 py-1 text-xs font-bold text-[rgb(24_22_46)] shadow-[2px_2px_0_0_rgb(var(--ink))]"><Sparkles size={13} />Pour les étudiants, par des étudiants</span>
            <h1 className="mt-5 font-display text-[40px] font-extrabold leading-[1.02] tracking-tight sm:text-[56px]">Tes études.<br />Ton organisation.<br /><span className="marker">Un seul espace.<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">Planifie tes cours, organise tes révisions, lance des sessions de focus, maîtrise ton budget et tes courses, partage le ménage avec ta coloc et prends soin de ton sommeil. Tout au même endroit, sur tous tes appareils.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Btn variant="primary" className="h-12 px-5 text-[15px]" onClick={start}>{signedIn ? "Ouvrir mon espace" : "Commencer gratuitement"}</Btn>
              <a href="#fonctionnalites" className="press inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border-2 border-fg/80 bg-panel px-5 text-[15px] font-semibold hover:bg-hi/40">Découvrir les fonctionnalités</a>
            </div>
            <p className="mt-4 text-[13px] text-muted">Gratuit · Sans installation · Fonctionne sur ordinateur, tablette et téléphone</p>
          </div>
          <div className="relative mx-auto w-full max-w-[640px] pb-10 lg:pb-0" aria-label="Aperçu de l'application">
            <figure className="inked overflow-hidden rounded-[22px] bg-panel">
              <div className="flex items-center gap-1.5 border-b-2 border-fg/80 bg-sunken px-3 py-2" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-bad" /><span className="h-2.5 w-2.5 rounded-full bg-warn" /><span className="h-2.5 w-2.5 rounded-full bg-ok" /><span className="ml-3 truncate font-mono text-[11px] text-muted">etudiant-os / tableau de bord</span></div>
              <Shot src="dashboard-desktop.jpg" alt="Capture du tableau de bord d'Étudiant.OS avec des données d'exemple" w={1280} h={800} eager />
            </figure>
            <figure className="inked absolute -bottom-2 -right-2 w-[34%] max-w-[190px] rotate-[3deg] overflow-hidden rounded-[22px] bg-panel sm:-right-6">
              <Shot src="focus-mobile.jpg" alt="Capture du minuteur de focus sur téléphone" w={390} h={844} eager />
            </figure>
            <span className="sticker absolute -left-3 top-8 hidden rounded-xl border-2 border-fg bg-pink px-3 py-1.5 text-xs font-bold text-white shadow-[3px_3px_0_0_rgb(var(--ink))] sm:block" aria-hidden>Synchronisé ✓</span>
            <figcaption className="mt-3 max-w-[62%] text-left text-[12px] text-muted">Vraies captures de l'application, avec des données d'exemple.</figcaption>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Fonctionnalités */}
        <section id="fonctionnalites" className="scroll-mt-20 border-y-2 border-dashed border-line bg-sunken/40 py-16" aria-labelledby="f-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="f-title" className="font-display text-[32px] font-extrabold tracking-tight sm:text-[40px]">Tout ce qu'il faut, <span className="marker">rien de plus<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h2>
            <p className="mt-3 max-w-2xl text-muted">Sept modules qui partagent les mêmes données : une tâche planifiée apparaît dans ton planning, ton focus et ton tableau de bord.</p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <article key={f.title} className={cx("inked lift rounded-[22px] bg-panel p-6", i === 0 && "lg:col-span-2")}>
                  <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-fg text-white shadow-[2px_2px_0_0_rgb(var(--ink))]" style={{ background: f.color }}><f.icon size={20} /></span><h3 className="font-display text-xl font-bold">{f.title}</h3></div>
                  <ul className="mt-4 flex flex-col gap-2 text-[14px]">{f.points.map((p) => <li key={p} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-ok" />{p}</li>)}</ul>
                </article>))}
              <article className="inked rounded-[22px] bg-hi p-6 text-[rgb(24_22_46)]">
                <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-[rgb(24_22_46)] bg-panel text-fg"><Zap size={20} /></span><h3 className="font-display text-xl font-bold">Et aussi</h3></div>
                <ul className="mt-4 flex flex-col gap-2 text-[14px] font-medium">{["Recherche rapide (Ctrl K) et raccourcis clavier", "Thèmes clair et sombre", "Installable sur l'écran d'accueil", "Export de toutes tes données"].map((p) => <li key={p} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0" />{p}</li>)}</ul>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Comment ça marche */}
        <section id="comment" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6" aria-labelledby="c-title">
          <h2 id="c-title" className="font-display text-[32px] font-extrabold tracking-tight sm:text-[40px]">Comment ça marche ?</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {[["Crée ton compte gratuitement", "Un e-mail, un mot de passe, une confirmation. Si tu utilisais déjà l'application sans compte, tu peux importer tes données.", Users],
              ["Configure ton espace", "Tes horaires de sommeil, ton budget, tes colocataires, puis tes modules et ton emploi du temps (à la main ou depuis le PDF de ton école).", FileText],
              ["Organise tout depuis un seul tableau de bord", "Ajoute tes devoirs : ils sont répartis dans tes créneaux libres. Le reste suit : focus, budget, ménage, sommeil.", LayoutDashboard]].map(([t, d, I], i) => {
              const Icon = I as React.FC<{ size?: number }>; return (
              <li key={t as string} className="inked relative rounded-[22px] bg-panel p-6">
                <span className="sticker absolute -top-4 left-5 grid h-9 w-9 place-items-center rounded-full border-2 border-fg bg-hi font-display text-lg font-extrabold text-[rgb(24_22_46)] shadow-[2px_2px_0_0_rgb(var(--ink))]" aria-hidden>{i + 1}</span>
                <Icon size={22} />
                <h3 className="mt-3 font-display text-lg font-bold">{t as string}</h3>
                <p className="mt-2 text-[14px] text-muted">{d as string}</p>
              </li>); })}
          </ol>
        </section>

        {/* ---------------------------------------------------------------- Avantages */}
        <section id="avantages" className="scroll-mt-20 border-y-2 border-dashed border-line bg-sunken/40 py-16" aria-labelledby="a-title">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 id="a-title" className="font-display text-[32px] font-extrabold tracking-tight sm:text-[40px]">Moins d'outils, <span className="marker">plus de clarté<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h2>
              <ul className="mt-8 flex flex-col gap-4">
                {[["Moins de dispersion", "Agenda, to-do, minuteur, tableur de budget et groupe de coloc : un seul outil."],
                  ["Tes priorités visibles", "Ce qui est prévu aujourd'hui, ce qui est en retard, ce qui arrive cette semaine."],
                  ["Un suivi clair de ton travail", "Temps de focus par matière, progression de chaque devoir et projet."],
                  ["Un quotidien plus simple", "Courses, budget, ménage et sommeil suivis au même endroit."],
                  ["Sur tous tes appareils", "Connecte-toi partout : tes données te suivent et restent synchronisées."],
                  ["Tes données isolées et protégées", "Chaque compte ne voit que ses propres données, vérifié par des tests automatisés."]].map(([t, d]) => (
                  <li key={t} className="flex gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-fg bg-hi text-[rgb(24_22_46)]"><Check size={12} strokeWidth={3} /></span><div><p className="font-semibold">{t}</p><p className="text-[14px] text-muted">{d}</p></div></li>))}
              </ul>
            </div>
            <figure className="inked mx-auto w-full max-w-[300px] rotate-[-2deg] overflow-hidden rounded-[26px] bg-panel">
              <Shot src="dashboard-mobile.jpg" alt="Capture du tableau de bord sur téléphone" w={390} h={844} />
            </figure>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Aperçu */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="p-title">
          <h2 id="p-title" className="font-display text-[32px] font-extrabold tracking-tight sm:text-[40px]">Un aperçu du vrai produit</h2>
          <div role="tablist" aria-label="Choisir un module" className="mt-6 flex flex-wrap gap-2">
            {tabs.map(([l], i) => <button key={l} role="tab" id={`tab-${i}`} aria-selected={tab === i} aria-controls="tab-panel" onClick={() => setTab(i)} className={cx("rounded-full border-2 px-4 py-1.5 text-[14px] font-semibold transition", tab === i ? "border-fg bg-hi text-[rgb(24_22_46)] shadow-[2px_2px_0_0_rgb(var(--ink))]" : "border-line text-muted hover:border-fg/60")}>{l}</button>)}
          </div>
          <figure id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="inked mt-6 overflow-hidden rounded-[22px] bg-panel">
            <Shot key={tabs[tab][1]} src={tabs[tab][1]} alt={tabs[tab][2]} w={1280} h={800} className="animate-fade" />
          </figure>
          <p className="mt-3 text-[12px] text-muted">Captures réelles avec des données d'exemple. Ton espace démarre vide et se remplit avec tes propres informations.</p>
        </section>

        {/* ---------------------------------------------------------------- FAQ */}
        <section id="faq" className="scroll-mt-20 border-t-2 border-dashed border-line bg-sunken/40 py-16" aria-labelledby="q-title">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 id="q-title" className="font-display text-[32px] font-extrabold tracking-tight sm:text-[40px]">Questions fréquentes</h2>
            <div className="mt-8 flex flex-col gap-3">
              {FAQ.map(([q, a]) => (
                <details key={q} className="inked group rounded-[18px] bg-panel px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-fg text-lg leading-none transition group-open:rotate-45" aria-hidden>+</span></summary>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted">{a}</p>
                </details>))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Appel final */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="inked flex flex-col items-start gap-5 rounded-[26px] bg-accent p-8 text-onaccent sm:flex-row sm:items-center sm:justify-between sm:p-10">
            <div><h2 className="font-display text-[28px] font-extrabold tracking-tight sm:text-[34px]">Prêt à mettre de l'ordre dans ton semestre ?</h2><p className="mt-2 opacity-90">Crée ton compte en une minute. C'est gratuit.</p></div>
            <button onClick={start} className="press shrink-0 rounded-xl border-2 border-fg bg-hi px-6 py-3 text-[15px] font-bold text-[rgb(24_22_46)] shadow-[3px_3px_0_0_rgb(var(--ink))]">{signedIn ? "Ouvrir mon espace" : "Commencer gratuitement"}</button>
          </div>
        </section>
      </main>
      <Footer go={go} />
    </div>
  );
}

export function Footer({ go }: { go: Go }) {
  const link = (r: Route, l: string, href: string) => <a href={href} onClick={(e) => { e.preventDefault(); go(r); }} className="hover:text-fg hover:underline">{l}</a>;
  return (
    <footer className="border-t-2 border-fg/80 bg-panel">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div><Logo onClick={() => go({ name: "landing" })} /><p className="mt-3 max-w-xs text-[13px] text-muted">L'espace d'organisation des étudiants : planning, focus, budget, courses, ménage et sommeil.</p></div>
        <nav aria-label="Produit" className="flex flex-col gap-2 text-[14px] text-muted"><p className="font-semibold text-fg">Produit</p><a href={`${BASE}#fonctionnalites`} className="hover:text-fg hover:underline">Fonctionnalités</a><a href={`${BASE}#comment`} className="hover:text-fg hover:underline">Comment ça marche</a><a href={`${BASE}#faq`} className="hover:text-fg hover:underline">FAQ</a></nav>
        <nav aria-label="Compte" className="flex flex-col gap-2 text-[14px] text-muted"><p className="font-semibold text-fg">Compte</p>{link({ name: "signup" }, "Créer un compte", "signup")}{link({ name: "login" }, "Se connecter", "login")}{link({ name: "forgot" }, "Mot de passe oublié", "forgot-password")}</nav>
        <nav aria-label="Informations" className="flex flex-col gap-2 text-[14px] text-muted"><p className="font-semibold text-fg">Informations</p>{link({ name: "privacy" }, "Confidentialité et cookies", "confidentialite")}{link({ name: "terms" }, "Conditions d'utilisation", "conditions")}<a href={`${REPO}/issues/new`} target="_blank" rel="noopener" className="hover:text-fg hover:underline">Signaler un problème</a></nav>
      </div>
      <p className="border-t-2 border-dashed border-line px-4 py-4 text-center text-[12px] text-muted">© {new Date().getFullYear()} Étudiant.OS</p>
    </footer>
  );
}

// ------------------------------------------------------------- Pages légales (modèles à faire valider)
function LegalPage({ title, go, children }: { title: string; go: Go; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} · Étudiant.OS`; window.scrollTo(0, 0); }, [title]);
  return (
    <div className="min-h-full bg-bg text-fg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6"><Logo onClick={() => go({ name: "landing" })} /><Btn variant="ghost" onClick={() => go({ name: "landing" })}>Accueil</Btn></header>
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <article className="inked rounded-[22px] bg-panel p-6 sm:p-10 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_p]:leading-relaxed [&_ul]:mt-3 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 text-[15px]">
          <h1 className="font-display text-[32px] font-extrabold tracking-tight">{title}</h1>
          <p className="!mt-2 text-[13px] text-muted">Dernière mise à jour : 16 octobre 2026</p>
          <p className="rounded-xl border-2 border-warn/50 bg-warn/10 p-3 text-[13px]">Document de base décrivant le fonctionnement réel du service. Les mentions entre crochets doivent être complétées par l'éditeur, et l'ensemble relu avant une ouverture au public : il ne constitue pas un avis juridique.</p>
          {children}
        </article>
      </main>
      <Footer go={go} />
    </div>
  );
}
export function PrivacyPage({ go }: { go: Go }) {
  return (
    <LegalPage title="Politique de confidentialité" go={go}>
      <h2>Responsable du traitement</h2><p>[Nom ou raison sociale de l'éditeur, adresse, e-mail de contact]. Pour toute question : <a className="text-accent underline" href={`${REPO}/issues`}>suivi des demandes</a> ou l'adresse ci-dessus.</p>
      <h2>Données collectées</h2>
      <ul><li><b>Compte</b> : adresse e-mail, mot de passe (stocké chiffré par Supabase Auth, jamais lisible), nom d'affichage, dates de création et de connexion.</li>
        <li><b>Contenu que tu saisis</b> : tâches, modules, emploi du temps, sessions de focus, dépenses, listes de courses, corvées et noms de colocataires que tu indiques, nuits de sommeil, réglages.</li>
        <li><b>Fichiers</b> : le PDF d'emploi du temps si tu l'importes.</li>
        <li><b>Demandes de support</b> : les signalements et demandes d'aide que tu envoies, les messages échangés, les captures d'écran que tu joins, et, si tu laisses la case cochée, des informations techniques limitées (navigateur, système, version de l'application, page concernée, date).</li>
        <li><b>Données techniques</b> : journaux de connexion conservés par l'hébergeur pour la sécurité.</li></ul>
      <p>Les administrateurs du service voient les informations de compte nécessaires au support (e-mail, dates, statut) et des totaux sur tes données, pas leur contenu. Un accès exceptionnel à une donnée précise n'est possible que pour résoudre un problème, avec une justification ; il est enregistré dans un journal non modifiable.</p>
      <p>Les photos de tickets de caisse sont lues dans ton navigateur et ne sont pas envoyées à nos serveurs ; seul le montant que tu valides est enregistré.</p>
      <h2>Finalités et base légale</h2><p>Fournir le service que tu demandes (exécution du contrat) : authentification, sauvegarde et synchronisation de tes données entre tes appareils. Aucune publicité, aucune revente, aucun profilage.</p>
      <h2>Hébergement et sous-traitants</h2><p>Base de données, authentification et fichiers : Supabase (région [à préciser lors de la création du projet, par exemple Union européenne]). Site : [GitHub Pages / autre hébergeur]. Polices : Google Fonts (chargées depuis les serveurs de Google, qui reçoivent ton adresse IP).</p>
      <h2>Durée de conservation</h2><p>Tant que ton compte existe. À la suppression du compte, ton profil, tes données, tes fichiers et tes demandes de support sont supprimés immédiatement de la base (le journal d'administration conserve la trace de l'opération) ; les sauvegardes techniques de l'hébergeur expirent selon sa politique [durée à préciser].</p>
      <h2>Sécurité</h2><p>Connexion chiffrée (HTTPS), mots de passe gérés par Supabase Auth, isolation des données de chaque compte par des règles d'accès au niveau de la base (Row Level Security), vérifiées par des tests automatisés.</p>
      <h2>Tes droits</h2><p>Accès et portabilité (Réglages → Mon compte → Exporter mes données), rectification (modifie directement tes données), effacement (Réglages → Mon compte → Supprimer mon compte), opposition et limitation via le contact ci-dessus. Tu peux saisir la CNIL (cnil.fr).</p>
      <h2>Cookies et stockage local</h2><p>Aucun cookie publicitaire ou de mesure d'audience. Le site utilise uniquement le stockage local du navigateur, strictement nécessaire au fonctionnement : session de connexion, copie de tes données pour l'usage hors ligne, préférences (thème). Ces éléments sont effacés à la déconnexion, sauf les préférences d'affichage.</p>
    </LegalPage>
  );
}
export function TermsPage({ go }: { go: Go }) {
  return (
    <LegalPage title="Conditions d'utilisation" go={go}>
      <h2>Objet</h2><p>Étudiant.OS est un outil d'organisation personnelle. Ces conditions encadrent son utilisation. Éditeur : [nom, contact].</p>
      <h2>Compte</h2><p>Tu dois fournir une adresse e-mail valide et la confirmer. Tu es responsable de la confidentialité de ton mot de passe. Un compte est personnel.</p>
      <h2>Gratuité</h2><p>Le service est actuellement gratuit. Toute évolution de ce modèle serait annoncée à l'avance aux utilisateurs inscrits.</p>
      <h2>Tes contenus</h2><p>Tu restes propriétaire des données que tu saisis. Tu peux les exporter et supprimer ton compte à tout moment.</p>
      <h2>Disponibilité</h2><p>Le service est fourni tel quel, sans garantie de disponibilité permanente. Exporte régulièrement tes données importantes. Les calculs (planning, budget, sommeil) sont des aides à l'organisation ; les indications sur le sommeil ne sont pas des avis médicaux.</p>
      <h2>Usage acceptable</h2><p>Pas de tentative d'accès aux données d'autrui, de contournement des protections ou de surcharge volontaire du service.</p>
      <h2>Résiliation</h2><p>Tu peux supprimer ton compte depuis les réglages. L'éditeur peut suspendre un compte en cas de violation manifeste de ces conditions.</p>
      <h2>Droit applicable</h2><p>[Droit applicable et juridiction compétente à préciser par l'éditeur.]</p>
    </LegalPage>
  );
}
export function NotFound({ go }: { go: Go }) {
  useEffect(() => { document.title = "Page introuvable · Étudiant.OS"; }, []);
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 py-16 text-center text-fg">
      <div className="inked max-w-md rounded-[24px] bg-panel p-8">
        <p className="sticker mx-auto inline-block rounded-xl border-2 border-fg bg-hi px-3 py-1 font-display text-3xl font-extrabold text-[rgb(24_22_46)]">404</p>
        <h1 className="mt-4 font-display text-2xl font-extrabold">Cette page n'existe pas</h1>
        <p className="mt-2 text-[14px] text-muted">Le lien est peut-être incomplet ou la page a été déplacée.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2"><Btn variant="primary" onClick={() => go({ name: "landing" })}>Accueil</Btn><Btn onClick={() => go({ name: "app", view: "dashboard" })}>Mon espace</Btn></div>
      </div>
    </div>
  );
}
