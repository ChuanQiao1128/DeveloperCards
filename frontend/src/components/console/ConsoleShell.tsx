// src/components/console/ConsoleShell.tsx

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { getSessionGeneration, subscribeSessionChanges } from '../../auth/tokenStore';
import { useSignOut } from '../../auth/AuthContext';
import { isSuperAdmin, readSessionUser } from '../../auth/sessionUser';
import { consoleAreaFor, consoleSectionFor } from './consoleNav';
import type { ConsoleArea, ConsoleSection } from './consoleNav';
import { ConsoleIcon } from './ConsoleIcon';
import { Button } from '../ui/Button';

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
  attentionHref?: string;
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
  'console-nav-link flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const NAV_LINK_CLASS = `${NAV_LINK_BASE} text-slate-600 hover:bg-slate-200/60 hover:text-slate-950`;
const NAV_LINK_ACTIVE_CLASS = `${NAV_LINK_BASE} bg-indigo-50 text-indigo-800`;

export function ConsoleShell({
  title,
  subtitle,
  userLabel,
  superAdmin,
  attentionHref,
  operationsHref,
  learnersHref,
  decksHref,
  adminUsersHref,
  webhooksHref,
  ledgerHref,
  reviewHref,
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
  // A caller may suppress navigation, but a stale prop cannot grant permission.
  const resolvedSuperAdmin = isSuperAdmin(derivedUser) && superAdmin !== false;

  const location = useLocation();
  const current = consoleSectionFor(location.pathname);
  const area = consoleAreaFor(current);
  const emailView = current === 'automation' && new URLSearchParams(location.search).get('tab') === 'email';
  const drawerRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const [navigationOpen, setNavigationOpen] = useState(false);

  // Close after browser history navigation as well as clicks inside the drawer.
  useEffect(() => { if (drawerRef.current?.open) drawerRef.current.close(); }, [location.key]);
  useEffect(() => {
    const desktop = window.matchMedia?.('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop?.matches && drawerRef.current?.open) drawerRef.current.close(); };
    desktop?.addEventListener('change', closeOnDesktop);
    return () => desktop?.removeEventListener('change', closeOnDesktop);
  }, []);

  const closeNavigation = () => { if (drawerRef.current?.open) drawerRef.current.close(); };
  const openNavigation = () => {
    drawerRef.current?.showModal();
    setNavigationOpen(true);
  };
  const operations = resolvedSuperAdmin ? operationsHref : undefined;
  const webhooks = resolvedSuperAdmin ? webhooksHref : undefined;
  const administrators = resolvedSuperAdmin ? adminUsersHref : undefined;
  const publishingIssues = resolvedSuperAdmin ? attentionHref : undefined;
  const notifications = automationHref ? `${automationHref.split('?')[0]}?tab=email` : undefined;
  const nav: [ConsoleArea, ConsoleSection, string, string | undefined][] = [
    ['decks', 'decks', 'Decks & publishing', decksHref],
    ['attention', 'attention', 'Needs attention', publishingIssues ?? reportsHref ?? reviewHref],
    ['learners', 'learners', 'App users', resolvedSuperAdmin ? learnersHref : undefined],
    ['usage', 'usage', 'Analytics', usageHref],
    ['system', 'operations', 'System', operations ?? automationHref ?? ledgerHref ?? webhooks ?? administrators],
  ];
  const subnav: [string, string | undefined, boolean][] = area === 'attention' ? [
    ['Publishing issues', publishingIssues, current === 'attention'],
    ['Card feedback', reportsHref, current === 'reports'],
    ['AI draft review', reviewHref, current === 'review'],
  ] : area === 'system' ? [
    ['Operations', operations, current === 'operations'],
    ['Notifications', notifications, emailView],
    ['Automation', automationHref, !emailView && (current === 'automation' || current === 'ledger')],
    ['Integrations', webhooks, current === 'webhooks'],
    ['Administrators & permissions', administrators, current === 'adminUsers'],
  ] : [];
  const areaLabel = nav.find(([id, , , href]) => id === area && href)?.[2];
  const pageLabel = subtitle ?? subnav.find(([, href, active]) => href && active)?.[0] ?? areaLabel ?? title;
  const secondary = subnav.filter(([, href]) => href);

  const navigation = (
    <nav aria-label="Console sections" className="console-navigation space-y-1">
      {nav.map(([id, icon, label, href]) => href && (
        <Link key={id} to={href} className={id === area ? NAV_LINK_ACTIVE_CLASS : NAV_LINK_CLASS}
          aria-current={id === area ? (location.pathname + location.search === href ? 'page' : 'location') : undefined} onClick={closeNavigation}>
          <ConsoleIcon name={icon} />
          <span className="min-w-0 flex-1">{label}</span>
        </Link>
      ))}
    </nav>
  );
  const brand = (
    <div className="console-brand">
      <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <ConsoleIcon name="decks" className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-950">DeveloperCards</div>
        <div className="text-xs text-slate-500">Console</div>
      </div>
    </div>
  );

  return (
    <div className="console-shell min-h-screen bg-slate-50 text-slate-900">
      <a className="console-skip-link" href="#console-main">Skip to content</a>
      <aside className="console-sidebar" aria-label={title} aria-hidden={navigationOpen || undefined}>
        {brand}
        {navigation}
      </aside>

      <dialog
        id={drawerId}
        ref={drawerRef}
        className="console-drawer"
        aria-label="Console navigation"
        onCancel={event => { event.preventDefault(); closeNavigation(); }}
        onClose={() => { setNavigationOpen(false); triggerRef.current?.focus(); }}
        onClick={event => { if (event.target === event.currentTarget) closeNavigation(); }}
      >
        <div className="flex h-full flex-col bg-slate-50">
          <div className="flex items-center justify-between pr-4">
            {brand}
            <Button variant="ghost" className="min-h-11 min-w-11 p-2" aria-label="Close navigation" onClick={closeNavigation}>
              <ConsoleIcon name="close" />
            </Button>
          </div>
          {navigation}
        </div>
      </dialog>

      <div className="console-workspace">
        <header className="console-topbar">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button ref={triggerRef} variant="ghost" className="console-menu-button min-h-11 min-w-11 p-2" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls={drawerId} onClick={openNavigation}>
              <ConsoleIcon name="menu" />
            </Button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {areaLabel && areaLabel !== pageLabel && <><div className="hidden shrink-0 text-slate-500 sm:block">{areaLabel}</div><ConsoleIcon name="chevron" className="hidden h-3 w-3 shrink-0 text-slate-400 sm:block" /></>}
                <div className="truncate font-semibold text-slate-900">{pageLabel}</div>
              </div>
            </div>
          </div>
          <div className="console-account">
            <span className="console-account-label text-xs text-slate-600" title={resolvedUserLabel}>{resolvedUserLabel}</span>
            <Button variant="outline" size="sm" className="min-h-11 shrink-0 gap-2" onClick={signOut}>
              <ConsoleIcon name="signOut" className="h-4 w-4" />Sign out
            </Button>
          </div>
        </header>
        <main id="console-main" tabIndex={-1} className="console-main space-y-4">
          {secondary.length > 1 && <nav aria-label={`${areaLabel} pages`} className="flex flex-wrap gap-1 border-b border-slate-200">
            {secondary.map(([label, href, active]) => <Link key={label} to={href!} aria-current={active ? (current === 'ledger' ? 'location' : 'page') : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${active ? 'border-indigo-600 text-indigo-800' : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}>
              {label}
            </Link>)}
          </nav>}
          {children}
        </main>
      </div>
    </div>
  );
}
