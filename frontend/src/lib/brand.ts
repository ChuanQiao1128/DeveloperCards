// src/lib/brand.ts
//
// The one place the console names itself. Everything visible that used to carry
// the old product name reads from here instead, so the product has a single
// brand and a single default deck author rather than a scatter of string
// literals that drift apart.
//
// NO IMPORTS. App.tsx and LoginPage are eager (first-load) modules and pull
// this in, so anything imported here would join the first-load closure that
// tests/bundleFirstLoad.test.ts budgets. Keep it to plain constants and a pure
// function.

export const CONSOLE_NAME = 'DeveloperCards Console';
// New decks are authored by the company (owner, 2026-10-18), not the product.
export const DEFAULT_DECK_AUTHOR = 'Time Awake';

// Each known route's own short label. The document title is this label followed
// by the console name, so a tab reads "Decks · DeveloperCards Console" rather
// than the same static string on every page.
const ROUTE_TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/auth/callback': 'Signing in',
  '/': 'Decks',
  '/decks/new': 'New deck',
  '/decks/edit': 'Edit deck',
  '/decks/publish': 'Publishing',
  '/decks/release': 'Publishing',
  '/decks/versions': 'Published versions',
  '/decks/preview': 'Deck preview',
  '/decks/cards': 'Cards',
  '/decks/cards/new': 'New card',
  '/decks/cards/edit': 'Edit card',
  '/decks/cards/import': 'Import cards',
  '/admin/users': 'Administrators & permissions',
  '/admin/webhooks': 'Webhooks',
  '/ledger': 'Automation ledger',
  '/review': 'AI draft review',
  '/decks/qa': 'AI QA',
  '/automation': 'Automation',
  '/reports': 'Card feedback',
  '/usage': 'Usage',
  '/overview': 'Overview',
  '/needs-attention': 'Needs attention',
  '/operations': 'Operations',
  '/learners': 'App users',
};

/**
 * The document title for a pathname. A known path returns
 * `${label} · ${CONSOLE_NAME}`; anything else returns the console name alone.
 * One trailing slash is stripped first (except for `/` itself) so that
 * `/decks/new/` and `/decks/new` name the same page.
 */
export function documentTitleFor(pathname: string, search = ''): string {
  const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const label = path === '/automation' && new URLSearchParams(search).get('tab') === 'email' ? 'Notifications'
    : path.startsWith('/learners/') ? 'User profile'
    : path.startsWith('/decks/publish-jobs/') ? 'Publish job' : ROUTE_TITLES[path];
  return label ? `${label} · ${CONSOLE_NAME}` : CONSOLE_NAME;
}
