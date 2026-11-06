# AWS领域1：本批5张卡

累计接受52张。本批新增5张，修订0张。

本批原题支撑：{'sufficient_decision_support': [678], 'partial': [216, 862, 359, 740, 942, 965, 1009], 'unknown': []}。这是设计支撑，学习者记忆与正确率尚未测量。

# 5张AWS双语卡片

## 1．S3密钥管理权 / S3 key control · Rare

**问：** 合规团队要自行创建、轮换和禁用S3数据加密密钥，并尽量不写加密代码。应采用哪种加密与密钥组合，为什么？

**答：** 采用SSE-KMS，并选择客户管理的KMS密钥（customer managed key）。

**考点：** S3负责对象的服务端加密，团队通过KMS管理密钥生命周期与使用权限，无需自行实现文件加密。

**易错提醒：** SSE-S3和AWS管理的KMS密钥不提供同等自主管理权；只写SSE-KMS，还没有指定密钥归属。

**Question：** A compliance team must create, rotate, and disable the keys used to encrypt S3 data, while minimizing custom encryption code. Which encryption and key combination should it use, and why?

**Answer：** Use SSE-KMS with a customer managed KMS key.

**Key point：** S3 performs server-side object encryption, while the team manages the key lifecycle and permissions through KMS, without implementing file encryption itself.

**Watch out：** SSE-S3 and AWS managed KMS keys do not provide the same customer control. Saying SSE-KMS alone does not specify the key ownership type.

## 2．SSE-C由谁供钥 / Supplying SSE-C keys · Rare

**问：** 一个已允许SSE-C的S3桶存储敏感对象。客户上传时给过密钥，以后读取还需要再提供吗，为什么？

**答：** 需要。上传和读取SSE-C对象时，都由调用方通过HTTPS提供相应密钥。

**考点：** SSE-C由客户保管密钥，S3收到密钥后负责加解密，但不会保存这把密钥供下次读取使用。

**易错提醒：** 不能把SSE-C设为桶默认加密来省掉每次供钥。

**Question：** An S3 bucket that explicitly allows SSE-C stores sensitive objects. The customer supplied a key when uploading an object. Must it supply the key again when reading that object, and why?

**Answer：** Yes. For both upload and read requests for an SSE-C object, the caller supplies the appropriate key over HTTPS.

**Key point：** The customer retains the SSE-C key. S3 uses the supplied key to encrypt or decrypt the object, but does not store that key for later reads.

**Watch out：** You cannot set SSE-C as the bucket's default encryption to avoid supplying a key with each request.

## 3．上传前加密 / Encrypting before upload · Rare

**问：** 敏感文件必须在离开应用、发送到S3之前变成密文。应把加密放在哪里？SSE-KMS或SSE-C能否单独满足这个边界，为什么？

**答：** 在应用端进行客户端加密后再上传；单用SSE-KMS或SSE-C不能满足这个边界。

**考点：** 客户端加密让S3收到的就是密文；两种SSE由S3接收数据后加密，密钥由谁管理不改变加密发生的位置。

**易错提醒：** 客户端可用KMS密钥保护数据密钥，但客户端加密不是一项桶设置。

**Question：** Sensitive files must become ciphertext before they leave the application for S3. Where should encryption happen? Can SSE-KMS or SSE-C alone meet this boundary, and why?

**Answer：** Encrypt in the application with client-side encryption before uploading. SSE-KMS or SSE-C alone does not meet this boundary.

**Key point：** With client-side encryption, S3 receives ciphertext. Both SSE options encrypt data after S3 receives it; who manages the key does not change where encryption happens.

**Watch out：** A client can use a KMS key to protect its data keys, but client-side encryption is not a bucket setting.

## 4．S3存量对象加密 / Encrypting existing S3 objects · Rare

**问：** 桶中有数百万个已确认未加密的历史对象，每个不超过5GB。只开启桶默认加密能补齐它们吗？怎样在S3内批量处理？

**答：** 不能。例如用S3 Inventory列出未加密对象，再用S3 Batch Operations的Copy指定SSE-S3加密，写回原桶。

**考点：** 默认加密只影响后续写入；Inventory提供对象及加密状态清单，批量Copy按清单重新写入，因此能处理存量。

**易错提醒：** 这条批量Copy路径不支持SSE-C，不能直接套用于客户逐请求供钥的要求。

