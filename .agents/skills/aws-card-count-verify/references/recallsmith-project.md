# RecallSmith项目入口

适用工作区：`/Users/qc/Desktop/DeveloperCards`。先读工作区`AGENTS.md`中第4节教学标准和第5节证据复用规则；这里不复制它们。

运行根目录：

`/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102`

当前题库为1018题，Q868由用户排除；原始分类保留1019题。四领域是知识导航，同卡跨领域引用。全库约300多张是产品目标，不是用来强行裁剪必要知识的验收证明。

用户已确认按**现行AWS知识**验收：官方确认过时的题保留原文、纠错与考点去向，优先用当前有效知识覆盖。决定在本次运行的`inputs/user-knowledge-scope-accepted.json`。不用重复询问这一范围；仍面向既有合格客户提供的服务不能一概当作退役，未确认的源问题也不因此自动豁免。

用户随后接受了**独立确认错误题的最小纠错练习版验收**，决定在`inputs/user-source-correction-policy-accepted.json`：原文和问题证据保留，纠错版另存并用实际卡组独立验证，纠错版通过不升级原题充分性。未知题继续核查，不能据此自动豁免或编造原文；这一口径也不再重复询问。

## 原题欠定与技术事实未知

技术能力尚未查清时保留`UNKNOWN`，不能据此改题或豁免。若能力已有官方正证，且独立审查能构造两个都满足原题明示条件、却导致不同选择或不同可行性的具体情境，则可确认题面缺少决定性输入，记`SOURCE_ISSUE`的`decisive_input_missing`子类。此时未知的是原场景真实取值；题面信息不足可以有确定证据。普通实施省略、未做生产实测或任意想象的配置差异，不足以作此确认。

最小纠错练习可以只补该项必要输入，或改为选择全部有效方案；新增输入须明确是练习设定，不倒写成原题事实。独立验收不要求、也不允许声称恢复原作者未写出的隐含值。仍须保留原目标和已有约束，优先多选而非加入不相关工具偏好强迫唯一答案。普通架构选型本来可判时，继续作选型证明，不扩大题源问题范围。原题与练习版的状态、证据和统计始终分开。

## 接续正在执行的实际内容验证

子目录`global-card-proof-20261106/`：

- `run.json`、`rules.md`、`inputs/source-manifest.json`：本次执行范围、真实起点和冻结来源；保留原始时钟。
- `inputs/card-catalogue.frozen-design.json`：356项设计清单。356不是最终实卡覆盖PASS。
- `inputs/question-allocation1018.json`：现有关系，作为检索和验证范围，不替代实际支撑证明。
- `inputs/existing176.json`、`inputs/new180.json`：已有中文原型与待落实任务；任务数据数量以实时文件为准。
- `drafts/batch*.json`、`drafts/repair*.json`：本轮作者实际短稿和显式修订。原批与失败版本不覆盖。
- `assemble_current.py`、`deliverables/cards.current.json`、`validation/body-progress.json`：已有正文组装与进度工具。先检查是否仍适配当前修订文件；组装成功不代表语义通过。
- `review/reuse-a/reuse-results.json`、`question-reuse371.json`：原型与旧整题证明的独立复用资格。只有当前依赖未变化时有效，原CONDITIONAL/SOURCE_ISSUE不升级为充分。
- `review/cards-c/`、`review/reuse-a/batch*.review.json`：新正文事实/教学审查；读当前正文绑定及修订谱系，不能仅统计PASS字样。
- `review/source-a/results.json`：100题疑点复核的独立原始结果。确认源问题、解除疑点与UNKNOWN各有记录；须检查原文证据，疑点报告本身不是绝对权威。
- `review/questions-*/input/`：实际卡组与完整原题的冻结回测包；只处理尚未完成或因正文变动失效的包。

这是持续任务，中断恢复时先核对活跃Agent及已落盘产物，勿再提取1018题、再建同一套蓝图或重新派已有有效审查。

## 原始素材与官方依据

- 原题：运行根下`domain1-final-card-catalog-20261105/questions.all.json`，完整题干和选项，不含可用来代替推理的印刷答案。
- 既有需求：`needs-index-objectives-reviewed-20261104/needs.jsonl`，1018条、1697判断；是候选学习范围，非逐项必背清单。
- 原177项原型及旧371题完整证明：`domain1-compression80-20261106/deliverables/`。原文件只读。
- 官方目录：`domain1-final-card-catalog-20261105/official-sources.catalog.json`，定位已有AWS快照。
- 公共官方缓存：运行根上两级的`corpus/`及`retrieval-v3/corpus/`；本轮新证据在`global-card-proof-20261106/evidence/`。
- 原卡数核算：`global-card-count-closure-20261106/acceptance.json`和`final-review/final-readback.json`仅通过设计计数，明确未通过实卡、唯一答案或学习效果验收。

普通正式出卡入口仍是工作区`tools/aws_cards/pipeline.py`。这次先核验中文正文和数量，不为了执行它而自动启动CLI作者、双语封装、发布或创建预算。后续复用已有脚本，确有适配缺口才做局部修正。
