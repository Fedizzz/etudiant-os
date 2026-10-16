/* Étudiant.OS — accès aux données de support (tickets, messages, notifications, administration).
 * Toutes les règles (propriété, rôle, statut, validation) sont appliquées par la base (RLS + fonctions) :
 * ce module ne fait qu'appeler l'API ; rien ici n'accorde un droit. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACH_TYPES, type TicketKind, type TicketPriority, type TicketStatus } from "./supportModel.ts";

export interface Ticket {
  id: string; number: number; owner_id: string; kind: TicketKind; category: string; subject: string; description: string;
  module: string | null; steps: string | null; expected: string | null; observed: string | null; frequency: string | null; impact: string | null;
  urgency: string | null; tech: Record<string, string> | null; attachment_path: string | null; status: TicketStatus; priority: TicketPriority;
  assigned_to: string | null; created_at: string; updated_at: string; last_message_at: string; last_message_by: "user" | "admin";
  owner_read_at: string; admin_read_at: string | null; resolved_at: string | null;
}
export interface Message { id: string; ticket_id: string; author_id: string | null; author_role: "user" | "admin" | "system"; body: string; attachment_path: string | null; created_at: string }
export interface Notification { id: string; ticket_id: string | null; kind: string; created_at: string; read_at: string | null; tickets?: { owner_id: string } | null }
/** Notification sur un de MES tickets (sinon : notification d'administration). */
export const isMine = (n: Notification, uid: string) => n.tickets?.owner_id === uid;