**Question：** A bucket contains millions of historical objects confirmed to be unencrypted, each no larger than 5 GB. Will enabling bucket default encryption encrypt them? How can you process them in bulk within S3?

**Answer：** No. For example, list the unencrypted objects with S3 Inventory, then use S3 Batch Operations Copy to write them back to the same bucket with SSE-S3 encryption.

**Key point：** Default encryption affects subsequent writes. Inventory reports objects and their encryption status; the batch Copy operation rewrites the listed objects, so it can process existing data.

**Watch out：** This batch Copy operation does not support SSE-C, so it cannot be directly reused for a requirement to supply customer keys with each request.

## 5．S3降低KMS请求费 / Reducing S3 KMS request costs · Rare

**问：** S3对象使用SSE-KMS，新增对象持续写入且读取频繁。必须继续使用KMS加密，怎样减少KMS请求费用，为什么？

**答：** 为新增对象启用S3 Bucket Key（桶密钥）。

**考点：** S3临时保留从KMS取得的桶级密钥，用它生成对象数据密钥，减少逐对象访问KMS的请求。

**易错提醒：** 这会减少而非消除KMS调用；已有对象不会因开启桶设置就自动使用Bucket Key。

**Question：** S3 objects use SSE-KMS, with frequent reads and ongoing uploads. The workload must continue using KMS encryption. How can it reduce KMS request charges, and why?

**Answer：** Enable an S3 Bucket Key for new objects.

**Key point：** S3 temporarily retains a bucket-level key obtained from KMS and uses it to generate object data keys, reducing per-object requests to KMS.

**Watch out：** This reduces KMS calls rather than eliminating them. Existing objects do not automatically start using a Bucket Key when you enable the bucket setting.


## 原题缺口

| 原题 | 状态 | 缺口 |
| --- | --- | --- |
| Q216 | partial | 原题所有存量对象是否满足Batch Operations Copy的5GB限制未确认。；保留“未设置桶加密”与“已确认对象未加密”的区别；当前卡不能证明全部原题条件下的唯一最少工作量方案。 |
| Q678 | sufficient_decision_support | 无已确认必要缺口 |
| Q862 | partial | 保留原题AWS整体与S3服务边界的歧义；如果确认其指应用向S3上传，当前卡足以定位D并排除桶配置客户端加密与服务端方案，但该确认不在原题中。；不把未教的双层加密名称和配置细节列为本题新增必背任务；其服务端执行位置已足以用于本次核心辨析。 |
| Q359 | partial | 医院全部PHI须同时满足传输中、静态加密及团队管理静态密钥；当前卡面未教aws:SecureTransport如何强制HTTPS及ACM关联边界，故不能确认完整原题选项。 |
| Q740 | partial | 必须同时覆盖数百万现有未加密归档对象和未来对象，并保留customer-provided key要求；现有卡片足以发现多个选项的官方限制冲突，但未建立任何一个原选项的完整可行方案，原题选项有效性须保留待核实。 |
| Q942 | partial | 原题同时要求静态加密、每年自动轮换、CloudTrail跟踪轮换及密钥成本最小；前三类机制与成本的完整比较尚未教全。；保留O3泛指SSE-KMS而O4指定customer managed KMS keys的范围重叠；不能擅自把O3限定成AWS managed key以制造唯一答案。 |
| Q965 | partial | 保留原题“before storing”措辞，需确认它是否确指发送到S3前，而不是S3收到后落盘前；不得以教学卡的更强边界替换原题条件。；客户端customer managed keys与Amazon S3 managed keys两种组合的有效性辨析未在当前卡面完整建立。 |
| Q1009 | partial | 原题当前使用KMS与必须保持KMS并非同一条件，严格加密要求的具体内容未给出，不能据教学卡较强前提直接排除SSE-S3。；原题“不增加KMS调用”的比较基线与零调用含义未明；Bucket Key减少调用但不消除调用，且开启设置不会追溯让已有对象使用Bucket Key。；其他候选的KMS调用、密钥交付与成本路径未教完整，故保留原题支撑为partial。 |

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch07-20261105/deliverables/364eb1703e45d94b4928/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch07-20261105/deliverables/364eb1703e45d94b4928/cards.json) · [逐题记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch07-20261105/question-support.current.json)

本批通过现有独立语义与确定性门禁；题目部分支撑不升级，未发布。

从本批准备开始至自动交付：11.59分钟，包含准备、审查、修正与交付。工具：无版本变化。CLI派发次数0，native token未知。
