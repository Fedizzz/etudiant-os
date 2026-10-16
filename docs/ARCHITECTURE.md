# Architecture d'Étudiant.OS

## Vue d'ensemble

```
Navigateur (site statique, GitHub Pages)
 ├─ landing / pages légales / auth          (public)
 └─ /app/*  → vérification de session → CloudHost
        ├─ StudentOS.tsx (interface, inchangée)  ← state + dispatch
        ├─ core.ts (reducer, calculs)            ← même logique qu'avant
        └─ sync.ts (SyncEngine)
              ├─ cache local par compte (hors ligne, actions en attente)
              └─ Supabase : Auth · Postgres (RLS) · Realtime · Storage
```

Le site reste **statique** : aucun serveur applicatif à héberger. Les opérations sensibles sont protégées dans la base (RLS, fonctions `SECURITY DEFINER` limitées à `auth.uid()`), sans clé privilégiée dans le navigateur.

## Modèle de données

L'application était déjà construite autour d'un **état unique** (`AppState`) modifié par un **reducer** (`core.ts`). Plutôt que d'éclater cet état en une table par module (ce qui aurait dupliqué la logique en SQL et rendu la synchronisation fragile), chaque utilisateur possède :

| Table | Contenu | Accès client |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `display_name`, dates | lecture / modification de sa ligne |
| `user_data` | `state` (JSONB : tâches, modules, emploi du temps, focus, budget, courses, ménage, sommeil, réglages), `version`, `updated_at`, `updated_by` | lecture / suppression de sa ligne ; **écriture uniquement via `save_state()`** |
| `storage.objects` (bucket `user-files`, privé) | PDF d'emploi du temps, dossier = identifiant utilisateur | ses propres fichiers ; PDF ≤ 10 Mo |

Fonctions :
- `save_state(state, base_version, client)` : écriture avec verrouillage optimiste ; refuse si la version a changé et renvoie l'état serveur.
- `delete_my_account()` : supprime le compte appelant (profil et données par cascade) ; refuse s'il reste des fichiers (le client les supprime avant via l'API Storage).
- Déclencheur `on_auth_user_created` : crée le profil à l'inscription.

Contraintes : clés étrangères `on delete cascade` vers `auth.users`, contrôle de forme du document (`state_is_app_state`), taille < 5 Mo, nom ≤ 80 caractères. La validation détaillée (et la réparation des éléments invalides) est faite par `validateState()` dans `core.ts`.

## Sécurité

- RLS activée sur `profiles` et `user_data`, politiques SELECT / UPDATE / DELETE limitées à `auth.uid()`.
- Privilèges SQL réduits : `anon` n'a aucun droit ; `authenticated` n'a ni INSERT ni UPDATE sur `user_data` (seulement `save_state`).
- Fonctions sensibles : `SECURITY DEFINER`, `search_path` vide, `EXECUTE` retiré à `public`/`anon`.
- Seule la clé publique Supabase est intégrée au site ; le build refuse une clé secrète.
- Le service worker ne met **jamais** en cache les réponses de l'API (données personnelles).
- Redirection après connexion limitée aux pages `/app` (pas de redirection ouverte) ; les URL de redirection des e-mails sont filtrées par la liste blanche Supabase (testé).
- Messages d'erreur traduits et sans détail technique ; réponses identiques que l'adresse existe ou non (mot de passe oublié, inscription).
- Tests : `tests/db.test.ts` tente de lire, insérer, modifier et supprimer les données et fichiers d'un autre compte, et d'agir sans être connecté.

## Synchronisation

1. Chaque modification est une **action** du reducer : appliquée immédiatement à l'interface, ajoutée à une file d'attente persistée dans le cache local du compte.
2. Après 0,6 s, l'état est envoyé avec la version de base (`save_state`).
3. Succès → version +1, file vidée, statut **Enregistré** (seulement à ce moment).
4. Conflit (un autre appareil a écrit) → on repart de l'état serveur et on **rejoue** les actions en attente : les deux appareils gardent leurs modifications ; pour un même champ modifié des deux côtés, la dernière action rejouée l'emporte. Les sessions de focus ont un identifiant : jamais comptées deux fois.
5. Hors ligne / erreur réseau → statut **Hors ligne**, nouvel essai avec délai croissant, envoi au retour de la connexion (événement `online`).
6. Les autres appareils sont prévenus par **Realtime** ; en secours : relecture au retour sur l'onglet, au retour en ligne et toutes les 60 s.

Statuts affichés : Chargement, Enregistrement…, Enregistré, Modifications en attente, Hors ligne, Erreur de synchronisation.

**Limites** : le document entier est envoyé à chaque enregistrement (adapté à des volumes étudiants, < 5 Mo) ; « annuler » une suppression restaure l'état local précédent, ce qui peut écraser une modification faite au même instant sur un autre appareil.

## Données locales existantes

