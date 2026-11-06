# 领域1剩余缺口归并与首批10项精炼

**156题、159项原缺口已全部归并并完成独立审查；首批10个现有中文原型精炼通过，原型总数仍88。定向复核13题，12题获得当前卡面充分支撑，Q676保留官方兼容性问题。最终所需卡数仍未冻结。**

| 归并后的制作素材 | 组数 | 用途 |
| --- | ---: | --- |
| 可尝试精炼现有原型 | 23 | 同一判断的必要小边界，不自动加卡 |
| 共享新增候选 | 17 | 仍需事实、跨题复用和短卡设计验收 |
| 低频保留义务 | 81 | 保留范围，继续查全库复用，不自动删除或出卡 |
| 复合素材簇 | 15 | 先分清不同回忆任务，不压成一张普通卡 |
| 合计 | 136 | **136不是新增卡数** |

独立审查回读了57组涉及的82题全部选项，其余78个原单例先核原义务完整保留。13项修正已回读通过，覆盖Region/TGW限定、WAF集合与关联入口分离、供应商发布与消费端分离、复合任务模式及3项交叉原子的明确partial职责。没有重抽全库考点。

**本批实际变化。** CB09补明被调用服务及授权/网络边界；CB10补明IP集合与WAF入口；CC08补明加密快照继承；NS02补明ALB端点；NC09补明归档韧性；CC20补明期限与凭证寿命；CA08补SQS资源策略实例；CB05比较IPv4/IPv6主动出站并保留原NAT路径；NA03区分IP流量与HTTP日志并保留投递去向；NB05比较误删恢复与Snapshot Lock事前保护。新增原型身份0，正式卡接受库存仍62。

**本批定向题目结果。** 充分支撑：Q53、Q121、Q360、Q470、Q555、Q608、Q675、Q707、Q749、Q754、Q765、Q856。这些是针对可精炼缺口选择的题，不是随机正确率样本；也不是学习者实际考试结果。

Q675按[当前官方Snapshot Lock机制](https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-lock-concepts.html)和题面字面选择Snapshot Lock，Recycle Bin只承担删除后的恢复窗口。Q676的[官方Firehose说明](https://docs.aws.amazon.com/firehose/latest/dev/writing-with-cloudwatch-logs.html)明确说CloudWatch Logs不能向OpenSearch这一目的地交付，不能把分别受支持的单段连接拼成整条链路。该题继续保留，不用错误教学填平。

初审中CC08、NC09的两项私有自评超出正面所问，已只修评分要求并回读，正文与题目结果未因此重跑。随后补回CB05/NA03旧用途，并只复审3张受影响卡和3题。Q360/Q555的分歧另由独立裁定按功能选型处理：未给竞争方案网络前提，不等于已证明第二个完整可行解。原FAIL及各轮原文均保留。

**剩余范围。** 这156题中，143题、145项原知识缺口尚未在本轮闭合，Q676另列来源问题；原来的25项适用前提与11项题目疑点不在本批处理范围。不能据17个新增候选推成“最终105张”，也不能据143题直接追加143张卡。当前全域179题是上一版完整回测基线，改动影响的旧证明未整批重新验收，因此本报告不把它直接加12冒称当前全域191题验收通过。

**计时。** 本轮落盘可观察时钟从2026-11-05T07:41:45.750931+00:00到2026-11-05T09:00:41.430636+00:00，约78.9分钟，包含156题归并、独立核82题、10项精炼及来源裁定；这不是单纯10张出卡吞吐。native token未知，外部模型CLI/API调用0，历史起点/预算未重置。原流程起点仍保留为2026-11-05T05:47:36+00:00，跨阶段观察时钟约193.1分钟（含对话间隔）。原卡、规范题源、蓝图与生产指针的保护哈希未变。没有发布或OTA。

成果入口：

- [10个精炼原型全文](/Users/qc/Desktop/DeveloperCards/reports/2026-11-05-aws-domain1-gap-refinements-10.md)
- [136个素材簇及逐题范围](/Users/qc/Desktop/DeveloperCards/reports/2026-11-05-aws-domain1-gap-material-index.md)
- [当前88个中文原型](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/gap-consolidation-v1/cards.batch1.final-proposed.json)
- [13题当前有效支撑记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/gap-consolidation-v1/batch1.effective-question-support.json)
- [143题剩余知识义务](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/gap-consolidation-v1/remaining.knowledge.current.json)
- [156题到素材簇的索引](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/gap-consolidation-v1/question-to-groups.json)
- [当前事实与教学凭证](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/gap-consolidation-v1/batch1.effective-gates.json)

后续直接复用归并索引与官方证据，优先处理仍可同任务精炼的候选；独立低频机制先从现有全库索引检查跨领域复用。完整覆盖与最终N仍需闭合，不能只靠材料分组验收抵扣。
