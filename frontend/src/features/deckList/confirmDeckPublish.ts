import type { useConfirm } from '../../components/ui/ConfirmDialogContext';
import { qaPageHref, qaPublishPreviewLine } from '../../lib/qaGate';

type ConfirmFn = ReturnType<typeof useConfirm>;

const PUBLISH_BODY = 'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json';
// How long the publish dialog waits for the AI QA preview before it opens
// without it.
const QA_PREVIEW_TIMEOUT_MS = 3000;

/**
 * The AI QA preview for the publish dialog (contract §7.10): GET …/qa/status,
 * summarised in one line. The QA API module is loaded with a dynamic import
 * after the Publish click, so the deck list's first load does not grow; any
 * failure or a slow answer returns null and the dialog opens as before.
 */
async function loadQaPublishPreview(deckId: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), QA_PREVIEW_TIMEOUT_MS);
    });
    const load = import('../../api/qa').then(async ({ fetchQaStatus }) => {
      const res = await fetchQaStatus(deckId);
      return res.success && res.data ? qaPublishPreviewLine(res.data) : null;
    });
    return await Promise.race([load, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function confirmDeckPublish(confirm: ConfirmFn, slug: string, deckId?: number): Promise<boolean> {
  const qaLine = deckId === undefined ? null : await loadQaPublishPreview(deckId);
  return confirm({
    title: `Publish deck "${slug}"?`,
    body: qaLine ? `${PUBLISH_BODY}\n\n${qaLine}` : PUBLISH_BODY,
    confirmLabel: 'Publish',
    ...(qaLine && deckId !== undefined ? { link: { href: qaPageHref(deckId), label: 'Open AI QA' } } : {}),
  });
}