Les données utilisées sans compte (clé `etudiant-os/v1`) ne sont jamais envoyées automatiquement. Après connexion, si elles existent et contiennent des éléments absents du compte, une fenêtre propose l'import avec un aperçu (nombre de tâches, dépenses, nuits…). Import = fusion sans doublon (identifiants), copie de sécurité préalable, données locales conservées. Le choix est mémorisé par compte.

## Déconnexion et appareils partagés

À la déconnexion : cache du compte, file d'attente, session et copies de sécurité du compte sont effacés de l'appareil. Si des modifications ne sont pas encore envoyées, une confirmation explicite est demandée.

## Routes

`/` accueil · `/login` · `/signup` · `/forgot-password` · `/reset-password` · `/confidentialite` · `/conditions` · `/app` (tableau de bord) · `/app/planning` · `/app/academique` · `/app/focus` · `/app/courses` · `/app/budget` · `/app/menage` · `/app/sommeil` · `/app/settings` · `/app/report-problem` · `/app/help` · `/app/requests[/<id>]` · `/admin` · `/admin/users[/<id>]` · `/admin/tickets[/<id>]` · `/admin/audit` · toute autre adresse → page 404.
Sur GitHub Pages, `404.html` (copie de `index.html`) permet l'actualisation de n'importe quelle route ; `_redirects` fait de même sur Netlify / Cloudflare Pages.

## Administration et support

Fichiers : `src/supportModel.ts` (libellés, validation, infos techniques — testé), `src/supportApi.ts` (appels), `src/support.tsx` (pages utilisateur, conversation), `src/admin.tsx` (espace admin). Migration : `supabase/migrations/20261017000001_support_admin.sql`.

| Table | Contenu | Lecture | Écriture |
|---|---|---|---|
| `admin_allowlist` | adresses autorisées à administrer | personne (API) | SQL Editor uniquement |
| `user_roles` | rôle `admin` accordé | sa ligne ; admins | déclencheur sur `auth.users` uniquement |
| `profiles` (+ `status`, `status_reason`, `deletion_requested_at`) | statut du compte | sa ligne | client : `display_name` seulement ; statut : fonctions admin |
| `tickets` | signalements (`bug`) et demandes d'aide (`help`) | les siens ; admins | `create_ticket`, `post_message`, `set_my_ticket_state`, `admin_update_ticket` |
| `ticket_messages` | conversation (rôle `user` / `admin` / `system` fixé par la base) | messages de ses tickets ; admins | `post_message` |
| `ticket_notes` | notes internes | admins | `admin_add_ticket_note` |
| `user_notes` | notes de support sur un compte | admins | `admin_add_user_note` |
| `notifications` | réponse, précision demandée, résolu, rouvert, nouveau ticket… | les siennes (Realtime filtré par RLS) | fonctions ci-dessus ; lu : `mark_ticket_read` |
| `admin_audit` | journal (acteur, action, cible, résumé, justification) | admins | fonctions uniquement ; UPDATE / DELETE / TRUNCATE bloqués par déclencheur |
| bucket `support-files` | captures PNG/JPEG/WebP ≤ 5 Mo, dossier = auteur | ses fichiers, pièces jointes de ses tickets, admins | son dossier |

**Rôle administrateur** : `is_admin()` exige à chaque appel un rôle présent, une adresse toujours dans `admin_allowlist`, **confirmée** (`email_confirmed_at`) et un compte non suspendu. Une adresse en cours de changement (non confirmée), des métadonnées modifiées par le client ou une requête directe ne suffisent pas (testé). Aucune fonction n'accorde de rôle ; un admin ne peut ni suspendre ni supprimer un autre admin ou lui-même.

**Données personnelles** : la fiche utilisateur affiche compte, statut, préférences d'affichage et **totaux** (nombre de tâches, dépenses…), jamais le contenu. La correction ciblée (`admin_read_user_data` / `admin_fix_user_data`) exige une justification, vise un chemin précis (`tasks / id:abc / title`), vérifie que la valeur n'a pas changé depuis la lecture et que le type est conservé, journalise ancienne et nouvelle valeur, et peut être annulée (`admin_revert_data_fix`) si la valeur n'a pas bougé depuis. L'appareil de l'utilisateur reçoit la nouvelle version par la synchronisation habituelle.

**Suspension** : `profiles.status = suspended` (écritures, lecture des données et création de tickets refusées immédiatement) + `auth.users.banned_until` (connexion et renouvellement de session refusés) + suppression des sessions. **Suppression** : lancement (suspension + marquage, journalisé) → suppression des fichiers par l'API Storage (politique admin limitée aux comptes marqués) → `admin_delete_user` (confirmation par l'adresse).

**Notifications** : Realtime sur `notifications` (RLS : chacun ne reçoit que les siennes) + relecture toutes les 45 s et au retour sur l'onglet. Pas d'e-mail (aucun fournisseur configuré).
