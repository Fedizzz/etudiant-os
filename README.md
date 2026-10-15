# Étudiant OS

Planificateur étudiant tout-en-un : planning automatique (time-blocking), cours et notes pondérées, minuteur Pomodoro, liste de courses avec budget, suivi des dépenses, ménage en colocation et sommeil.

**Ouvrir l'application :** https://fedizzz.github.io/etudiant-os/

Les données restent dans le navigateur de chaque appareil (localStorage). Utilisez Réglages → Exporter / Importer pour les transférer.

## Structure
- `index.html` — le site publié par GitHub Pages (page autonome, React + Tailwind chargés depuis un CDN).
- `src/StudentOS.tsx` — code source React/TypeScript.
- `src/shell.html` — styles et squelette de la page.
- `src/build.py` — régénère `index.html` après une modification : `python3 src/build.py`
