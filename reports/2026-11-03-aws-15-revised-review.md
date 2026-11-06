# 15张卡片重写与验收

现有15张双语卡已按AGENTS.md第4节重写并重新验收：1 Easy、10 Rare、4 Legend，15个身份保持不变；这次修订不会累计成24张。旧版本与旧审查保留，旧347张卡未作为正文或模板输入。

[阅读15张双语卡](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-15-revised-cards.md) · [可导入Deck](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-15-revised.deck.md) · [可导入JSON](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-15-revised-cards.json)

每张卡保留一个有用判断，正面给出决定条件，背面解释机制与真正会混淆的边界。较宽的恢复题收窄为快照到文件可访问的链路；跨账户EFS卡使用已有官方依据的EC2场景，未将其推断为原生Lambda跨账户挂载可行。Legend按前置基础组合必要步骤。

| 验收 | 结果 |
| --- | --- |
| 官方事实、英中等义、理解、回忆、迁移、自评、先修 | 当前15卡共105项必选判断PASS |
| 独立复核 | 9卡首审；6卡首审发现1项；修正后6卡全新上下文复核PASS |
| 定向修正 | Windows组合卡原先允许任选路线却只接受AWS Backup；英中题面改为使用AWS Backup设计流程，事实正文及其他5卡未改 |
| 代表Rare单条件迁移 | 当前版本5项通过 |
| Deck Linter | 15 cards，15 zh-CN，0 issues，0 warnings |
| 实际导入器 | 两批及15卡合包解析、导出、再回读一致；中文v:1齐全 |
| 身份与历史 | 15个原修订UID保持，与弃用347 UID不相交；原P1八份输入/正文及用量账本未改 |
| 隔离坏例 | 重复身份、缺译文、未知引用、依赖环、私有题号泄漏被拒绝；过期/缺卡/失败规则/缺迁移审查不能放行 |

本轮有2次原通道CLI作者调用，合计input 64,346 + output 18,217 = **82,563可观测token**，output已含推理，不能重复加计。作者调用累计8.17分钟；从原stageStarted到本报告约27.2分钟，从首次内容派发约21.0分钟。监督、审查及局部题面修订的原生token不可观测，记unknown；82,563不是全部消耗。局部修订按独立发现的明确收窄建议用本地替换实施，未新增CLI调用，修复谱系计1次。原P1的100,322及更早历史计数不清零。

本次完成的是15张知识卡修订。原50题充分支撑仍为0/50，原题Q324的数百TB单卷矛盾、Q800的Lambda跨账户EFS集成缺口仍保留；Q456/Q508原题逐判断覆盖未因卡片通过而自动升级，其余46题未制卡。全库范围仍是1,018题，最终卡数未知。实际学习者记忆和答题正确率尚未测量，未发布、未做手机/离线/OTA验收，自动化仍PAUSED。

私有运行与证据：`/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-rewrite15-20261103`。当前输入、实际设计标准、官方原句/偏移、作者原稿、三份独立审查、首次FAIL及一次修复、格式回读与身份检查均在该目录保留。当前版本由current-artifacts.json定位，15项范围删减保存在scope-change-ledger.json。
