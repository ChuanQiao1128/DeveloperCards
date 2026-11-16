import { Link } from 'react-router-dom';
import { useOperations } from '../hooks/useConsoleOperations';
import { ConsolePage, OperationsSummary, ReadError } from '../components/console/OperationsViews';
import { LINK, PANEL, HEADING } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';

export function OverviewPage() {
  const query = useOperations();
  return <ConsolePage title="Overview">
    <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm text-slate-600">Read-only operational evidence for the console.</p><Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>Refresh sources</Button></div>
    {query.isPending && <p role="status">Loading operational sources…</p>}
    {query.error && <ReadError error={query.error} historical={!!query.data} />}
    {query.data && <OperationsSummary data={query.data} historical={!!query.error} />}
    <section className={PANEL}><h2 className={HEADING}>Inspect the evidence</h2><p><Link className={LINK} to="/operations">Operations: checks, alarms and publishing</Link></p><p><Link className={LINK} to="/learners">Learners: observed accounts and server records</Link></p><p className="text-sm text-slate-600">Anonymous guards check rejection, not authenticated sync. Device queues, complete sync and current device OTA are unknown.</p></section>
  </ConsolePage>;
}
