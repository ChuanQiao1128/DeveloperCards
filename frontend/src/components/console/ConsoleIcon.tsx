import type { ConsoleSection } from './consoleNav';

type IconName = ConsoleSection | 'menu' | 'close' | 'signOut' | 'chevron';

const paths: Record<IconName, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  decks: 'M4 4h12v14H4z M8 21h12V7 M7 8h6 M7 12h6',
  review: 'M9 4H5v17h14V4h-4 M9 3h6v4H9z M8 14l3 3 5-6',
  qa: 'M8 3h8 M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3 M8 14h8',
  reports: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 17v-3 M12 17v-6 M16 17v-4',
  learners: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M17 3.13a4 4 0 0 1 0 7.75',
  automation: 'M13 2 4 14h7l-1 8 10-12h-7z',
  ledger: 'M5 3h14v18H5z M9 7h6 M9 12h6 M9 17h6',
  usage: 'M4 3v17h17 M8 15v-4 M13 15V6 M18 15V9',
  operations: 'M3 12h4l3-8 4 16 3-8h4',
  webhooks: 'M8 12a4 4 0 0 1 4-4h4a4 4 0 0 1 0 8h-1 M16 12a4 4 0 0 1-4 4H8a4 4 0 0 1 0-8h1',
  adminUsers: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M9 12l2 2 4-4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'm6 6 12 12 M6 18 18 6',
  signOut: 'M9 4H4v16h5 M14 8l4 4-4 4 M8 12h12',
  chevron: 'm9 5 7 7-7 7',
};

/** A single outline vocabulary keeps navigation quiet and recognizable. */
export function ConsoleIcon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return <svg className={className} aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
