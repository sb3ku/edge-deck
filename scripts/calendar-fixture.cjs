'use strict';
// Deterministic calendar for the isolated verification host, never production.
function stamp(date) { const p = n => String(n).padStart(2, '0'); return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`; }
function at(day, hour, minute = 0) { const date = new Date(); date.setDate(date.getDate() + day); return `${stamp(date)}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`; }
function day(offset) { const date = new Date(); date.setDate(date.getDate() + offset); return stamp(date); }
function fixtureIcs() {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Edge Deck//Fixture//EN', 'X-WR-CALNAME:Personal', 'X-APPLE-CALENDAR-COLOR:#FF9500',
    'BEGIN:VEVENT', 'UID:fixture-1', `DTSTART:${at(0, 23, 0)}`, `DTEND:${at(0, 23, 59)}`, 'SUMMARY:Evening walk', 'LOCATION:Riverside Park', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fixture-2', `DTSTART:${at(1, 10, 30)}`, `DTEND:${at(1, 11, 15)}`, 'SUMMARY:Design review', 'LOCATION:Room 4', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fixture-3', `DTSTART;VALUE=DATE:${day(1)}`, `DTEND;VALUE=DATE:${day(2)}`, 'SUMMARY:Public holiday', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fixture-4', `DTSTART:${at(-7, 9, 0)}`, `DTEND:${at(-7, 9, 30)}`, 'RRULE:FREQ=WEEKLY;INTERVAL=1', 'SUMMARY:Weekly planning', 'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
async function fetchCalendarFixture(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw Error('Unexpected calendar fixture destination');
  return new Response(fixtureIcs(), { status: 200, headers: { 'content-type': 'text/calendar' } });
}
module.exports = { fetchCalendarFixture, fixtureIcs };
