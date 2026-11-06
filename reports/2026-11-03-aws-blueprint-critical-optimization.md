# 全量蓝图的批判性审查与自动优化

日期：2026-11-03（Pacific/Auckland）。范围：1,018题、1,532候选学习目标、1,566待核验主题。本轮完成结构审计、候选风险识别和制卡输入准备的自动优化；正式新卡仍0，最终N未知。

现有蓝图的来源与关系完整。它适合作为候选索引；直接按1,532条逐一发单，会承担重复卡片、重复研究和过宽目标的风险。本轮保留已验收版本，增加一个可直接生成小批输入的执行层。候选数量保持1,532；没有依据相似度删除目标，也没有把教学或AWS事实的未知写成PASS。

## 关键判断与已做的优化

| 发现 | 证据与影响 | 本轮实际处理 |
| --- | --- | --- |
| 场景目标仍较分散 | 1,193/1,532目标、1,276/1,566主题仅关联一道题。这是候选索引的分散度，不能据此判定重复。 | 全量保留原条件与变式；共享检索和来源上下文，分开记录学习目标、核验义务、检索候选与最终卡片。 |
| 合并主题缺逐项证据状态 | 296主题含多个原疑问，997主题关联多个目标。一个官方片段可能只支持其中一部分。 | 将1,636个归并前主题逐一与其原疑问展开，生成**2,069条核验义务**；保留原问题、原scope、原始待核验文本、判断、场景和目标映射，每项独立pending。 |
| Legend可能重复先修内容 | 46个Legend与唯一先修的needRefs相同，其中33组连主题也相同；这不等于46组均应合并。 | 增加“额外整合/迁移判据”门槛与处置队列。若写卡时没有额外判据，可提出同卡场景变式，继续保留两目标的映射与修复谱系。 |
| 先修候选不等于已教会的先修 | 156个原先修候选映射到236目标；筛出67条候选关系，涉及59个目标，仍需判断适用性。 | 保留sourceKind；候选关系逐条待定为taught_here、requires_other_unit或not_required_with_reason，未自动添加依赖边。 |
| 部分Easy或目标边界过宽 | 例如obj-b16-g56涵盖9题、10主题，跨访问、取回、可用性、持久性与计费；高关联数本身不证明必须拆卡。 | 为全部1,532目标增加制卡处置与答案判据的pending状态；52个高关联目标加边界审查标记，实际制卡时确定收窄、拆分或组合。 |

### 两个具体例子

**Q776**：Rare obj-b01-g30已经比较快照、复制、亚毫秒响应及接入条件；Legend obj-b01-g31仍以同一父判断比较迁库或RDS前置缓存。写两张卡前，应能说明Legend新增的整合问题及自评要点。若答案实际上重复，应提交一个目标到同卡变式的映射决定，而非为了层级多写一张卡。当前只标记风险，没有未经审查的删并。

**Q730**：比较减少数据库请求与扩容时，缓存的读取重复度、更新和新鲜度是相关前提。原先修候选Q730:j3与obj-b14-g2相连，但obj-b14-g47没有对应compositionRefs。输入包已显式带入该候选关系与相关目标，作者须说明本卡是否教授该前提、依赖哪一窄目标，或为何不需要。候选提供者可能有其他变式，不能整包视为已接受先修。

## 自动优化后的实际产物

- [执行层入口](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/optimized-blueprint.json)：绑定原五文件版本，并索引本次全部产物。
- [全量目标制卡契约](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/goal-contracts.jsonl)：1,532条，保留来源角色、先修、相关义务和未决门槛。
- [逐项核验义务](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/verification-obligations.jsonl)：2,069条，对应1,080个原始疑问；这是验收追踪粒度，**不是2,069次模型作业或卡数**。
- [共享官方候选文档清单](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/shared-document-worklist.json)：缓存语料内的检索候选，逐URL共享读取。
- [处置队列](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/review-queue.json)：46个Legend触发项、67条先修建议、52个宽范围触发项；保留265条未审需求、109道来源异常题及既有UNKNOWN/边界近邻记录。
- [实际5目标输入包](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/demo-author-input.json)与[输入包生成器](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/packet.py)：场景、原题及全部选项、待核验义务、官方候选片段与教学规则均进入同一个输入包；引文与场景按ID共享。

