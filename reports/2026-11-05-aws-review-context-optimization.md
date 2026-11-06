# 制卡审查输入与时间成本优化

2026-11-05。已接入现有 `tools/aws_cards/pipeline.py`，本轮是工具维护，当前47张接受卡和生产指针保持原哈希，没有新增制卡调用。

下批沿同一知识组补已有题目缺口，复用有效官方证据；写作时同次删除无关或缺证的附加主张，不新增自查阶段。策略已记入AGENTS第5节，第4节完整教学标准未改。

本次工具改动：

- 首次审查提供完整本批卡片；局部复审按已有题卡关联的并集保留相关卡、全部待审卡和递归先修，带齐其官方摘录。原题、全部选项、条件、判断、异常与教学标准保持完整。
- 缺少或空映射、未知判断、非背景判断未绑定支撑卡时使用完整上下文。卡身份集合变化时旧题目结果失效；未知或逐判断映射不完整的结果绑定整个卡集合，任一卡变化后重新核查。
- 七项独立检查、迁移和题目支撑核对保持；通过项简述依据，失败、未知和缺口保留具体原因及卡面锚点。旧审查结论不进入新的Reviewer输入。

用第6批真实返修材料在隔离目录构造输入，结果如下：

| 项目 | 原来 | 优化后 |
| --- | ---: | ---: |
| 审查输入 | 48,702字节 | 37,704字节 |
| 待审卡 | 1 | 1 |
| 关联上下文卡 | 4 | 2 |
| 官方摘录 | 9段 | 6段 |
| 原题 | 4道 | 4道 |

输入减少22.58%。四题的完整原题与需求、教学标准、检查规则及保留摘录逐字段相同。这是输入构造验证，没有派发新的卡片语义审查，不能据此声称生产时间已缩短22.58%。

43项本地检查通过。独立代码复核提出两项回退／缓存边界问题，已修复并通过定向复核；前两轮FAIL原件保留。复核结论只涵盖代码及输入边界，不代表卡片记忆或实际作答效果。

下一批继续完整计时，以5张约10分钟为待验证目标。首次读代码发生在维护记录起点之前，未单独计时，本轮不能用作完整生产测速。

[运行与复核证据](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/review-context-optimization-20261105/maintenance.json) · [真实材料输入验证](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/review-context-optimization-20261105/smoke-results.json) · [最终独立复核](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/review-context-optimization-20261105/independent-review-r3.json)
