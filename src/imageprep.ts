/* Étudiant.OS — préparation d'une photo de ticket avant l'OCR (fonctions pures sur des tableaux de pixels).
 * Niveaux de gris → suppression de l'éclairage inégal (division par le fond flouté) → étirement du contraste.
 * Pas de binarisation : sur nos essais (tickets synthétiques) elle n'apportait pas mieux et peut détruire les traits fins. */

/** Taille cible : grand côté ramené dans [1400 ; 2400] px (visé : 2000). Renvoie le facteur d'échelle à appliquer. */
export function targetScale(w: number, h: number): number {
  const long = Math.max(w, h);
  if (long > 2400 || long < 1400) return 2000 / long;
  return 1;
}

/** RGBA → niveaux de gris (luminance), en place dans un nouveau tableau w*h. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

/** Fond estimé : image réduite par 8, floutée (boîte, 2 passes), puis agrandie par interpolation bilinéaire. */
function background(g: Uint8ClampedArray, w: number, h: number): Float32Array {
  const f = 8, sw = Math.max(1, Math.ceil(w / f)), sh = Math.max(1, Math.ceil(h / f));
  let a = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0, n = 0;
    for (let yy = y * f; yy < Math.min(h, y * f + f); yy++) for (let xx = x * f; xx < Math.min(w, x * f + f); xx++) { s += g[yy * w + xx]; n++; }
    a[y * sw + x] = s / Math.max(1, n);
  }
  const R = Math.max(2, Math.round(Math.min(w, h) / f / 20)); // rayon ≈ 5 % du petit côté
  const blur = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k; if (xx >= 0 && xx < sw && yy >= 0 && yy < sh) { s += src[yy * sw + xx]; n++; } }
      out[y * sw + x] = s / n;
    }
    return out;
  };
  for (let pass = 0; pass < 2; pass++) a = blur(blur(a, true), false);
  const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      bg[y * w + x] = (a[y0 * sw + x0] * (1 - tx) + a[y0 * sw + x1] * tx) * (1 - ty) + (a[y1 * sw + x0] * (1 - tx) + a[y1 * sw + x1] * tx) * ty;
    }
  }
  return bg;
}

/** Aplatit l'éclairage et étire le contraste (percentiles 1 % / 99 %). Renvoie un nouveau tableau de niveaux de gris. */
export function flattenGray(g: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const bg = background(g, w, h);
  const ratio = new Float32Array(g.length), hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) {
    const r = Math.min(1.2, g[i] / Math.max(1, bg[i]));
    ratio[i] = r; hist[Math.min(255, Math.round((r / 1.2) * 255))]++;
  }
  const at = (p: number) => { let acc = 0; const t = g.length * p; for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= t) return (b / 255) * 1.2; } return 1.2; };
  const lo = at(0.01), hi = at(0.99);
  const out = new Uint8ClampedArray(g.length);
  if (hi - lo < 0.02) { for (let i = 0; i < g.length; i++) out[i] = g[i]; return out; } // image quasi uniforme : on ne touche à rien
  for (let i = 0; i < g.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, (ratio[i] - lo) / (hi - lo))) * 255);
  return out;
}
