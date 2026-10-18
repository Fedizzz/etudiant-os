// Page de test (NON livrée) : monte l'application en mode « compte » contre un faux serveur Supabase (voir docs/colocation.md).
import React, { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import StudentOS, { PencilDefs } from "../../src/StudentOS.tsx";
import { blank, reducer } from "../../src/core.ts";
import type { ViewKey } from "../../src/core.ts";
import { supabase } from "../../src/supabase.ts";
import type { AppEnv } from "../../src/env.ts";

const who = new URLSearchParams(location.search).get("u") ?? "a";
const uid = `00000000-0000-0000-0000-00000000000${who}`;
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const token = `${b64({ alg: "none" })}.${b64({ sub: uid, aud: "authenticated", role: "authenticated", exp: 4102444800 })}.x`;
const env: AppEnv = { mode: "cloud", ns: "t", files: { save: async () => {}, load: async () => undefined, remove: async () => {} },
  account: { id: uid, email: `${who}@t`, displayName: who === "a" ? "Alice" : "Bob", pendingEmail: null, updateName: async () => null, updateEmail: async () => null, updatePassword: async () => null, signOut: async () => {}, deleteAccount: async () => null } };
function H() {
  const [state, dispatch] = useReducer(reducer, { ...blank({ name: "Test" }, 600), settings: { ...blank({ name: "Test" }, 600).settings, onboarded: true } });
  const [view, setView] = useState<ViewKey>("flat");
  return <StudentOS state={state} dispatch={dispatch} env={env} view={view} onView={setView} />;
}
void (async () => {
  // Faux jeton : le client l'ajoute à chaque requête (le faux serveur ne vérifie que « sub »).
  (supabase!.auth as unknown as { getSession: () => Promise<unknown> }).getSession = async () => ({ data: { session: { access_token: token } }, error: null });
  createRoot(document.getElementById("root")!).render(<><PencilDefs /><H /></>);
})();
