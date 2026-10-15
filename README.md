# Étudiant OS

Planificateur étudiant tout-en-un : planning automatique (time-blocking), cours et notes pondérées, minuteur Pomodoro, liste de courses avec budget, suivi des dépenses, ménage en colocation et sommeil.

**Ouvrir l'application :** https://fedizzz.github.io/etudiant-os/

Les données restent dans le navigateur de chaque appareil (localStorage). Utilisez Réglages → Exporter / Importer pour les transférer.

## Installer sur le téléphone
- **iPhone / iPad** : ouvrez le lien dans Safari → Partager → *Sur l'écran d'accueil*.
- **Android** : Chrome → menu ⋮ → *Installer l'application*.

L'application fonctionne ensuite hors ligne.

## Structure
- `index.html` — le site publié par GitHub Pages (page autonome, React + Tailwind chargés depuis un CDN).
- `src/core.ts` — logique métier sans interface : types, reducer, stockage, planification, moyennes, focus, budget, sommeil, ménage. Seule source de vérité des calculs, partagée par tous les modules.
- `src/StudentOS.tsx` — interface React/TypeScript.
- `src/shell.html` — styles et squelette de la page.
- `manifest.webmanifest`, `sw.js`, `icon*.png` — installation sur l'écran d'accueil et mode hors ligne.
- `src/build.py` — assemble `core.ts` + `StudentOS.tsx` et régénère `index.html` : `python3 src/build.py`
- `tests/core.test.ts` — tests automatisés des calculs (Node ≥ 22.6, aucune dépendance) : `node --test --experimental-strip-types tests/*.test.ts`

## Données locales
- Tout est enregistré dans le navigateur (`localStorage`, clé `etudiant-os/v1`) ; le PDF d'emploi du temps dans IndexedDB.
- Au chargement, les données sont validées et réparées (les éléments invalides sont écartés et signalés). Une sauvegarde illisible n'est jamais écrasée : elle est copiée dans `etudiant-os/v1:corrupt` et récupérable depuis Réglages.
- Avant un import ou un effacement, une copie de sécurité est créée (`etudiant-os/v1:backup`), restaurable depuis Réglages.
- Les suppressions proposent « Annuler » pendant quelques secondes.
- Aucune synchronisation entre appareils ni entre colocataires dans cette version.

## Règles de calcul
- **Moyennes** : retirées de l'interface (les notes déjà saisies restent dans les sauvegardes).
- **Ménage du jour** (tableau de bord) : corvées prévues aujourd'hui selon la rotation, avec qui les fait ; cocher ou reporter met à jour la page Ménage.
- **Planning** : reste à faire ÷ jours avant l'échéance (veille visée), ajusté par la priorité ; simulation sur plusieurs jours sans double comptage ; une tâche en retard est répartie sur 3 jours ; cours et indisponibilités ne sont jamais déplacés, les chevauchements sont signalés.
- **Focus** : une session terminée ou interrompue (≥ 1 min) est enregistrée une seule fois (identifiant de session) et ajoute ses minutes à la tâche liée.
- **Budget** : projection = récurrentes du mois + dépenses variables extrapolées ; les récurrentes ne sont ajoutées qu'une fois par mois.
- **Sommeil** : statistiques sur les nuits saisies uniquement ; passage de minuit géré ; les cycles de 90 min sont une estimation, pas un avis médical.
