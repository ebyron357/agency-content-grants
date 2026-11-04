/**
 * Deadline calendars (RFC 5545). Grants.gov records give a closing date but
 * the closing time and time zone live in the notice, so each deadline is an
 * all-day event with reminders and a note to confirm the time. Reminder
 * thresholds are shared with the deadline webhook event.
 */

/** Days before a closing date at which reminders fire (calendar alarms and the webhook event). */
export const DEADLINE_REMINDER_DAYS = [14, 7, 2] as const;

export interface CalendarDeadline {
  uid: string;
  /** ISO closing date, YYYY-MM-DD. */
  date: string;
  summary: string;
  description: string;
  url?: string | null;
}

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, continuing with CRLF and a space, without splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function compactDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A VCALENDAR with one all-day VEVENT per deadline, each with reminders. Invalid dates are skipped. */
export function buildDeadlineCalendar(name: string, deadlines: CalendarDeadline[], now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Content Machine//Grant Studio//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
  ];
  for (const d of deadlines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.uid}@grant-studio`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(d.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(d.date))}`,
      `SUMMARY:${escapeIcsText(d.summary)}`,
      `DESCRIPTION:${escapeIcsText(`${d.description}\n\nConfirm the closing time and time zone in the official notice.`)}`,
      ...(d.url ? [`URL:${d.url}`] : []),
      "TRANSP:TRANSPARENT",
    );
    for (const days of DEADLINE_REMINDER_DAYS) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(`${d.summary}: ${days} days left`)}`, `TRIGGER:-P${days}D`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * The reminder threshold a deadline has newly crossed: the smallest threshold
 * at or above the days left that is below the last one alerted. Returns null
 * when nothing new is due or the date has passed.
 */
export function dueReminder(daysLeft: number | null, lastAlertedDays: number | null): number | null {
  if (daysLeft === null || daysLeft < 0) return null;
  const crossed = DEADLINE_REMINDER_DAYS.filter((t) => daysLeft <= t);
  if (crossed.length === 0) return null;
  const threshold = Math.min(...crossed);
  if (lastAlertedDays !== null && threshold >= lastAlertedDays) return null;
  return threshold;
}

/** A safe file name stem for a download. */
export function fileStem(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "deadlines";
}
