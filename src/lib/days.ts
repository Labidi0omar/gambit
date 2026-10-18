/**
 * Due date for spaced repetition: the start of the local calendar day `n` days from `now`.
 * Using local midnight (not now + n*24h) means an item missed at 23:30 is due the next morning,
 * and setDate() keeps it right across daylight-saving changes.
 */
export function dueInDays(n: number, now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}