/** Erreur lisible (les messages de la base sont déjà en français). */
export function supportError(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  if (/fetch|network|Failed to fetch|Load failed/i.test(m)) return "Connexion impossible au serveur. Vérifie ta connexion internet puis réessaie.";
  if (/réservé|42501|permission denied|row-level security/i.test(m)) return "Action non autorisée.";
  if (/check constraint|violates/i.test(m)) return "Certaines valeurs sont invalides. Vérifie le formulaire.";
  if (/mime|type.*not supported|invalid_mime/i.test(m)) return "Format de fichier non accepté.";
  if (/exceeded the maximum|too large|Payload too large/i.test(m)) return "Fichier trop lourd (5 Mo maximum).";
  if (m && m.length < 160 && /[a-zà-ü]/i.test(m) && !/^[A-Z_]+$/.test(m)) return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
  return "Une erreur est survenue. Réessaie dans un instant.";
}
async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ------------------------------------------------------------- Pièces jointes (bucket privé support-files)
export async function uploadAttachment(sb: SupabaseClient, uid: string, file: File): Promise<string> {
  const ext = ATTACH_TYPES[file.type];
  if (!ext) throw new Error("Format non accepté : seulement PNG, JPEG ou WebP");
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("support-files").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
/** URL temporaire (1 h) d'une pièce jointe, si l'appelant y a droit (vérifié par la politique Storage). */
export async function attachmentUrl(sb: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await sb.storage.from("support-files").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ------------------------------------------------------------- Utilisateur
export const myRole = (sb: SupabaseClient) => rpc<{ is_admin: boolean; active: boolean }>(sb, "my_role");
export const createTicket = (sb: SupabaseClient, p: Record<string, unknown>) => rpc<{ id: string; number: number }>(sb, "create_ticket", { p });
export const postMessage = (sb: SupabaseClient, ticket: string, body: string, attachment?: string | null, status?: TicketStatus | null) =>
  rpc<{ id: string; created_at: string; author_role: string }>(sb, "post_message", { p_ticket: ticket, p_body: body, p_attachment: attachment ?? null, p_status: status ?? null });
export const setMyTicketState = (sb: SupabaseClient, ticket: string, action: "resolve" | "reopen") => rpc<void>(sb, "set_my_ticket_state", { p_ticket: ticket, p_action: action });
export const markTicketRead = (sb: SupabaseClient, ticket: string) => rpc<void>(sb, "mark_ticket_read", { p_ticket: ticket });
export const markAllRead = (sb: SupabaseClient) => rpc<void>(sb, "mark_notifications_read");
export const logAdminDenied = (sb: SupabaseClient, path: string) => rpc<void>(sb, "log_admin_denied", { p_path: path });

export async function myTickets(sb: SupabaseClient, uid: string): Promise<Ticket[]> {
  const { data, error } = await sb.from("tickets").select("*").eq("owner_id", uid).order("last_message_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return data as Ticket[];
}
export async function getTicket(sb: SupabaseClient, id: string): Promise<Ticket | null> {
  const { data, error } = await sb.from("tickets").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Ticket | null;
}
export async function getMessages(sb: SupabaseClient, ticket: string): Promise<Message[]> {
  const { data, error } = await sb.from("ticket_messages").select("*").eq("ticket_id", ticket).order("created_at");
  if (error) throw new Error(error.message);
  return data as Message[];
}
export async function unreadNotifications(sb: SupabaseClient, uid: string): Promise<Notification[]> {
  const { data, error } = await sb.from("notifications").select("*, tickets(owner_id)").eq("user_id", uid).is("read_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data as Notification[];
}
/** Écoute ses propres notifications (Realtime, filtré par RLS) ; renvoie la fonction d'arrêt. */
export function watchNotifications(sb: SupabaseClient, uid: string, onChange: () => void): () => void {
  let ch: ReturnType<SupabaseClient["channel"]> | null = null, stopped = false;
  void sb.auth.getSession().then(async ({ data }) => {
    if (stopped || !data.session) return;
    await sb.realtime.setAuth(data.session.access_token);
    ch = sb.channel(`notifications:${uid}`).on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, onChange).subscribe();
  });
  return () => { stopped = true; if (ch) void sb.removeChannel(ch); };
}

// ------------------------------------------------------------- Administration
export interface AdminUserRow { id: string; display_name: string; email: string; created_at: string; email_confirmed_at: string | null; last_activity: string | null; status: "active" | "suspended"; role: "admin" | "user"; open_tickets: number; profile_updated_at: string | null }
export interface AdminTicketRow { id: string; number: number; kind: TicketKind; category: string; subject: string; status: TicketStatus; priority: TicketPriority; module: string | null; created_at: string; last_message_at: string; last_message_by: string; owner_id: string; owner_email: string; owner_name: string; assigned_to: string | null; assigned_email: string | null; unread: boolean }
export interface AuditEntry { id: number; actor_email: string | null; action: string; target_email?: string | null; target_user?: string | null; target_ticket?: string | null; summary?: Record<string, unknown>; reason?: string | null; created_at: string }
export interface Paged<T> { total: number; rows: T[] }

export const admin = {
  stats: (sb: SupabaseClient) => rpc<Record<string, number> & { recent_tickets: AdminTicketRow[]; priority_tickets: AdminTicketRow[]; recent_audit: AuditEntry[] }>(sb, "admin_stats"),
  admins: (sb: SupabaseClient) => rpc<{ id: string; email: string; name: string }[]>(sb, "admin_list_admins"),
  users: (sb: SupabaseClient, f: { q?: string; role?: string; status?: string; from?: string; to?: string; sort?: string; page?: number; size?: number }) =>
    rpc<Paged<AdminUserRow>>(sb, "admin_list_users", { p_q: f.q || null, p_role: f.role || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null, p_sort: f.sort || "created_desc", p_page: f.page ?? 0, p_size: f.size ?? 25 }),
  user: (sb: SupabaseClient, id: string) => rpc<{
    user: AdminUserRow; account: { last_sign_in_at: string | null; providers: string[]; banned_until: string | null; new_email: string | null };
    profile: { status_reason: string | null; status_changed_at: string | null; created_at: string } | null; preferences: Record<string, unknown> | null;
    data: { version: number; updated_at: string; updated_by: string | null; counts: Record<string, number>; expenses: number } | null;
    tickets: { id: string; number: number; kind: TicketKind; subject: string; status: TicketStatus; priority: TicketPriority; created_at: string }[];
    notes: { id: string; body: string; created_at: string; author: string | null }[]; audit: AuditEntry[];
  }>(sb, "admin_get_user", { p_user: id }),
  updateProfile: (sb: SupabaseClient, id: string, name: string, reason: string) => rpc<void>(sb, "admin_update_profile", { p_user: id, p_display_name: name, p_reason: reason }),
  addUserNote: (sb: SupabaseClient, id: string, body: string) => rpc<void>(sb, "admin_add_user_note", { p_user: id, p_body: body }),
  setStatus: (sb: SupabaseClient, id: string, status: "active" | "suspended", reason: string) => rpc<void>(sb, "admin_set_status", { p_user: id, p_status: status, p_reason: reason }),
  requestReset: (sb: SupabaseClient, id: string, reason: string) => rpc<string>(sb, "admin_request_password_reset", { p_user: id, p_reason: reason }),
  beginDeletion: (sb: SupabaseClient, id: string, reason: string) => rpc<void>(sb, "admin_begin_deletion", { p_user: id, p_reason: reason }),
  /** Suppression complète : fichiers (API Storage) puis compte. S'arrête à la première erreur. */
  async deleteUser(sb: SupabaseClient, id: string, confirmEmail: string, reason: string) {
    const files = await rpc<{ bucket: string; name: string }[]>(sb, "admin_user_files", { p_user: id });
    for (const b of ["user-files", "support-files"]) {
      const names = files.filter((f) => f.bucket === b).map((f) => f.name);
      if (names.length) { const { error } = await sb.storage.from(b).remove(names); if (error) throw new Error(error.message); }
    }
    await rpc<void>(sb, "admin_delete_user", { p_user: id, p_confirm_email: confirmEmail, p_reason: reason });
  },
  readData: (sb: SupabaseClient, id: string, path: string[], reason: string) => rpc<unknown>(sb, "admin_read_user_data", { p_user: id, p_path: path, p_reason: reason }),
  fixData: (sb: SupabaseClient, id: string, path: string[], expected: unknown, value: unknown, reason: string) =>
    rpc<{ version: number }>(sb, "admin_fix_user_data", { p_user: id, p_path: path, p_expected: expected, p_value: value, p_reason: reason }),
  revertFix: (sb: SupabaseClient, auditId: number, reason: string) => rpc<void>(sb, "admin_revert_data_fix", { p_audit: auditId, p_reason: reason }),
  tickets: (sb: SupabaseClient, f: { q?: string; kind?: string; status?: string; priority?: string; owner?: string; assigned?: string; sort?: string; page?: number; size?: number }) =>
    rpc<Paged<AdminTicketRow>>(sb, "admin_list_tickets", { p_q: f.q || null, p_kind: f.kind || null, p_status: f.status || null, p_priority: f.priority || null, p_owner: f.owner || null, p_assigned: f.assigned || null, p_sort: f.sort || "activity", p_page: f.page ?? 0, p_size: f.size ?? 25 }),
  ticket: (sb: SupabaseClient, id: string) => rpc<{ ticket: Ticket & { owner_email: string; owner_name: string; owner_status: string }; notes: { id: string; body: string; created_at: string; author: string | null }[]; audit: AuditEntry[] }>(sb, "admin_get_ticket", { p_ticket: id }),
  updateTicket: (sb: SupabaseClient, id: string, p: { status?: TicketStatus; priority?: TicketPriority; assigned?: string | null }) =>
    rpc<void>(sb, "admin_update_ticket", { p_ticket: id, p_status: p.status ?? null, p_priority: p.priority ?? null, p_assigned: p.assigned || null, p_unassign: p.assigned === null }),
  addTicketNote: (sb: SupabaseClient, id: string, body: string) => rpc<void>(sb, "admin_add_ticket_note", { p_ticket: id, p_body: body }),
  async audit(sb: SupabaseClient, f: { action?: string; page?: number; size?: number }): Promise<Paged<AuditEntry>> {
    const size = f.size ?? 50, page = f.page ?? 0;
    let q = sb.from("admin_audit").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * size, page * size + size - 1);
    if (f.action) q = q.eq("action", f.action);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { total: count ?? 0, rows: data as AuditEntry[] };
  },
};
