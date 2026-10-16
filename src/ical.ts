/* Étudiant.OS — lecture de calendriers iCalendar (.ics) : Celcat, iCloud, Google, Outlook…
 * Logique pure (testée) : texte .ics → occurrences datées en heure locale de l'appareil, sur une fenêtre de dates. */

export interface CalOccurrence { uid: string; title: string; room: string; date: string; start: string; end: string; allDay: boolean }

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Lignes « dépliées » (RFC 5545 : une ligne qui commence par espace/tab continue la précédente). */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
}
const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

/** Décalage (minutes) d'un fuseau IANA à un instant donné. */
function tzOffset(tz: string, utcMs: number): number {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return (asUtc - utcMs) / 60000;
  } catch { return -new Date(utcMs).getTimezoneOffset(); }
}
/** Heure « murale » dans un fuseau → instant. Sans fuseau : heure locale de l'appareil (« flottante »). */
function wallToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string, utc?: boolean): Date {
  if (utc) return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (!tz) return new Date(y, mo - 1, d, h, mi, s);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffset(tz, guess);
  off = tzOffset(tz, guess - off * 60000); // second passage : changements d'heure
  return new Date(guess - off * 60000);
}

interface Prop { name: string; params: Record<string, string>; value: string }
function parseProp(line: string): Prop {
  // NOM;PARAM=x;PARAM="y:z":valeur — le premier « : » hors guillemets sépare la valeur.
  let i = 0, q = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ":" && !q) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of ps) { const k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}
function parseDateValue(p: Prop): { date: Date; allDay: boolean } | null {
  const v = p.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || p.params.VALUE === "DATE") { m = m ?? /^(\d{4})(\d{2})(\d{2})/.exec(v); if (!m) return null; return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true }; }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  return { date: wallToDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), p.params.TZID, !!m[7]), allDay: false };
}

interface RawEvent { uid: string; title: string; room: string; start: Date; end: Date; allDay: boolean; rrule?: string; exdates: number[]; recurrenceId?: number; cancelled: boolean }

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** Occurrences d'un événement répétitif (FREQ DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL, BYDAY). */
function expand(ev: RawEvent, from: Date, to: Date): Date[] {
  if (!ev.rrule) return [ev.start];
  const r = Object.fromEntries(ev.rrule.split(";").map((kv) => kv.split("=") as [string, string]));
  const freq = r.FREQ, interval = Math.max(1, +(r.INTERVAL ?? 1)), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDateValue({ name: "UNTIL", params: {}, value: r.UNTIL })?.date ?? null : null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))).filter((i) => i >= 0) : null;
  const out: Date[] = [];
  let n = 0;
  const push = (d: Date) => { if (until && d > until) return false; n++; if (n > count) return false; if (d >= from && d <= to) out.push(d); return true; };
  const at = (base: Date, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
  if (freq === "WEEKLY") {
    const days = byday && byday.length ? byday : [ev.start.getDay()];
    const week0 = at(ev.start, -ev.start.getDay());
    for (let w = 0; w < 600; w += interval) {
      for (const wd of [...days].sort((a, b) => a - b)) {
        const d = at(week0, w * 7 + wd); d.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds());
        if (d < ev.start) continue;
        if (!push(d) || d > to) return out;
      }
    }
  } else if (freq === "DAILY") {
    for (let i = 0; i < 4000; i += interval) { const d = at(ev.start, i); if (byday && !byday.includes(d.getDay())) continue; if (!push(d) || d > to) return out; }
  } else if (freq === "MONTHLY" || freq === "YEARLY") {
    for (let i = 0; i < 400; i += interval) {
      const d = new Date(ev.start); if (freq === "MONTHLY") d.setMonth(d.getMonth() + i); else d.setFullYear(d.getFullYear() + i);
      if (d.getDate() !== ev.start.getDate()) continue; // 31 → mois sans 31 : ignoré (comme les calendriers)
      if (!push(d) || d > to) return out;
    }
  } else return [ev.start];
  return out;
}

