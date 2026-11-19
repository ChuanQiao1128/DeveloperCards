// Frontend smoke only: the real built UI/browser/CSP with mocked API and unsigned IdP session.
// This does not establish real Cognito, deployed API, provider, or device behavior.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './cspGuard';
import { detail, envelope, learners, membership, operations } from '../support/consoleOperationsFixture';
import type { Page } from '@playwright/test';

async function setup(page: Page, groups = ['super_admin']) {
  const unexpected: string[] = [];
  const reads: string[] = [];
  await page.addInitScript(roleGroups => {
    const claims = { sub: 'mock-console-admin', 'cognito:groups': roleGroups };
    const token = `header.${btoa(JSON.stringify(claims))}.unsigned-fixture`;
    sessionStorage.setItem('devcards:tokens', JSON.stringify({ accessToken: token, idToken: token, expiresAt: Date.now() + 3600000, expiresIn: 3600 }));
  }, groups);
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    reads.push(url.pathname);
    if (url.pathname === '/api/v1/admin/operations/overview') return route.fulfill({ json: envelope({ ...operations, synthetic: { ...operations.synthetic, state: 'stale' } }).data });
    if (url.pathname === '/api/v1/admin/learners') {
      const rows = [...learners.items,
        { ...learners.items[0], sub: 'sandbox-fixture', email: 'maya.patel@example.invalid', membership: { ...membership, environment: 'sandbox', premiumDownloadEligible: false } },
        { ...learners.items[0], sub: 'expired-fixture', email: 'daniel.chen@example.invalid', membership: { ...membership, tier: 'free' as const, status: 'expired' as const, expiresAt: '2026-11-15T04:00:00Z' } },
        { ...learners.items[0], sub: 'grant-fixture', email: 'ava.wilson@example.invalid', membership: { ...membership, source: 'legacy' as const, scope: 'selected_decks' as const, environment: null, expiresAt: null, premiumDownloadEligible: false } },
        { ...learners.items[0], sub: 'unknown-fixture', email: 'unknown@example.invalid', membership: null },
      ];
      const items = url.searchParams.has('query') ? [] : url.searchParams.get('source') === 'sandbox' ? [rows[1]] : rows;
      return route.fulfill({ json: envelope({ ...learners, items }).data });
    }
    if (url.pathname === '/api/v1/admin/learners/observed-1') return route.fulfill({ json: envelope(detail).data });
    unexpected.push(url.pathname);
    return route.fulfill({ status: 500, json: { success: false, data: null, error: { code: 'UNEXPECTED_MOCK_ROUTE' }, traceId: null } });
  });
  return { reads, unexpected };
}

