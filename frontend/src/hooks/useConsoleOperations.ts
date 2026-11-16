import { useQuery } from '@tanstack/react-query';
import { fetchOperations, fetchLearners, fetchLearner } from '../api/consoleOperations';
import { useAppQueryClient } from '../api/queryClient';
import { useConsoleIdentity } from './useConsoleIdentity';

export function useOperations() {
  const identity = useConsoleIdentity();
  return useQuery({ queryKey: ['console-operations', identity.sub, identity.generation], queryFn: ({ signal }) => fetchOperations(signal), enabled: identity.allowed, staleTime: 60_000, gcTime: 60_000, retry: false, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: false }, useAppQueryClient());
}
export function useLearners(query: string, cursor?: string) {
  const identity = useConsoleIdentity();
  return useQuery({ queryKey: ['console-learners', identity.sub, identity.generation, query, cursor], queryFn: ({ signal }) => fetchLearners(query, cursor, signal), enabled: identity.allowed, gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }, useAppQueryClient());
}
export function useLearner(sub: string, deckCursor?: string) {
  const identity = useConsoleIdentity();
  return useQuery({ queryKey: ['console-learner', identity.sub, identity.generation, sub, deckCursor], queryFn: ({ signal }) => fetchLearner(sub, deckCursor, signal), enabled: identity.allowed && !!sub, gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false }, useAppQueryClient());
}
