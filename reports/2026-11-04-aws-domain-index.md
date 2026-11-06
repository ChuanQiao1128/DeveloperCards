# 全量领域视图与双向索引 · 第一步完成

已用本地脚本建立四领域、14个考试任务的候选导航，以及原题／必要判断／现有目标的双向索引。独立review的IR1–IR7全部通过，无实质缺陷。原题、分类CSV、蓝图正文及已有卡片均未修改，没有重新提取、重新分类或生成卡片。

| 领域入口 | 主归题 | 含交叉题 | 候选目标引用 |
| --- | ---: | ---: | ---: |
| [领域1·安全架构](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/domain-1.md) | 310 | 371 | 559 |
| [领域2·弹性架构](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/domain-2.md) | 210 | 299 | 558 |
| [领域3·高性能架构](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/domain-3.md) | 329 | 520 | 864 |
| [领域4·成本优化架构](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/domain-4.md) | 169 | 210 | 333 |

原题唯一集合为1,018题，Q868仍排除；分类CSV原1,019行保留。跨领域题和目标可以重复显示，表中含交叉题及候选目标引用不得相加当作唯一总数或卡数。

## 已建关系

| 项目 | 数量 |
| --- | ---: |
| 现有候选目标 | 1,532 |
| 原题候选判断 | 1,697 |
| 目标—题目关系 | 2,165 |
| 目标—判断关系 | 2,857 |
| 条件／变式／组合引用 | 1,454／2,150／972 |

这些是已有关系的引用索引。正文仍由当前权威蓝图提供，未新建第二套知识库，也未删除单题目标或合并考点。

## 三种使用方式

- 按领域／考试任务找到候选目标和对应题目。
- 按考点取得全部来源题、具体needRefs、条件、变式和组合关系；不会因从某领域进入而裁掉其他领域的题。
- 按原题反查其考点、判断、条件、源分类状态和当前卡片支撑状态。

```sh
DOMAIN_INDEX_MANIFEST='/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/manifest.json'
python3 tools/aws_cards/domain_index.py lookup "$DOMAIN_INDEX_MANIFEST" task 1.2
python3 tools/aws_cards/domain_index.py lookup "$DOMAIN_INDEX_MANIFEST" objective obj-b03-g6
python3 tools/aws_cards/domain_index.py lookup "$DOMAIN_INDEX_MANIFEST" question 456
```

查询obj-b03-g6会保留Q312、Q456、Q508、Q602全部来源题；从成本任务4.2进入也不会把其他题裁掉。考点的主领域／任务仍为未确认，题目标签只用于候选导航。

## Review与校验

- 独立重算全部原题、目标、判断、双向关系及分类集合。
- 独立逐行核对四页2,623条目标行；381条存在任务之外来源题的行，全部保留全局上下文。
- 六项自动测试通过，包含10种破坏场景；独立review额外五项破坏探针均被拒绝。
- Q31的暂归／待核实标签仍保留；CSV答案、学习状态和含答案的待核文字未进入索引。
- 所有源版本、生成文件和程序哈希均绑定；源或接受卡数量改变时，查询会要求刷新索引快照。

[机器入口manifest](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/manifest.json) · [双向索引](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/data-v2/bidirectional-index.json) · [独立review](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain-reference-index-20261104/independent-review-r1.json) · [本地工具](/Users/qc/Desktop/DeveloperCards/tools/aws_cards/domain_index.py)

## 状态边界

四领域导航已经可用，考点主归及共享教学分组留待领域优化时确认。现有15张接受卡仅登记UID清单，尚未建立可靠的逐目标绑定；索引显式标为未绑定，不会据空列表认定尚未出卡。正式制作前需先确认已有卡片绑定。

本轮未验证AWS技术事实、最终整题卡片支撑或真实学习效果；没有新增卡片、变更学习进度、发布或恢复自动化。当前1,018条需求复核状态、15接受卡、25唯一UID及0/50题卡支撑保持。