/** Occurrences entre `from` et `to` (dates ISO incluses), triées. Les événements annulés et les exceptions sont respectés. */
export function parseIcs(text: string, from: string, to: string): CalOccurrence[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Ce lien ne renvoie pas un calendrier (.ics).");
  const lines = unfold(text);
  const events: RawEvent[] = [];
  let cur: Partial<RawEvent> & { exdates?: number[] } | null = null, depth = 0;
  for (const line of lines) {
    const up = line.toUpperCase();
    if (up === "BEGIN:VEVENT") { cur = { exdates: [], title: "", room: "", cancelled: false }; depth = 0; continue; }
    if (!cur) continue;
    if (up.startsWith("BEGIN:")) { depth++; continue; }          // VALARM… ignorés
    if (up.startsWith("END:") && depth > 0) { depth--; continue; }
    if (up === "END:VEVENT") {
      if (cur.start) {
        const end = cur.end ?? new Date(cur.start.getTime() + (cur.allDay ? 864e5 : 36e5));
        events.push({ uid: cur.uid ?? `${cur.title}-${cur.start.getTime()}`, title: cur.title || "Sans titre", room: cur.room ?? "", start: cur.start, end, allDay: !!cur.allDay, rrule: cur.rrule, exdates: cur.exdates ?? [], recurrenceId: cur.recurrenceId, cancelled: !!cur.cancelled });
      }
      cur = null; continue;
    }
    if (depth > 0) continue;
    const p = parseProp(line);
    switch (p.name) {
      case "UID": cur.uid = p.value.trim(); break;
      case "SUMMARY": cur.title = unescape(p.value); break;
      case "LOCATION": cur.room = unescape(p.value); break;
      case "DTSTART": { const d = parseDateValue(p); if (d) { cur.start = d.date; cur.allDay = d.allDay; } break; }
      case "DTEND": { const d = parseDateValue(p); if (d) cur.end = d.date; break; }
      case "DURATION": {
        const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(p.value.trim());
        if (m && cur.start) cur.end = new Date(cur.start.getTime() + (((+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 24 + +(m[3] ?? 0)) * 60 + +(m[4] ?? 0)) * 60000);
        break;
      }
      case "RRULE": cur.rrule = p.value.trim().toUpperCase(); break;
      case "EXDATE": for (const v of p.value.split(",")) { const d = parseDateValue({ ...p, value: v }); if (d) cur.exdates!.push(d.date.getTime()); } break;
      case "RECURRENCE-ID": { const d = parseDateValue(p); if (d) cur.recurrenceId = d.date.getTime(); break; }
      case "STATUS": cur.cancelled = /CANCELLED/i.test(p.value); break;
    }
  }
  const fromD = new Date(from + "T00:00:00"), toD = new Date(to + "T23:59:59");
  // Exceptions (RECURRENCE-ID) : remplacent l'occurrence d'origine.
  const overrides = new Map<string, RawEvent>();
  for (const e of events) if (e.recurrenceId !== undefined) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const out: CalOccurrence[] = [];
  const emit = (e: RawEvent, s: Date) => {
    if (e.cancelled) return;
    const e2 = new Date(s.getTime() + (e.end.getTime() - e.start.getTime()));
    // Un événement sur plusieurs jours est découpé jour par jour (borné à 14 jours).
    for (let day = new Date(s.getFullYear(), s.getMonth(), s.getDate()), k = 0; day < e2 && k < 14; day.setDate(day.getDate() + 1), k++) {
      const date = isoDate(day);
      if (date < from || date > to) continue;
      const sameStart = isoDate(s) === date, sameEnd = isoDate(e2) === date;
      out.push({ uid: e.uid, title: e.title, room: e.room, date, allDay: e.allDay, start: e.allDay || !sameStart ? "00:00" : hm(s), end: e.allDay || !sameEnd ? "23:59" : hm(e2) });
      if (e.allDay) continue;
    }
  };
  for (const e of events) {
    if (e.recurrenceId !== undefined) { emit(e, e.start); continue; }
    const span = e.end.getTime() - e.start.getTime();
    for (const s of expand(e, new Date(fromD.getTime() - span), toD)) {
      if (e.exdates.includes(s.getTime())) continue;
      if (overrides.has(`${e.uid}|${s.getTime()}`)) continue;
      emit(e, s);
    }
  }
  const seen = new Set<string>();
  return out.filter((o) => { const k = `${o.uid}|${o.date}|${o.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** webcal:// → https:// ; espaces retirés. */
export const normalizeFeedUrl = (u: string) => u.trim().replace(/^webcals?:\/\//i, "https://");
export const isFeedUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s/]+\/\S*$/i.test(normalizeFeedUrl(u));
