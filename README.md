# Étudiant.OS

L'espace d'organisation des étudiants : planning automatique, tâches, focus, budget, courses, ménage en colocation et sommeil, avec comptes et synchronisation entre appareils.

- Site : https://fedizzz.github.io/etudiant-os/
- Architecture et sécurité : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Mise en production (Supabase, GitHub Pages) : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)

## Développement

Prérequis : Node ≥ 22.6, Docker, CLI Supabase.

```bash
npm install
supabase start                      # Postgres, Auth, Realtime, Storage, boîte mail de test (http://127.0.0.1:54324)
cp .env.example .env                # puis : SUPABASE_URL=http://127.0.0.1:54321 et SUPABASE_ANON_KEY=<ANON_KEY de `supabase status`>
npm run dev                         # http://127.0.0.1:5173/etudiant-os/
```

Sans `.env`, le site est construit en **mode local** (pas de comptes, données dans le navigateur, comportement historique).

## Tests

| Commande | Contenu | Besoin |
|---|---|---|
| `npm run typecheck` | TypeScript strict | — |
| `npm test` | logique métier (calculs, planning, focus, budget, sommeil, import), moteur de synchronisation (hors ligne, conflits, doublons), routes | — |
| `npm run test:db` | inscription/confirmation réelles, mot de passe oublié, RLS, isolation entre comptes, fichiers, suppression de compte ; rôles admin, tickets, messagerie, notes internes, pièces jointes, journal d'audit, suspension, correction de données | `supabase start` (+ `supabase/seed.sql` : adresses admin de test) |
| `npm run test:e2e` | parcours complets dans un navigateur : landing, comptes, deux appareils, temps réel, hors ligne, conflits, import local, focus, suppression | `supabase start`, build + `node scripts/serve.mjs` |
| `npm run test:e2e:support` | signalement avec capture, aide, Mes demandes, réponse admin, notes internes, notifications, résolution/réouverture, accès /admin refusé, gestion des utilisateurs, mobile | `supabase start`, build + `node scripts/serve.mjs` |

## Structure

```
src/core.ts        logique métier (types, reducer, calculs) — source de vérité, sans React
src/sync.ts        synchronisation compte ↔ appareil (file d'actions, versions, rejeu en cas de conflit, import)
src/router.ts      routes publiques / privées
src/supabase.ts    client Supabase (clé publique), transport, fichiers, compte
src/hosts.tsx      mode local ou compte (statut de synchro, import des données locales, déconnexion)
src/auth.tsx       connexion, inscription, mot de passe oublié / nouveau
src/landing.tsx    page d'accueil, pages légales, 404
src/StudentOS.tsx  interface de l'application (modules)
supabase/          migrations SQL (tables, RLS, fonctions), modèles d'e-mails, config locale
scripts/           build (esbuild + Tailwind), serveur de dev, captures de la landing
tests/             tests de logique, backend et navigateur
```

`index.html` à la racine est l'ancienne version (publiée par GitHub Pages en mode « branche ») : à supprimer une fois le déploiement par GitHub Actions activé (voir docs/DEPLOIEMENT.md).
