import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './cspGuard';
import { envelope, AT } from '../support/consoleOperationsFixture';

const reported = {
  reportId: 41, deckId: 15, deckSlug: 'aws-basics', cardId: 1203, stableUid: 'aws-0042',
  question: 'Which S3 storage class suits infrequent access?', reason: 'wrong_answer',
  note: 'The card names the wrong storage class.', status: 'open', resolution: null as string | null, resolutionNote: null,
  clientVersion: '2.1.1', createdAt: AT, resolvedAt: null as string | null, anonymous: false,
};
const deck = { id: 15, slug: 'aws-basics', title: 'AWS Basics', locale: 'en-US', deckType: 1, version: 1 };
const card = {
  id: 1203, deckId: 15, stableUid: reported.stableUid, question: reported.question, explanation: 'The original explanation.',
  difficulty: 2, orderInDeck: 1, version: 1, isDeleted: 0,
};

test('card feedback preserves queue filters through a real edit and confirmed resolution', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const token = `header.${btoa(JSON.stringify({ sub: 'feedback-fixture', 'cognito:groups': ['editor'] }))}.unsigned-fixture`;
    sessionStorage.setItem('devcards:tokens', JSON.stringify({ accessToken: token, idToken: token, expiresAt: Date.now() + 3600000, expiresIn: 3600 }));
  });
  let report = { ...reported };
  const requestedReasons: (string | null)[] = [];
  await page.route('**/api/v1/authoring/decks**', route => route.fulfill({ json: envelope([deck]).data }));
  await page.route('**/api/v1/admin/card-reports?*', route => {
    const params = new URL(route.request().url()).searchParams;
    requestedReasons.push(params.get('reason'));
    const items = params.get('status') === report.status &&
      (!params.has('reason') || params.get('reason') === report.reason) ? [report] : [];
    return route.fulfill({ json: envelope({ items, nextCursor: null }).data });
  });
  await page.route('**/api/v1/authoring/cards**', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ id: card.id, expectedVersion: 1, question: 'Which S3 class fits infrequently accessed objects?' });
      report = { ...report, question: body.question };
      return route.fulfill({ json: envelope({ ...card, question: body.question, version: 2 }).data });
    }
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(String(card.id));
    return route.fulfill({ json: envelope([card]).data });
  });
  await page.route('**/api/v1/admin/card-reports/41/resolve', route => {
    expect(route.request().postDataJSON()).toEqual({ resolution: 'fixed' });
    report = { ...report, status: 'resolved', resolution: 'fixed', resolvedAt: AT };
    return route.fulfill({ json: envelope({ reportId: 41, status: 'resolved', resolution: 'fixed' }).data });
  });

  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto('/reports?deckId=15');
  await expect(page.getByText(report.question)).toBeVisible();
  await page.getByLabel('Reason').selectOption('wrong_answer');
  await expect.poll(() => requestedReasons.at(-1)).toBe('wrong_answer');
  const editor = page.getByRole('link', { name: /^Open in editor/ });
  await expect(editor).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('card-feedback-desktop.png') });
  await editor.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Back to Card feedback' })).toHaveAttribute('href', '/reports?deckId=15&reason=wrong_answer');
  await page.getByRole('textbox', { name: /^Question/ }).fill('Which S3 class fits infrequently accessed objects?');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL('/reports?deckId=15&reason=wrong_answer');
  await expect(page.getByText(report.question)).toBeVisible();

  await page.getByRole('button', { name: /^Resolve report/ }).click();
  await page.getByRole('button', { name: 'Save resolution' }).click();
  await expect(page.getByText('No card reports match these filters.')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Report resolved as Fixed.');
  await page.getByLabel('Status').selectOption('resolved');
  await expect(page.getByText('Resolved · Fixed')).toBeVisible();
});
