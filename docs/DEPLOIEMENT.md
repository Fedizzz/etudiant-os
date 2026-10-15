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

## 6. Avant d'ouvrir au public

- [ ] Compléter les mentions entre crochets des pages Confidentialité et Conditions (éditeur, contact, hébergeur, région) et les faire relire.
- [ ] SMTP de production configuré, e-mails de test reçus (inscription, mot de passe oublié, changement d'adresse).
- [ ] Inscription, confirmation, connexion et récupération testées sur le site en ligne, sur ordinateur et téléphone.
- [ ] Vérifier dans Supabase → Advisors (Security / Performance) qu'aucune alerte ne subsiste.
