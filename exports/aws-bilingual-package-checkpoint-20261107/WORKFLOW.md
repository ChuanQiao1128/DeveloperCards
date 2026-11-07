# AWS 双语包自动接续工作流

当前状态以 progress.json、current-review-index.json 和父目录 workflow-auto-closeout-20261107/state.json 为准。授权为全自动续接，不重复询问已接受的范围例外或已授权步骤。数量验证已结束；本阶段不重复提取题库需求，不发布、不改正式库存或学习记录。

## 输入与完成条件

- 固定365张共享中文核心卡；四领域唯一主归116/46/159/44，共享复习159/137/197/117。
- 范围处置为899原题充分、115最小纠错练习、4用户接受例外（Q49/201/454/783），不写成1018原题充分。
- 245张英文已通过独立等义/教学自评复核和真实解析，仍缺120张。下一批 batch-25，从 order.json 的索引245开始，每批5–10张。
- 只有365张全部有当前语义凭证、来源链、双语等义、UID与先修完整性、真实parser/导出往返及最终回读，才能标记正式双语包完成。部分包不发布；全量装配缺译文时必须失败且保留已验输出。

## 执行循环

1. 用 order.json 和 batches/*.json 计算缺失ID，读取对应 cards.current.json 的 visibleBody；不重写合格中文正文。冻结正文SHA与AGENTS第4节。
2. 单作者逐批补英文、kind、topic和mustAnswer，write_batch.py保存。保留全部中文条件、因果及边界；自评不考题面已给前提或未问提醒。
3. 仅派 fork_turns:none 的独立Reviewer，提供本批正文与完整教学标准；审等义、回忆任务、自评及分类。报告存 review/batch-NN.review.json，附输入SHA。
4. 有缺陷时在history保存旧版，只修失效字段；局部独立复审保存repair记录。原PASS仅在逐卡条目相同且旧输入SHA可回查时复用，不原样重审整批。
5. collect_reviews.py收集当前版本凭证；assemble.py 累计数装配。用真实前端的tools/aws_cards/roundtrip.mjs与严格lint-deck.mts验证；本地脚本完成格式、哈希、排序、计数。
6. 更新progress/state，继续下一缺失批次，不以装配或Linter通过代替语义完成。365齐备后运行assemble.py all，并将verify_partial.py的局部范围改为全量门禁，另做独立最终回读。

## 现有证据与边界

source-bindings.json保留原中文FACT receipt、旧官方原句、当前正文SHA以及补采网页。supplementalCurrentSnapshots明确是新采集快照，不替换旧FACT凭证。GCL-008原404链接保留，正确filefsxw链接及三条原句经独立核对。已有时钟、旧失败、预算和未知native用量均不重置；本阶段CLI/API内容调用0。

当前部分包缺少VC-009的先修gsc-080英文，该卡在365计划中；全包完成前必须补齐。学习者记忆和实际正确率未实测。
