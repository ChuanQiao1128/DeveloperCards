import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserScopedKey } from '../../../review/storage';
import type { CardProgress } from '../../../review/model';
import type { ReviewRating } from '../../../review/model';
import type { OwnedGate } from '../contracts';
import type { McqRunState } from '../mcq/mcqRotation';
import type { useSessionStore } from './sessionStore';

type SessionState = ReturnType<typeof useSessionStore.getState>;
export type McqCheckpoint = {
  stage: 'stem' | 'options' | 'verdict';
  picks: string[];
  firstPicks: string[] | null;
  changedPick: boolean;
  confidence: 'sure' | 'unsure' | null;
  verdict: 'correct' | 'partial' | 'wrong' | null;
  mappedRating: ReviewRating | null;
  scheduleLine: string | null;
  attemptIndex: number;
  responseElapsedMs: number;
};
export type SessionCheckpoint = {
  v: 1;
  dateKey: string;
  deckVersion: string;
  context: string;
  progressStamp: string;
  currentUid: string;
  showAnswer: boolean;
  limit: number;
  minimumGoal: number;
  focusRatedUids: string[];
  attempts: [string, number][];
  mcqRun: McqRunState;
  picks: { landed: number; answered: number };
  loadForecast: string | null;
  mcq: McqCheckpoint | null;
  session: Pick<SessionState, 'sessionId' | 'slug' | 'route' | 'currentIndex' | 'completedCount' |
    'streakEarned' | 'sessionRatings' | 'startedAt' | 'rewardOutcome'>;
};

const PREFIX = 'recallsmith:session-checkpoint:v1:';
const writes = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = writes.get(key) ?? Promise.resolve();
  const run = previous.then(action, action);
  writes.set(key, run);
  try { return await run; }
  finally { if (writes.get(key) === run) writes.delete(key); }
}

export function checkpointDate(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Compare every scheduler field and the current ownership gate before resuming. */
export function checkpointProgressStamp(progress: CardProgress[], owned: OwnedGate): string {
  return JSON.stringify({
    progress: [...progress].sort((a, b) => a.stableUid.localeCompare(b.stableUid))
      .map(row => Object.keys(row).sort().map(key => [key, (row as any)[key]])),
    owned: owned === null ? null : [...owned].sort(),
  });
}

function valid(raw: any): raw is SessionCheckpoint {
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1000;
  const text = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 1000;
  const strings = (a: unknown) => Array.isArray(a) && a.length <= 1000 && a.every(text);
  const wallet = (w: any) => w === null || (!!w && count(w.availablePulls) && count(w.reservePulls));
  const s = raw?.session;
  const r = s?.rewardOutcome;
  const m = raw?.mcq;
  const optionKeys = (a: any) => Array.isArray(a) && a.length <= 6 && new Set(a).size === a.length &&
    a.every((key: unknown) => typeof key === 'string' && /^[a-f]$/.test(key));
  const validMcq = m === null || (!!m && ['stem', 'options', 'verdict'].includes(m.stage) &&
    optionKeys(m.picks) && (m.firstPicks === null || optionKeys(m.firstPicks)) &&
    typeof m.changedPick === 'boolean' && count(m.attemptIndex) &&
    Number.isFinite(m.responseElapsedMs) && m.responseElapsedMs >= 0 && m.responseElapsedMs <= 86400000 &&
    (m.stage === 'verdict'
      ? ['sure', 'unsure'].includes(m.confidence) && ['correct', 'partial', 'wrong'].includes(m.verdict) &&
        ['again', 'hard', 'good', 'easy'].includes(m.mappedRating) && text(m.scheduleLine)
      : m.confidence === null && m.verdict === null && m.mappedRating === null && m.scheduleLine === null));
  return raw?.v === 1 && text(raw.dateKey) && text(raw.deckVersion) && typeof raw.context === 'string' && raw.context.length <= 16000 &&
    typeof raw.progressStamp === 'string' && raw.progressStamp.length <= 800000 && text(raw.currentUid) &&
    typeof raw.showAnswer === 'boolean' && count(raw.limit) && raw.limit > 0 && count(raw.minimumGoal) &&
    strings(raw.focusRatedUids) && Array.isArray(raw.attempts) && raw.attempts.length <= 1000 &&
    raw.attempts.every((a: any) => Array.isArray(a) && a.length === 2 && text(a[0]) && count(a[1])) &&
    count(raw.mcqRun?.served) && [null, 'mcq', 'qa'].includes(raw.mcqRun?.lastNewKind) &&
    count(raw.picks?.landed) && count(raw.picks?.answered) && raw.picks.landed <= raw.picks.answered &&
    validMcq && (raw.loadForecast === null || text(raw.loadForecast)) && text(s?.sessionId) && text(s?.slug) &&
    Number.isFinite(s.startedAt) && s.startedAt > 0 && typeof s.streakEarned === 'boolean' &&
    count(s.completedCount) && s.completedCount < raw.limit && s.currentIndex === s.completedCount &&
    Array.isArray(s.route) && s.route.length === raw.limit &&
    s.route.every((n: any) => n && text(n.id) && text(n.role) && typeof n.title === 'string' && typeof n.subtitle === 'string') &&
    Array.isArray(s.sessionRatings) && s.sessionRatings.length === s.completedCount &&
    s.sessionRatings.every((rating: any) => text(rating.stableUid) && ['again', 'hard', 'good', 'easy'].includes(rating.rating)) &&
    !!r && count(r.newCardPulls) && strings(r.newCardUids) && r.newCardUids.length === r.newCardPulls &&
    [0, 1].includes(r.dueClearPulls) && r.rewardPulls === r.newCardPulls + r.dueClearPulls &&
    count(r.applied) && count(r.dropped) && wallet(r.walletBefore) && wallet(r.walletAfter);
}

export async function saveSessionCheckpoint(sub: string, slug: string, checkpoint: SessionCheckpoint): Promise<void> {
  if (!valid(checkpoint) || checkpoint.session.slug !== slug) throw new Error('Invalid study position');
  const key = await getUserScopedKey(PREFIX + slug, sub);
  await serialized(key, () => AsyncStorage.setItem(key, JSON.stringify(checkpoint)));
}

export async function loadSessionCheckpoint(sub: string, slug: string, expected: {
  deckVersion: string; context: string; progressStamp: string;
}): Promise<SessionCheckpoint | null> {
  const key = await getUserScopedKey(PREFIX + slug, sub);
  return serialized(key, async () => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw || raw.length > 1000000) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!valid(value) || value.session.slug !== slug || value.dateKey !== checkpointDate() ||
      value.deckVersion !== expected.deckVersion || value.context !== expected.context ||
      value.progressStamp !== expected.progressStamp) return null;
    return value;
  });
}

export async function clearSessionCheckpoint(sub: string, slug: string): Promise<void> {
  const key = await getUserScopedKey(PREFIX + slug, sub);
  await serialized(key, () => AsyncStorage.removeItem(key));
}
