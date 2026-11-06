# AWS卡数闭环验证 Skill

已创建 [aws-card-count-verify](/Users/qc/.codex/skills/aws-card-count-verify/SKILL.md)，自动发现开启。可直接使用 `$aws-card-count-verify` 接续当前验证。

目标是交付有实际卡面和逐题证据支持的全库去重数N，以及四领域的唯一主归数、包含共享卡和必要先修的实际复习数。四域主归合计必须等于N；共享引用允许重叠，不相加。

执行闭环为：复用已有考点和证据 → 用当前短卡回测完整原题 → 只修必要缺口 → 检查删除与合并 → 验证当前版本并统计。未过完成门禁，就保持未完成，不能用356项历史设计卡目代替最终N。批量删除须确保替代卡仍在最终保留集合，不能把互相替代的候选一起删掉。

用户已确认按现行AWS验收。官方确认过时的题保留原文、纠错和考点去向，优先当前有效知识；未知和未确认的题源问题仍须处理。范围决定已记入运行账本，后续不重复询问。

结构校验通过。实际前向试用已覆盖普通选型、硬条件与生产实测的边界、局部修正及完成门禁；删除集合和主归依据规则另作增量检查。Skill的校验通过不等于全题支撑通过。

当前仍在验证卡数（2026-11-06 UTC持续记录）：361候选中360项当前中文正文事实／教学通过，1项错误新部署推荐隔离。已采用补充04的9项及补充05的7项；两张教学失败稿保留，定向修复和后续候选仍在审。拟保留集合353项只是工作集合，尚非最终N。

用户还已接受独立确认错误题的最小纠错练习版验收：原题和问题证据保留，变体另存并用当前卡组独立验证，变体通过不升级原题。Q52、Q324的CV02已通过；另外44个纠错练习草稿等待审查，不算通过。19个原未知题的定向核查已有4题充分、4题具体卡面缺口、8题确认源问题、3题仍未知，旧记录保留。

1018题首轮记录已齐。当前机械绑定汇总为720充分、23条件、207待重核、19卡组不足、43题源问题、6未知；待重核主要包括正文变动失效，不能当作207个新增知识点。这里没有宣布最终总数或领域数，最终需用稳定卡组闭合逐题证据和纠错版。

执行期间连续处理未完成批次；中断后从运行账本与handoff恢复，沿用原始时钟和历史证据。没有创建后台服务、定时任务或发布操作。

- [运行账本](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/run.json)
- [当前实际中文短稿](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/deliverables/cards.current.zh.md)
- [两题实际前向试用](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/review/questions-c/skill-forward-check.md)
- [删除与归属增量试用](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/review/reduction-a/skill-forward-check.md)
