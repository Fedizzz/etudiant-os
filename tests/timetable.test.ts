// Lecture d'un emploi du temps en grille (format type Cronos / UC3M) à partir du texte et des cases d'une page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGrid, lastDateIn, dayOf, type TItem, type TRect } from "../src/timetable.ts";

const T = (s: string, x: number, y: number, w = s.length * 5, h = 8): TItem => ({ s, x, y, w, h });
function sample() {
  const items: TItem[] = [T("LUNES", 230, 86), T("MARTES", 420, 86), T("MIÉRCOLES", 670, 86)];
  const rects: TRect[] = [{ x0: 111, y0: 78, x1: 371, y1: 90 }, { x0: 371, y0: 78, x1: 500, y1: 90 }, { x0: 500, y0: 78, x1: 890, y1: 90 }];
  // lignes horaires de 15 min (19 px) à partir de 09:00, étiquettes « 0900 - 0915 » coupées en exposants
  for (let i = 0; i < 20; i++) {
    const s = 9 * 60 + i * 15, e = s + 15, y = 104 + i * 19, p = (n: number) => String(n).padStart(2, "0");
    items.push(T(p(Math.floor(s / 60)), 58, y), T(p(s % 60), 66, y - 4, 6, 6), T(`- ${p(Math.floor(e / 60))}`, 74, y), T(p(e % 60), 87, y - 4, 6, 6));
  }
  // Lundi 09:00-10:30 (6 lignes), Mardi 10:45-12:15 avec type LABORATORIO, Mercredi : sous-colonne
  rects.push({ x0: 111, y0: 87, x1: 371, y1: 201 }, { x0: 111, y0: 87, x1: 371, y1: 201 }, { x0: 371, y0: 220, x1: 500, y1: 334 }, { x0: 630, y0: 220, x1: 760, y1: 334 });
  items.push(T("TEORÍA", 112, 104), T("Expresión Oral y Escrita", 112, 120), T(", grp.20", 218, 120), T("(490-19508)", 250, 120), T("Aula 2.0.C15:", 112, 136, 35, 6), T("07.sep-05.oct, 19.oct-26.oct", 147, 136, 105, 6));
  items.push(T("LABORATORIO", 372, 237), T("Introducción a la", 372, 253, 100), T("Física, grp.20 1º, Cuatr.1", 372, 265, 110), T("Aula LAB 1.0.G15 (Bioingeniería):16.nov", 372, 285, 120, 6));
  items.push(T("PRÁCTICAS", 631, 237), T("Gen.-Programación", 631, 253, 100), T("Sala 4.0.E03:07.sep", 631, 270, 100, 6));
  return { items, rects };
}

test("grille : jours, heures, intitulés, salles, sous-colonnes", () => {
  const { items, rects } = sample();
  const r = parseGrid(items, rects, "2026-10-16");
  assert.deepEqual(r.map((x) => [x.day, x.start, x.end, x.title, x.room]), [
    [0, "09:00", "10:30", "Expresión Oral y Escrita", "2.0.C15"],
    [1, "10:45", "12:15", "Introducción a la Física (Labo)", "LAB 1.0.G15"],
    [2, "10:45", "12:15", "Gen.-Programación (TP)", "Sala 4.0.E03"],
  ]);
  assert.deepEqual(r[0].ranges, [["2026-09-07", "2026-10-05"], ["2026-10-19", "2026-10-26"]]);
  assert.equal(r[0].lastDate, "2026-10-26"); assert.equal(r[1].lastDate, "2026-11-16"); assert.equal(r[2].lastDate, "2026-09-07");
});

test("grille absente : rien (lecture par lignes utilisée à la place)", () => {
  assert.deepEqual(parseGrid([T("Lundi 10h-12h Maths", 10, 10, 200)], []), []);
});

test("dates de fin et jours multilingues", () => {
  assert.equal(lastDateIn("Aula 2.0.C15:07.sep-05.oct, 09.nov-30.nov", "2026-10-16"), "2026-11-30");
  assert.equal(lastDateIn("09.sep-09.dic", "2026-10-16"), "2026-12-09");
  assert.equal(lastDateIn("12.ene-20.feb", "2026-10-16"), "2027-02-20");
  assert.equal(lastDateIn("Aula 2.0.C15", "2026-10-16"), undefined);
  for (const [w, d] of [["LUNES", 0], ["MIÉRCOLES", 2], ["miercoles", 2], ["Jeudi", 3], ["VIERNES", 4], ["Sábado", 5]] as const) assert.equal(dayOf(w), d, w);
});

test("cours limités à certaines périodes : présents seulement ces jours-là dans le planning", async () => {
  const { blank, planDay, classOn } = await import("../src/core.ts");
  const s = blank({ name: "T" }, 600);
  s.courses = [{ id: "c", name: "Bio", code: "BIO", coef: 1, color: "#000", grades: [] } as never];
  s.classes = [{ id: "k", courseId: "c", day: 0, start: "10:45", end: "12:15", room: "LAB", dates: [["2026-10-05", "2026-10-05"], ["2026-11-16", "2026-11-23"]] }];
  assert.equal(classOn(s.classes[0], "2026-10-05"), true);
  assert.equal(classOn(s.classes[0], "2026-10-12"), false);
  assert.equal(classOn(s.classes[0], "2026-11-23"), true);
  assert.equal(planDay(s, "2026-10-12", undefined, "2026-10-01").blocks.some((b) => b.kind === "class"), false);
  assert.equal(planDay(s, "2026-11-16", undefined, "2026-10-01").blocks.some((b) => b.kind === "class"), true);
});
