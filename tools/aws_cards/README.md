# AWS卡片生成入口

## 按领域查询现有蓝图

`domain_index.py` 是本地引用索引工具，提供领域、官方任务、考点和原题四种查询。当前索引入口见[领域索引与审查结果](/Users/qc/Desktop/DeveloperCards/reports/2026-11-04-aws-domain-index.md)；机器入口也登记在权威run.json的`fourDomainOrganization.indexManifestPath`。

```sh
python3 tools/aws_cards/domain_index.py check /absolute/path/manifest.json
python3 tools/aws_cards/domain_index.py lookup /absolute/path/manifest.json task 1.2
python3 tools/aws_cards/domain_index.py lookup /absolute/path/manifest.json objective obj-b03-g6
python3 tools/aws_cards/domain_index.py lookup /absolute/path/manifest.json question 456
```

领域/任务查询给出由现有题目分类带入的候选目标；考点查询保留其全局题目、全部当前条件和变式。考点主归未据题目标签自动裁定，`not_assessed_by_this_index`也不代表题目已获卡片完整支撑。

当前接受卡数量与入口以权威run.json及其indexManifestPath为准，未推测逐目标绑定；空`objectiveBindings`不等于无卡。正式发起作者任务前，应先核对已有卡并建立有依据的绑定，避免重复出卡。

蓝图、分类或接受卡清单变更会触发版本检查；刷新引用快照即可，无需重新提取需求。索引构建与查询不调用模型、不修改原数据、不生成卡片。

新索引工具的边界检查：

```sh
python3 -m unittest discover -s tools/aws_cards -p test_domain_index.py -v
```

## 正式卡片生成

固定入口为 `pipeline.py`。复用已有Codex CLI作者、七项独立语义验收与RecallSmith实际导入器。普通批次5～10张；脚本自动构包、恢复、生成作者任务、按卡复审、打包与校验，不自动发布。

## 先运行现有15张回放

在 `/Users/qc/Desktop/DeveloperCards` 执行：

```sh
/Users/qc/.local/share/codex-skill-runtimes/graphify-0.9.94/bin/python tools/aws_cards/pipeline.py tools/aws_cards/replay-15.json
```

这是已有接受版本的本地回放，没有新的制卡调用。输出目录由manifest的stage指定。`state.json`是当前状态，`artifactDirectory`指向本次通过校验的版本目录（`deliverables/<版本>/`），含可读双语MD、Deck MD、canonical JSON。不要仅凭旧固定路径或旧完成时间选交付。回放可以重复执行，原作者与独立审查原件不改。

## 后续新批次

使用新manifest，填写新stage、输入packet、官方快照目录，以及已授权的generationLedger。新批次省略candidate字段。

正式新批次必须设置`checkQuestions: true`及下述`closeout`；新作者入口会拒绝省略这两项的配置。仅处理既有证据的累计回放可显式设置`replayOnly: true`，该模式禁止派作者。

```sh
/Users/qc/.local/share/codex-skill-runtimes/graphify-0.9.94/bin/python tools/aws_cards/pipeline.py /absolute/path/batch-manifest.json --author
```

- 不加`--author`时只构包和处理已有产物，不调用作者。
- 作者沿用既有CLI、模型/effort与全局单模型锁；generationLedger必须已有policy/progress。脚本不创建预算窗口、不清零token、时钟或已有修复次数；原调用未完成、usage缺失、超限、输入变更均停止并保留现场。
- 首次作者输出只能通过冻结input/prompt/schema、成功result与mechanical-check恢复。仅输出文件存在不够。
- 显式candidate用于指定冻结回放/修订稿，不代表它已通过当前语义验收。

## 独立审查交接

出现`needs_independent_review`时，当前主Agent读取request路径和同目录reviewer-prompt.md，以`fork_turns: none`派发Reviewer，仅传冻结输入与允许来源。输出写入该目录的`output.json`后，再执行同一命令，脚本自动核验并继续。

Python脚本不能直接调用主Agent的原生子Agent工具；这个交接明确保留。脚本不把schema、引用存在或缓存命中当成新的语义审查。

每张卡首次需要FACT/B1/U1/R1/T1/S1/P1全部PASS。代表Rare保留每批至少2张（不足2张时取全部）的条件迁移验证。修订后只重审失效卡，必要先修作为上下文；已绑定且未变化的迁移证据可保留。

