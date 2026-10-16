/* Étudiant.OS — support : libellés, validation des formulaires, informations techniques (logique pure, testée). */

export type TicketKind = "bug" | "help";
export type TicketStatus = "new" | "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "critical";

export const BUG_CATEGORIES: Record<string, string> = {
  display: "Bug d'affichage", calculation: "Erreur de calcul", planning: "Problème de planning", sync: "Problème de synchronisation",
  login: "Problème de connexion", data: "Perte ou incohérence de données", performance: "Problème de performance", other: "Autre",
};
export const HELP_CATEGORIES: Record<string, string> = {
  feature_question: "Question sur une fonctionnalité", usage: "Aide pour utiliser l'application", account: "Problème de compte",
  connection: "Problème de connexion", data_sync: "Question sur les données et la synchronisation", correction: "Demande de correction",
  suggestion: "Suggestion d'amélioration", other_request: "Autre demande",
};
export const MODULES: Record<string, string> = {
  dashboard: "Tableau de bord", academic: "Académique", planning: "Planning", focus: "Focus", groceries: "Courses", budget: "Budget",
  chores: "Ménage", sleep: "Sommeil", settings: "Paramètres", account: "Compte et connexion", other: "Autre",
};
export const FREQUENCIES: Record<string, string> = { once: "Une seule fois", sometimes: "Occasionnellement", often: "Souvent", always: "À chaque utilisation" };
export const IMPACTS: Record<string, string> = { low: "Faible", medium: "Moyen", high: "Important", blocking: "Bloquant" };
export const URGENCIES: Record<string, string> = { low: "Pas pressé", normal: "Normal", high: "Assez urgent" };
export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "Nouveau", open: "Ouvert", in_progress: "En cours", waiting_user: "En attente de l'utilisateur", resolved: "Résolu", closed: "Fermé",
};
/** Libellé côté utilisateur (« ta réponse » plutôt que « l'utilisateur »). */
export const STATUS_LABEL_USER: Record<TicketStatus, string> = { ...STATUS_LABEL, waiting_user: "En attente de ta réponse" };
export const PRIORITY_LABEL: Record<TicketPriority, string> = { low: "Basse", normal: "Normale", high: "Haute", critical: "Critique" };
export const KIND_LABEL: Record<TicketKind, string> = { bug: "Signalement", help: "Assistance" };
export const statusTone = (s: TicketStatus) => (s === "resolved" || s === "closed" ? "ok" : s === "waiting_user" ? "warn" : s === "new" ? "info" : "muted") as "ok" | "warn" | "info" | "muted";
export const priorityTone = (p: TicketPriority) => (p === "critical" ? "bad" : p === "high" ? "warn" : "muted") as "bad" | "warn" | "muted";
export const categoryLabel = (c: string) => BUG_CATEGORIES[c] ?? HELP_CATEGORIES[c] ?? c;
export const isOpen = (s: TicketStatus) => s !== "resolved" && s !== "closed";

export const NOTIF_LABEL: Record<string, string> = {
  admin_reply: "Nouvelle réponse de l'équipe", user_message: "Nouveau message de l'utilisateur", ticket_resolved: "Demande résolue",
  ticket_reopened: "Demande rouverte", info_requested: "L'équipe a besoin d'une précision", new_ticket: "Nouvelle demande",
};

export const LIMITS = { subject: [3, 120], description: [10, 5000], steps: 3000, expected: 1000, observed: 1000, message: 5000 } as const;

export interface BugForm { category: string; subject: string; description: string; steps: string; expected: string; observed: string; frequency: string; module: string; impact: string; includeTech: boolean }
export interface HelpForm { category: string; subject: string; description: string; module: string; urgency: string }
export type Errors = Partial<Record<string, string>>;

