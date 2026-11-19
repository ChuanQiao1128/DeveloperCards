# 五卡内容发布状态与恢复

实体为一个owner下固定releaseId的Console session；import/review/publish各有唯一逻辑动作。服务端job状态与浏览器“已核验公开内容”分别记录。

| 状态 | 持久含义 |
| --- | --- |
| Prepared | v2包和原库存基线冻结，尚无Console动作 |
| Captured | 完整原始backup/inventory/bundle及owner已存IDB |
| Frozen/unknown | 固定actionId/原payload已保存；提交结果未知 |
| Confirmed | 本次挂载已验证成功响应或原动作查询 |
| Unreconciled | 恢复/刷新后的历史结果，不授权后续写入 |
| Queried/not-found | 原动作查询不存在，只允许相同正文重放 |
| Awaiting delivery | 原publish已确认，job/index/CDN未全部闭合 |
| Verified | 原job成功、索引已投递、live及公网manifest/真实字节/逐卡全部一致 |
| Finalized | 本地冻结四文件通过真实Console解析及全卡校验，可作下批baseline |

事件：用户载入/恢复包、Run、服务器成功/失败、原动作查询、重放、job状态变化、CDN核验、选目录、finalize。

| 从 | 事件 | 到 | 副作用或拒绝 |
| --- | --- | --- | --- |
| Prepared | Capture | Captured | v2基线必须匹配；保存完整backup后才写 |
| Captured/Confirmed | 准备下一动作 | Frozen/unknown | 先持久化；review需import确认，publish需review与同快照 |
| Frozen/unknown | 成功响应 | Confirmed | 验证scope、snapshot、receipt/job |
| Frozen/unknown | 超时/503 | Frozen/unknown | 原key/正文不变；先查询 |
| 任意保存态 | 刷新/恢复 | Unreconciled | 清除本次确认标志，保留历史结果与原字节 |
| Unreconciled/unknown | 查询已提交 | Confirmed | 核对原结果，不另建job |
| Unreconciled/unknown | ACTION_NOT_FOUND | Queried/not-found | 清旧result，仅允许依赖已确认的相同请求重放 |
| Queried/not-found | 原请求重放 | Frozen/unknown | CAS及owner检查后发送 |
| publish Confirmed | 继续监测 | Awaiting delivery | 遵守原job lease/退避/尝试上限 |
| Awaiting delivery | CDN全部验证通过 | Verified | 保存proof与实际下载字节 |
| Unreconciled且有proof | 原动作与job确认 | Verified | 核对当前job/build/live及缓存字节；完整匹配则不再下载 |
| Verified | 换目录/导出 | Verified | 保存同bundle、journal确认时间、proof和原CDN字节 |
| Verified | finalize | Finalized | 冻结4文件后验证；零网络/模型调用，同字节幂等 |

不变量：owner和实际bearer必须一致；baseline/live、bundle、logical key、payload不可重基或替换；全量UID/顺序/hash/schema/revision/双语绑定保持；过期凭证不授权新写入。已完成历史收尾可接受已过期原凭证，但必须有完整匹配的完成journal，不能据此重新发布。所有恢复动作先查询；job SUCCESS单独不构成公开交付成功。

非法转移：v1新capture、基线变化后导入、未确认import就review、未确认review就publish、未查询就重放、换key绕过错误、异主或截断备份、失配receipt/proof/字节、旧标签覆盖新journal、不同收尾结果覆盖旧归档。全部停止，保留原记录。

持久化：owner scoped IDB journal CAS；proof/原字节绑定owner/release/canonical bundle；支持时owner Web Lock跨CAS及目录写入。四文件逐个原生提交，非整组事务，partial结果由finalize拒绝。完成目录按owner/release哈希命名；外部目录句柄需浏览器持续授权，缺能力时使用单文件导出。finalize临时冻结原字节，逐文件原子禁止覆盖写入。

回归清单：正常3动作；基线变化；超时/503/队列未知；重复与非法事件；刷新/上传恢复；ACTION_NOT_FOUND原字节重放；身份切换；存储失败；多标签CAS/保存锁；缓存字节失配；确认时间不同；完成换目录；导出→finalize；篡改/部分文件；相同结果幂等及源文件并发变化。单元测试与真实浏览器合成API演练分别记录，不充当生产或语义审查证明。

## 控制台状态与操作（2026-11-19）

| 当前证据 | 页面提示 | 允许操作 |
| --- | --- | --- |
| 超时、查询失败、响应不完整或恢复后未查询 | Publication result not confirmed | 查询原动作；撤下历史成功与重放入口 |
| 原动作不存在 | 同一保存请求尚未提交 | 查询；依赖确认后发送原字节 |
| PENDING / PROCESSING 或 lease / backoff 未到期 | 等待队列、构建或下一次重试时间 | 查询；不重复创建发布 |
| 队列 / 索引 pending 且已到重试时间 | 继续原任务投递 | 查询后继续原 actionId / payload |
| FAILED 或投递 needs_attention | 发布失败或投递重试耗尽 | 查询与查看错误；不显示无效重试按钮 |
| SUCCESS 但 live build 已变 | Live version changed | 查询，先核对当前版本 |
| SUCCESS、索引 delivered、未完成公开字节核验 | Public verification incomplete | 查询；Verify public cards |
| 当前原任务、live、公开内容完全一致 | Published and verified | 导出核验文件；开始下一批 |

`Verify public cards` 仅查询原 publish 动作、读取公开 manifest / 下载字节并保存本地证明；不调用 import、review 或 publish 写接口。新一轮查询开始即撤下内存成功凭证，失败不沿用旧成功状态。完整备份、原请求和恢复日志保留。此处未新增后台重建、CDN 核验任务或定时扫库。

验证：41项相关测试、全前端1980项测试、生产构建通过；独立复核仅核对 legacy PENDING 重放与异常查询恢复修正。实际组件在桌面及390px宽度下用合成任务核验，不注入生产失败，不发布卡片。沿用控制台既有 indigo 链接配色；静态 detector 的既有配色提示不作为本轮故障。
