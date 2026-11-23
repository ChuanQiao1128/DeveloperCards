# 从题库制作 RecallSmith 卡包

给 Codex 一份题库、卡包 slug 和可信官方文档范围。流程会为整套题确定需要掌握的判断，找出可共享的规则，再查证据、写双语短卡、审查和回测。卡片数量由实际复用和逐题支撑决定。所有卡片采用项目当前的手机短卡规则。

## 输入

运行清单示例

```json
{
  "deckSlug": "aws-foundations-practice",
  "questions": "exam.json",
  "questionCount": 1,
  "sourceHosts": ["docs.aws.amazon.com"],
  "sources": ["https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html"]
}
```

题库 JSON 是一个数组。每题的 `id` 唯一，`text` 保留完整题干，`choices` 保留全部原选项，`answer` 是可选的原题答案键数组。题干和选项里保留原始条件；把附录答案和解析留在题干之外。

```json
[
  {
    "id": "Q1",
    "text": "What identifies one object inside an Amazon S3 bucket?",
    "choices": {"A": "An object key.", "B": "An Availability Zone ID."},
    "answer": ["A"]
  }
]
```

现有 AWS 归档的 `questions.all.json` 可直接读取。重复选项标签用原顺序号区分。

也接受有文字层、使用 `Question 1` 或 `Q1` 标记及 `A.` 或 `A)` 选项的 PDF。PDF 需要填实际 `questionCount`，并在 PATH 提供 `pdftotext`。扫描件和其他版式先转为上述 JSON，保留全部题干和选项。

`sources` 可列出相关官方文档作为起点。规划会补充允许域名内的文档候选，真正取到的官方原文才进入证据包。不同考试换清单和官方域名，沿用同一流程。题库答案用于核对结果，卡片技术事实依赖官方文档。单题完整 JSON 至多 40,000 个 UTF-16 代码单元，给卡面与审查规则保留上下文。

可用 `evidenceHints` 为已知缺口提供决定性的官方段落。键是原题 ID，每题可给 1–5 组 `{"url": "...", "quote": "..."}`。引用必须逐字出现在允许域名的实际下载段落中。构包优先给相关卡片和独立题源审查提供这些段落，卡面回测仍只读原题和可见卡面。

## 运行和接续

准备已登录 ChatGPT 的本地 Codex CLI、现有 Workbench 支持的 .NET 10 SDK、Node 前端依赖。工作流沿用 Workbench 的受限独立上下文与订阅通道。

```sh
dotnet build tools/content-workbench/Workbench
uv run --frozen --project evals python tools/content-pipeline/exam_deck.py \
  /absolute/path/manifest.json --output /absolute/private/path/new-run
```

重复同一命令可以继续。每个已完成请求的输入、schema、结果和执行日志绑定哈希。重跑按原计划检查这些记录，材料一致就复用。未知投递保留现场供 Workbench 核对。临时网络超时或部分服务端故障会先有限重试，再冻结实际下载结果。下载成功与失败均保留在本次运行，换一份来源清单需开新运行。输出目录仅供本机当前用户访问。

1. 分批提取必要判断，复用旧规则，再独立核查全局的相似候选。只有适用条件、判断和机制等价的候选才能合并。
2. 用本地 BM25 找官方段落，按规则批量写卡。答案和原因各须有确切原句，独立 Codex 审查事实、双语等义、手机阅读、回忆任务和迁移。
3. 回测时提供完整原题、选项、可见卡面及判断和卡片的对应关系。题目明确要求选几项时按该数量核验。每个必要判断及选项判定都必须有文字证据。原题答案键和规划阶段的判断描述留在回测输入之外。有原题或答案键疑点时另查官方证据。
4. 待修卡自动定向重写并独立复审。回测有缺口时，只重规划相关题。修共享卡后，所有依赖旧正文的题都会重新回测。达到自动修复轮次上限时保留缺口、旧失败和已验证成果，状态为 `incomplete`。

## 验收产物

- `cards.md` 是双语阅读稿。
- `round-*.json` 保存逐题、规则、卡面、官方原文和历轮审查。
- `result.json` 汇总充分支撑的原题、证实答案键有误的可解题、确认题源有问题的题及仍待修题。后两类原题问题分别登记。全部为已确认题源问题时，结果为 `source_issues_only`，保留报告且生成零个卡包。
- `delivery/batch-*/reviewed-batch.json` 是在整套卡包的每个批次都通过真实 Console 构包校验及空牌组导入计划检查后统一交付的批次。对应目标牌组应为英文主语言，附简体中文译文。省略 `deckId` 时只带测试编号，适用于本地验收。正式发布按现有 Console 流程和用户授权执行。

自动测试

```sh
uv run --frozen --project evals python -m unittest discover \
  -s tools/content-pipeline -p test_exam_deck.py -v
```
