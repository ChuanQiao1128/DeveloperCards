// Frontend smoke only: the real built UI/browser/CSP with mocked API and unsigned IdP session.
// This does not establish real Cognito, deployed API, provider, or device behavior.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './cspGuard';
import { detail, envelope, learners, operations } from '../support/consoleOperationsFixture';
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
    if (url.pathname === '/api/v1/admin/learners') return route.fulfill({ json: envelope(url.searchParams.has('query') ? { ...learners, items: [], nextCursor: null } : learners).data });
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
  await page.getByRole('link', { name: 'Operations: checks, alarms and publishing' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic checks', level: 2 })).toBeVisible();
  expect(fixture.reads.filter(path => path.endsWith('/operations/overview'))).toHaveLength(1);
  await expect(page.getByText(/OK means the alarm is not firing/)).toBeVisible();
  await page.getByRole('link', { name: 'Learners', exact: true }).click();
  const search = page.getByLabel('Search email or subject');
  await search.focus();
  await page.keyboard.type('literal%_@example.invalid');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('No observed learners match this search.')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(JSON.stringify(stored)).not.toContain('literal%_');
  await search.fill('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'learner@example.invalid', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/learners\/observed-1$/);
  await expect(page.getByRole('heading', { name: 'Evaluated access' })).toBeVisible();
  await expect(page.getByText('sandbox disallowed')).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('mock learner evidence fits a narrow screen and direct editor routes stay guarded', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/learners/observed-1');
  await expect(page.getByRole('heading', { name: 'Device state' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('learner-narrow.png'), fullPage: true });
  expect(fixture.unexpected).toEqual([]);
});

test('mock editor cannot read the new direct routes or see their navigation', async ({ page }) => {
  const fixture = await setup(page, ['editor']);
  for (const path of ['/overview', '/operations', '/learners', '/learners/observed-1']) {
    await page.goto(path);
    await expect(page.getByText('Super administrator access required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Learners', exact: true })).toHaveCount(0);
  }
  expect(fixture.reads).toEqual([]);
});

test('commercial shell keeps desktop categories and traps mobile navigation focus', async ({ page }, testInfo) => {
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
  await expect(sidebar.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
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
    const last = drawer.getByRole('link', { name: 'Admin Management', exact: true });
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
    await page.screenshot({ path: testInfo.outputPath(`commercial-navigation-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`commercial-workspace-${width}.png`), fullPage: true });
  }
  expect(fixture.unexpected).toEqual([]);
});
