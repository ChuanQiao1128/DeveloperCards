# 全库共享选卡首版结果

已形成**330项全库共享候选工作表**，包含原177项中文原型和153项补充判断草案。这里没有新增330张卡，也没有给领域1另分177张配额。四个领域引用相同规则ID。

本轮复用1018题、1697项已有判断及分类，未重新提取考点。旧1100卡槽方案仅作检索线索，其未核答案不作AWS事实或覆盖依据。

| 当前工作表 | 数量 |
|---|---:|
| 全库唯一候选位置 |330|
| 原有中文原型／补充判断草案 |177／153|
| 已有至少3题必要用途的优先复用候选 |74|
| 仍需必要性、复用与可推导性核查的候选 |256|
| 逐题与逐判断底账 |1018题／1697项|
| 新增独立核查用途 |33处|
| 确认当前卡面已有规则的必要用途 |17处，涉及9个规则|
| 本轮新增整题充分证明 |0|

例如，原先在领域1只用到一次的RDS Proxy卡，已确认还支撑Q175/Q354的连接管理判断，现有3题用途；API Gateway/Lambda、粘滞会话、Compute Savings Plans及备份计划等也出现真实复用。独立审查没有把另16处来源/范围疑点、缺知识或无关匹配算成正向用途。

五项由低实证用途提升到至少3题：

| 原型 | 旧用途数→当前必要用途数 | 本轮确认题号 |
|---|---:|---|
|CUR:CA17|1→3|Q516、Q914|
|CUR:CB02|2→5|Q140、Q770、Q885|
|CUR:CB18|1→3|Q175、Q354|
|CUR:NB08|1→3|Q390、Q694|
|CUR:NS03|2→5|Q259、Q508、Q849|

这验证了一个方向：一些在领域1显得低频的卡，在全库可以重复使用。此处统计的是必要步骤，不能把17处关联算成17道新题已经完整覆盖。

提议粒度审查修正了4处：EKS共享文件判断改作既有共享文件规则的应用；块盘性能、Athena分区和EC2内存瓶颈各收窄为一个主要判断；列式扫描机制独立保留为待核草案。原1697项义务不因收窄而删除。初版和旧FAIL保留。

**330是预算内的候选框架，尚未证明330张足够。** 74项是优先选卡候选，其他256项没有自动准入；不能据相似度生成全部卡片。既有371题的原型卡组证明继续引用，其中272充分、59条件成立、40源疑点；剩余647题还没有全量整题支撑证明。最终核心集合的充分性和最终N仍未知。

每条规则已登记：拟训练的判断、已有必要用途、真实新增用途、候选题目、来源/条件引用、旧规则对比入口和准入状态。每道题保留全部既有needRef；原需求是查漏底账，不是逐项强制背诵清单。下一执行队列应核这些对应关系及真实缺口，再选择/替换候选，不重复抽考点、不把每个新细节自动加成一张卡。

成果：

- [330项全库共享选卡表](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-global-shared-selection-table.md)
- [领域1导航](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-global-selection-domain-1.md)、[领域2导航](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-global-selection-domain-2.md)、[领域3导航](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-global-selection-domain-3.md)、[领域4导航](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-global-selection-domain-4.md)
- [1018题逐题机器台账](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-shared-selection-20261106/deliverables/question-selection1018.json)及[1697判断核查队列](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-shared-selection-20261106/deliverables/judgment-review-queue1697.json)
- [17处已核必要步骤](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-shared-selection-20261106/deliverables/reviewed-cross-question-links.json)及[全部33处审查去向](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-shared-selection-20261106/deliverables/all33-link-decisions.json)

正式62张库存、原177正文、原分类与蓝图、学习记录和历史预算均未改；未发布或恢复自动化。新增模型CLI/API调用0，native token未知。记录区间包含准备和审查等待，不能换算成制卡吞吐。
