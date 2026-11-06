# AWS卡数验证保存点

当前拟保留363张中文核心卡；最终N未冻结。958/1018题已闭合，剩60题。本目录只保存进度，不代表正式双语包、学习效果或发布通过。

直接阅读 `handoff.md`。当前正文与原题/练习索引已展开保存；`runtime.tar.xz` 保存完整本轮运行目录（含旧失败、修复、独立审查、官方证据及未完成输入），逐文件哈希在 `runtime-manifest.json`。`source-dependencies/`另存完整原题及官方来源目录。

Skill版本在仓库 `.agents/skills/aws-card-count-verify/`。历史计划与报告在 `plans/`、`reports/`，正文工具在 `tools/aws_cards/`。

续接优先使用仍保留的原运行目录。灾难恢复时，将归档中的 `global-card-proof-20261106/` 还原到原运行根；按manifest检查哈希。目录和证据里保留原绝对路径，换机器后须显式映射路径，不能凭旧路径存在就当有效。完整历史前置运行、整个官方语料库和PDF不在此快照，原文件仍保留原位。

生产库存、学习进度及OTA未改；所有计时、预算与失败历史保留。读取 `validation/status-snapshot-20261107.json` 确认当前口径，不以历史候选数宣布最终卡数。
