export function hasReviewedDeckRelease(deck: { id: number | null; slug: string }): boolean {
  return deck.id === 15 && deck.slug === 'aws-saa-fundamentals';
}
