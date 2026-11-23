# 卡包制作和更新

新卡包、加卡和修卡按同一批次流程执行。用卡包的数字 ID 和 slug 定位目标。每张新增卡的 `expectedVersion` 为 0。修改卡沿用 UID 和顺序，`expectedVersion` 取审查前的编辑库版本。一批可以同时含新增和修改。

1. **选范围。** 首批记录学习对象、学习目标和可信来源。续批沿用该说明，记录本次变化和影响到的先修卡。已有原文可直接引用，缺少依据时用 RAG 找原文。在 Console 新建目标卡包时保留草稿状态。在导入页点 **Copy card versions** 取得当前 UID、版本和顺序。
2. **写稿和核对。** 基于该版本写下本批完整卡面和引用。独立审查只拿冻结稿、规则及实际来源。核对事实、双语、解释、回忆和先修。备考卡另核对相关题目的支撑。已通过且内容、证据和依赖均未变化的记录可复用。工作目录保存实际审查输入、结论及必要返修记录。
3. **冻结并导入。** 用下列命令封装实际通过的审查。授权发布后，在目标卡包的 **Import cards** 加载批次 JSON，预览并点击导入。首批和续批进入同一个导入事务。卡包改名、版本过时、顺序冲突或内容会被服务端规范化时，事务拒绝整批。遇到未知结果，复用 Console 的导入恢复入口核对原操作回执。
4. **发布并回读。** 在 **Publishing** 核对当前编辑内容和预览，再确认发布。核对任务完成、公开索引及实际下载的卡包，首发同时检查 App 能找到并学习该卡包。普通卡包使用 Console 的标准发布入口。现有 AWS Architect Basics 走其绑定的 S3 **Publish batch** 路径和原有发布回执。

题库驱动的新卡包可先走[自动制卡工作流](../../tools/content-pipeline/EXAM_DECK_WORKFLOW.md)。它从原题提取判断，复用卡片，逐题回测并生成此处使用的冻结草稿。

## 一次确认导入并发布

具备发布权限的 Console 管理员，可在公开免费卡包的审查批次预览里选择 **Import and publish**。首发使用空卡包。续发要求编辑库与上一版发布时的快照一致。旧版本缺少快照、已有其他未发布编辑或有发布任务在跑时，页面提供原有的导入路径。

确认后，导入核对预览中的基线，发布再核对导入回执中的版本。任务排队后仍检查卡包、卡片和原线上版本。等待 QA 或提交失败时，可以从 **Recover saved import** 恢复同一动作。接受任务后，后台核对公开索引与实际下载的 S3 版本字节，Console 显示任务状态和核验结果。

## 跨会话接续

在原卡包的导入页，同一 Console 账号可用 **Find saved publication** 查找最近一次已确认导入。已有任务就读取原任务状态。投递未确认时可以重试原任务，仍占投递租约时继续等待。若导入已提交且版本仍一致，用 **Resume saved publication** 继续原发布操作，服务端复用原操作 ID。版本变过则回到当前稿件核对。若服务端还没有导入回执，使用已冻结的批次重新预览。

## 封装审查稿

在仓库安装好前端依赖后运行：

```sh
node frontend/scripts/deck-batch.mjs draft DRAFT.json
node frontend/scripts/deck-batch.mjs pack DRAFT.json REVIEW.json BATCH.json
```

`DRAFT.json` 的顶层是 `deckId`、`deckSlug`、`cards`。每张卡使用 Console 导入字段：

- 身份和位置为 `stableUid`、`expectedVersion`、`orderInDeck`、`difficulty`。
- `question` 和 `explanation` 是卡面。`codeSnippet`、`codeLanguage`、`realWorldUsage` 和 `topic` 没内容时填空字符串。
- `mcq`、`source`、`translations`、`frontHelp`、`teaching` 和 `tags` 保持当前服务端 JSON 结构。无对应内容时填 `null`。修改卡应从完整当前卡面出发，把要保留的字段一起交给审查。想移除已有译文的操作单独走 Console 的显式确认。
- 保留卡面内部段落换行。已有卡保持原顺序，新卡使用未占用的顺序值。

`draft` 输出冻结稿原字节的 `draftSha256`。独立审查通过以后，用该值填写实际 `REVIEW.json`，同时写明 `reviewer` 和 `cards`。评审文件中的每个卡项为 `{stableUid, verdict, note}`。只有覆盖所有卡的 `PASS` 才能封装，且每张需要实际审查说明。待修项修改后重新冻结，取得对应审查。封装和导入校验文件绑定，事实和教学质量由实际审查确认。BATCH.json 含本批正文和审查说明，应留在卡包工作目录。

使用 **Import only** 时，仍在 Publishing 单独确认发布。导入回执表示编辑库已写入。线上交付以发布和 CDN 核验回执为准。
