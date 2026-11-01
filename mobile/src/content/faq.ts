export type FaqEntry = { q: string; a: string };

export const FAQ_LIST: readonly FaqEntry[] = [
  {
    q: 'How do I earn draws?',
    a: "AWS Architect Basics unlocks cards in order. After you study all your unlocked cards, up to 5 more are available immediately when your saved draws are used up; you can keep learning on the same day. Learn a new card to earn a draw for its pack: the first time you finish it, by tapping Got it on a new card or answering Remembered, Hard, Good or Easy, or by getting a multiple-choice card right. Clearing all of that pack's due cards adds one more, once a day. Every pack gets 5 draws the first time you open it, and your first lesson ends with 5 draws for its pack. A pack saves up to 60 draws, plus 5 extra draws waiting. Draws are never sold.",
  },
  {
    q: 'Why is Draw locked?',
    a: "For AWS Architect Basics, study the cards you have unlocked, then choose Unlock next cards to continue in order. If all your unlocked cards are studied and your draws are used up, the next batch becomes available immediately while cards remain. There is no daily wait for this course. Other packs need draws earned by studying; when caught up with no draws, they receive 1 free draw a day. Coming Soon packs cannot be studied yet.",
  },
  {
    q: 'When is a rare card guaranteed?',
    a: "AWS Architect Basics is an ordered course, so rarity does not change which card unlocks next. For random packs, after 10 Commons in a row, the next card is Rare or better, so a rare card is guaranteed within 11 cards while the pack still has a Rare or Legendary you don't own. There are no repeat draws: a card you have drawn never comes up again. Open up to 5 cards at once, or just 1: you only spend draws for the cards you receive.",
  },
  {
    q: 'What do I study?',
    a: 'Available now: AWS Architect Basics (the basics behind SAA-C03, in English with a built-in Chinese translation). AWS Associate Architect (SAA-C03) and Claude Developer Foundations (CCDV-F) are Coming Soon and cannot be studied yet. Reviews are scheduled with FSRS, the open-source spaced-repetition algorithm, never more than 90 days out, and a card is Mastered once its next review is 15 or more days away. The app is iOS only.',
  },
  {
    q: 'Why is a card locked in the Library?',
    a: "You study the cards in your collection. A locked card is one you have not unlocked yet. In AWS Architect Basics, cards unlock in course order. Studied means you have reviewed a card at least once; Mastered is a separate spaced-repetition milestone. Anything you already studied stays open.",
  },
  {
    q: 'Does it work offline? Do I need an account?',
    a: 'AWS Architect Basics downloads the first time your phone is online. After the full course finishes downloading, you can study and unlock its next cards offline. Coming Soon packs are not available for study. An account is optional: signing in adds cloud backup, Report a card and the Premium subscription. Premium is for future premium decks; there is nothing premium to unlock yet.',
  },
  {
    q: 'How are the cards made?',
    a: 'Cards are drafted with AI assistance from official documentation and checked by automated checks and AI review passes. If a card looks wrong, sign in and use Report a problem. The sources are AWS and Anthropic documentation, and you can also tell me through Support.',
  },
];

// R24B contract §2: shown as the Help screen's footer (and in the App Store
// description).
export const FAQ_DISCLAIMER: readonly [string, string] = [
  'Not official exam material and not an exam simulator.',
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon or Anthropic.',
];
