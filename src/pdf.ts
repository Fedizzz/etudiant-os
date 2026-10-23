/* Étudiant.OS — générateur PDF minimal (rectangles + texte Helvetica), sans dépendance, utilisable hors ligne.
 * Unités : millimètres, origine en haut à gauche (convertie vers le repère PDF). */

const PT = 72 / 25.4;
type RGB = [number, number, number];
const col = (c: RGB) => c.map((v) => (v / 255).toFixed(3)).join(" ");
/** Texte → Latin-1 (WinAnsi) ; caractères non représentables remplacés. */
export function latin1(t: string): string {
  return t.replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
    .replace(/[  ]/g, " ").replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}
const esc = (t: string) => latin1(t).replace(/[\\()]/g, (m) => "\\" + m);
/** Largeur approximative (Helvetica ≈ 0,52 em ; gras ≈ 0,56 em), suffisante pour couper / centrer. */
export const textWidth = (t: string, size: number, bold = false) => latin1(t).length * size * (bold ? 0.56 : 0.52) / PT;

export class MiniPdf {
  private pages: string[][] = [];
  readonly w: number; readonly h: number;
  constructor(w = 297, h = 210) { this.w = w; this.h = h; this.addPage(); }
  private get ops() { return this.pages[this.pages.length - 1]; }
  addPage() { this.pages.push([]); }
  rect(x: number, y: number, w: number, h: number, fill?: RGB, stroke?: RGB, lw = 0.2) {
    const p = `${(x * PT).toFixed(2)} ${((this.h - y - h) * PT).toFixed(2)} ${(w * PT).toFixed(2)} ${(h * PT).toFixed(2)} re`;
    this.ops.push(`${fill ? col(fill) + " rg " : ""}${stroke ? col(stroke) + " RG " + (lw * PT).toFixed(2) + " w " : ""}${p} ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB, lw = 0.2) {
    this.ops.push(`${col(c)} RG ${(lw * PT).toFixed(2)} w ${(x1 * PT).toFixed(2)} ${((this.h - y1) * PT).toFixed(2)} m ${(x2 * PT).toFixed(2)} ${((this.h - y2) * PT).toFixed(2)} l S`);
  }
  text(x: number, y: number, t: string, size: number, c: RGB = [24, 22, 46], opts: { bold?: boolean; align?: "left" | "center" | "right" } = {}) {
    const wdt = textWidth(t, size, opts.bold);
    const dx = opts.align === "center" ? -wdt / 2 : opts.align === "right" ? -wdt : 0;
    this.ops.push(`BT /${opts.bold ? "F2" : "F1"} ${size} Tf ${col(c)} rg ${((x + dx) * PT).toFixed(2)} ${((this.h - y) * PT).toFixed(2)} Td (${esc(t)}) Tj ET`);
  }
  /** Coupe un texte en lignes tenant dans `w` mm. */
  wrap(t: string, w: number, size: number): string[] {
    const out: string[] = []; let cur = "";
    for (const word of latin1(t).split(/\s+/).filter(Boolean)) {
      const next = cur ? cur + " " + word : word;
      if (textWidth(next, size) <= w || !cur) cur = next; else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out.map((l) => { let s = l; while (s.length > 1 && textWidth(s, size) > w) s = s.slice(0, -2) + "."; return s; });
  }
  /** Fichier PDF (octets). */
  bytes(): Uint8Array {
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(""), pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${(this.w * PT).toFixed(2)} ${(this.h * PT).toFixed(2)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"; const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    // Tout le contenu est en Latin-1 : un caractère = un octet.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}
