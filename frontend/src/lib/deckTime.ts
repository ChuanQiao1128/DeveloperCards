const DECK_TIME = new Intl.DateTimeFormat('en-NZ', {
  timeZone: 'Pacific/Auckland',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

export function formatDeckTime(value: string | number | null | undefined, fallback = '—'): string {
  const instant = new Date(value ?? '');
  return Number.isFinite(instant.getTime()) ? DECK_TIME.format(instant) : fallback;
}
