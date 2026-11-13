import { describe, expect, it } from 'vitest';
import { publishJobStage } from '../src/features/deckList/publishJobStage';

describe('publish delivery stages', () => {
  it('keeps committed builds distinct from manifest delivery', () => {
    expect(publishJobStage({ status: 'SUCCESS', manifestState: 'pending' })).toBe('Build committed · manifest pending');
    expect(publishJobStage({ status: 'SUCCESS', manifestState: 'needs_attention' })).toBe('Build committed · manifest needs attention');
    expect(publishJobStage({ status: 'SUCCESS', manifestState: 'delivered' })).toBe('SUCCESS');
  });
  it('preserves old schema and non-success responses', () => {
    expect(publishJobStage({ status: 'SUCCESS' })).toBe('SUCCESS');
    expect(publishJobStage({ status: 'FAILED', manifestState: 'pending' })).toBe('FAILED');
  });
});