const len = (s: string) => s.trim().length;
function common(f: { subject: string; description: string; category: string }, cats: Record<string, string>): Errors {
  const e: Errors = {};
  if (!cats[f.category]) e.category = "Choisis une catégorie.";
  if (len(f.subject) < LIMITS.subject[0]) e.subject = "Donne un titre d'au moins 3 caractères.";
  else if (len(f.subject) > LIMITS.subject[1]) e.subject = `120 caractères maximum (actuellement ${len(f.subject)}).`;
  if (len(f.description) < LIMITS.description[0]) e.description = "Décris le problème en quelques mots (10 caractères minimum).";
  else if (len(f.description) > LIMITS.description[1]) e.description = `5000 caractères maximum (actuellement ${len(f.description)}).`;
  return e;
}
export function validateBug(f: BugForm): Errors {
  const e = common(f, BUG_CATEGORIES);
  if (!FREQUENCIES[f.frequency]) e.frequency = "Indique la fréquence.";
  if (!IMPACTS[f.impact]) e.impact = "Indique l'impact.";
  if (f.module && !MODULES[f.module]) e.module = "Module inconnu.";
  if (len(f.steps) > LIMITS.steps) e.steps = "3000 caractères maximum.";
  if (len(f.expected) > LIMITS.expected) e.expected = "1000 caractères maximum.";
  if (len(f.observed) > LIMITS.observed) e.observed = "1000 caractères maximum.";
  return e;
}
export function validateHelp(f: HelpForm): Errors {
  const e = common(f, HELP_CATEGORIES);
  if (f.module && !MODULES[f.module]) e.module = "Module inconnu.";
  if (!URGENCIES[f.urgency]) e.urgency = "Indique l'urgence.";
  return e;
}

export const ATTACH_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const ATTACH_MAX = 5 * 1024 * 1024;
/** Capture d'écran : PNG, JPEG ou WebP, 5 Mo maximum. Renvoie un message d'erreur ou null. */
export function validateAttachment(f: { type: string; size: number; name: string }): string | null {
  if (!ATTACH_TYPES[f.type] || !/\.(png|jpe?g|webp)$/i.test(f.name)) return "Format non accepté : seulement PNG, JPEG ou WebP.";
  if (f.size > ATTACH_MAX) return `Fichier trop lourd (${(f.size / 1048576).toFixed(1)} Mo) : 5 Mo maximum.`;
  if (f.size === 0) return "Fichier vide.";
  return null;
}

/** Informations techniques NON sensibles : navigateur, système approximatif, version, page, date. Jamais de données de l'application. */
export function techInfo(ua: string, route: string, appVersion: string, now = new Date()): Record<string, string> {
  const m = (re: RegExp) => re.exec(ua)?.[1];
  const browser = m(/Edg\/(\d+)/) ? `Edge ${m(/Edg\/(\d+)/)}` : m(/Firefox\/(\d+)/) ? `Firefox ${m(/Firefox\/(\d+)/)}`
    : m(/Chrome\/(\d+)/) ? `Chrome ${m(/Chrome\/(\d+)/)}` : m(/Version\/(\d+).*Safari/) ? `Safari ${m(/Version\/(\d+).*Safari/)}` : "Inconnu";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Inconnu";
  // Route sans paramètres ni fragment (qui pourraient contenir des jetons).
  const cleanRoute = route.split(/[?#]/)[0].slice(0, 120);
  return { browser, os, appVersion, route: cleanRoute, reportedAt: now.toISOString() };
}

export const fmtDateTime = (s: string | null | undefined) => s ? new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtShort = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s), diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export const AUDIT_LABEL: Record<string, string> = {
  role_granted: "Rôle administrateur accordé", role_revoked: "Rôle administrateur retiré", user_viewed: "Fiche utilisateur consultée",
  profile_updated: "Profil modifié", user_note_added: "Note de support ajoutée", account_suspended: "Compte suspendu", account_reactivated: "Compte réactivé",
  password_reset_sent: "Réinitialisation du mot de passe envoyée", deletion_started: "Procédure de suppression lancée", account_deleted: "Compte supprimé",
  data_viewed: "Donnée consultée (accès exceptionnel)", data_fixed: "Donnée corrigée", data_fix_reverted: "Correction annulée",
  reply_sent: "Réponse envoyée", ticket_status: "Statut du ticket modifié", ticket_closed: "Ticket résolu / fermé", ticket_reopened: "Ticket rouvert",
  ticket_priority: "Priorité modifiée", ticket_assigned: "Ticket assigné", ticket_note_added: "Note interne ajoutée", admin_access_denied: "Accès à l'administration refusé",
};

/** Chemin lisible « tasks / id:abc / title » → segments. */
export const parsePath = (s: string) => s.split("/").map((x) => x.trim()).filter(Boolean);
