/* Étudiant.OS — routes (History API) avec chemin de base (ex. /etudiant-os/ sur GitHub Pages). */
import type { ViewKey } from "./core.ts";

export type Route =
  | { name: "landing" } | { name: "login" } | { name: "signup" } | { name: "forgot" } | { name: "reset" }
  | { name: "privacy" } | { name: "terms" } | { name: "app"; view: ViewKey } | { name: "notfound" };

/** Segment d'URL ↔ module de l'application. */
export const VIEW_SLUGS: Record<ViewKey, string> = {
  dashboard: "", planning: "planning", academic: "academique", focus: "focus", groceries: "courses",
  budget: "budget", chores: "menage", sleep: "sommeil", settings: "settings",
};
const SLUG_VIEW = Object.fromEntries(Object.entries(VIEW_SLUGS).map(([v, s]) => [s, v])) as Record<string, ViewKey>;
export const PUBLIC_PATHS: Record<string, Route["name"]> = {
  "": "landing", login: "login", signup: "signup", "forgot-password": "forgot", "reset-password": "reset", confidentialite: "privacy", conditions: "terms",
};

export function parseRoute(pathname: string, base: string): Route {
  let p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
  p = p.replace(/\/+$/, "").replace(/^\/+/, "");
  if (p === "app" || p.startsWith("app/")) {
    const slug = p.slice(4);
    const view = SLUG_VIEW[slug];
    return view ? { name: "app", view } : { name: "notfound" };
  }
  const name = PUBLIC_PATHS[p];
  return name ? ({ name } as Route) : { name: "notfound" };
}
export function routePath(r: Route, base: string): string {
  if (r.name === "app") return base + "app" + (VIEW_SLUGS[r.view] ? "/" + VIEW_SLUGS[r.view] : "");
  const slug = Object.entries(PUBLIC_PATHS).find(([, n]) => n === r.name)?.[0] ?? "";
  return base + slug;
}
export const isPrivate = (r: Route) => r.name === "app";
/** Destination après connexion : seulement un chemin interne à l'application (pas de redirection ouverte). */
export function safeNext(next: string | null, base: string): string {
  if (!next || !next.startsWith(base + "app") || next.includes("//") || /[\\]|%2f|%5c/i.test(next)) return base + "app";
  return next;
}
