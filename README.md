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
- `src/StudentOS.tsx` — code source React/TypeScript.
- `src/shell.html` — styles et squelette de la page.
- `manifest.webmanifest`, `sw.js`, `icon*.png` — installation sur l'écran d'accueil et mode hors ligne.
- `src/build.py` — régénère `index.html` après une modification : `python3 src/build.py`
