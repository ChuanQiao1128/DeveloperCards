import { useState, type Dispatch, type SetStateAction } from 'react';
import { Outlet } from 'react-router-dom';
import { DEFAULT_MEMBERSHIP_FILTERS, type MembershipFilters } from '../../api/consoleOperations';
import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';

type Directory = { draft: string; query: string; cursors: (string | undefined)[]; filters: MembershipFilters };
export type DirectoryContext = { directory: Directory; setDirectory: Dispatch<SetStateAction<Directory>> };

export function LearnerWorkspace() {
  const identity = useConsoleIdentity();
  return <DirectorySession key={identity.generation} />;
}

function DirectorySession() {
  // Keep search and paging across drilldown, only in this identity's mounted workspace.
  const [directory, setDirectory] = useState<Directory>({ draft: '', query: '', cursors: [undefined], filters: DEFAULT_MEMBERSHIP_FILTERS });
  return <Outlet context={{ directory, setDirectory } satisfies DirectoryContext} />;
}

