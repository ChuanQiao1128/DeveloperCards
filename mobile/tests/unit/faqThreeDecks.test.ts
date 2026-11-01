// Help offers the live course, distinguishes the two previews and explains offline availability.
import { describe, expect, it } from 'vitest';

import { FAQ_DISCLAIMER, FAQ_LIST } from '../../src/content/faq';

function answer(q: string): string {
  const entry = FAQ_LIST.find((e) => e.q === q);
  expect(entry, q).toBeDefined();
  return entry!.a;
}

describe('Help FAQ reflects current pack availability', () => {
  it('never names the hidden C# deck', () => {
    const copy = [...FAQ_LIST.flatMap(e => [e.q, e.a]), ...FAQ_DISCLAIMER].join('\n');
    expect(copy).not.toMatch(/C#|\.NET|csharp|Microsoft/i);
  });
  it('only offers AWS Basics for study and labels the other packs Coming Soon', () => {
    const a = answer('What do I study?');
    expect(a).toMatch(/^Available now: AWS Architect Basics/);
    expect(a).toContain('AWS Associate Architect (SAA-C03) and Claude Developer Foundations (CCDV-F) are Coming Soon');
    expect(a).not.toContain('Three free decks');
    expect(a).toContain('built-in Chinese translation');
  });
  it('requires the available course download before offline learning', () => {
    const a = answer('Does it work offline? Do I need an account?');
    expect(a).toContain('AWS Architect Basics downloads the first time your phone is online');
    expect(a).toContain('After the full course finishes downloading');
    expect(a).toContain('Coming Soon packs are not available for study');
    expect(a).not.toMatch(/first lesson on either works offline/);
  });
  it('explains immediate ordered continuation and distinguishes study from mastery', () => {
    expect(answer('Why is Draw locked?')).toContain('There is no daily wait for this course');
    expect(answer('When is a rare card guaranteed?')).toContain('rarity does not change which card unlocks next');
    expect(answer('Why is a card locked in the Library?')).toContain('reviewed a card at least once');
  });
});
