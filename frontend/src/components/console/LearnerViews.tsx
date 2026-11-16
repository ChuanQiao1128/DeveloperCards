import { useState } from 'react';
import { ConsoleReadError, type LearnerDetail } from '../../api/consoleOperations';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';

export function LearnerReadError({ error, historical = false }: { error: unknown; historical?: boolean }) {
  const failure = error instanceof ConsoleReadError ? error : new ConsoleReadError('READ_FAILED');
  const message = failure.code === 'NOT_FOUND' ? '该用户已不在当前用户列表中。'
    : failure.code === 'FORBIDDEN' ? '当前账号没有查看用户的权限。'
      : failure.code === 'VALIDATION_ERROR' ? '查询条件已失效，请返回列表重新查询。' : '暂时无法读取用户数据，请重试。';
  return <Callout tone="danger" role="alert" title="用户数据加载失败">
    {message}{historical && ' 下方保留的是上次读取结果，当前情况暂无法确认。'}
    {failure.traceId && <span className="block mt-1">排查编号：{failure.traceId}</span>}
  </Callout>;
}

export function LearnerLoading() {
  return <div role="status" aria-label="正在加载用户数据" className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
    <span className="sr-only">正在加载用户数据…</span>
    {[0, 1, 2].map(row => <div key={row} aria-hidden="true" className="h-12 rounded bg-slate-100 motion-safe:animate-pulse" />)}
  </div>;
}

export function CopyUserId({ sub }: { sub: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(sub); setFeedback('用户 ID 已复制'); }
    catch { setFeedback('复制失败，请选择下方用户 ID 手动复制'); }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-600">用户 ID</span><Button size="xs" variant="outline" onClick={() => void copy()}>复制 ID</Button><span role="status" className="text-sm text-slate-600">{feedback}</span></div>
    <p className="select-all break-all font-mono text-xs text-slate-700">{sub}</p>
  </div>;
}

export function MembershipBadge({ entitlements }: { entitlements: LearnerDetail['entitlements'] }) {
  const effective = entitlements.effective;
  const label = effective.entitlementsTier === 'unknown' ? '权益待确认'
    : effective.entitlementsTier === 'free' ? '免费权益'
      : effective.entitlementsSource === 'revenuecat' && entitlements.revenueCat.environment === 'sandbox' ? 'Premium · 测试环境'
        : effective.entitlementsSource === 'legacy' ? 'Premium · 历史授权' : 'Premium 权益';
  return <span className={`inline-flex rounded px-2 py-1 text-sm font-medium ${effective.entitlementsTier === 'premium' ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{label}</span>;
}

