import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOperations, fetchLearners, fetchLearner, type MembershipFilters, type SourceState } from '../api/consoleOperations';
import { useAppQueryClient } from '../api/queryClient';
import { useConsoleIdentity } from './useConsoleIdentity';

function sampleDeadline(source: SourceState | undefined, receivedAt: number) {
  if (source?.state !== 'fresh' || !source.expiresAt) return Infinity;
  // Use the remaining lifetime measured by the server, anchored to receipt in this browser.
  return receivedAt + Math.max(0, Date.parse(source.expiresAt) - Date.parse(source.fetchedAt));
}

function expiredSample<T extends SourceState>(sample: T): T {
  return { ...sample, state: 'stale', status: 'unknown', reason: 'snapshot_expired' };
}

export function useOperations() {
  const identity = useConsoleIdentity();
  const query = useQuery({
    queryKey: ['console-operations', identity.sub, identity.generation],
    queryFn: ({ signal }) => fetchOperations(signal),
    enabled: identity.allowed,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  }, useAppQueryClient());
  const [clock, setClock] = useState(() => Date.now());
  const { data, dataUpdatedAt } = query;
  const observedAt = Math.max(clock, dataUpdatedAt);
  const syntheticDeadline = sampleDeadline(data?.synthetic, dataUpdatedAt);
  const alarmDeadline = sampleDeadline(data?.alarms, dataUpdatedAt);
  const nextDeadline = Math.min(
    syntheticDeadline > observedAt ? syntheticDeadline : Infinity,
    alarmDeadline > observedAt ? alarmDeadline : Infinity,
  );
  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) return;
    const timeout = window.setTimeout(
      () => setClock(Math.max(Date.now(), nextDeadline)),
      Math.max(0, nextDeadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [nextDeadline]);

  if (!data || (syntheticDeadline > observedAt && alarmDeadline > observedAt)) return query;
  return {
    ...query,
    data: {
      ...data,
      synthetic: syntheticDeadline <= observedAt ? expiredSample(data.synthetic) : data.synthetic,
      alarms: alarmDeadline <= observedAt ? expiredSample(data.alarms) : data.alarms,
    },
  };
}
export function useLearners(query: string, cursor?: string, filters?: MembershipFilters) {
  const identity = useConsoleIdentity();
  return useQuery({ queryKey: ['console-learners', identity.sub, identity.generation, query, cursor, filters], queryFn: ({ signal }) => fetchLearners(query, cursor, signal, filters), enabled: identity.allowed, gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }, useAppQueryClient());
}
export function useLearner(sub: string, deckCursor?: string) {
  const identity = useConsoleIdentity();
  return useQuery({ queryKey: ['console-learner', identity.sub, identity.generation, sub, deckCursor], queryFn: ({ signal }) => fetchLearner(sub, deckCursor, signal), enabled: identity.allowed && !!sub, gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }, useAppQueryClient());
}
