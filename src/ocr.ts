/* Étudiant.OS — lecture d'un ticket par OCR dans le navigateur (tesseract.js 5.1.0, aucun envoi du ticket à un serveur).
 * Le moteur, le cœur WASM et le modèle français sont hébergés avec l'application (public/ocr/) : une fois chargés,
 * la lecture fonctionne hors ligne. Si les fichiers locaux manquent (ex. version de développement), repli sur le CDN public.
 * Un seul « worker » est créé puis réutilisé ; il est libéré après 2 min d'inactivité. Une seule lecture à la fois. */
import { BASE } from "./supabase.ts";
import { flattenGray, targetScale, toGray } from "./imageprep.ts";

export type OcrErrorKind = "busy" | "cancelled" | "heic" | "image" | "engine" | "lang" | "recognize";
/** Erreur de lecture avec une étape identifiée (jamais de texte du ticket dans `detail`). */
export class OcrError extends Error {
  kind: OcrErrorKind; detail: string; offline: boolean;
  constructor(kind: OcrErrorKind, message: string, detail = "") { super(message); this.kind = kind; this.detail = detail; this.offline = typeof navigator !== "undefined" && navigator.onLine === false; }
}
export interface OcrProgress { phase: "prepare" | "engine" | "lang" | "read"; pct: number }
export interface OcrOutput {
  text: string;
  /** Moyenne de confiance des mots donnée par Tesseract (0-100). Indicateur brut, pas une probabilité de justesse. */
  meanConfidence: number | null;
  /** Description non sensible du traitement (pour l'écran de diagnostic). */
  info: { width: number; height: number; preprocessed: boolean; engine: "local" | "cdn" };
}

interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: Blob | File): Promise<{ data: { text: string; confidence?: number } }>;
  terminate(): Promise<unknown>;
}
interface TessLib { createWorker(lang: string, oem: number, opts: Record<string, unknown>): Promise<TessWorker> }
type Logger = (m: { status: string; progress: number }) => void;

const CDN_JS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
const abs = (p: string) => new URL(`${BASE}${p}`, location.href).href;
const errText = (e: unknown) => String((e as { message?: string } | null)?.message ?? e ?? "").slice(0, 200);

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src)) scripts.set(src, new Promise((ok, ko) => {
    const el = document.createElement("script"); el.src = src; el.async = true;
    el.onload = () => ok(); el.onerror = () => { scripts.delete(src); el.remove(); ko(new Error("script")); };
    document.head.appendChild(el);
  }));
  return scripts.get(src)!;
}
const lib = () => (window as unknown as { Tesseract?: TessLib }).Tesseract;

// ---------------------------------------------------------------- Worker réutilisé
let worker: Promise<{ w: TessWorker; engine: "local" | "cdn" }> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let running = false;
let logger: Logger = () => {};
let lastStatus = "";

async function create(local: boolean): Promise<TessWorker> {
  lastStatus = "";
  if (!lib()) await loadScript(local ? abs("ocr/tesseract.min.js") : CDN_JS);
  const T = lib(); if (!T) throw new Error("Tesseract absent");
  const opts: Record<string, unknown> = { logger: (m: { status: string; progress: number }) => { lastStatus = m.status; logger(m); }, gzip: true };
  if (local) Object.assign(opts, { workerPath: abs("ocr/worker.min.js"), corePath: abs("ocr/core"), langPath: abs("ocr/lang") });
  const w = await T.createWorker("fra", 1, opts);
  // 6 = un seul bloc de texte uniforme : le plus fiable pour un ticket (benchmarks du dépôt) ; espaces conservés pour garder les colonnes.
  await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  return w;
}
async function getWorker() {
  if (!worker) {
    worker = (async () => {
      try { return { w: await create(true), engine: "local" as const }; }
      catch (e1) {
        // fichiers locaux absents ou illisibles : repli sur le CDN (le script local éventuellement déjà chargé est réutilisé)
        try { return { w: await create(false), engine: "cdn" as const }; }
        catch (e2) {
          const stage = /lang|traineddata/i.test(lastStatus) ? "lang" : "engine";
          throw new OcrError(stage, stage === "lang" ? "Le modèle de langue française n'a pas pu être chargé." : "Le moteur de lecture n'a pas pu être chargé.", `${errText(e1)} | ${errText(e2)}`);
        }
      }
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}
/** Libère le worker (mémoire) ; il sera recréé à la prochaine lecture. */
export async function releaseOcr() {
  clearTimeout(idle);
  const p = worker; worker = null;
  try { const { w } = (await p) ?? {}; await w?.terminate(); } catch { /* déjà libéré */ }
}
const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => { if (!running) void releaseOcr(); }, 120_000); };

// ---------------------------------------------------------------- Préparation de l'image
const isHeic = async (f: File) => {
  if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) return true;
  try { const b = new Uint8Array(await f.slice(0, 16).arrayBuffer()); return String.fromCharCode(...b.slice(4, 12)).match(/^ftyp(heic|heix|hevc|mif1|msf1)/) !== null; } catch { return false; }
};
async function decode(f: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(f, { imageOrientation: "from-image" }); } catch { /* repli ci-dessous */ }
  }
  const url = URL.createObjectURL(f);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
}
/** Redimensionne (grand côté ≈ 2000 px), applique l'orientation EXIF, niveaux de gris, aplatissement de l'éclairage.
 *  Si une étape de traitement échoue, renvoie le fichier d'origine (jamais bloquant). */