`checkQuestions: true`将规范原题题干、全部选项和已有需求中的条件／必要判断／异常放入同一冻结交接，不重复提炼考点。Reviewer同次输出`questionSupport`，逐题逐判断记录当前卡文锚点、支撑卡、缺口及`sufficient_decision_support / partial / unknown`。七项卡片PASS与整题支撑分开，不能将partial自动升级。上下文仅去掉偏移、历史PASS叙述等机械元数据，完整原数据仍在source-bindings.json。

题卡支撑按相关卡及递归先修的完整指纹复用；改来源、规则、评分或先修也会使相关结果失效。仅变化题目进入补审，已有单题补审可跨后续批内修正复用。缺少完整绑定的旧题卡报告保留原结论为历史，并在新累计视图中标`needs_recheck`，不据此自动撤销或升级现有线上记录。

- 卡片、评分要点、引用原句/偏移/源文本版本、规则、标准或递归先修变化，都会使对应PASS失效。
- 缓存凭证回查原始冻结输入、工件、独立报告和文件哈希，不凭一个手填PASS放行。
- 初审发现一张失败时，其他真正PASS的卡可保留。相同失败版本返回`needs_repair`，不原样重复派审。
- 修订稿用新文件保存并更新manifest的candidate。未闭合失败的修复候选按UID计数，继承repairHistoryPaths已有次数，受原policy上限约束；原FAIL与闭合记录保留。普通已验收版本的新修订不会重新开启旧已闭合失败。
- S1在作者与Reviewer同次检查：开放题的等价答案范围必须与评分一致；限定工具的机制题应在题面明确。
- 作者同次检查合法反例：共用/不同路由表、直连/经ALB、同/跨Region、发起方/接收方；补教学前提时记录范围变化，不替原题补条件。该提示不保证语义正确，独立审查继续保留。
- `supervisor-handoff.json`自动列出稳定发现ID、变更字段、失效目标与当前请求位置；它供主Agent路由，不传给独立Reviewer。相同review请求在一次运行中只验证一次，缓存仍回查原件。

局部题卡复审可复用已验证审查记录中的关联并集来缩小`contextCards`，同时保留所有待审卡和递归先修；题干、全部选项、原需求、教学标准和保留摘录原文不变。来源题／需求不匹配、缺少／空映射、存在未知判断或非背景判断无支撑卡时使用完整上下文；卡身份集合变化时旧题目结果也不复用，必须重核。`questionCardFingerprints`绑定实际提供的卡，`questionReviewUniverse`记录完整卡集合，供路由与未知／不完整映射的保守失效使用；旧状态、旧解释不传给Reviewer，也不据映射沿用失效PASS。新审查提示要求通过项简述，失败／未知、迁移及逐判断锚点／缺口保留，不减少七项语义检查。旧冻结请求不改。

未知或逐判断关联不完整的题目结果绑定当时整个卡集合的指纹；任一卡变化都会使该题结果失效，重新进入完整上下文审查，不能因`cardKeys`为空而永久沿用旧结果。

## 一条命令完成本地收尾

在新manifest加入：

```json
{
  "checkQuestions": true,
  "closeout": {
    "previousIndexManifest": "/absolute/path/current-domain-index/manifest.json",
    "previousQuestionSupport": "/absolute/path/previous/question-support.cumulative.json",
    "runPath": "/absolute/path/run.json",
    "expectedRuntimeSha256": "开工前run.json的SHA-256",
    "commitRuntime": true
  }
}
```

继续执行同一`pipeline.py manifest.json`命令。脚本先完成全部语义门禁及真实Linter/导入回读，再由`closeout.py`合并累计卡清单、区分新增／修订／复用、合并题卡状态、调用既有领域索引构建器刷新引用，生成摘要与产物绑定。全部校验后以原run哈希为前提原子更新run.json；预算、原50题试验、旧分析及学习记录不重置。`commitRuntime: false`只在新目录生成运行快照，适合隔离验收。

收尾中断可从准备好的版本继续；重复执行不重复计卡。同一runtime的制卡收尾使用共享文件锁，在锁内重新比较完整run哈希、原子替换并回读当前索引，避免两个收尾进程覆盖彼此。同数量替换也由完整run哈希及当前索引路径/哈希检测。旧`domain_index.py check`的数量保护不足以单独证明索引是当前版本；生产收尾另外调用`closeout.check_current`核对完整指针。不要拿任意旧索引路径当权威入口。

