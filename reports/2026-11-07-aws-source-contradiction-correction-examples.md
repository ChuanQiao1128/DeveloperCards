# 容量矛盾原题：保留原文与纠错练习版

这是两项已定位原文和AWS官方上限的例子。它们不属于“服务已退役”；增加卡片不能让矛盾的原选项同时满足要求。原题与原选项均不修改。

| 原题 | 硬条件与官方事实 | 最小纠错练习版提案 |
| --- | --- | --- |
| Q52 | 原文说单个输出文件可达数百TB；EFS单文件上限47.9TiB，不能据此声称原选项C充分。 | 将单文件范围明确为几十GB至数TB，总数据量可达数百TB；继续考共享文件系统、弹性增长、多AZ与运维负担。 |
| Q324 | 原文是数百TB的单个iSCSI卷；stored单卷上限16TiB。每网关512TiB总量不等于一个卷可达该容量。 | 将原单卷明确为10TiB，继续考完整本地主数据、iSCSI接口与异步灾备；不增加原题没有的多卷重组假设。 |

这些是明确标注的纠错练习版提案，不是对原文的回写，也不是已经获得整题PASS。纠错后仍要用当前卡组独立回测；原题保留问题状态。未知或只有来源疑点的题，不能直接放入这类已确认错误的例外。

依据：

- [EFS文件系统配额](https://docs.aws.amazon.com/efs/latest/ug/limits.html)：`Size of a single file ... 47.9 TiB`。
- [Storage Gateway卷配额](https://docs.aws.amazon.com/storagegateway/latest/vgw/resource-gateway-limits.html)：stored单卷16TiB、每网关最多32卷、合计512TiB。
- [逐题独立原始证据](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/global-card-proof-20261106/review/source-a/results.json)：Q52/Q324含原文锚点、官方原句、快照哈希与偏移。

当前已接受的范围是现行AWS知识，并对官方确认过时题保留原文、纠错与考点去向。以上容量矛盾需要单列统计口径，不能悄悄当成原题充分支撑。
