/* Étudiant.OS — routes (History API) avec chemin de base (ex. /etudiant-os/ sur GitHub Pages). */
import type { ViewKey } from "./core.ts";

export type Route =
  | { name: "landing" } | { name: "login" } | { name: "signup" } | { name: "forgot" } | { name: "reset" }
  | { name: "privacy" } | { name: "terms" } | { name: "app"; view: ViewKey } | { name: "notfound" }
  | { name: "support"; page: SupportPage; id?: string }
  | { name: "admin"; section: AdminSection; id?: string };
export type SupportPage = "report" | "help" | "requests";
export type AdminSection = "dashboard" | "users" | "tickets" | "audit";
const SUPPORT_SLUGS: Record<SupportPage, string> = { report: "report-problem", help: "help", requests: "requests" };
const ADMIN_SLUGS: Record<AdminSection, string> = { dashboard: "", users: "users", tickets: "tickets", audit: "audit" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Segment d'URL ↔ module de l'application. */
export const VIEW_SLUGS: Record<ViewKey, string> = {
  dashboard: "", planning: "planning", academic: "academique", focus: "focus", groceries: "courses",
  budget: "budget", chores: "menage", flat: "colocation", todos: "perso", routines: "routines", sleep: "sommeil", settings: "settings",
};
const SLUG_VIEW = Object.fromEntries(Object.entries(VIEW_SLUGS).map(([v, s]) => [s, v])) as Record<string, ViewKey>;
export const PUBLIC_PATHS: Record<string, Route["name"]> = {
  "": "landing", login: "login", signup: "signup", "forgot-password": "forgot", "reset-password": "reset", confidentialite: "privacy", conditions: "terms",
};

export function parseRoute(pathname: string, base: string): Route {
  let p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
  p = p.replace(/\/+$/, "").replace(/^\/+/, "");
  if (p === "admin" || p.startsWith("admin/")) {
    const [, sec = "", id] = p.split("/");
    const section = (Object.keys(ADMIN_SLUGS) as AdminSection[]).find((k) => ADMIN_SLUGS[k] === sec);
    if (!section || p.split("/").length > 3) return { name: "notfound" };
    if (id !== undefined && (!UUID.test(id) || (section !== "users" && section !== "tickets"))) return { name: "notfound" };
    return id ? { name: "admin", section, id: id.toLowerCase() } : { name: "admin", section };
  }
  if (p.startsWith("app/")) {
    const [, sl, id] = p.split("/");
    const page = (Object.keys(SUPPORT_SLUGS) as SupportPage[]).find((k) => SUPPORT_SLUGS[k] === sl);
    if (page) {
      if (p.split("/").length > 3 || (id !== undefined && (page !== "requests" || !UUID.test(id)))) return { name: "notfound" };
      return id ? { name: "support", page, id: id.toLowerCase() } : { name: "support", page };
    }
  }
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
  if (r.name === "support") return base + "app/" + SUPPORT_SLUGS[r.page] + (r.id ? "/" + r.id : "");
  if (r.name === "admin") return base + "admin" + (ADMIN_SLUGS[r.section] ? "/" + ADMIN_SLUGS[r.section] : "") + (r.id ? "/" + r.id : "");
  const slug = Object.entries(PUBLIC_PATHS).find(([, n]) => n === r.name)?.[0] ?? "";
  return base + slug;
}
export const isPrivate = (r: Route) => r.name === "app" || r.name === "support" || r.name === "admin";
/** Destination après connexion : seulement un chemin interne à l'application (pas de redirection ouverte). */
export function safeNext(next: string | null, base: string): string {
  if (!next || !(next.startsWith(base + "app") || next === base + "admin" || next.startsWith(base + "admin/")) || next.includes("//") || /[\\]|%2f|%5c/i.test(next)) return base + "app";
  return next;
}
