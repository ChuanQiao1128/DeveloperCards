# 领域1卡片数量分析（2026-11-05）

**当前候选实体卡基数为300张，其中49张已有、251张为新增候选。另30项目标待定，尚未计入基数。** 这是按当前教学标准得到的排产估计，最终卡数仍可能因复用、事实核查和教学试制而调整；本次没有证明最少卡数。

| 数量口径 | 本次结果 |
| --- | ---: |
| 领域1本轮已经制作并接受 | 47张 |
| 可复用此前新包试制接受卡 | 2张 |
| 新增候选 | 251张 |
| 当前规划基数 | **300张** |
| 尚待澄清 | **30项目标，未折算为确定卡数** |

此前试制的2张分别训练跨账户EFS的IAM只读授权、恢复点数据年龄与RPO。它们来自全新卡包试制的15张接受卡，旧347张卡没有进入本次数量。全局接受库存仍为62张，本次只计算与领域1规划相关的49张；没有修改接受状态或删除其他卡。

**统计范围是领域1所含371道完整题：310道主归题和61道交叉题，Q868排除。** 为完成这些综合题所需的成本、性能、可用性判断也在范围内，后续可以由其他领域卡共享引用。这里的300张不是全1018题总数，也不是300张全部属于纯安全知识。

**如何算出这个数量。** 复用现有559个直接相关目标，外加2个支持目标，没有重新提取全库考点。先按一个有用判断及必要原因归并，再将新增候选带回本轮原题题干及全部选项，排除其他题的变式、弱干扰项扩展和可以组合练习的重复内容。最后按已有卡实际正文核对复用，以UID计实体卡。

| 阶段 | 计数结果 |
| --- | ---: |
| 三组初始候选 | 343个判断卡位 |
| 保留47张现卡并只加入实际使用的早期新卡后 | 345张实体规划基数 |
| 13组合并，相当于减少12张新增实体候选 | 333张 |
| 28项转为已有规则组合或迁移练习 | 305张 |
| 4项确认属于本轮范围外变式 | 301张 |
| 1项改为待定，保留原条件 | **300张** |

归并后为296个候选判断卡位，其中45个复用卡位、251个新增卡位。判断卡位与实体卡不同：有的卡位引用多张既有卡，且本次保留全部47张本轮接受卡，因此最终实体基数为49＋251＝300。没有把已有多卡的内容强行压成一张新卡。

**几项具体去重。** 以下是规划上的必要判断支撑关系，不能据此声称单卡可做对整题：

| 处理 | 当前任务 | 原题关联示例 |
| --- | --- | --- |
| A005＋B068合并为M01 | SSM节点的Agent、实例身份和服务网络接入前提 | Q37、Q50、Q766 |
| A095＋C023合并为M04 | 请求身份与端点网络来源的区别 | Q663、Q913 |
| B065＋C022复用同一UID，合并为M07 | 数据库入站引用专用应用安全组 | Q55、Q74、Q254等 |
| A053＋B052合并为M03 | 静态浏览器文件能否直接托管，服务器端PHP是否需要计算 | Q116、Q541 |
| B002、B025移出本轮 | Q125没有Aurora副本；Q754没有跨Region实例ID注册要求 | 回读原题确认 |
| B078、B079移出本轮 | Q184已有DX/VGW，只需让Lambda接入可达VPC，没有TGW集中互联任务 | 回读原题确认 |
| C117转练习 | Q638临时对象分享复用已有presigned URL卡 | 无需另学全部协议竞争方案 |

回查发现了一个重要数量误差来源：目标的needRefs已限定本领域，但其variants仍含全库其他题条件。只按目标标题归并会虚增卡数。本次三组范围审计分别核读85、91、116个新增卡位，另由主控和独立审查定向核对4个范围外卡位；不把这些审计当作AWS事实验证。

C088也作了定向范围纠正：移出原DynamoDB新增记录通知的偏置，保留Q33真正需要的交易输入流多消费者共享任务。B013/B083合为Q667的本地与VPC访问S3端点范围判断。两处都保留实际问题需要，未因旧候选方向有偏差而直接删掉义务。原蓝图和原始输出没有覆盖改写，修正在本次数量分析层留档。

**待定项为什么不能直接加成卡数。** 30项目标保留缺失策略正文、密钥语义、数据驻留、大小/服务版本、扫描可执行性等疑问。36条原始预留描述中存在重复、互斥解释和已由候选卡承担的内容；澄清后可能复用、合并、取消或新增，尚不能给可靠上界。另有6处独立粒度问题保留在清单，例如检查路由是否与GWLB同卡、NLB安全组生命周期是否独立成卡。

Q208的唯一物理实例限制和全部API/数据私网路径仍保留待定；组合练习经过这些路径时，仍带有待定标记。不能把一条规划路由视为条件已经得到满足。

**完整性与复核边界。** 561项目标、622个原mustJudge引用、371道题均有规划去向；去向可以是候选卡、已有卡组合、背景或待定。该检查验证集合完整，没有升级正式卡、AWS事实或整题支撑状态。宽目标拆到多个卡位后，仍须在正式制作时精确绑定每个卡面支持哪个原题判断，不能沿用一个宽目标的全部题号来夸大单卡收益。

本次尚未证明每张卡都至少对应两道题。制卡应优先完成可复用于多题的判断；仅在本领域出现一次、但会改变答案的边界也应保留。后续四领域共享同一知识卡，按实际来源绑定，不按领域再复制正文。

数量、路线集合、已有UID和保护源哈希通过本地校验；独立复审记录绑定最终冻结产物。必要事实与学习效果仍由正式制卡验收和实际作答检查承担。

- [候选清单](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/clusters.final.json)
- [计数结果](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/summary.final.json)
- [归并与修订记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/cross-reconciliation.final.json)
- [待定目标](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/pending.final.json)
- [逐判断规划去向](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/need-routes.final.json)
- [首次独立审查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/reviewer-count.md)
- [最终冻结回读](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-card-count-analysis-20261105/reviewer-final-count.md)

本次只完成数量分析与文档，没有生成正式卡、启动发布或修改生产run、需求源、预算与学习记录。此前150张的数字只是排程假设，应由本次候选基数替换，不能继续作为固定制卡配额。
