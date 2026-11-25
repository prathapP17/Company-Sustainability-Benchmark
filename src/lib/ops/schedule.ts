/**
 * Wall-clock schedule helpers for the container scheduler (hosted mode has no launchd).
 * Times are evaluated in a configurable IANA time zone.
 */
export interface Slot {
  /** 0 = Sunday … 6 = Saturday; null = every day. */
  weekday: number | null;
  hour: number;
  minute: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The local date, weekday and time of `d` in `timeZone`. */
export function localParts(d: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/**
 * Whether a slot is due: its time has passed today (in `timeZone`) and it has
 * not run yet on that local day. `lastRunDate` is the local date of its last run.
 */
export function isDue(slot: Slot, now: Date, timeZone: string, lastRunDate: string | null): boolean {
  const p = localParts(now, timeZone);
  if (slot.weekday !== null && p.weekday !== slot.weekday) return false;
  if (p.hour * 60 + p.minute < slot.hour * 60 + slot.minute) return false;
  return lastRunDate !== p.date;
}

/** Parses "Mon 07:00" or "daily 03:00". */
export function parseSlot(s: string): Slot {
  const m = /^(sun|mon|tue|wed|thu|fri|sat|daily)\s+(\d{1,2}):(\d{2})$/i.exec(s.trim());
  if (!m) throw new Error(`bad schedule "${s}" (use e.g. "Mon 07:00" or "daily 03:00")`);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) throw new Error(`bad time in "${s}"`);
  const day = m[1].toLowerCase();
  return { weekday: day === "daily" ? null : WEEKDAYS.findIndex((w) => w.toLowerCase() === day), hour, minute };
}
