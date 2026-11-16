import type { LearnerDetail } from '../api/consoleOperations';
import { formatTime } from './consoleOperationsView';

export const learnerTime = (value: string | null | undefined) => value ? formatTime(value) : '暂无记录';
export const learnerNumber = (value: number | null) => value === null ? '暂无法确认' : value.toLocaleString('zh-CN');
export const entitlementSource = (source: LearnerDetail['entitlements']['effective']['entitlementsSource']) => ({ revenuecat: '订阅服务 RevenueCat', legacy: '历史授权', none: '无付费权益记录', unknown: '暂无法确认' })[source];
export const downloadDecision = (reason: LearnerDetail['entitlements']['effective']['downloadReason']) => ({ active_rc: '当前订阅允许下载付费卡组', inactive_or_absent_rc: '暂无有效订阅下载授权', sandbox_disallowed: '测试环境权益不允许下载付费卡组', source_unavailable: '订阅来源不可用，暂无法确认下载权限' })[reason];
