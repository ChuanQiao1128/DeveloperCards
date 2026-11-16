import { useState, type Dispatch, type SetStateAction } from 'react';
import { Outlet } from 'react-router-dom';
import { useConsoleIdentity } from '../../hooks/useConsoleIdentity';

type Directory = { draft: string; query: string; cursors: (string | undefined)[] };
export type DirectoryContext = { directory: Directory; setDirectory: Dispatch<SetStateAction<Directory>> };

export function LearnerWorkspace() {
  const identity = useConsoleIdentity();
  return <DirectorySession key={identity.generation} />;
}

function DirectorySession() {
  // Keep search and paging across drilldown, only in this identity's mounted workspace.
  const [directory, setDirectory] = useState<Directory>({ draft: '', query: '', cursors: [undefined] });
  return <Outlet context={{ directory, setDirectory } satisfies DirectoryContext} />;
}

