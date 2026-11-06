# AWS领域1：本批5张卡

累计接受62张。本批新增5张，修订0张。

本批原题支撑：{'sufficient_decision_support': [446, 925], 'partial': [53, 85, 109, 154, 478, 679], 'unknown': []}。这是设计支撑，学习者记忆与正确率尚未测量。

# 5张AWS双语卡片

## 1．版本历史与不可变保护 / Versions and immutability · Easy

**问：** S3开启Versioning后，为什么还不能把它当作不可变存储？需要增加什么保护？

**答：** Versioning保留多个版本；若需WORM（写一次、多次读取）保护，还需启用Object Lock，并对相应版本设置保留期或法律保留（legal hold）。

**考点：** 有权限的用户仍能永久删除普通版本；Object Lock按保留规则保护指定版本，而不是仅留下可恢复的历史。

**易错提醒：** 同名上传仍可创建新版本；锁不会把对象名永远固定到最初的内容。

**Question：** Why does enabling S3 Versioning not by itself make storage immutable? What additional protection is needed?

**Answer：** Versioning retains multiple versions. For WORM (write once, read many) protection, also enable Object Lock and apply a retention period or legal hold to the relevant versions.

**Key point：** An authorized user can still permanently delete an ordinary version. Object Lock protects specified versions under retention rules, rather than merely keeping recoverable history.

**Watch out：** Uploading to the same key can still create a new version. A lock does not permanently bind the object name to its original content.

## 2．合规与治理保留 / Compliance and governance retention · Rare

**问：** 审计记录的某个S3版本必须保留至约定日期，期间连管理员和root都不能永久删除。Object Lock应选compliance还是governance模式，为什么？

**答：** 选择compliance（合规）模式，并设置保留到约定日期。

**考点：** 合规模式下，账户中的任何用户包括root都不能在保留期内永久删除受保护版本，也不能缩短保留期。

**易错提醒：** governance（治理）模式允许具备专门绕过权限的用户提前删除或改变保留设置，不能满足这里的约束。

**Question：** An S3 version of an audit record must be retained until an agreed date, with even administrators and root unable to delete it permanently during that period. Should Object Lock use compliance or governance mode, and why?

**Answer：** Use compliance mode and set retention until the agreed date.

**Key point：** In compliance mode, no user in the account, including root, can permanently delete the protected version during retention or shorten its retention period.

**Watch out：** Governance mode allows users with special bypass permissions to delete early or change retention settings, so it does not meet this constraint.

## 3．不定期法律保留 / Indefinite legal holds · Rare

**问：** 调查资料需要锁定到调查结束，但结束日期未知，由授权人员决定何时解除。比较legal hold与固定保留期，应选哪种，为什么？

**答：** 选择legal hold（法律保留）。

**考点：** 固定保留期对应预定到期日；legal hold没有到期日，会一直保护该版本，直到有权限的人员明确解除。

**易错提醒：** 解除legal hold不会消除仍有效的保留期；两种保护可以同时存在。

**Question：** Investigation records must stay locked until the investigation ends, but its end date is unknown and an authorized person will decide when to release them. Between a legal hold and a fixed retention period, which fits, and why?

**Answer：** Use a legal hold.

**Key point：** A fixed retention period has a predetermined end date. A legal hold has no expiration date and protects the version until an authorized person explicitly removes it.

**Watch out：** Removing a legal hold does not remove an active retention period. Both protections can exist together.

## 4．新旧版本保留 / Retaining new and existing versions · Rare

**问：** 桶已启用Versioning和Object Lock，新旧版本都需满足7年合规保留。设置默认7年保留后，能认为历史版本也已补齐吗？如何以较少运维补齐？

**答：** 不能。可按旧版本清单运行S3 Batch Operations的Object Lock retention操作，批量设置合规模式及符合要求的保留到期日。

**考点：** 默认保留用于后续放入的新版本；批量保留操作直接给指定旧版本设置保留元数据，无需为了加锁重新复制内容。

**易错提醒：** 清单应覆盖需要保护的版本；未指定版本ID时，批量任务默认处理对象的最新版本。

**Question：** A bucket has Versioning and Object Lock enabled, and both new and existing versions must meet a seven-year compliance retention requirement. Does setting seven-year default retention also cover the historical versions? How can they be covered with little operational work?

