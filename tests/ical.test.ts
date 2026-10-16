// Lecteur iCal : formats Celcat (UTC), iCloud / Google (TZID + RRULE), exceptions, journées entières.
// Lancé avec TZ=Europe/Paris (voir package.json) : les heures attendues sont celles de Paris.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs, normalizeFeedUrl, isFeedUrl } from "../src/ical.ts";

const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}\r\nEND:VCALENDAR\r\n`;

test("Celcat : événements en UTC, salle, texte replié et échappé", () => {
  const ics = cal([
    "BEGIN:VEVENT", "UID:celcat-1", "DTSTART:20261019T080000Z", "DTEND:20261019T093000Z",
    "SUMMARY:CM - Algèbre linéaire\\, groupe A", "LOCATION:Amphi B", "DESCRIPTION:Enseignant : M. X\\nGroupe : L1", "END:VEVENT",
    "BEGIN:VEVENT", "UID:celcat-2", "DTSTART:20261020T130000Z", "DTEND:20261020T150000Z",
    "SUMMARY:TD Physique statistique et ther", " modynamique", "LOCATION:Salle 102", "END:VEVENT",
  ].join("\r\n"));
  const r = parseIcs(ics, "2026-10-19", "2026-10-25");
  assert.deepEqual(r.map((o) => [o.date, o.start, o.end, o.title, o.room]), [
    ["2026-10-19", "10:00", "11:30", "CM - Algèbre linéaire, groupe A", "Amphi B"],
    ["2026-10-20", "15:00", "17:00", "TD Physique statistique et thermodynamique", "Salle 102"],
  ]);
});

test("iCloud / Google : fuseau, répétition hebdomadaire, exception déplacée, date exclue, changement d'heure", () => {
  const ics = cal([
    "BEGIN:VEVENT", "UID:foot", "DTSTART;TZID=Europe/Madrid:20261007T180000", "DTEND;TZID=Europe/Madrid:20261007T193000",
    "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261104T235959Z", "EXDATE;TZID=Europe/Madrid:20261021T180000", "SUMMARY:Foot", "END:VEVENT",
    "BEGIN:VEVENT", "UID:foot", "RECURRENCE-ID;TZID=Europe/Madrid:20261028T180000", "DTSTART;TZID=Europe/Madrid:20261029T200000",
    "DTEND;TZID=Europe/Madrid:20261029T213000", "SUMMARY:Foot (déplacé)", "END:VEVENT",
  ].join("\r\n"));
  const r = parseIcs(ics, "2026-10-01", "2026-11-30");
  assert.deepEqual(r.map((o) => [o.date, o.start, o.title]), [
    ["2026-10-07", "18:00", "Foot"], ["2026-10-14", "18:00", "Foot"], ["2026-10-29", "20:00", "Foot (déplacé)"], ["2026-11-04", "18:00", "Foot"],
  ]);
});

test("journée entière, durée, événement annulé, COUNT", () => {
  const ics = cal([
    "BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261103", "SUMMARY:Vacances", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "DTSTART:20261103T090000", "DURATION:PT45M", "SUMMARY:RDV", "RRULE:FREQ=DAILY;COUNT=2", "END:VEVENT",
    "BEGIN:VEVENT", "UID:c", "DTSTART:20261103T120000", "DTEND:20261103T130000", "STATUS:CANCELLED", "SUMMARY:Annulé", "END:VEVENT",
  ].join("\r\n"));
  const r = parseIcs(ics, "2026-11-01", "2026-11-10");
  assert.deepEqual(r.map((o) => [o.date, o.start, o.end, o.title, o.allDay]), [
    ["2026-11-02", "00:00", "23:59", "Vacances", true],
    ["2026-11-03", "09:00", "09:45", "RDV", false],
    ["2026-11-04", "09:00", "09:45", "RDV", false],
  ]);
});

test("lien : webcal accepté, contenu non-calendrier refusé", () => {
  assert.equal(normalizeFeedUrl(" webcal://p52-caldav.icloud.com/published/2/abc "), "https://p52-caldav.icloud.com/published/2/abc");
  assert.equal(isFeedUrl("webcal://edt.univ.fr/ical?id=1"), true);
  assert.equal(isFeedUrl("pas un lien"), false);
  assert.throws(() => parseIcs("<html>Connexion</html>", "2026-01-01", "2026-01-02"), /calendrier/);
});
