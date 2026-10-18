# Lecture des tickets de caisse (scanner)

## Fonctionnement
1. Photo (`<input type=file capture>`) → `src/ocr.ts` `scanReceipt()`.
2. **Préparation** (`src/imageprep.ts`, dans le navigateur) : orientation EXIF (`createImageBitmap(..., "from-image")`), grand côté ramené vers 2000 px
   (seulement s'il sort de 1400-2400 px), niveaux de gris, **suppression de l'éclairage inégal** (division par le fond flouté) et étirement du contraste.
   Pas de binarisation. Si une étape échoue, l'image d'origine est utilisée. HEIC illisible → message explicite.
3. **OCR** : tesseract.js 5.1.0, langue `fra` (modèle `tessdata_best` entier), `tessedit_pageseg_mode=6` (un bloc de texte), `preserve_interword_spaces=1`.
   Un seul worker, réutilisé, libéré après 2 min d'inactivité ; une seule lecture à la fois ; annulable.
4. **Analyse** (`src/receipt.ts`, fonctions pures, testées) : `parseReceipt` (total, date, magasin avec statuts), `parseReceiptItems` (articles).
5. **Relecture obligatoire** (`ReceiptReview`) : tout est modifiable ; rien n'est enregistré avant « Utiliser ces données ».
   - Courses : les articles confirmés sont rapprochés prudemment de la liste (`applyReceiptToGroceries`), cochés, le montant payé est pré-rempli ; la dépense n'est créée que par « Valider les achats ».
   - Budget : le formulaire « Nouvelle dépense » est pré-rempli (montant, date, magasin si sûr), articles et empreinte du ticket joints à la dépense.
   - Ticket déjà enregistré (même date et même total) : signalé, ajout explicite requis.

## Hors ligne / hébergement
Le moteur (`public/ocr/tesseract.min.js`, `worker.min.js`), le cœur WASM (`public/ocr/core/*`) et le modèle français (`public/ocr/lang/fra.traineddata.gz`, 707 Ko) sont **copiés tels quels** depuis les paquets npm
`tesseract.js@5.1.0`, `tesseract.js-core@5.1.1`, `@tesseract.js-data/fra@1.0.0` (`4.0.0_best_int`), licence Apache-2.0 (voir `public/ocr/README.txt`). Environ 8,4 Mo, non téléchargés au chargement de l'application : uniquement à la première lecture.
Si ces fichiers sont absents ou illisibles, repli automatique sur le CDN public (jsdelivr / projectnaptha). Le service worker (`public/sw.js`, inchangé) met en cache les fichiers du site après leur première récupération ; tesseract.js garde en plus le modèle de langue dans IndexedDB.
Le service worker ne s'enregistre qu'en HTTPS (`src/main.tsx`) : le test hors ligne (`tests/e2e-receipt.mjs`) exige donc `APP_HTTPS_URL`.

Pour mettre à jour les fichiers : `npm i --no-save tesseract.js@<v> @tesseract.js-data/fra` dans un dossier temporaire, recopier `dist/tesseract.min.js`, `dist/worker.min.js`, `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` et `fra.traineddata.gz`.

## Confidentialité
Le ticket reste dans le navigateur (aucun envoi à un service externe, aucune clé côté client) ; le texte brut n'est jamais écrit dans la console ni dans le stockage. Seuls le total, la date, le magasin, les noms d'articles et une empreinte `date|centimes` sont enregistrés, et seulement après confirmation.
Aucune table ni migration Supabase : l'état est un document JSON ; `Expense.ticket` est un champ optionnel.

## Mesures (images SYNTHÉTIQUES, pas de vraies photos)
20 tickets générés (5 modèles × propre / petit / pâle et ombré / incliné), `/tmp`-bench non versionné. Part des montants lus exactement par Tesseract :

| Réglage | montants lus | total présent |
|---|---|---|
| PSM 3, image brute | 60 % | 9/20 |
| PSM 6, image brute | 69 % | 13/20 |
| PSM 6, éclairage aplati + contraste (retenu) | 91 % | 15/20 |
| PSM 6, binarisé | 86 % | 15/20 |

Total du ticket exact après analyse (ancien analyseur → nouveau) : PSM 6 brut 6/20 → 15/20 ; PSM 6 préparé 10/20 → 19/20 (1 faux : un 5 lu 9 par l'OCR, signalé par l'écart somme/total dans la relecture).

## Limites connues
- Aucun test sur de vraies photos (flou de mouvement, papier thermique froissé, reflets, ticket plié) ni sur un vrai iPhone/Android.
- Photos très grandes (> ~40 Mpx) : le décodage complet peut saturer la mémoire d'un téléphone modeste.
- Un chiffre mal lu (5/9, 1/7) reste invisible si la somme des lignes est elle aussi mal lue ; la relecture est faite pour cela.
- Ordre des colonnes / tickets sur deux colonnes, tickets non français, ou prix en première colonne : analyse prudente, souvent « absent ».
- Alternatives si la précision ne suffit pas : modèle `tessdata_fast`/entraînement dédié (gain modéré), détection de lignes via `data.words` positions, ou un OCR serveur / API de vision — non retenu ici car le ticket quitterait l'appareil.
