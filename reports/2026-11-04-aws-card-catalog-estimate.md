# 全量制卡取舍、中文提纲与覆盖检查

状态：全量候选规划已生成，技术核验与充分支撑仍待完成。

本轮是既有蓝图的出卡规划。新答案和原因均为待核提议；不是正式双语卡包、AWS事实全量验收、原题唯一答案认证或学习效果测试。

范围：1018题、1697项原有判断、1532个候选目标；本轮已处理1532个目标。

| 项目 | 当前结果 |
| --- | ---: |
| 当前候选提纲卡槽 | 1100 |
| 有具体答案与原因草案 | 1100 |
| 待定且尚无提纲的目标 | 94 |
| 若上述待定目标各预留一张 | 1194 |
| 全部判断已登记规划去向的题 | 1018/1018 |
| 全部判断有候选卡组路径的题 | 966/1018 |
| 正确选项充分支撑验收 | 尚未全量核验新提纲事实与判题映射 |

候选卡槽数是当前提纲方案的精确计数；“待定项各一张”仅为预留情景，不是最终N的上下界或统计置信区间。事实核查、颗粒度修正仍可能增加、减少或拆合卡片。练习能沿依赖关系找到卡片，也不表示独有整合判断已被这些卡教会；这类条目另记integrationProofPending。

## 出卡取舍

| 去向 | 目标数 |
| --- | ---: |
| keep | 1052 |
| merge | 16 |
| no_new_card | 4 |
| pending | 94 |
| practice | 366 |

## 按主领域与学习任务计数

| 主领域建议 | 卡槽数 |
| --- | ---: |
| 领域1：安全架构 | 375 |
| 领域2：弹性架构 | 280 |
| 领域3：高性能架构 | 354 |
| 领域4：成本优化架构 | 91 |
| 待确认主领域 | 0 |

| 学习任务 | 卡槽数 |
| --- | ---: |
| Easy | 122 |
| Rare | 954 |
| Legend | 24 |

原始组合目标不被一概删除。组合若只复用已有判断可作练习；独有判断、未决技术事实和例外条件均保留引用及待核去向。每张提纲按一个有用回忆任务规划，不按Easy/Rare/Legend固定配额凑数。

## 可读提纲与机器台账

- [领域1：安全架构提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/catalog-domain-1.md)
- [领域2：弹性架构提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/catalog-domain-2.md)
- [领域3：高性能架构提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/catalog-domain-3.md)
- [领域4：成本优化架构提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/catalog-domain-4.md)
- [待确认主领域提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/catalog-domain-unknown.md)

- [1532目标取舍台账](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/objective-dispositions.jsonl)
- [全部短卡提纲](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/card-outlines.jsonl)
- [1018题逐题覆盖与待核状态](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/question-coverage.jsonl)
- [卡量情景与检查结果](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/count-estimate.json)

源五文件、分类表、原题条件和变式未覆盖或重提。已有15张接受卡的完整目标绑定尚未建立，未自动加到或扣除出卡槽数。旧347卡及已退回卡正文不作新知识源。正式卡数、学习记录、原0/50支撑账本、历史预算和修复记录均不改；未发布、OTA或恢复自动化。

## 独立核查与待核目录

候选规划完整性、计数与措辞诚实性R1–R5已通过独立核查；这不代表1100个新答案事实、原题正确选项或学习效果通过验收。

- [94项目标待定、52题路径缺口与20项整合待核](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/deliverables/pending-and-gaps.md)
- [独立完整性审查原始记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-catalog-estimate-20261104/independent-integrity-review-r1.json)

本轮已知CLI用量53,399 token；原生规划、审查与监督用量unknown，不能当作总用量53,399。既有阶段消耗、时钟和修复次数均未重置。