test('mock sources render with safe semantics and a keyboard-operable learner drilldown', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Operational sources' })).toBeVisible();
  await expect(page.getByText('Stale — historical results')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
  await expect(page).toHaveURL(/\/operations$/);
  await expect(page.getByRole('heading', { name: 'Synthetic checks', level: 2 })).toBeVisible();
  expect(fixture.reads.filter(path => path.endsWith('/operations/overview'))).toHaveLength(1);
  await expect(page.getByText(/OK means the alarm is not firing/)).toBeVisible();
  await page.getByRole('link', { name: 'App users', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('user-directory-desktop.png'), fullPage: true });
  const search = page.getByLabel('Search users');
  await search.focus();
  await page.keyboard.type('literal%_@example.invalid');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('No users match this search')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(JSON.stringify(stored)).not.toContain('literal%_');
  await search.fill('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'learner@example.invalid', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/learners\/observed-1$/);
  await expect(page.getByRole('heading', { name: 'Account details' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('user-profile-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Account' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Membership' })).toBeFocused();
  await expect(page.getByText('Sandbox access does not permit premium downloads')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('membership.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('mock learner evidence fits a narrow screen and direct editor routes stay guarded', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/learners/observed-1');
  await expect(page.getByRole('heading', { name: 'Account details' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('learner-narrow.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Learning' }).click();
  await expect(page.getByRole('heading', { name: 'Learning by deck' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Back to users' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('user-directory-narrow.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('membership directory filters reach the server and remain usable at narrow widths', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.goto('/learners');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('Expired', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText('Selected decks', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText('Access unknown', { exact: true }).filter({ visible: true })).toHaveCount(1);
  const request = page.waitForRequest(req => new URL(req.url()).searchParams.get('source') === 'sandbox');
  await page.getByLabel('Membership source').selectOption('sandbox');
  await request;
  await expect(page.getByText('1 users on this page · Filters applied')).toBeVisible();
  await expect(page.getByRole('link', { name: 'maya.patel@example.invalid', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'learner@example.invalid', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByRole('link', { name: 'learner@example.invalid', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('membership-directory-desktop.png'), fullPage: true });
  for (const width of [768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Membership filter')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`membership-directory-${width}.png`), fullPage: true });
  }
  expect(fixture.unexpected).toEqual([]);
});

test('mock editor cannot read the new direct routes or see their navigation', async ({ page }) => {
  const fixture = await setup(page, ['editor']);
  for (const path of ['/overview', '/operations', '/learners', '/learners/observed-1']) {
    await page.goto(path);
    await expect(page.getByText('Super administrator access required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'App users', exact: true })).toHaveCount(0);
  }
  expect(fixture.reads).toEqual([]);
});

test('console shell keeps five desktop areas and traps mobile navigation focus', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Operational sources' })).toBeVisible();
  const sidebar = page.locator('.console-sidebar');
  await expect(sidebar).toBeVisible();
  const bounds = await sidebar.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(248);
  expect(await page.locator('main').evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(248);
  await expect(sidebar.getByRole('link', { name: 'System', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: testInfo.outputPath('commercial-desktop-1440.png'), fullPage: true });

  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(sidebar).toBeHidden();
    const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Console navigation', exact: true });
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const close = drawer.getByRole('button', { name: 'Close navigation', exact: true });
    const last = drawer.getByRole('link', { name: 'System', exact: true });
    await last.focus();
    await page.keyboard.press('Tab');
    // Native dialogs may put focus in browser chrome between the final and
    // first control; the document reports body, never an inert background control.
    const forwardFocus = await drawer.evaluate(node => document.activeElement === document.body ? 'browser' : node.contains(document.activeElement) ? 'dialog' : 'background');
    expect(forwardFocus).not.toBe('background');
    if (forwardFocus === 'browser') await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const backwardFocus = await drawer.evaluate(node => document.activeElement === document.body ? 'browser' : node.contains(document.activeElement) ? 'dialog' : 'background');
    expect(backwardFocus).not.toBe('background');
    if (backwardFocus === 'browser') await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`commercial-navigation-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`commercial-workspace-${width}.png`), fullPage: true });
  }
  expect(fixture.unexpected).toEqual([]);
});

test('publishing issues show verified stages and return to the affected deck at 320 px', async ({ page }, testInfo) => {
  await setup(page);
  const deck = { id: 15, slug: 'aws-saa-fundamentals', title: 'AWS Basics', author: 'Fixture', locale: 'en-US', deckType: 1, version: 1 };
  const index = { jobId: 'index-job', deckId: 15, deckSlug: deck.slug, deckTitle: deck.title,
    deckAvailable: true, status: 'SUCCESS', manifestState: 'needs_attention', createdAt: '2026-11-19T09:10:00Z',
    buildId: 'build-aws-15', manifestError: 'The download index could not be updated.', manifestAttempts: 5 };
  const requestedJobs: string[] = [];
  await page.route('**/api/v1/authoring/publish/jobs', route => route.fulfill({ json: envelope([
    { jobId: 'queued-job', deckId: 42, deckSlug: 'queued-cards', deckTitle: 'Still queued', status: 'PENDING', dispatchExhausted: false },
    { jobId: 'build-job', deckId: 31, deckSlug: 'network-cards', deckTitle: 'Networking', status: 'FAILED', updatedAt: '2026-11-19T09:12:00Z' },
    index,
  ]).data }));
  await page.route('**/api/v1/authoring/publish/status?*', route => {
    const jobId = new URL(route.request().url()).searchParams.get('jobId');
    requestedJobs.push(jobId ?? '');
    return route.fulfill({ json: envelope(index).data });
  });
  await page.route('**/api/v1/authoring/decks?*', route => {
    expect(new URL(route.request().url()).searchParams.get('id')).toBe('15');
    return route.fulfill({ json: envelope([deck]).data });
  });

  await page.setViewportSize({ width: 1440, height: 780 });
  await page.goto('/operations');
  await page.getByRole('link', { name: 'Needs attention', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Publishing issues', level: 1 })).toBeVisible();
  await expect(page.getByText('Build failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Failed · 2026-11-19 09:12:00 UTC')).toBeVisible();
  await expect(page.getByText('Submitted · 2026-11-19 09:10:00 UTC')).toBeVisible();
  await expect(page.getByText('Still queued')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('publishing-issues-desktop.png') });

  await page.setViewportSize({ width: 320, height: 820 });
  const open = page.getByRole('link', { name: 'View publish job for AWS Basics' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'AWS Basics' })).toBeVisible();
  await expect(page.getByText('The download index could not be updated.')).toBeVisible();
  await expect(page.getByText('build-aws-15')).toBeVisible();
  expect(requestedJobs).toEqual(['index-job']);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('publish-job-narrow.png'), fullPage: true });

  await page.getByRole('link', { name: 'Open deck publishing' }).click();
  await expect(page).toHaveURL('/decks/publish?deckId=15');
  await expect(page.getByRole('link', { name: 'Open reviewed release' })).toBeVisible();
});
