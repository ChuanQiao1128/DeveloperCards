export const PANEL = 'rounded border border-slate-200 bg-white p-4 space-y-3';
export const HEADING = 'text-lg font-semibold text-slate-900';
export const LINK = 'text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded';
export const INPUT = 'w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';
export function formatTime(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? `${parsed.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC')}` : 'Unknown';
}
export function formatCount(value: number | null): string { return value === null ? 'Unknown' : value.toLocaleString('en-US'); }
export function formatBoolean(value: boolean | null): string { return value === null ? 'Unknown' : value ? 'Yes' : 'No'; }
