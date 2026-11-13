import type { CardExport } from '../../../types/deckExport';
import type { CardTextLang } from './CardTextLang';
import { stripInlineCode } from '../../../content/inlineCode';
import { questionText } from '../../../content/questionCode';

export function buildPrerequisiteLabels(cards: readonly CardExport[], lang?: CardTextLang): Record<string, string> {
  return Object.fromEntries(cards.map((card) => {
    const parts = (card.Topic ?? '').split(/\s+\/\s+/);
    const localized = parts.filter((part) => /[\u3400-\u9fff]/.test(part) === (lang === 'zh-CN')).join(' / ').trim();
    const title = localized || card.Topic?.trim() || stripInlineCode(questionText(card.Question));
    return [card.StableUid, title];
  }));
}
