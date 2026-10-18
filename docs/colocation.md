# Colocation (appartement partagé)

## Ce que ça fait
**Onglet Colocation** (compte requis) : créer un appartement ou en rejoindre un, voir les **membres** et le **code d'invitation** (10 caractères, copier / régénérer pour le propriétaire), retirer un membre (propriétaire), quitter. Rien d'autre.
8 membres maximum, un seul appartement actif par personne ; quitter transmet la propriété au plus ancien membre ; le dernier qui part supprime l'appartement.

**Dans un appartement seulement**, les onglets existants gagnent un choix **Perso | nom de l'appartement** (mémorisé par onglet) :
- **Courses** : liste commune (tout le monde ajoute, coche, supprime). « Valider les achats » crée la dépense partagée et retire les articles cochés (une seule opération côté base).
- **Budget** : dépenses partagées (qui a payé, partagé entre qui, parts égales en centimes, le reste va aux premiers), historique, **« qui doit combien à qui »** (virements minimaux), « Marquer remboursé ».
- **Ménage** : **le même écran que le ménage personnel** (composant partagé) : suggestions de corvées par thème, matrice de la semaine, récurrence (chaque jour / semaine / une semaine sur deux / une fois), heure fixe ou durée, **checklist d'étapes** (la corvée est marquée faite quand toutes les étapes le sont), « reporter » un jour, déplacer une corvée vers un autre jour (glisser), compteur « à l'heure ? », historique sur 4 semaines, répartition du temps par personne. Différence : la **rotation** se choisit parmi les membres (puces). Tout le monde voit et coche ; on voit « fait par X ». Un ancien membre est retiré de la rotation. Cocher une case enregistre l'auteur et le jour réel (coché après son jour = en retard, comme au perso).
- **Planning et tableau de bord** : vos tours de corvée commune apparaissent dans votre journée et dans « Ménage du jour » (cochables ; la base est mise à jour, tout le monde le voit). Les corvées des autres s'affichent sur le tableau de bord avec leur nom, sans bloc dans votre planning. Fusionnées à l'affichage seulement : jamais enregistrées dans vos données personnelles, jamais exportées, jamais comptées dans vos points ni vos statistiques. Les modifier (reporter, étapes, suppression) se fait dans Ménage → Colocation.

**Sans appartement (ou sans compte)** : Courses, Budget et Ménage sont exactement la version personnelle, sans sélecteur.

L'ancienne liste de « colocataires » (simples noms) n'est plus proposée à l'inscription ni dans les réglages ; si elle existait, un lien « La retirer » permet de l'effacer (les anciennes corvées ne sont pas supprimées).
Les données sont relues toutes les 20 s, au retour sur l'onglet et après chaque action (pas de temps réel pour l'instant).

## Données et sécurité
- Migration **additive** `supabase/migrations/20261019000001_flats.sql` : nouvelles tables `flats`, `flat_members`, `flat_groceries`, `flat_expenses`, `flat_join_log`. Aucune table existante n'est modifiée ; `user_data` (données personnelles) est intact.
- Aucun droit INSERT/UPDATE/DELETE pour les clients : toute écriture passe par des fonctions `SECURITY DEFINER` (appartenance, cohérence des parts : somme = montant, payeur et participants = membres actifs).
- Lecture réservée aux membres actifs (RLS `is_flat_member`).
- Rejoindre : 15 essais par heure et par utilisateur. **Un code inconnu renvoie `null` sans exception** : une exception annulerait l'écriture du journal et laisserait deviner les codes sans limite (défaut trouvé et corrigé pendant les tests).
- Les identifiants d'utilisateur des dépenses ne sont pas des clés étrangères : supprimer un compte ne supprime pas l'historique des autres.

## ⚠ À faire avant de mettre en ligne
Trois migrations, dans l'ordre : `20261019000001_flats.sql` (appartement, courses, dépenses), `20261020000001_flat_chores.sql` (ménage partagé) puis `20261021000001_flat_chores_full.sql` (heure fixe, checklist, report, étapes cochées). Sans les deux dernières, seul le Ménage en mode appartement affiche « pas encore activé » ; le reste fonctionne (testé).
Une migration **non appliquée** sur votre Supabase fait afficher ce message. Tant qu'elle ne l'est pas, l'onglet affiche « La colocation n'est pas encore activée sur ce serveur ». Pour l'appliquer : `supabase db push` (ou coller le fichier dans l'éditeur SQL du tableau de bord Supabase). Sauvegardez avant (Réglages → export, et sauvegarde de la base).

## Tests
- `node --test --experimental-strip-types tests/flat.test.ts` (inclus dans `npm test`) : partage en centimes, soldes, virements minimaux.
- `createdb flats_test && psql -v ON_ERROR_STOP=1 -d flats_test -f tests/flats.sql` : SQL contre un PostgreSQL ordinaire (schéma `auth` simulé) : droits, RLS, validations, limite d'essais, départ/héritage, plafond de 8 membres. Affiche « TOUT EST OK ».
- `tests/flat-ui/` : parcours à deux utilisateurs dans un navigateur, contre le vrai SQL, via un faux serveur Supabase (`server.mjs`, `npm i --no-save pg`). Base : `flats.sql` jusqu'aux insertions d'utilisateurs, plus les utilisateurs `…0a` et `…0b`. Page de test : `esbuild tests/flat-ui/harness.tsx --bundle --format=esm --jsx=transform --outfile=$WEB_DIR/h.js --define:__SUPABASE_URL__='"http://127.0.0.1:5460"' --define:__SUPABASE_ANON_KEY__='"anon"' --define:__BASE_PATH__='"/"' --define:__SITE_URL__='"http://127.0.0.1:5460/"'`, plus `h.css` (Tailwind) et un `index.html` minimal.
  Ce test ne remplace pas `npm run test:db` (vraie pile Supabase, non lancé ici).

## Limites et suite
- Pas de dépenses à parts inégales ni de scan de ticket vers la dépense commune : prochaines étapes.
- Pas de notifications ni de temps réel.
- L'heure d'une corvée sans heure fixe (placement automatique dans le planning) n'est pas figée pour les corvées communes.
- Un propriétaire ne peut pas encore renommer l'appartement.
