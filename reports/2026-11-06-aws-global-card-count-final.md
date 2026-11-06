# 全库卡数与四领域分配

本轮核算结果为 **356张去重设计卡目**，作为后续制卡的排产基数。领域是导航，同一张卡可以被多个领域引用。

| 领域 | 唯一主归卡数 | 含交叉题、共享卡和先修的引用数 |
| --- | ---: | ---: |
| 领域1：安全架构 | 113 | 176 |
| 领域2：弹性架构 | 44 | 182 |
| 领域3：高性能架构 | 156 | 258 |
| 领域4：成本优化架构 | 43 | 142 |
| **全库** | **356** | **去重后仍为356** |

主归列可以相加：113＋44＋156＋43＝356。引用列表示学习该领域全部相关题目时涉及的卡目，允许重叠，不能相加。例如领域1主归113张，还会引用其他领域的知识，合计涉及176张；不能把113张说成领域1全部复习负担。

## 这次怎样计算

复用已有蓝图和原题，没有重新提取考点。已有371题的完整原题核查保留，剩余647题完成独立的设计归属核查；1018题、1697条既有判断均登记了去向。

从原330项提案出发，对83次缺口请求交叉比较后，保留32项独立任务，合并3项重复规则，排除3项未找到必要用途的候选：

**330＋32－3－3＝356。**

三项合并分别是RDS高可用／读扩展用途、计算承诺覆盖范围、API按已有身份选择验证路径。三项排除是Kinesis enhanced fan-out、Athena分区裁剪、列式扫描成本的独立候选；它们在本轮逐题选择中未被判为必需，原候选仍保留。

每个卡目有唯一规则ID、一个主要回忆任务、唯一主归领域和具体题号。新增范围和必要适用条件单独记录；这些是制卡责任，不能沿用旧正文的PASS，冒称新增知识已经教会。

## 对复用和覆盖的实际结论

当前卡目中，200项关联至少3题，63项关联2题，93项关联1题。低频项保留了必要能力差异，不能宣称每张卡都能单独解决多道题，也不能用主题相同或重复题号提高复用数。

356是已确定的**设计排产数**，不是已制作356张，也不是数学上的最少卡数。卡面事实、完整卡组判题支撑和学习者记忆／作答表现仍须分别验收。

100题至少有一个判断保留为题源疑点，包括选项不完整、缺少前提或产品适用性未确认等；已登记相关知识任务，但未宣称这些原题都有唯一正确答案。不能靠增加卡片消除题目自身的矛盾。

原分类、蓝图、177项原型正文、正式库存、学习记录和生产指针均未修改。本轮仅核算卡目，没有继续制卡或发布。

## 可回查产物

- [完整356卡目与领域表](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-count-closure-20261106/deliverables/card-catalogue.frozen-design.md)
- [1018题双向分配账本](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-count-closure-20261106/deliverables/question-allocation1018.json)
- [计数数据](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-count-closure-20261106/deliverables/counts.json)
- [独立审查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-count-closure-20261106/final-review/semantic-review.md)

独立复核发现的API验证重复项已合并；计数与归属的最终回读记录保存在本轮运行目录。
