# 固定生成脚本与优化验收

已接入[固定入口](/Users/qc/Desktop/DeveloperCards/tools/aws_cards/pipeline.py)，[运行说明](/Users/qc/Desktop/DeveloperCards/tools/aws_cards/README.md)。后续批次复用同一脚本构包、调用原作者通道、校验、按卡复审、导出与记账。独立Reviewer仍通过当前主Agent的原生子Agent工具交接；语义复核缺失时脚本等待，不自动签发PASS。

| 项目 | 实际结果 |
| --- | --- |
| 作者输入压缩 | 89,160 → 64,430字节，减少27.7%；仅省去旧背面和可本地绑定元数据 |
| 官方依据与场景 | 全30段原句及完整原场景正面保持，偏移/来源哈希独立绑定 |
| 输出契约 | 模型省去UID及重复supportedClaim描述，本地恢复身份和逐段引用绑定；双语正文与必要评分条件保留 |
| 单卡修订 | 末端卡变更仅1张失效；示例基础卡变更使该卡及2张依赖组合卡失效 |
| 缓存验收 | 逐卡绑定正文、自评、规则、标准、来源及递归先修；回查原冻结输入和独立报告 |
| 完整验收 | 初次仍每卡7项必选维度；代表Rare迁移验证保留，未改卡凭有效原证据复用 |
| 同版本失败 | needs_repair，不重复原样派审；原FAIL、修复次数及闭合状态保留 |
| 中断恢复 | 校对成功状态、usage、input/prompt/schema/output及结构凭证；超时或旧输入残留拒绝复用 |
| 导出与计时 | 同次生成双语MD、Deck MD、canonical JSON并调用真实Linter/导入器；计时到全部交付步骤完成 |
| 代码与回归 | 独立代码审查PASS；13项本地回归通过 |
| 现有15张回放 | 全15张复用原冻结有效证据；Deck与canonical导入JSON逐字节匹配当前接受版本 |
| 新增制卡调用 | 0；原作者82,563和前P1 100,322未清零，代码审查/监督native用量unknown |

本地回放仅检验已有15张的确定性流程，耗时不到1秒；这不是实际制卡吞吐。已有官方证据时15张12～15分钟仍是下一批待实测目标，未宣称已达到。模型/供应商/effort及原全局锁不改；原预算窗由manifest的generationLedger提供，不自动创建新窗。

本次未生成新卡、未扩大原50题范围，未升级原题覆盖；正式唯一卡数仍15、完整题目支撑仍0/50，最终N未知。生产发布、手机/离线/OTA未执行，自动化仍PAUSED。

运行证据：`/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-generation-optimized-20261103`，包括state、timings、逐卡证明cache、repair-history、构包、导出检查与code-review.json。首次代码审查发现的作者目录与旧输出恢复缺陷已修复，发现及复验记录保留。
