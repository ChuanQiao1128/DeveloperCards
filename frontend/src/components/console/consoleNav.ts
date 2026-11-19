// src/components/console/consoleNav.ts
//
// The console's global sections, in one place. Every page spreads
// consoleNav() into ConsoleShell, so the header offers the same destinations
// wherever the user is — including the review queue, the human gate of the
// authoring agent, from the landing page. A page passes only its deck-scoped
// overrides (e.g. reviewHref: `/review?deckId=7`), or `undefined` to leave a
// section out. The deck list keeps its own Decks destination visible as well.
//
// Webhooks and Admin Management are listed for everyone; ConsoleShell renders
// them only for a super_admin session.

export type ConsoleNavHrefs = {
  attentionHref?: string;
  operationsHref?: string;
  learnersHref?: string;
  decksHref?: string;
  reviewHref?: string;
  reportsHref?: string;
  usageHref?: string;
  ledgerHref?: string;
  automationHref?: string;
  webhooksHref?: string;
  adminUsersHref?: string;
};

// automationHref (A00 §16.1) is listed like the ledger, so every ConsoleShell
// page links the Automation console (B07 frontend-console-12); it used to be
// passed only by the four pages of the automation area.
export const CONSOLE_NAV: Readonly<Required<ConsoleNavHrefs>> = {
  attentionHref: '/needs-attention',
  operationsHref: '/operations',
  learnersHref: '/learners',
  decksHref: '/',
  reviewHref: '/review',
  // R20 V09: learner card reports, triaged by the deck's editors.
  reportsHref: '/reports',
  // R20 V10: learner usage (DAU/WAU/MAU, retention) and publish freshness.
  usageHref: '/usage',
  ledgerHref: '/ledger',
  automationHref: '/automation',
  webhooksHref: '/admin/webhooks',
  adminUsersHref: '/admin/users',
};

export function consoleNav(overrides: ConsoleNavHrefs = {}): ConsoleNavHrefs {
  return { ...CONSOLE_NAV, ...overrides };
}

export type ConsoleSection =
  | 'attention'
  | 'operations'
  | 'learners'
  | 'decks'
  | 'review'
  | 'qa'
  | 'reports'
  | 'usage'
  | 'ledger'
  | 'automation'
  | 'webhooks'
  | 'adminUsers';

/** The console section a path belongs to; the deck list and its card/deck pages are Decks. */
export function consoleSectionFor(pathname: string): ConsoleSection | null {
  if (pathname === '/needs-attention') return 'attention';
  if (pathname === '/overview' || pathname === '/operations') return 'operations';
  if (pathname === '/learners' || pathname.startsWith('/learners/')) return 'learners';
  if (pathname === '/review') return 'review';
  if (pathname === '/decks/qa') return 'qa';
  if (pathname === '/reports') return 'reports';
  if (pathname === '/usage') return 'usage';
  if (pathname === '/ledger') return 'ledger';
  if (pathname === '/automation') return 'automation';
  if (pathname === '/admin/webhooks') return 'webhooks';
  if (pathname === '/admin/users') return 'adminUsers';
  if (pathname === '/' || pathname.startsWith('/decks')) return 'decks';
  return null;
}

export type ConsoleArea = 'decks' | 'attention' | 'learners' | 'usage' | 'system';

const AREA_BY_SECTION: Record<ConsoleSection, ConsoleArea> = {
  decks: 'decks', qa: 'decks',
  attention: 'attention', review: 'attention', reports: 'attention',
  learners: 'learners', usage: 'usage',
  operations: 'system', automation: 'system', ledger: 'system',
  webhooks: 'system', adminUsers: 'system',
};

export function consoleAreaFor(section: ConsoleSection | null): ConsoleArea | null {
  return section ? AREA_BY_SECTION[section] : null;
}