**Answer：** No. Use a manifest of existing versions with the S3 Batch Operations Object Lock retention operation to apply compliance mode and retain-until dates that meet the requirement.

**Key point：** Default retention applies to subsequently added versions. The batch retention operation applies retention metadata directly to the specified existing versions, without recopying their contents just to lock them.

**Watch out：** The manifest must cover the versions requiring protection. Without an explicit version ID, the batch operation acts on the latest version of an object.

## 5．强制保留与到期清理 / Retention and expiration · Rare

**问：** 备份在30天内不能被提前永久删除，之后再按规则清理。只设30天Lifecycle到期规则，能保证前30天不可删吗？保留与清理应怎样分工？

**答：** 不能。用Object Lock的保留保护防止提前永久删除，用Lifecycle规则安排符合条件后的清理。

**考点：** 生命周期规则安排到期操作，不会单独禁止有权限者提前删除；仍被Object Lock保护的版本也不能被到期规则永久删除。

**易错提醒：** 版本化桶的Expiration可只添加删除标记，令当前对象看似消失；这不代表旧版本已永久删除。

**Question：** Backups must not be permanently deleted during their first 30 days and should then be cleaned up under defined rules. Does a 30-day Lifecycle expiration rule alone prevent early deletion? How should retention and cleanup be divided?

**Answer：** No. Use Object Lock retention protection to prevent early permanent deletion, and Lifecycle rules to schedule cleanup when eligible.

**Key point：** Lifecycle rules schedule expiration actions; they do not by themselves prevent an authorized user from deleting early. Expiration also cannot permanently delete a version that remains protected by Object Lock.

**Watch out：** In a versioned bucket, Expiration can add a delete marker so the object appears absent. That does not mean its older versions were permanently deleted.


## 原题缺口

| 原题 | 状态 | 缺口 |
| --- | --- | --- |
| Q53 | partial | 首年即时访问、随后9年归档及最大韧性的存储类别选择与Lifecycle转换尚无当前卡文支撑；固定10年compliance判断本身已教会。 |
| Q85 | partial | ACL/EFS只读路径与存储层保护的必要边界尚缺卡文。；原选项A的启用功能不等于所有新版本已有有效保留；当前卡明示应施加retention/legal hold，未替原题补写。；Object Lock保护指定版本，原题若要求对象名永远对应同一内容，当前卡明确不能据此保证。 |
| Q109 | partial | 特定用户解除legal hold与实际删除对象版本的权限链未教，不能将PutObjectLegalHold等同删除权限。；Glacier保管库锁作用范围及原题修改语义与版本保护的对应仍有缺口。；原文“ability 10 delete”文字异常原样保留，尚待源校核；未将其擅自解释为新条件。 |
| Q154 | partial | 已支持固定期不可绕过保留的模式判断，但新增/只读授权与防止同名新版本的边界未完整教会。；IAM控制及hash标记检测与预防性锁定之间的必要职责比较缺少当前卡文。 |
| Q446 | sufficient_decision_support | 无已确认必要缺口 |
| Q478 | partial | 公开读取及IAM principals与匿名公众的权限路径未教。；Object Lock对版本而非文件夹或永久固定对象名生效；原题“任何人不得修改/删除”与公开读取路径的完整衔接未确认。；原选项B未明确compliance模式，当前卡的严格“包括root”结论不能直接填入原选项。 |
| Q679 | partial | 选择三个步骤时，Object Lock创建与Versioning依赖的具体动作关系缺当前卡文。；默认30天保留与清理的职责可判，但普通Expiration不保证旧版本永久清除；非当前版本清理及实际执行时序未教，未把“30天后自动删除”改写为只加删除标记。 |
| Q925 | sufficient_decision_support | 无已确认必要缺口 |

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch09-20261105/deliverables/877146939c75d72abb30/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch09-20261105/deliverables/877146939c75d72abb30/cards.json) · [逐题记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch09-20261105/question-support.current.json)

本批通过现有独立语义与确定性门禁；题目部分支撑不升级，未发布。

从本批准备开始至自动交付：11.84分钟，包含准备、审查、修正与交付。工具：无版本变化。CLI派发次数0，native token未知。
