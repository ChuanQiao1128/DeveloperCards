# AWS双语包自动工作流

当前365张正式双语包已完成本地验收，权威完成凭证为completion.json，执行状态为progress.json与父目录workflow-auto-closeout-20261107/state.json。没有新增需求时，不重新出卡或重复审查。

## 固定输入与范围

同一套365张共享核心卡，四域唯一主归116/46/159/44、含共享复习159/137/197/117；domain-index.json引用同一stableUid，不复制正文。题侧处置899原题充分＋115最小纠错练习＋4已接受例外Q49/201/454/783；不写成1018原题充分。

## 自动执行与恢复

1. 按order.json与batches计算缺失/变更ID；只读现有visibleBody、当前中文事实凭证、官方引用及冻结AGENTS第4节。每批5–10张，由单作者翻译，不重新提取全库需求。
2. write_batch.py保存英文、kind、topic、mustAnswer及中文正文SHA。英中条件、因果、边界对齐；自评只考实际题面，不考已给前提或补充提醒。
3. fork_turns:none隔离Reviewer审本批完整卡与教学标准；review记录输入SHA。失败保留history，仅定向修正并局部复审。未变PASS须与冻结条目精确相同方可复用。
4. collect_reviews.py收集当前语义凭证；assemble.py all必须完整365才装配。真实tools/aws_cards/roundtrip.mjs、严格lint-deck.mts及verify_full.py检查双语v:1、UID、先修、来源与数据完整性。隔离缺批负控须拒绝且不覆盖已有输出。
5. 全部当前凭证与正式文件通过独立最终回读后才生成completion.json、更新状态、导出并保存PR。不因格式/哈希通过自动升级语义；变更后的完成凭证需重新校验受影响依赖。

当前输入、逐卡初审/修复、旧失败、原中文FACT receipt及补采provenance均保留。assemble/current-review-index中的formal:false是完成总验之前的审查快照，最终完成状态以completion.json为准。输入变化须使旧completion失效，不盲用旧完成状态。

本工作流沿用全自动授权，不重复确认已接受范围或已授权步骤；不擅自扩大卡数/预算，不改正式库存、学习记录或生产环境，不发布/OTA。历史时钟与计数保留，新增内容模型CLI/API调用0、native用量未知。学习者实际记忆与正确率未测。