首次预检在15秒内尝试读取必需脚本、题源、官方快照、索引源文件和分类CSV；文件不可用则先停，避免制卡结束后才等待iCloud。它只验证文件可用，不取代后续事实与语义核查。失败重跑会先清除当前完成状态，旧完成时间移入历史，原起始时间和阶段记录保留。

累计接受数可由清单确定；历史上曾出现但已退回的UID总数不从当前接受清单猜测。收尾保留旧接受链引用，该历史统计需从完整历史UID账本另行核对。

## 输入与计时

packet沿用当前结构：questions、cards（每项含stableUid、cardKey、kind、learningGoal、frontZh/条件、focusHint）、officialEvidence（原句、URL、偏移、源及摘录SHA-256）。可以附加原题条件和异常，脚本保留它们；旧答案正文及模型不需要的来源元数据只在作者输入中省去，完整源绑定另存。

当前实现不截短官方摘录、不删除场景限定。模型输出省去可本地绑定的UID及重复supportedClaim描述；双语正文、必要评分条件、引用映射与实际范围变化保留。

`timings.json`从脚本首次进入记录，包含构包、作者、导出及校验；完成时间在全部交付步骤后写入。多次运行保留原开始时间，失败阶段也记账；原生Agent token保持unknown。本地回放速度不代表模型制卡速度，12～15分钟/15张仍是待实测目标。

输入packet、candidate和旧审查放在stage以外，避免覆盖冻结输入。每批先修须能在本批定位，缺失或依赖环会拒绝；跨批先修尚需在输入构包层显式组织，不静默跳过。

## 验证

```sh
/Users/qc/.local/share/codex-skill-runtimes/graphify-0.9.94/bin/python -m unittest discover -s tools/aws_cards -p 'test_*.py' -v
```

测试覆盖单卡变动、先修传播、来源/标准/规则变动、过期/矛盾PASS、循环依赖、最小复审交接、作者首次派发与中断恢复、有界修复及完整计时。测试中的作者为本地stub，不产生制卡调用。

## 先构包再进行原生写作

普通批次直接使用固定命令，先记总时钟，再准备输入：

```sh
python3 tools/aws_cards/pipeline.py /absolute/path/new-stage --begin
python3 tools/aws_cards/pipeline.py /absolute/path/selection.json --prepare
```

`--prepare`不派作者，输出manifest和冻结author-input路径。selection最少只需`stage`、`qids`、`cards`（5–10个有依据的新目标）和`reuseEvidence`四项。其余基础配置默认复用本项目入口；基础设施有变化时仍可显式提供runPath、inputDirectory、sourceDir、baseManifest、batchId、uidPrefix或deliveryReport。UID去重和当前run/索引绑定保留。

例如`reuseEvidence`中一个分组为：

```json
{"packet":"/absolute/path/previous/packet.json","ids":{"I1":"ROLE_TRUST","I2":"ROOT_POLICY"}}
```

省略重命名时，ids也可用字符串数组。脚本校验旧摘录的URL、全文哈希、原句、字符偏移和成功状态，自动复制对应完整官方快照。正文篡改、越界/非整数偏移、来源ID重复、别名冲突均拒绝。复用材料不等于新的事实或教学PASS，仍走完整独立审查。新增事实缺证时才定向补源，可继续使用`evidence`的file/startText/endText边界，不为每批重写下载/复制脚本。

同一selection重试会核验冻结绑定，不覆盖或悄悄换输入；完整manifest缺失但已有准备文件时保留现场并拒绝重绑。普通manifest执行也不会重写已冻结作者输入；新版本candidate修正可继续使用原manifest入口。旧manifest命令不变。

新输入开启`compactAuthor`，保留原题/选项/需求语义，机械坐标与旧审查留source-bindings。原生作者实际读取冻结输入，直接将卡片JSON写到candidate路径，再执行同一pipeline命令；不要另写正文装载脚本。`deliveryReport`启用自动阅读报告、缺口表、计时和最终回读。工具接入时间及准备时间计入task-clock，不当作免费预处理。局部复审缩包尚未启用。

`--begin`重复执行不会清零起点，并记录核心工具版本。交付时标记工具版本是否变化；旧时钟未记录版本则显示未知，不估算或扣除维护分钟。正常出卡按当前知识组接续，不每批重新通览全库或设计另一套流程；工具维护另列，但总计时始终保留。
