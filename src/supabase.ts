/* Étudiant.OS — accès Supabase (authentification, données, fichiers).
 * Seule la clé PUBLIQUE est utilisée ici ; la sécurité repose sur les politiques RLS de la base. */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { AppState } from "./core.ts";
import type { Cache, CacheData, RemoteDoc, SaveResult, Transport } from "./sync.ts";
import type { FileStore } from "./env.ts";


export const BASE = __BASE_PATH__;
export const SITE_URL = __SITE_URL__;
const url = (typeof window !== "undefined" && (window as unknown as { __SB_URL__?: string }).__SB_URL__) || __SUPABASE_URL__;
const key = (typeof window !== "undefined" && (window as unknown as { __SB_KEY__?: string }).__SB_KEY__) || __SUPABASE_ANON_KEY__;

/** null si le site a été construit sans Supabase (mode local uniquement). */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "etudiant-os/auth" },
}) : null;

/** URL absolue d'une page de l'application (pour les liens des e-mails). */
export const appUrl = (path: string) => new URL(BASE + path.replace(/^\//, ""), window.location.origin).toString();

// ------------------------------------------------------------- Traduction des erreurs
export function frError(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  const code = (e as { code?: string })?.code ?? "";
  if (/invalid login credentials/i.test(m) || code === "invalid_credentials") return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(m) || code === "email_not_confirmed") return "Adresse e-mail pas encore confirmée : cliquez sur le lien reçu par e-mail.";
  if (/already registered|already been registered|user_already_exists/i.test(m + code)) return "Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez le mot de passe.";
  if (/password should be at least|weak_password|password.*(characters|contain)/i.test(m + code)) return "Mot de passe trop faible : 8 caractères minimum, avec des lettres et des chiffres.";
  if (/same_password|should be different/i.test(m + code)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/unable to validate email|invalid.*email|email_address_invalid/i.test(m + code)) return "Adresse e-mail invalide.";
  if (/rate limit|too many|over_email_send_rate_limit|for security purposes/i.test(m + code)) return "Trop de tentatives. Patientez une minute puis réessayez.";
  if (/expired|otp_expired|invalid.*(token|link)/i.test(m + code)) return "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.";
  if (/fetch|network|Failed to fetch|Load failed/i.test(m)) return "Connexion impossible au serveur. Vérifiez votre connexion internet.";
  if (/fichiers restants/i.test(m)) return "Suppression interrompue : des fichiers n'ont pas pu être supprimés. Réessayez.";
  return "Une erreur est survenue. Réessayez dans un instant.";
}

// ------------------------------------------------------------- Données (document versionné)
export function cloudTransport(sb: SupabaseClient): Transport {
  return {
    async load(): Promise<RemoteDoc | null> {
      const { data, error } = await sb.from("user_data").select("state, version, updated_at").maybeSingle();
      if (error) throw error;
      return data ? { state: data.state, version: data.version, updatedAt: data.updated_at } : null;
    },
    async save(state: AppState, baseVersion: number, clientId: string): Promise<SaveResult> {
      const { data, error } = await sb.rpc("save_state", { p_state: state, p_base_version: baseVersion, p_client: clientId }).single<{ ok: boolean; version: number; state: unknown; updated_at: string | null }>();
      if (error) throw error;
      return data.ok ? { ok: true, version: data.version, updatedAt: data.updated_at } : { ok: false, remote: data.version ? { state: data.state, version: data.version, updatedAt: data.updated_at } : null };
    },
  };
}

/** Cache local propre au compte (consultation hors ligne + modifications en attente). Effacé à la déconnexion. */
export const cacheKey = (uid: string) => `etudiant-os/u/${uid}`;
export function localCache(uid: string): Cache {
  const k = cacheKey(uid);
  return {
    read: () => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as CacheData) : null; } catch { return null; } },
    write: (d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch { /* quota : la synchro serveur reste la référence */ } },
    clear: () => { try { for (const key of Object.keys(localStorage)) if (key === k || key.startsWith(k + ":")) localStorage.removeItem(key); } catch { /* ignore */ } },
  };
}

/** Écoute les écritures des autres appareils (Realtime) ; renvoie la fonction d'arrêt. */
export function watchRemote(sb: SupabaseClient, uid: string, onChange: () => void): () => void {
  let ch: ReturnType<SupabaseClient["channel"]> | null = null, stopped = false;
  // Le canal doit être authentifié avec le jeton de l'utilisateur (sinon la RLS ne laisse rien passer).
  void sb.auth.getSession().then(async ({ data }) => {
    if (stopped || !data.session) return;
    await sb.realtime.setAuth(data.session.access_token);
    ch = sb.channel(`user_data:${uid}`).on("postgres_changes", { event: "*", schema: "public", table: "user_data", filter: `user_id=eq.${uid}` }, onChange).subscribe();
  });
  const { data: sub } = sb.auth.onAuthStateChange((e, s) => { if (s && (e === "TOKEN_REFRESHED" || e === "SIGNED_IN")) void sb.realtime.setAuth(s.access_token); });
  return () => { stopped = true; sub.subscription.unsubscribe(); if (ch) void sb.removeChannel(ch); };
}

// ------------------------------------------------------------- Fichiers (bucket privé, dossier = identifiant)
export function cloudFiles(sb: SupabaseClient, uid: string): FileStore {
  const bucket = () => sb.storage.from("user-files");
  return {
    async save(name, blob) { const { error } = await bucket().upload(`${uid}/${name}`, blob, { upsert: true, contentType: blob.type || "application/pdf" }); if (error) throw error; },
    async load(name) { const { data, error } = await bucket().download(`${uid}/${name}`); if (error) return undefined; return data ?? undefined; },
    async remove(name) { const { error } = await bucket().remove([`${uid}/${name}`]); if (error) throw error; },
    async list() { const { data } = await bucket().list(uid); return (data ?? []).map((f) => f.name); },
  };
}

// ------------------------------------------------------------- Compte
export async function deleteAccount(sb: SupabaseClient, uid: string): Promise<string | null> {
  try {
    const files = await cloudFiles(sb, uid).list!();
    if (files.length) { const { error } = await sb.storage.from("user-files").remove(files.map((f) => `${uid}/${f}`)); if (error) throw error; }
    const { error } = await sb.rpc("delete_my_account");
    if (error) throw error;
    await sb.auth.signOut({ scope: "local" });
    return null;
  } catch (e) { return frError(e); }
}
export const displayNameOf = (u: User | null) => String(u?.user_metadata?.display_name ?? "");
