// src/components/console/ConsoleShell.tsx

import { useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { getSessionGeneration, subscribeSessionChanges } from '../../auth/tokenStore';
import { useSignOut } from '../../auth/AuthContext';
import { isSuperAdmin, readSessionUser } from '../../auth/sessionUser';
import { consoleSectionFor } from './consoleNav';
import type { ConsoleSection } from './consoleNav';

type Props = {
  title: string;
  subtitle?: string;
  // Optional: a page that knows its own identity passes these and keeps full
  // control of the header; a page that does not lets the shell derive them from
  // the stored session (see below), so every authoring page can render the same
  // top bar without threading the session through itself.
  userLabel?: string;
  superAdmin?: boolean;

  // ---------------------------------------------------------------------
  // DESTINATIONS, NOT HANDLERS. THE DIFFERENCE IS THE WHOLE POINT.
  // ---------------------------------------------------------------------
  // These were `onGoDecks?: () => void` and friends, and every caller passed
  // `() => navigate('/…')`. Rendered as <button onClick={…}> that produced
  // controls which look like links, sit where links sit, and are not links:
  // cmd-click and middle-click open nothing, "copy link address" is absent,
  // the status bar shows no target, and a screen reader announces "button"
  // for a thing whose only effect is to change the page.
  //
  // Passing the path instead lets the shell render <Link>, which restores all
  // of that for free — react-router's Link is an <a href> that also intercepts
  // the plain left-click, so modified clicks fall through to the browser.
  //
  // An undefined href means "this session has nowhere to go here", and the
  // control is not rendered at all. That is the same three-state shape the
  // callbacks had; only the payload changed.
  overviewHref?: string;
  operationsHref?: string;
  learnersHref?: string;
  decksHref?: string;
  adminUsersHref?: string;
  // super_admin only, like adminUsersHref: rendered only for a super_admin session.
  webhooksHref?: string;
  // Not role-gated: the ledger's read routes are RequireAdmin, so the pages
  // that pass this decide who sees it.
  ledgerHref?: string;
  // Not role-gated: the draft review routes decide who may act.
  reviewHref?: string;
  // Not role-gated: the AI QA routes decide who may act.
  qaHref?: string;
  // Not role-gated: the card report routes are RequireAdmin and deck-scoped.
  reportsHref?: string;
  // Not role-gated: the usage and freshness routes are RequireAdmin.
  usageHref?: string;
  // Not role-gated, like ledgerHref: the automation read routes are RequireAdmin.
  // Part of consoleNav(), so every console page offers it.
  automationHref?: string;

  children: React.ReactNode;
};

/**
 * One spelling for every section link, so a link cannot drift away from its
 * neighbours: the same focus-visible ring as the HITL pages' controls
 * (frontend-console-22), and an active look for the current section
 * (frontend-console-27).
 */
const NAV_LINK_BASE =
  'text-xs px-2 py-1 rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const NAV_LINK_CLASS = `${NAV_LINK_BASE} border-slate-300 text-slate-700 hover:bg-slate-50`;
const NAV_LINK_ACTIVE_CLASS = `${NAV_LINK_BASE} bg-indigo-50 border-indigo-300 text-indigo-700`;

export function ConsoleShell({
  title,
  subtitle,
  userLabel,
  superAdmin,
  overviewHref,
  operationsHref,
  learnersHref,
  decksHref,
  adminUsersHref,
  webhooksHref,
  ledgerHref,
  reviewHref,
  qaHref,
  reportsHref,
  usageHref,
  automationHref,
  children,
}: Props) {
  // Sign-out is the shell's own affair now, through AuthContext, so no page has
  // to carry (or duplicate) a handler. In the real app this resets the context's
  // tokens state; in a bare page test it degrades to dropping the session.
  const signOut = useSignOut();

  // Session replacement and refreshed permission changes update navigation.
  // API authorization remains authoritative.
  useSyncExternalStore(subscribeSessionChanges, getSessionGeneration);
  const derivedUser = readSessionUser();

  const resolvedUserLabel =
    userLabel ??
    (derivedUser
      ? `${derivedUser.email ?? derivedUser.username ?? 'Signed in'} · ${
          isSuperAdmin(derivedUser) ? 'super_admin' : 'editor'
        }`
      : '—');
  const resolvedSuperAdmin = superAdmin ?? isSuperAdmin(derivedUser);

  const current = consoleSectionFor(useLocation().pathname);
  /** aria-current and the active look for the link of the section on screen. */
  const navProps = (section: ConsoleSection) =>
    section === current
      ? { className: NAV_LINK_ACTIVE_CLASS, 'aria-current': 'page' as const }
      : { className: NAV_LINK_CLASS };

  const navGroups: [string, [ConsoleSection, string, string | undefined, string?][]][] = [
    ['Operations and learners', resolvedSuperAdmin ? [
      ['overview', 'Overview', overviewHref], ['operations', 'Operations', operationsHref], ['learners', 'Learners', learnersHref],
    ] : []],
    ['Content and automation', [
      ['decks', 'Decks', decksHref], ['review', 'Review queue', reviewHref], ['qa', 'AI QA', qaHref],
      ['reports', 'Reports', reportsHref], ['usage', 'Usage', usageHref], ['ledger', 'Automation ledger', ledgerHref],
      ['automation', 'Automation', automationHref],
    ]],
    ['Administration', resolvedSuperAdmin ? [
      ['webhooks', 'Webhooks', webhooksHref], ['adminUsers', 'Admin Management', adminUsersHref, 'Manage users and permissions (super_admin only)'],
    ] : []],
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] w-full mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            {subtitle ? <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div> : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* A landmark, so "skip to the console's sections" is answerable by
                assistive technology without reading the header out. It needs the
                three links to be adjacent, which is why the user pill now sits
                after them rather than between the section links and Admin
                Management — that position was incidental, and identity beside
                Sign out is where a shell usually puts it. */}
            <nav aria-label="Console sections" className="flex items-center gap-2 flex-wrap">
              {navGroups.map(([label, entries]) => entries.some(([, , href]) => href) && (
                <div key={label} role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
                  {entries.map(([section, label, href, title]) => href && (
                    <Link key={section} to={href} title={title} {...navProps(section)}>{label}</Link>
                  ))}
                </div>
              ))}
            </nav>

            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              {resolvedUserLabel}
            </span>

            {/* Stays a button, and must: signing out is an action with a side
                effect, not a destination. */}
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-[1600px] w-full mx-auto px-4 py-6">
        {/* Main */}
        <main className="space-y-4">{children}</main>
      </div>
    </div>
  );
}
