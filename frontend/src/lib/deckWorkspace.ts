export function hasReviewedDeckRelease(deck: { id: number | null; slug: string }): boolean {
  return deck.id === 15 && deck.slug === 'aws-saa-fundamentals';
}

export const REVIEWED_DECK_RELEASE_HREF = '/decks/release?deckId=15';