原[全量候选蓝图](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-candidate-objective-blueprint.md)及五文件索引保持原字节。新执行层补充制卡契约和检索准备，供下一阶段消费。

## 测量：哪些确实减少了重复

使用既有官方语料快照与项目既有BM25代码，本地执行，无新增内容CLI/API调用；没有读取旧卡正文、旧目标目录或印刷答案。

| 项目 | 本次结果 | 能支持的结论 |
| --- | ---: | --- |
| 逐场景核验义务 | 2,069 | 支持分别记录义务状态，不会因主题合并丢失原要求 |
| 不同检索词集合 | 1,764 | 对同一词集合只做一次本地检索；词集合相同不代表义务等价 |
| 候选页面出现次数 / 不同URL | 5,292 / 310 | 可按URL缓存共享；尚未证明这些页面足够或相关 |
| 不同候选片段 | 1,131 | 片段正文、URL、源版本和文本哈希固定，支持追溯 |
| 演示输入 | 5个选定目标＋1个候选先修上下文，6道来源题、9项义务、23个不同片段 | 已实际生成并校验；尚未发送作者或完成制卡 |
| 同上下文JSON表示 | 133,362 → 101,808 UTF-8字节，减少23.7% | 仅此示例的表示压缩；不是token、工时或质量提升实测 |

检索候选使用本地已缓存的AWS官方文档快照。当前性、引文适用范围与事实支持仍待核验；检索分数不作为PASS。新增核验义务能共享同一段官方引文，每项的语义适用性仍独立判断。

## 验收证据与边界

[独立原蓝图审查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/independent-critical-review.json)遍历全部五文件结构，并对明确列出的代表目标、主题和原题作语义检查；没有声称独立逐条复审全部语义。

[确定性回读](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/checks.json)验证原输入哈希、全部目标/义务与来源的精确连接、pending状态、逐项映射、候选片段原文及版本，并实际生成5目标输入。8个隔离坏例覆盖删除义务、伪造目标接受、篡改父判断角色、伪造证据通过、抹去未审来源门槛、跨题义务错绑、遗漏输入场景与悬空检索义务，均被拒绝。[单Legend依赖输入检查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/dependency-packet-check.json)另验证先修按上下文进入。

[本次执行层的独立验收](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/final-independent-review-r2.json)只验收上述派生产物、约束与输入准备，不证明AWS事实、卡片质量或最终题卡覆盖。全部2,069义务仍pending，265条来源需求未升级；原来的1项归并UNKNOWN及13目标/8主题边界近邻继续保留。

本轮第一次独立验收发现派生映射过宽：共享主题的目标被复制到每个来源义务，形成865条缺少原始判断交集的required关系，其中860条跨题。已将原4,300条主题关联完整留作历史映射，按判断交集得到3,435条required关系，其余5条同题关系保留pending applicability；没有删去任何义务或目标。输入包按实际义务补全来源场景，并将全局检索引用裁剪到当前输入的义务集合。原版本和FAIL证据留在[首次版本归档](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/revision-v1/relocation-manifest.json)及[首次独立报告](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/final-independent-review.json)，[跨题回归](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/blueprint-critical-optimization-20261103/cross-case-packet-regression.json)检查obj-b01-g11不再承担Q259/Q863的义务。

## 下一步的执行方式

1. 沿用原定50题范围。先选5～10个实际目标，用本次生成器准备完整输入；输入上限120,000字节，超限直接要求收窄/缩小批量，不截断条件或引文。疑似重复、宽目标及候选先修在受影响批次解决。
2. 对当前批次的相关义务，核对官方引文的事实、边界及当前性；相关来源语义、异常和教学边界在同次作者/独立Reviewer闭环处理。完成原定双语卡，背面继续为答／考点／易错提醒；教学、事实和逐题支撑分别验收。
3. 记录实际制卡的时间与token后再决定扩量。无需先把2,069条义务各跑一次独立模型研究；按主题共享证据，模型只接收当前批次相关内容，已有合格项只在受影响时重审。

生产作者/控制器尚未调用本次适配器；本轮已准备输入并验证消费关系。既有CLI用量已知下限1,904,885和一次usage未知记录保持；本轮原生审查/监督token unknown。正式新卡0、N未知，旧347禁用范围与线上内容保持，自动化PAUSED，发布和OTA未开始。
