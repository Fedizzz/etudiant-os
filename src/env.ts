/* Étudiant.OS — ce que l'interface reçoit de son environnement (mode local ou compte synchronisé). */
import type { SyncStatus } from "./sync.ts";

/** Fichiers de l'utilisateur (PDF d'emploi du temps) : IndexedDB en local, Supabase Storage avec un compte. */
export interface FileStore { save(name: string, blob: Blob): Promise<void>; load(name: string): Promise<Blob | undefined>; remove(name: string): Promise<void>; list?(): Promise<string[]> }
export interface AccountApi {
  id: string; email: string; displayName: string; pendingEmail: string | null;
  updateName(name: string): Promise<string | null>;
  updateEmail(email: string): Promise<string | null>;
  updatePassword(password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Supprime fichiers, données et compte. Renvoie un message d'erreur ou null. */
  deleteAccount(): Promise<string | null>;
}
export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null; error: string | null; conflicts: number; online: boolean; retry(): void }
/** Support et administration (mode compte uniquement). isAdmin n'est qu'un indice d'affichage : la base vérifie tout. */
export interface SupportInfo { isAdmin: boolean; unread: number; open(page: "report" | "help" | "requests"): void; openAdmin(): void }
export interface AppEnv {
  mode: "local" | "cloud";
  /** Préfixe des clés de stockage locales (sauvegardes de sécurité…) : propre à chaque compte. */
  ns: string;
  files: FileStore;
  account?: AccountApi;
  sync?: SyncInfo;
  support?: SupportInfo;
  /** Télécharge un calendrier .ics (via la base en mode compte : contourne le blocage CORS des navigateurs). */
  fetchCalendar?: (url: string) => Promise<string>;
  /** Relit les données du compte (et envoie les modifications en attente). */
  refresh?: () => Promise<void>;
}
