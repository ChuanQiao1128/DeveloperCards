import type { CardExport } from '../types/deckExport';
import bundled from './checklistZh20261114.json';

const translations: Readonly<Record<string, { en: string[]; zh: string[] }>> = bundled;
const points = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 &&
  value.every(point => typeof point === 'string' && point.trim().length > 0);

/** Read-only localization for the existing public deck; published translations take priority. */
export function chineseAnswerChecklist(card: CardExport): readonly string[] | null {
  const english = card.Teaching?.mustAnswer;
  if (!points(english)) return null;
  const published = card.Teaching?.['zh-CN']?.mustAnswer;
  if (points(published) && published.length === english.length) return published;
  const entry = Object.prototype.hasOwnProperty.call(translations, card.StableUid)
    ? translations[card.StableUid] : undefined;
  // Do not normalize text or order: a changed English requirement needs a fresh translation.
  return entry && entry.en.length === english.length &&
    entry.en.every((point, index) => point === english[index]) ? entry.zh : null;
}
