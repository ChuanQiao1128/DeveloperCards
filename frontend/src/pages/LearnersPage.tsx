import { useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useLearners } from '../hooks/useConsoleOperations';
import { ConsolePage } from '../components/console/OperationsViews';
import { LearnerLoading, LearnerReadError } from '../components/console/LearnerViews';
import { learnerTime as time } from '../lib/learnerView';
import { INPUT, LINK } from '../lib/consoleOperationsView';
import { Button } from '../components/ui/Button';
import type { DirectoryContext } from './LearnerWorkspace';

export function LearnersPage() {
  const { directory, setDirectory } = useOutletContext<DirectoryContext>();
  const [validation, setValidation] = useState<string | null>(null);
  const query = useLearners(directory.query, directory.cursors.at(-1));
  const data = query.data;

  function search(event: FormEvent) {
    event.preventDefault();
    const value = directory.draft.trim();
    if (value.length > 128 || Array.from(directory.draft).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      setValidation('请输入不超过 128 个字符的邮箱或用户 ID，不要包含换行等控制字符。');
      return;
    }
    setValidation(null);
    if (value === directory.query && directory.cursors.length === 1) void query.refetch();
    else setDirectory(current => ({ ...current, query: value, cursors: [undefined] }));
  }

  return <ConsolePage title="用户管理">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="max-w-prose text-sm leading-6 text-slate-600">查找使用 App 的用户，查看账号资料、会员权益和已同步的学习记录。</p>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '正在刷新…' : '刷新列表'}</Button>
    </div>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="用户列表">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 sm:p-6">
        <div className="w-full sm:max-w-md">
          <label htmlFor="learner-search" className="mb-2 block text-sm font-medium text-slate-900">搜索用户</label>
          <input id="learner-search" type="search" className={INPUT} value={directory.draft} placeholder="输入邮箱或用户 ID" onChange={event => setDirectory(current => ({ ...current, draft: event.target.value }))} aria-invalid={!!validation} aria-describedby={validation ? 'learner-search-error' : undefined} autoComplete="off" spellCheck={false} />
          {validation && <p id="learner-search-error" role="alert" className="mt-2 text-sm text-red-700">{validation}</p>}
        </div>
        <Button type="submit" disabled={query.isFetching}>搜索</Button>
        {(directory.draft || directory.query) && <Button variant="ghost" disabled={query.isFetching} onClick={() => { setValidation(null); setDirectory({ draft: '', query: '', cursors: [undefined] }); }}>清除搜索</Button>}
      </form>

      {query.isPending && <LearnerLoading />}
      {query.error && <div className="p-6 space-y-3"><LearnerReadError error={query.error} /><Button variant="outline" onClick={() => void query.refetch()}>重试</Button></div>}
      {data && !query.error && <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6 text-sm text-slate-600" aria-live="polite"><p>本页 {data.items.length} 位用户{directory.query ? ' · 已应用搜索条件' : ''}</p><p>第 {directory.cursors.length} 页</p></div>
        {data.items.length === 0 ? <div className="space-y-2 px-6 py-12 text-center"><h2 className="font-semibold text-slate-900">{directory.query ? '未找到匹配的用户' : '还没有用户连接记录'}</h2><p className="text-sm text-slate-600">{directory.query ? '检查邮箱或用户 ID，也可以清除搜索条件后重试。' : '用户登录 App 并连接服务后，会出现在这里。'}</p></div>
          : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="sr-only">已连接 App 的用户，按用户 ID 排列</caption>
            <thead className="bg-slate-50 text-slate-600"><tr><th scope="col" className="px-4 py-3 sm:px-6 font-medium">用户</th><th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">首次连接</th><th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">最近连接</th><th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">最近上报的 App</th><th scope="col" className="px-4 py-3 sm:px-6 font-medium text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.items.map(learner => <tr key={learner.sub} className="align-top hover:bg-slate-50">
              <td className="max-w-xs px-4 py-4 sm:px-6"><Link className={`${LINK} break-all font-medium`} to={`/learners/${encodeURIComponent(learner.sub)}`}>{learner.email ?? '未记录邮箱'}</Link><p className="mt-1 break-all font-mono text-xs text-slate-500">{learner.sub}</p><p className="mt-2 text-xs text-slate-600 md:hidden">最近连接：{time(learner.lastServerActivityAt)}</p></td>
              <td className="hidden px-4 py-4 text-slate-600 tabular-nums xl:table-cell">{time(learner.firstObservedAt)}</td>
              <td className="hidden px-4 py-4 text-slate-600 tabular-nums md:table-cell">{time(learner.lastServerActivityAt)}</td>
              <td className="hidden px-4 py-4 text-slate-600 lg:table-cell">{learner.lastReportedPlatform ?? '未上报'}<span className="mt-1 block text-xs">{learner.lastReportedVersion ?? '版本未上报'}</span></td>
              <td className="px-4 py-4 sm:px-6 text-right"><Link className={`${LINK} inline-block whitespace-nowrap py-1`} aria-label={`查看 ${learner.email ?? learner.sub} 的详情`} to={`/learners/${encodeURIComponent(learner.sub)}`}>查看详情</Link></td>
            </tr>)}</tbody>
          </table></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-4 sm:px-6">
          <p className="text-xs text-slate-600">每页最多 25 位 · 按用户 ID 排序</p>
          <div className="flex gap-3"><Button size="sm" variant="outline" disabled={directory.cursors.length === 1 || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: current.cursors.slice(0, -1) }))}>上一页</Button><Button size="sm" variant="outline" disabled={!data.nextCursor || query.isFetching} onClick={() => setDirectory(current => ({ ...current, cursors: [...current.cursors, data.nextCursor!] }))}>下一页</Button></div>
        </div>
      </>}
    </section>
    <details className="text-sm text-slate-600"><summary className="cursor-pointer rounded py-2 focus-visible:outline-indigo-500">用户范围与时间说明</summary><p className="mt-2 max-w-prose leading-6">这里只显示后端已记录的用户，不是全部注册账号。首次连接为后端建档时间，最近连接为服务端活动时间，均不代表登录或完整同步时间。所有时间使用 UTC。</p>{data && <p className="mt-2">数据读取：{time(data.fetchedAt)} · 本次分页截止：{time(data.asOf)}。分页期间新建的用户不纳入本次列表，资料变更和删除仍可能影响结果。</p>}</details>
  </ConsolePage>;
}
