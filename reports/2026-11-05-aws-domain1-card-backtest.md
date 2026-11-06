# 领域1卡数实测与定向修正

**当前88个中文原型，设计层面的卡面支撑为179/371题（48.2%）。尚未覆盖全部领域1；83或88均不能当作最终所需卡数。最终N未冻结。**

| 当前结果 | 题数 |
| --- | ---: |
| 当前可见卡面可解释所需选择 | 179 |
| 必要知识仍未闭合，或知识与适用性混合 | 156 |
| 题目适用前提未确认 | 25 |
| 原文、选项或唯一性疑点，需独立澄清 | 11 |
| 合计 | 371 |

这些是模型依据可见卡面作出的设计支撑判定，不是学习者记忆或考试正确率。题目疑点也不是已确认题库错误；可解释某个方案与原文字面能否唯一选定分别记录。

**本轮实做。** 首轮对371题读题干和全部选项；共享事实按83个原型核验，未重复提取全库考点。对194条首轮缺口全部重测，另对修改依赖题、恢复的策略图和审查分歧定向复核。去重后260题有本轮复测，107题的充分支撑证据因实际所用正文未变而沿用，另4条未变化的源问题由原独立审查保留。371个题号完整、唯一，Q868不在范围。

**修正后的规模。** 保留原83个身份，精炼其中20个，新增5个中文规则原型，共88个。全部88个当前正文有官方事实支持；其中22个修改或新增正文完成本轮聚焦教学审查。其余原型未因此升级为正式教学接受。未新增正式双语卡，正式接受库存仍62张。

**真实复用。** 77个原型参与了已支撑题目的证明；其中59个参与至少2题，44个参与至少3题。157条充分支撑记录引用1–2张卡。这些数字允许卡组共同解题；单卡独立支撑另列，不能把卡组的全部题号算成每张卡独立解题的能力。尚未证明整个集合最少。

**门槛校准。** OAI用途曾在OAC改写时丢失，已在同一张卡补回短定义并复测相关5题；ALB证书例句也补回原用途。独立复核允许把已教机制迁移给新角色或调用方，同时保留真正的服务兼容能力、明确期限与原题条件。只问功能选型的题，不额外要求完整部署清单。

**仍不能直接计算最终卡数。** 192题未闭合不等于再加192张卡：它们包含可合并机制、同卡边界、适用前提和题源疑点。现有88个原型仍须按真实必要判断继续补齐与去重；低频独立机制保留待决，不自动挤入普通卡或计作共享核心。原题未知Region、API类型及原文缺失不能靠加卡确认。完整覆盖闭合前，不给一个缺少证据的最终N。

**耗时与边界。** 本轮首次可观察起点2026-11-05T05:47:36+00:00，报告生成2026-11-05T07:28:58.988208+00:00，端到端约101.4分钟，包含首次全库回测、官方事实审查、策略图恢复、定向修正和判定门槛校准。没有可分拆的完整各步骤计时，native token未知；本轮外部模型CLI/API调用0，不重置历史用量。后续可复用当前正文、官方证据、逐题缺口和依赖关系。原需求蓝图、规范源和生产指针未改，未发布或恢复自动化。

可定位成果：

- [371题逐题矩阵](/Users/qc/Desktop/DeveloperCards/reports/2026-11-05-aws-domain1-question-support.md)
- [完整当前支撑记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/question-support.final.json)
- [卡到题的反向索引，含单卡独立支撑](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/cards-to-questions.final.json)
- [当前88个可见中文原型](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/cards.repaired.v6.json)
- [全部未闭合事项](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/remaining.open.json)
- [汇总、计时与计数边界](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/question-support.final.summary.json)
- [结构、锚点、答案数量及保护文件检查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-backtest-20261105/validation.final.json)

原题来源：[SAA-C03原始PDF](</Users/qc/Desktop/AWS Arch Associate/SAA-C03 1019题 题目+答案+讨论.pdf>)。印刷答案与讨论未用作AWS技术权威；策略图恢复保留原始缺陷与独立核对记录。