export async function prepareImage(file: File): Promise<{ image: Blob; width: number; height: number; preprocessed: boolean }> {
  let src: ImageBitmap | HTMLImageElement;
  try { src = await decode(file); }
  catch (e) {
    if (await isHeic(file)) throw new OcrError("heic", "Ce format de photo (HEIC) n'est pas lisible par ce navigateur. Réglez l'appareil photo sur « Le plus compatible » (JPEG) ou exportez la photo en JPEG.", errText(e));
    throw new OcrError("image", "Cette image n'a pas pu être ouverte. Essayez une photo JPEG ou PNG.", errText(e));
  }
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width, sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  try {
    const k = targetScale(sw, sh), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h);
    const flat = flattenGray(toGray(px.data, w, h), w, h);
    for (let i = 0, j = 0; i < flat.length; i++, j += 4) { px.data[j] = px.data[j + 1] = px.data[j + 2] = flat[i]; px.data[j + 3] = 255; }
    ctx.putImageData(px, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    c.width = c.height = 0; // libère la mémoire du canvas
    if (!blob) throw new Error("blob");
    return { image: blob, width: w, height: h, preprocessed: true };
  } catch {
    return { image: file, width: sw, height: sh, preprocessed: false };
  } finally { if ("close" in src) src.close(); }
}

// ---------------------------------------------------------------- Lecture
export interface ScanOptions { onProgress?: (p: OcrProgress) => void; signal?: AbortSignal }
/** Lit une photo de ticket. Une seule lecture à la fois ; erreurs typées (OcrError) ; annulable. */
export async function scanReceipt(file: File, { onProgress, signal }: ScanOptions = {}): Promise<OcrOutput> {
  if (running) throw new OcrError("busy", "Une lecture est déjà en cours.");
  running = true; clearTimeout(idle);
  const abort = () => { void releaseOcr(); };
  signal?.addEventListener("abort", abort);
  const gone = () => signal?.aborted ? new OcrError("cancelled", "Lecture annulée.") : null;
  try {
    onProgress?.({ phase: "prepare", pct: 0 });
    const prep = await prepareImage(file);
    if (gone()) throw gone()!;
    logger = (m) => {
      if (/recognizing/i.test(m.status)) onProgress?.({ phase: "read", pct: Math.round(m.progress * 100) });
      else if (/language|traineddata/i.test(m.status)) onProgress?.({ phase: "lang", pct: Math.round(m.progress * 100) });
      else onProgress?.({ phase: "engine", pct: Math.round(m.progress * 100) });
    };
    const { w, engine } = await getWorker();
    if (gone()) throw gone()!;
    try {
      const { data } = await w.recognize(prep.image);
      if (gone()) throw gone()!;
      return { text: data.text ?? "", meanConfidence: typeof data.confidence === "number" ? data.confidence : null, info: { width: prep.width, height: prep.height, preprocessed: prep.preprocessed, engine } };
    } catch (e) {
      if (e instanceof OcrError) throw e;
      void releaseOcr(); // worker possiblement dans un état incohérent : on le recrée à la prochaine lecture
      throw gone() ?? new OcrError("recognize", "La lecture de l'image a échoué.", errText(e));
    }
  } catch (e) {
    if (e instanceof OcrError) throw e;
    throw gone() ?? new OcrError("recognize", "La lecture de l'image a échoué.", errText(e));
  } finally {
    signal?.removeEventListener("abort", abort);
    logger = () => {}; running = false; armIdle();
  }
}
