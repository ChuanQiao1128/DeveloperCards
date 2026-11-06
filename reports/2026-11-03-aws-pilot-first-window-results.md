# 首轮实际制卡结果：9张通过，6张待审

2026-11-03（Pacific/Auckland）。本轮已开始P1实际制卡并到达预算停派线；**原50题完整闭环尚未完成**。正式接受9张本地新卡，另有6张候选稿；未发布或执行OTA。

## 直接查看成果

- [9张已独立验收双语卡：Markdown](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-pilot-first-cards.md) · [带v1翻译格式的JSON](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-pilot-first-cards.json)
- [第二批6张候选稿：Markdown](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-pilot-batch02-draft.md) · [JSON](/Users/qc/Desktop/DeveloperCards/reports/2026-11-03-aws-pilot-batch02-draft.json)：仅结构/格式通过，未独立核验事实、双语与教学，不计入正式接受数量。
- [第一批独立验收原始记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-pilot50-20261103/batch-01/review-r1/review.json) · [逐卡接受凭证](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-pilot50-20261103/batch-01/accepted/acceptance.json)

## 本轮完成了什么

| 批次 | 原样本题 | 目标/卡片 | 结果 |
| --- | --- | --- | --- |
| 首批 | Q324、Q800 | 7候选目标 → 9张原创双语卡（Easy1、Rare6、Legend2） | 9张全部通过F1事实、B1双语及U1/R1/T1/S1教学和M1映射检查；原题支撑另列 |
| 第二批 | Q456、Q508 | 5个共享目标的试点变式 → 6张候选稿 | 结构与格式通过；到预算线后未派发独立Reviewer |

两批均经现有Deck Linter，分别为9/6张中文齐全、0格式问题、0警告；15个新UID唯一且与旧347集合不相交。使用真实前端解析器做JSON→Markdown→JSON回读，确认内容一致，并补齐导入格式要求的翻译schema `v:1`。这项元数据补齐未改变已审卡面文字；原审查输入保持原字节。

结构坏例覆盖缺翻译、未知引用、依赖环和私有题号泄漏，均被拒绝；首批语义控制正确识别单卷16 TiB与网关总计512 TiB的区别及中英文数字错位。

第二批限定为Q456/Q508的完整题干、全部选项、条件和父判断；全局目标其他变式及原始记录完整留存，不因试点投影计为全部目标通过。这一检查验证了范围与引用保留，尚未验证第二批卡片的语义质量。

## 卡片通过与原题闭环分开计数

| 原题 | 当前状态 | 原因 |
| --- | --- | --- |
| Q324 | source_ambiguous | 原文单卷数百TB与stored单卷16 TiB上限冲突；“不经历延迟”未量化。具体磁带到EC2恢复链仍需支撑。9张中的12 TiB组合例是明确的新教学场景，未替换原题条件。 |
| Q800 | insufficient_cards | 卡片教会网络/授权检查、层限制及成本比较，但尚未证实原生跨账户Lambda/EFS集成可行性并完整支撑原题选型。 |
| Q456、Q508 | 待独立审查 | 已有6张草稿；作者自评、检索结果和格式PASS不能计为事实或判题通过。 |
| 其余46题 | 本轮尚未制卡 | 保留在原定50题样本中。 |

因此当前充分卡片支撑 **0/50题**；已独立评估2题，另2题有待审稿。原题异常没有从50题或全库1,018题分母中删除。首批共7个判断（含1个先修候选）中，3项supported、1项source_ambiguous、3项missing；题级仍按整题规则判定。

## 实际时间与token

| 调用 | 输入token | 输出token | 可观测合计 | 写卡调用时间 |
| --- | ---: | ---: | ---: | ---: |
| 首批9张 | 46,557 | 11,676 | 58,233 | 309.968秒 |
| 第二批6张待审 | 32,838 | 9,251 | 42,089 | 208.058秒 |
| 合计 | 79,395 | 20,927 | **100,322** | **518.026秒（约8分38秒）** |

已按[获准方案](/Users/qc/Desktop/DeveloperCards/plans/2026-11-03-aws-first-card-pilot-next-step.md)的100,000可观测token停派线停止。第二次在途调用超出322 token（约0.32%），与原计划允许单条在途略超的口径一致；之后没有派发写卡、返修或独立审查调用。首批审查已在阈值前完成；第二批因此明确保留待审。

输入中46,336 cached tokens是输入的子集，未扣除；4,607 reasoning tokens已包含在输出中，未重复加。主对话、准备与原生Reviewer用量unknown；100,322不是总账单或全项目总token。旧聚合1,904,885已知下限、旧需求944,092及历史unknown记录保持。

截至本报告渲染，包含准备、监督、审查和整理的墙钟约36.7分钟；从首次内容派发约29.7分钟。这是本轮实际窗口快照，CLI生成秒数不代表完整墙钟。

## 对速度与下一步的判断

已经产出实际卡片，但本轮数据不足以外推全1,018题工期：充分闭环题数为0，最终卡数也未确定。9张合格卡的首批CLI消耗为58,233 token；第二批6张待审的成本不能混作6张合格卡成本。

第二批输入从首批约92.5KB缩到约38.4KB，实际输入仍有32,838 token；文件字节比例不能直接估计完整模型请求用量。原按首批比例加12,000输出储备的估计为31,350，实际为42,089，说明该预算估法偏低。后续应给终审/返修预留明确额度，并依据实际请求用量安排批量，先验收现有草稿再派新的作者调用。

续接顺序：先独立审查6张草稿，核对其中7项作者提出的证据候选缺口；再定向补Q800的官方集成依据和必要卡面，Q324保留真实来源缺陷。只修失败或缺支撑的受影响部分，继续保留当前9张已接受版本，按原样本推进。新调用需要明确的后续预算窗口；本轮计数、时钟和历史证据不重置。

运行证据：/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-pilot50-20261103。完整性、预算与身份回读见[交付检查](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-pilot50-20261103/final-readback.json)；开放缺口见[支撑账本](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/card-pilot50-20261103/unresolved-support-ledger.json)。手机、离线、学习记录和生产发布/OTA留待后续门禁，本轮均未执行。
