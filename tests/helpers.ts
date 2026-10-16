// Outils de test contre une stack Supabase LOCALE (supabase start). Jamais contre la production.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// Clé publique de la stack locale (valeur par défaut de la CLI, non secrète).
export const ANON = process.env.SUPABASE_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export const client = (): SupabaseClient => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;

/** Dernier lien reçu par `email` dans Mailpit (confirmation, récupération…). */
export async function lastLink(email: string, tries = 30): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const j = await r.json() as { messages: { ID: string }[] };
    if (j.messages?.length) {
      const m = await (await fetch(`${MAILPIT}/api/v1/message/${j.messages[0].ID}`)).json() as { Text: string; HTML: string };
      const link = (m.Text + " " + m.HTML).match(/https?:\/\/[^\s"<>]+verify[^\s"<>]+/)?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Aucun e-mail reçu pour " + email);
}
/** Suit le lien de vérification et renvoie l'URL de redirection finale (avec les jetons). */
export async function follow(link: string): Promise<string> {
  const r = await fetch(link, { redirect: "manual" });
  return r.headers.get("location") ?? "";
}
/** Crée un compte confirmé par le vrai parcours : inscription → e-mail → lien → connexion. */
export async function confirmedUser(tag: string, password = "motdepasse123") {
  const email = uniqueEmail(tag);
  const c = client();
  const { error } = await c.auth.signUp({ email, password, options: { data: { display_name: tag } } });
  if (error) throw error;
  await follow(await lastLink(email));
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { c, email, password, id: s.data.user!.id };
}

/** Compte administrateur de TEST (adresse autorisée par supabase/seed.sql, stack locale uniquement). Réutilisé d'un lancement à l'autre. */
export async function adminUser(n: 1 | 2, password = "adminpass123") {
  const email = `admin-test-${n}@test.local`;
  const c = client();
  let s = await c.auth.signInWithPassword({ email, password });
  if (s.error) {
    const { error } = await c.auth.signUp({ email, password, options: { data: { display_name: `Admin ${n}` } } });
    if (error) throw error;
    await follow(await lastLink(email));
    s = await c.auth.signInWithPassword({ email, password });
    if (s.error) throw s.error;
  }
  return { c, email, password, id: s.data.user!.id };
}
