# AWS双语包部分保存点

**245/365张**通过独立双语复核和真实导入验证；剩120张。此目录是续接保存点，正式包尚未完成，未发布。

- [卡片阅读稿](cards.deck.md)、[导入JSON](cards.import.json)、[私有证据](cards.private.json)。当前部分包VC-009的先修gsc-080英文尚在剩余清单中。
- [自动接续工作流](WORKFLOW.md)、[当前状态](progress.json)、[逐卡语义凭证索引](current-review-index.json)、[完整性回读](validation245.json)。下一批batch-25，从GSC-030开始，沿用现有授权，不重新提取全库考点。
- [制作与证据归档](workflow-evidence.tar.gz)保留全部翻译批次、旧失败/修复、独立审查、365张中文来源绑定、123份补采官方页面、原引用文件便携副本及冻结输入。archive内evidence-index.json把原绝对路径映射到SHA命名副本；原路径仅作追溯。
- 原运行目录仍是权威执行位置：`~/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/package-bilingual-20261107/`。原目录可直接续接；从归档恢复时按global-inputs与evidence-index重建引用，不覆盖其他版本。
- 365卡的题侧处置为899原题充分、115纠错练习、4用户接受例外（Q49/201/454/783）。例外不能算原题充分；学习者真实记忆与正确率未测。

校验摘要：真实parser/translationRules/严格Linter/roundtrip通过；245张，零错误零警告；新UID与旧347个UID交集0。缺120张时全量装配拒绝且保留已验输出。新采网页具有supplemental provenance，不替代旧FACT审查。

逐文件SHA及归档SHA见manifest.json。历史预算和时钟未重置，新增内容CLI/API调用0、native用量未知。
