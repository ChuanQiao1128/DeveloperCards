import { useId, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConsoleReadError } from '../api/consoleOperations';
import { useConsoleIdentity } from '../hooks/useConsoleIdentity';
import { useLearner } from '../hooks/useConsoleOperations';
import { ConsolePage, Fields } from '../components/console/OperationsViews';
import { CopyUserId, LearnerLoading, LearnerReadError, MembershipBadge } from '../components/console/LearnerViews';
import { downloadDecision, entitlementSource, learnerNumber as number, learnerTime as time } from '../lib/learnerView';
import { HEADING, LINK, PANEL } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';

const TABS = ['账号概览', '会员权益', '学习情况'] as const;

export function LearnerDetailPage() {
  const identity = useConsoleIdentity();
  const { sub = '' } = useParams();
  return <LearnerProfile key={`${identity.generation}:${sub}`} sub={sub} />;
}

function LearnerProfile({ sub }: { sub: string }) {
  const [tab, setTab] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const tabId = useId();
  const query = useLearner(sub, cursors.at(-1));
  const data = query.error instanceof ConsoleReadError && ['NOT_FOUND', 'FORBIDDEN'].includes(query.error.code) ? undefined : query.data;
  const effective = data?.entitlements.effective;
  const rc = data?.entitlements.revenueCat;

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(next);
    document.getElementById(`${tabId}-tab-${next}`)?.focus();
  }

  return <ConsolePage title="用户详情">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link className={LINK} to="/learners">返回用户列表</Link><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '正在刷新…' : '刷新用户资料'}</Button></div>
    {query.isPending && <LearnerLoading />}
    {query.error && <div className="space-y-3"><LearnerReadError error={query.error} historical={!!data} /><Button variant="outline" onClick={() => void query.refetch()}>重试</Button></div>}
    {data && effective && rc && <>
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 space-y-5" aria-label="用户资料摘要">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 break-all text-xl font-semibold text-slate-900">{data.learner.email ?? '未记录邮箱'}</h2><MembershipBadge entitlements={data.entitlements} /></div>
        <CopyUserId sub={data.learner.sub} />
        <div className="border-t border-slate-100 pt-4"><Fields items={[
          ['首次连接', time(data.learner.firstObservedAt)], ['最近连接', time(data.learner.lastServerActivityAt)], ['资料读取时间', time(data.fetchedAt)],
        ]} /></div>
      </section>
      <div role="tablist" aria-label="用户详情分类" className="flex gap-2 border-b border-slate-200">
        {TABS.map((label, index) => <button key={label} type="button" role="tab" id={`${tabId}-tab-${index}`} aria-selected={tab === index} aria-controls={tab === index ? `${tabId}-panel` : undefined} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => moveTab(event, index)} className={`rounded-t px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${tab === index ? 'border-b-2 border-indigo-600 text-indigo-800 bg-indigo-50' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-tab-${tab}`} tabIndex={0} className="space-y-5 rounded focus-visible:outline-indigo-500">
        {tab === 0 && <>
          <section className={PANEL}><h2 className={HEADING}>账号资料</h2><Fields items={[
            ['邮箱', data.learner.email ?? '未记录邮箱'], ['最近上报的平台', data.learner.lastReportedPlatform ?? '未上报'], ['最近上报的 App 版本', data.learner.lastReportedVersion ?? '未上报'],
          ]} /><p className="text-sm leading-6 text-slate-600">这里展示 App 已上报的资料。登录状态、邮箱验证状态和当前设备版本尚未接入，不能通过连接时间推断。</p></section>
          <section className={PANEL}><h2 className={HEADING}>当前权益</h2><MembershipBadge entitlements={data.entitlements} /><p className="text-sm text-slate-700">{downloadDecision(effective.downloadReason)}</p><p className="text-sm text-slate-600">权益来源：{entitlementSource(effective.entitlementsSource)}</p><Button variant="outline" size="sm" onClick={() => { setTab(1); document.getElementById(`${tabId}-tab-1`)?.focus(); }}>查看会员权益</Button></section>
          <p className="max-w-prose text-sm leading-6 text-slate-600">首次连接是后端建档时间，最近连接是服务端活动时间。它们不等于注册、登录或完整同步时间。所有时间使用 UTC。</p>
        </>}
        {tab === 1 && <>
          {data.entitlements.state !== 'known' && <Callout tone="warning" title="部分权益资料暂无法确认">当前来源未全部返回，未知项不会当作免费用户或无权益处理。</Callout>}
          <section className={PANEL}><h2 className={HEADING}>会员权益</h2><MembershipBadge entitlements={data.entitlements} /><Fields items={[
            ['权益来源', entitlementSource(effective.entitlementsSource)], ['付费卡组下载', effective.premiumDownloadEligible === null ? '暂无法确认' : effective.premiumDownloadEligible ? '允许' : '不允许'], ['权益评估时间', time(data.entitlements.evaluatedAt)],
          ]} /><p className="text-sm leading-6 text-slate-700">{downloadDecision(effective.downloadReason)}</p><p className="text-sm leading-6 text-slate-600">会员权益和付费卡组下载权限分别判断。历史授权可能提供 Premium 权益，下载仍受当前订阅及测试环境规则限制；这些记录不能代替付款凭证。</p></section>
          <section className={PANEL}><h2 className={HEADING}>订阅记录</h2>{rc.state === 'absent' ? <p className="text-sm text-slate-600">暂无订阅服务记录。</p> : rc.state === 'unknown' ? <p className="text-sm text-slate-600">暂时无法读取订阅服务记录。</p> : <Fields items={[
            ['来源', 'RevenueCat'], ['环境', rc.environment === 'production' ? '正式环境' : rc.environment === 'sandbox' ? '测试环境' : '未记录'], ['订阅产品', rc.productId ?? '未记录'], ['订阅到期时间', rc.expiresAtMs === null ? '未提供到期时间' : time(new Date(rc.expiresAtMs).toISOString())], ['记录更新时间', time(rc.updatedAt)], ['最近订阅事件时间', rc.lastEventAtMs === null ? '暂无记录' : time(new Date(rc.lastEventAtMs).toISOString())],
          ]} />}</section>
          <details className={PANEL}><summary className="cursor-pointer rounded font-medium text-slate-900 focus-visible:outline-indigo-500">高级排查：原始订阅与历史授权</summary><Fields items={[
            ['订阅原始有效标记', rc.premiumActiveRaw === null ? '暂无法确认' : rc.premiumActiveRaw ? '是' : '否'], ['禁止测试权益下载', effective.disallowSandboxPremium ? '是' : '否'], ['开发环境放行', '未评估'],
          ]} /><p className="text-sm text-slate-600">原始有效标记还需结合到期时间和测试环境规则判断。</p><h3 className="font-medium text-slate-900">历史授权记录</h3>
            {data.entitlements.legacy.state === 'unknown' ? <p className="text-sm text-slate-600">历史授权来源暂不可用。</p> : data.entitlements.legacy.items.length === 0 ? <p className="text-sm text-slate-600">暂无历史授权。</p> : <ul className="divide-y divide-slate-200">{data.entitlements.legacy.items.map((grant, index) => <li key={`${grant.key}:${index}`} className="py-3 text-sm space-y-1 break-words"><p className="font-medium">{grant.key} · {grant.tier}</p><p>来源：{grant.source} · 到期：{grant.expiresAt ? time(grant.expiresAt) : '未设置'}</p><p className="text-slate-600">更新：{time(grant.updatedAt)}</p></li>)}</ul>}
            {data.entitlements.legacy.truncated && <p className="text-sm text-slate-600">仅展示前 100 条历史记录，当前权益按完整数据单独计算。</p>}
          </details>
        </>}
        {tab === 2 && <>
          <section className={PANEL}><h2 className={HEADING}>已同步的学习记录</h2>{data.progress.state === 'unknown' && <Callout tone="warning" title="学习数据暂不可用">请稍后刷新，当前无法判断该用户是否有学习记录。</Callout>}<Fields items={[
            ['有进度的卡片', number(data.progress.projectedCardCount)], ['累计复习次数', number(data.progress.projectedReviewCount)], ['最近收到学习记录', time(data.progress.latestReceivedAt)],
          ]} /><p className="text-sm leading-6 text-slate-600">仅显示服务器已收到的记录。尚在设备上的离线学习可能未包含在内，复习次数不代表已掌握知识。</p></section>
          <section className={PANEL}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className={HEADING}>按卡组查看</h2><span className="text-sm text-slate-600">第 {cursors.length} 页</span></div>
            {data.progress.decks.length === 0 ? <div className="py-8 text-center text-sm text-slate-600">{data.progress.state === 'unknown' ? '暂时无法读取卡组进度。' : '暂无已同步的卡组进度。'}</div> : <ul className="divide-y divide-slate-200">{data.progress.decks.map(deck => <li className="py-4 space-y-3" key={deck.deckSlug}><h3 className="break-words font-medium text-slate-900">{deck.deckSlug}</h3><Fields items={[
              ['有进度的卡片', number(deck.projectedCardCount)], ['累计复习次数', number(deck.projectedReviewCount)], ['最近收到记录', time(deck.latestReceivedAt)],
            ]} /></li>)}</ul>}
            <div className="flex flex-wrap gap-3"><Button size="sm" variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>上一组</Button><Button size="sm" variant="outline" disabled={!data.progress.nextDeckCursor || query.isFetching} onClick={() => setCursors(current => [...current, data.progress.nextDeckCursor!])}>下一组</Button></div>
          </section>
          <details className={PANEL}><summary className="cursor-pointer rounded font-medium text-slate-900 focus-visible:outline-indigo-500">高级排查：同步与设备状态</summary><Fields items={[
            ['收到的去重事件数', number(data.progress.uniqueReceivedEventCount)], ['最近客户端事件时间', time(data.progress.latestEventAt)], ['最近服务端接收时间', time(data.progress.latestReceivedAt)], ['设备待同步队列', '未接入'], ['设备待同步事件数', '未接入'], ['最近完整同步时间', '未接入'], ['设备正在运行的 OTA 版本', '未接入'],
          ]} /><p className="text-sm leading-6 text-slate-600">事件按唯一 ID 去重，与累计复习次数分别计算。服务器收到记录不能证明设备已完成全部同步。</p></details>
        </>}
      </div>
    </>}
  </ConsolePage>;
}
