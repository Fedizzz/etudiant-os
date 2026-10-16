# Mise en production

Ce qui est prêt dans le dépôt : migrations SQL, modèles d'e-mails, workflows GitHub Actions (CI, déploiement, migrations), build reproductible. **Ce qui suit doit être fait par toi** (je n'ai pas accès à tes comptes Supabase et GitHub).

## 1. Créer le projet Supabase

1. https://supabase.com → New project. Région : de préférence **Union européenne** (ex. Frankfurt / Paris) pour tes utilisateurs français. Note le mot de passe de la base.
2. **Appliquer les migrations** (au choix) :
   - en local : `supabase login`, `supabase link --project-ref <ref>`, `supabase db push` ;
   - ou par GitHub : ajoute les secrets `SUPABASE_ACCESS_TOKEN` (Account → Access Tokens) et `SUPABASE_DB_PASSWORD`, la variable `SUPABASE_PROJECT_REF`, puis Actions → « Migrations Supabase » → Run workflow → `APPLIQUER`.
3. Vérifie dans Table Editor : tables `profiles` et `user_data` avec « RLS enabled », bucket Storage `user-files` privé.

## 2. Authentification (Dashboard → Authentication)

- **URL Configuration** :
  - Site URL : `https://fedizzz.github.io/etudiant-os/`
  - Redirect URLs : `https://fedizzz.github.io/etudiant-os/**` (+ `http://127.0.0.1:5173/**` pour le développement, + l'URL de préproduction si tu en as une).
- **Providers → Email** : activé, « Confirm email » **activé**, « Secure email change » activé.
- **Policies → Password** : longueur minimale 8, « Letters and digits ».
- **Email Templates** : copie le contenu de `supabase/templates/confirmation.html`, `recovery.html`, `email_change.html` dans « Confirm signup », « Reset password », « Change email address », avec les sujets indiqués dans `supabase/config.toml`.
- **SMTP** (Project Settings → Authentication → SMTP) : le serveur d'e-mails par défaut de Supabase est limité à quelques e-mails par heure et réservé aux tests. Pour un vrai lancement, configure un fournisseur (Brevo, Resend, Postmark, Amazon SES…) avec un domaine d'envoi vérifié.
- **Rate limits** : vérifie les limites d'envoi d'e-mails et de connexions après avoir configuré le SMTP.
- **Google (facultatif)** : Providers → Google, avec un client OAuth créé dans Google Cloud (URI de redirection : `https://<ref>.supabase.co/auth/v1/callback`). Puis ajoute la variable GitHub `GOOGLE_AUTH=1`. Tant que ce n'est pas fait, le bouton Google n'apparaît pas.

## 3. Publier le site (GitHub Pages)

1. GitHub → Settings → Pages → Source : **GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables** (ce sont des valeurs publiques) :
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_ANON_KEY` = clé **publique** (Project Settings → API → `anon` ou « Publishable key »). **Jamais** la clé `service_role` / secret : le build la refuse.
   - facultatif : `SITE_URL`, `BASE_PATH` (si domaine personnalisé : `BASE_PATH=/`), `GOOGLE_AUTH`.
3. Actions → « Déploiement » → Run workflow (ou pousse sur `main`). Le site est servi en HTTPS par GitHub.
4. Une fois en ligne, supprime l'ancien `index.html` à la racine du dépôt (il n'est plus utilisé).

Routes et actualisation : `404.html` renvoie toutes les adresses (`/login`, `/app/budget`…) vers l'application. GitHub Pages répond alors avec un code HTTP 404, sans effet pour l'utilisateur mais visible des robots ; pour des codes 200 propres, Netlify ou Cloudflare Pages peuvent publier le même dossier `dist/` (le fichier `_redirects` est déjà généré).

## 4. Préproduction (recommandé)

Crée un second projet Supabase « staging » et publie `dist/` construit avec ses variables sur Netlify / Cloudflare Pages (branche `staging`), ou teste en local avec `supabase start`. Ajoute son URL dans les Redirect URLs du projet staging uniquement.

## 5. Retour à une version précédente

- Site : Actions → « Déploiement » → ouvre une exécution antérieure réussie → « Re-run all jobs » (ou `git revert` du commit fautif puis push).
- Base : les migrations ne sont jamais modifiées une fois appliquées ; pour annuler, écris une nouvelle migration corrective. Active les sauvegardes quotidiennes (plan Pro : Point-in-time recovery) avant l'ouverture au public.

## 6. Administration, signalements et centre d'aide

La migration `20261017000001_support_admin.sql` ajoute : rôles administrateur, tickets, messages, notes internes, notifications, journal d'audit, bucket privé `support-files` (captures PNG / JPEG / WebP, 5 Mo). Elle s'applique comme les autres (`supabase db push` ou le workflow « Migrations Supabase »).

**Activer les deux comptes administrateurs** (`fedizayen12@gmail.com`, `khaled05062006@gmail.com`, inscrits dans la table `admin_allowlist` par la migration) :
1. Chaque personne crée son compte sur le site avec **cette adresse exacte**, puis clique le lien de confirmation reçu par e-mail.
2. À la confirmation, la base accorde automatiquement le rôle (déclencheur sur `auth.users`). Si le compte existait et était déjà confirmé avant la migration, la migration l'a promu directement.
3. Vérification (SQL Editor) : `select u.email, r.granted_at from public.user_roles r join auth.users u on u.id = r.user_id;`
4. Le bouton **Administration** apparaît dans Réglages → Aide & support et dans le menu. L'adresse de l'espace : `/etudiant-os/admin`.

Aucune fonction ni requête depuis le site ne peut accorder ce rôle : `admin_allowlist` et `user_roles` ne sont modifiables que depuis le SQL Editor (rôle `postgres`). Pour ajouter ou retirer un administrateur :
```sql
insert into public.admin_allowlist (email) values ('nouvelle@adresse.fr');   -- ou : delete from public.admin_allowlist where email = '…';
select public.sync_admin_roles();
```
Un administrateur dont l'adresse quitte la liste, change ou n'est plus confirmée perd ses droits immédiatement (`is_admin()` revérifie tout à chaque appel).

**Notifications** : dans l'application (pastille, liste « Mes demandes », temps réel via la table `notifications` + relecture toutes les 45 s). **Aucun e-mail de notification n'est envoyé** : il faudrait un fournisseur d'e-mails et une fonction serveur (Edge Function ou webhook de base de données), non configurés à ce jour.

**Suppression d'un compte par un administrateur** : en deux étapes (lancement = suspension immédiate ; puis suppression définitive avec saisie de l'adresse). Les fichiers sont supprimés par l'API Storage, puis le compte ; le journal d'audit conserve la trace.

## 7. Calendriers synchronisés (Celcat, iPhone, Google)

La migration `20261018000001_calendar_feeds.sql` active l'extension `http` de Postgres et ajoute `fetch_calendar(url)` : la base télécharge le flux .ics pour l'utilisateur connecté (les navigateurs bloquent la lecture directe de ces liens). Garde-fous : https uniquement, pas d'adresse interne/privée, 12 s max, 4 Mo max, contenu iCalendar obligatoire, 40 appels/heure/compte.
- Rien d'autre à configurer : appliquez la migration comme les autres. Si l'extension `http` est refusée, activez-la dans Database → Extensions → `http` (schéma `extensions`).
- Limite connue : une adresse publique qui redirige vers une adresse interne n'est pas filtrée par nom ; seul un contenu iCalendar est renvoyé au client.
- L'actualisation automatique (toutes les 3 h) se fait quand l'application est ouverte ; il n'y a pas de tâche planifiée côté serveur.

## 8. Avant d'ouvrir au public

- [ ] Compléter les mentions entre crochets des pages Confidentialité et Conditions (éditeur, contact, hébergeur, région) et les faire relire.
- [ ] SMTP de production configuré, e-mails de test reçus (inscription, mot de passe oublié, changement d'adresse).
- [ ] Inscription, confirmation, connexion et récupération testées sur le site en ligne, sur ordinateur et téléphone.
- [ ] Vérifier dans Supabase → Advisors (Security / Performance) qu'aucune alerte ne subsiste.
- [ ] Les deux comptes administrateurs créés, confirmés, et le rôle vérifié (section 6).
