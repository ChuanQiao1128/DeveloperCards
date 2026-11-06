# 三张小卡：学习颗粒度试读

2026-11-03。这是对现有知识的样式试读，尚未独立验收，不纳入正式卡数。原卡正文、UID与历史验收保持。没有新增CLI制卡或独立Reviewer调用。

先知道一个词：**主数据**是应用日常读写的那份数据；**备份**是用来恢复的副本。

## 1．Easy：主数据的位置

**正面**

Volume Gateway的stored模式，完整主数据保存在本地还是S3？

**背面**

- **答：** 本地。
- **考点：** AWS保存异步备份。
- **易错提醒：** cached模式以S3为主存，本地承担缓存角色。

**English**

**Front:** In Volume Gateway stored mode, is the complete primary dataset kept on premises or in S3?

- **Answer:** On premises.
- **Key point:** AWS holds asynchronous backups.
- **Watch out:** Cached mode uses S3 as the primary store; local storage acts as a cache.

依据：[How Volume Gateway works](https://docs.aws.amazon.com/storagegateway/latest/vgw/StorageGatewayConcepts.html)。

## 2．Rare：只比较一个决定条件

**正面**

比较Volume Gateway两种卷模式，假设容量符合配额：所有文件都要能从本地读取，但缓存装不下全部数据。选stored还是cached？

**背面**

- **答：** stored。
- **考点：** 它把完整主数据保留在本地。
- **易错提醒：** cached读取未命中的数据时，需要访问S3。

**English**

**Front:** Compare the two Volume Gateway volume modes, assuming their capacity quotas are met. Every file must be available from local storage, but the cache cannot hold the whole dataset. Which mode fits: stored or cached?

- **Answer:** Stored.
- **Key point:** It keeps the complete primary dataset on premises.
- **Watch out:** Cached mode must fetch a cache miss from S3.

依据：[How Volume Gateway works](https://docs.aws.amazon.com/storagegateway/latest/vgw/StorageGatewayConcepts.html)。

## 3．Rare：只检查一个容量边界

**正面**

一个网关的stored volumes总容量上限为512 TiB，能否直接创建一个20 TiB的stored volume？

**背面**

- **答：** 不能；stored volume单卷上限为16 TiB。
- **考点：** 单卷上限与网关总容量是两项配额。
- **易错提醒：** 不能把512 TiB当成单卷额度。

**English**

**Front:** A gateway supports up to 512 TiB of stored volumes in total. Can one stored volume be 20 TiB?

- **Answer:** No. A stored volume is limited to 16 TiB.
- **Key point:** Per-volume and per-gateway limits are separate quotas.
- **Watch out:** The 512 TiB aggregate is not the limit for one volume.

依据：[AWS Storage Gateway quotas](https://docs.aws.amazon.com/storagegateway/latest/vgw/resource-gateway-limits.html)。

## 用一道原创题试读

这道题用于检查上面三张卡能否支持判断，未计入原50题覆盖。

某站点使用Volume Gateway保存8 TiB数据，要求完整主数据留在本地，AWS只保存异步备份。下面哪项符合要求？

- A．cached volume，本地缓存2 TiB。
- B．stored volume，单卷8 TiB。
- C．stored volume，单卷20 TiB。
- D．cached volume，本地缓存8 TiB。

**English**

A site uses Volume Gateway for an 8 TiB dataset. The complete primary dataset must stay on premises, with AWS holding asynchronous backups. Which design meets these requirements?

- A. A cached volume with a 2 TiB local cache.
- B. An 8 TiB stored volume.
- C. A 20 TiB stored volume.
- D. A cached volume with an 8 TiB local cache.

先回复选项与一句理由，再根据实际理解反馈调整样式。当前没有宣称记忆效果或整题迁移已通过。
