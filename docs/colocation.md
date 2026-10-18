# Colocation (appartement partagé)

## Ce que ça fait
Onglet **Colocation** (compte requis) :
- **Appartement** : on le crée (nom + prénom visible), on invite avec un **code de 10 caractères**. 8 membres maximum, un seul appartement actif par personne.
  Le propriétaire peut régénérer le code ou retirer un membre ; quitter l'appartement transmet la propriété au plus ancien membre ; le dernier qui part supprime l'appartement.
- **Courses communes** : tout le monde ajoute, coche, supprime. « Valider les achats » crée la dépense partagée et retire les articles cochés (une seule opération côté base).
- **Dépenses partagées** : qui a payé, partagé entre qui (parts égales en centimes, le reste va aux premiers), historique, **« qui doit combien à qui »** (virements minimaux) et « Marquer remboursé ».
- **Ménage partagé** (onglet Ménage de la colocation) : corvées communes (chaque jour, chaque semaine, une semaine sur deux, une fois) avec **rotation entre les colocataires** ; tout le monde voit la semaine, coche, et on voit « fait par X ». Le propriétaire (ou l'auteur) supprime. Un ancien membre est retiré de la rotation.
- Le ménage personnel (onglet Ménage) reste individuel, sur votre planning. L'ancienne liste de « colocataires » (simples noms) n'est plus proposée à l'inscription ni dans les réglages ; si elle existait, un lien « La retirer » permet de l'effacer (les anciennes corvées ne sont pas supprimées).
- Les données sont relues toutes les 15 s, au retour sur l'onglet et après chaque action (pas de temps réel pour l'instant).

## Données et sécurité
- Migration **additive** `supabase/migrations/20261019000001_flats.sql` : nouvelles tables `flats`, `flat_members`, `flat_groceries`, `flat_expenses`, `flat_join_log`. Aucune table existante n'est modifiée ; `user_data` (données personnelles) est intact.
- Aucun droit INSERT/UPDATE/DELETE pour les clients : toute écriture passe par des fonctions `SECURITY DEFINER` (appartenance, cohérence des parts : somme = montant, payeur et participants = membres actifs).
- Lecture réservée aux membres actifs (RLS `is_flat_member`).
- Rejoindre : 15 essais par heure et par utilisateur. **Un code inconnu renvoie `null` sans exception** : une exception annulerait l'écriture du journal et laisserait deviner les codes sans limite (défaut trouvé et corrigé pendant les tests).
- Les identifiants d'utilisateur des dépenses ne sont pas des clés étrangères : supprimer un compte ne supprime pas l'historique des autres.

## ⚠ À faire avant de mettre en ligne
Deux migrations : `20261019000001_flats.sql` (appartement, courses, dépenses) puis `20261020000001_flat_chores.sql` (ménage partagé). Sans la seconde, seul l'onglet Ménage de la colocation affiche « pas encore activé » ; le reste fonctionne (testé).
Une migration **non appliquée** sur votre Supabase fait afficher ce message. Tant qu'elle ne l'est pas, l'onglet affiche « La colocation n'est pas encore activée sur ce serveur ». Pour l'appliquer : `supabase db push` (ou coller le fichier dans l'éditeur SQL du tableau de bord Supabase). Sauvegardez avant (Réglages → export, et sauvegarde de la base).

## Tests
- `node --test --experimental-strip-types tests/flat.test.ts` (inclus dans `npm test`) : partage en centimes, soldes, virements minimaux.
- `createdb flats_test && psql -v ON_ERROR_STOP=1 -d flats_test -f tests/flats.sql` : SQL contre un PostgreSQL ordinaire (schéma `auth` simulé) : droits, RLS, validations, limite d'essais, départ/héritage, plafond de 8 membres. Affiche « TOUT EST OK ».
- `tests/flat-ui/` : parcours à deux utilisateurs dans un navigateur, contre le vrai SQL, via un faux serveur Supabase (`server.mjs`, `npm i --no-save pg`). Base : `flats.sql` jusqu'aux insertions d'utilisateurs, plus les utilisateurs `…0a` et `…0b`. Page de test : `esbuild tests/flat-ui/harness.tsx --bundle --format=esm --jsx=transform --outfile=$WEB_DIR/h.js --define:__SUPABASE_URL__='"http://127.0.0.1:5460"' --define:__SUPABASE_ANON_KEY__='"anon"' --define:__BASE_PATH__='"/"' --define:__SITE_URL__='"http://127.0.0.1:5460/"'`, plus `h.css` (Tailwind) et un `index.html` minimal.
  Ce test ne remplace pas `npm run test:db` (vraie pile Supabase, non lancé ici).

## Limites et suite
- Les corvées communes n'apparaissent pas encore dans le planning personnel ni le tableau de bord ; pas de dépenses à parts inégales ni de scan de ticket vers la dépense commune : prochaines étapes.
- Pas de notifications ni de temps réel.
- Un propriétaire ne peut pas encore renommer l'appartement.
