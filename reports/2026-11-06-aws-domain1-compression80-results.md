# 领域1：80题差异压缩与回查结果

本轮把197项中文候选回忆任务压缩到**177项，净减20项（10.2%）**。逐项处置80题差异，175道受影响题完成独立回查，196道复用正文与完整依赖均未变的原证明；371题记录全部保留。

**177仍偏多，也不是已证明的最少卡数或最终排产量。** 本轮没有证明全库约300张已经足够。正式62张双语接受库存、旧197版封口及生产指针保持；未发布、未恢复自动化。

| 数量如何变化 | 项数 |
|---|---:|
| 原中文候选池 |197|
| 35项旧任务合成17项共享任务 |−18|
| 撤掉原题不要求另背的2项实现细节 |−2|
| 两张现有卡定向补清边界 |数量不变|
| 当前完整可见候选池 |**177**|

25组合并尝试中，17组最终保留，8组恢复父卡。恢复原因包括独立任务相加、记忆清单、或全题回查发现必要机制丢失；没有把这些内容搬到隐藏补充卡。

80题实际去向：15题的单题任务已并入共享任务，2题撤掉额外实现任务并保留原有必要卡组，1题修正原有任务，62题本轮保留对应任务。初审“可吸收”只是候选方向，不能把34个建议自动算成34次成功合并。完整对应见[80题逐项处置](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-domain1-tail80-disposition.md)。

| 371题的当前设计支撑 | 题数 | 含义 |
|---|---:|---|
| SUPPORTED |272|当前可见卡组支撑必要判断|
| CONDITIONAL |59|满足记录的Region、账户、费率或其他前提时成立|
| SOURCE_ISSUE |40|原题多解、选项冲突或来源/适用性疑点继续保留|

可判及条件题没有剩余INSUFFICIENT。40道源疑点题中的未决判断仍在账本，不能把它们当作371道题都能唯一作答。旧基线为280/57/34，本轮如实更新为272/59/40；没有为守住旧计数压掉新发现的问题。设计支撑不等于已测得学习者正确率或延迟记忆效果。

本轮关闭的具体问题：

- Q104：CloudFront合并稿不足以解释DDoS用途，恢复CA13与费用卡XA055；恢复后的真实卡组独立回查通过。
- Q787：Control Tower合并稿漏了必须从组织管理账户建立landing zone，恢复NC05/XA023。原完整依赖复原后复用原证明；同属影响链的Q151另行复核。
- Q491/Q587：区分正确方案不要求另背轮询删消息、service proxy请求映射，撤掉两项独立实现任务；最终卡组回查通过。
- Q657：原卡能说明共享CIDR机制，却没有必要费用比较。XA030补AWS RAM无额外共享费与Firewall Manager安全组策略/相关Config收费的官方依据，未新增卡。
- Q334/Q832：XB014明确用AD Connector桥接本地AD。官方支持该接法；Q334可判，Q832选项3明确可行，泛称选项4可能概括同一实现，保留题源重叠。

两张现有卡的事实、教学和自评已独立复核；最终Q151/Q334/Q657/Q832四题又用真实可见卡组回读。审查凭证保留原先修ID，最终先修经别名指向共享任务；两个学习签名不冒称字节相同，最终完整学习任务与卡组另有绑定。

当前177项在领域1内的实际用途：69项用于至少3道可判/条件题，28项用于2题，68项用于1题，12项仅用于源疑点机制或先修。**只复习前97项能覆盖全部领域1，尚未得到证明。** 其余80项继续计入候选总负担，不能删掉计数后宣称覆盖；是否进入全库核心包，仍须按跨领域复用与必要性选择。

这轮结果说明：逐对合并既有卡可以消掉重复，但不能保证达到约300张的产品目标。后续应在全库共享题族中选卡，优先重新选择/替换低复用任务；不应直接把177项全部双语化投产，也不应把领域数乘以177。

**成果入口**

- [177项完整中文候选卡目](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-domain1-compressed-catalogue.md)：完整正背面与各项原题用途；包含保留项，不是只有新合并稿。
- [80题处置表](/Users/qc/Desktop/DeveloperCards/reports/2026-11-06-aws-domain1-tail80-disposition.md)：旧任务、当前卡组、判题状态逐题可查。
- [371题完整设计支撑账本](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-compression80-20261106/deliverables/question-support371.json)：条件、源问题、逐字卡面锚点及证明版本。
- [197项旧任务唯一去向](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-compression80-20261106/deliverables/old197-destinations.json)与[双向索引](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-compression80-20261106/deliverables/bidirectional-index.json)。

本轮保留的共享合并任务：

| 任务 | 替换旧项 | 中文回忆任务 |
|---|---|---|
|M01|NC08 + NC09|低频存储先看能否等待恢复|
|M02|CB07 + CB08|访问者位置改变端点路径|
|M03|NC14 + aws-rb2-domain1-normal-batch07-20261105-s3-default-versus-existing-copy|默认设置与存量改造分开|
|M04|CB09 + XB015|PrivateLink发布与接入各在一侧|
|M05|CA04 + CA05|组织限制按成员账户范围生效|
|M06|CA06 + CA07|把权限交给实际运行代码的身份|
|M07|CA01 + aws-rb2-20261105-boundary-secret-primary-replica-rotation|轮换数据库密码，而非只换加密密钥|
|M08|CA02 + aws-rb2-20261103-b01-layers-are-deployment-assets|共享取值代码，秘密仍在运行时读取|
|M09|XA001 + XA002|策略条件先分清在检查谁|
|M10|CB14 + XB007 + aws-rb2-20261105-net-cross-region-peer-source|每一跳放行真正的发起者|
|M11|SC02 + XA034|静态加密和专线不替代TLS|
|M15|NC13 + XB009|转录后的文字还需要什么处理|
|M16|CC11 + CC12|保留期防删与到期清理分工|
|M19|CA14 + XB017|保留SFTP，后端按文件语义选择|
|M20|CC04 + XA052|加密位置决定存储是否先收到明文|
|M22|CB11 + XR103|DDoS防护绑定实际公网入口|
|M25|CB17 + XR104|私有数据库要走SQL路径|

用量与时间：新增模型CLI/API调用0，原生会话token未知，历史账本未清零。这是候选压缩及题目回查，并非普通批次制卡速度测试。首条记录前的准备耗时未知，记录区间包含对话中断、等待与一次输入恢复事故，未分段，不能换算为每卡制作速度。事故已按原哈希恢复，原失败/修复/被替换证明均保留。

最终独立封装回读结果另存本阶段`final-readback.json`。此文的数据及正文检查通过不抵扣双语、App导入、手机、离线、学习记录或OTA验收；本轮只交中文候选与题卡证据。
