import type { LearnerDetail } from '../api/consoleOperations';
import { formatTime } from './consoleOperationsView';

export const learnerTime = (value: string | null | undefined) => value ? formatTime(value) : 'No record';
export const learnerNumber = (value: number | null) => value === null ? 'Unknown' : value.toLocaleString('en-US');
export const entitlementSource = (source: LearnerDetail['entitlements']['effective']['entitlementsSource']) => ({ revenuecat: 'RevenueCat subscription', legacy: 'Legacy grants', none: 'No premium access record', unknown: 'Unknown' })[source];
export const downloadDecision = (reason: LearnerDetail['entitlements']['effective']['downloadReason']) => ({ active_rc: 'The current subscription permits premium downloads', inactive_or_absent_rc: 'No active subscription for premium downloads', sandbox_disallowed: 'Sandbox access does not permit premium downloads', source_unavailable: 'Subscription source unavailable; download access is unknown' })[reason];
