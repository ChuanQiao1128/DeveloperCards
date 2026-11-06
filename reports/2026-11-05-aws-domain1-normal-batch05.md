# AWS领域1：本批5张卡

累计接受42张。本批新增5张，修订0张。

本批原题支撑：{'sufficient_decision_support': [854, 951], 'partial': [13, 339, 418, 619], 'unknown': []}。这是设计支撑，学习者记忆与正确率尚未测量。

# 5张AWS双语卡片

## 1．密钥与密码轮换 / Key and password rotation · Rare

**问：** 应用要安全读取RDS MySQL登录密码，并自动更换数据库密码。创建KMS密钥并启用密钥轮换就够了吗？应使用什么方案，为什么？

**答：** 不够。用Secrets Manager保存和读取凭据，并配置数据库凭据自动轮换。

**考点：** KMS轮换更新的是加密密钥材料；Secrets Manager的轮换函数更新数据库和secret中的密码，控制台可创建这个函数。

**易错提醒：** Parameter Store的SecureString可以加密保存密码，但本身不提供数据库密码自动轮换。

**Question：** An application must securely retrieve its RDS MySQL password and automatically change the database password. Is creating a KMS key and enabling key rotation sufficient? What should it use, and why?

**Answer：** No. Store and retrieve the credentials with Secrets Manager and configure automatic database credential rotation.

**Key point：** KMS rotation changes encryption key material. A Secrets Manager rotation function updates the password in both the database and the secret, and the console can create this function.

**Watch out：** Parameter Store SecureString can store an encrypted password, but does not itself provide automatic database password rotation.

## 2．跨Region秘密副本 / Cross-Region secret replicas · Rare

**问：** 多个Region的应用需要就近读取同一份数据库凭据，并每月轮换。怎样维护各Region的secret，才能避免分别编写同步和轮换任务？

**答：** 用Secrets Manager将主secret复制到所需Region，并在主secret上配置每月轮换。

**考点：** 主secret轮换后的新值会传播到其副本，所以同一secret的各Region副本无需各自维护轮换。

**易错提醒：** 复制secret不等于修改每个Region里独立数据库的密码；不同数据库的凭据仍需各自对应的轮换配置。

**Question：** Applications in several Regions need local access to the same database credentials, with monthly rotation. How should you maintain the Regional secrets without writing separate synchronization and rotation jobs?

**Answer：** Replicate the primary secret to the required Regions with Secrets Manager and configure monthly rotation on the primary secret.

**Key point：** The new value from primary-secret rotation propagates to its replicas, so you do not manage rotation separately for each Regional copy of the same secret.

**Watch out：** Replicating a secret does not change the passwords of independent databases in every Region; credentials for different databases still need their corresponding rotation configurations.

## 3．Aurora临时登录 / Temporary Aurora authentication · Rare

**问：** EC2应用要连接Aurora，但不想维护静态数据库密码。网络已连通，数据库版本支持IAM认证。应采用什么认证方式，EC2应使用哪种身份，为什么？

**答：** 启用IAM数据库认证并创建对应数据库用户；给EC2实例角色授予连接权限，应用使用角色获取的认证令牌登录。

**考点：** 角色为EC2应用提供临时AWS凭据；IAM数据库认证用这些凭据生成登录令牌，替代应用保存长期数据库密码。

**易错提醒：** EC2通过instance profile关联IAM角色，不能把IAM用户当作实例角色来关联。

**Question：** An EC2 application must connect to Aurora without maintaining a static database password. Network connectivity is in place and the database version supports IAM authentication. Which authentication method and EC2 identity should it use, and why?

**Answer：** Enable IAM database authentication and create the corresponding database user. Grant connection permissions to the EC2 instance role, and have the application authenticate with a token obtained using that role.

**Key point：** The role supplies temporary AWS credentials to the EC2 application. IAM database authentication uses those credentials to generate a login token instead of making the application store a long-term database password.

**Watch out：** EC2 uses an instance profile to associate an IAM role; an IAM user is not an instance role that you can associate this way.

## 4．跨账户角色授权 / Cross-account role authorization · Rare

**问：** 生产账户已有能访问目标S3桶的角色，开发账户用户要通过它访问。只给角色增加S3权限就够了吗？还需哪两方授权，为什么？

**答：** 不够。生产角色的信任策略要允许开发方；开发方用户的身份策略也要允许对该角色调用AssumeRole。

**考点：** 角色权限规定扮演角色后能做什么；信任策略与调用方授权则决定谁能取得这个角色身份。

**易错提醒：** 把生产角色的信任关系补好，不等于开发账户所有用户都自动获得AssumeRole权限。

**Question：** A production account has a role that can access the target S3 bucket. Users in a development account need to access it through that role. Is adding S3 permissions to the role enough? Which two sides must authorize role assumption, and why?

**Answer：** No. The production role’s trust policy must allow the development-side principal, and the development users’ identity policies must allow AssumeRole on that role.

**Key point：** The role’s permissions specify what a session using the role may do. The trust policy and caller-side authorization determine who may obtain that role identity.

**Watch out：** Adding the production role’s trust relationship does not automatically grant AssumeRole permission to every user in the development account.

## 5．策略限制谁 / Which identity a policy restricts · Rare

**问：** 开发人员持有Organizations成员账户的root权限。只收紧CloudTrail所用服务角色的权限，就能阻止root本人修改CloudTrail吗？应如何限制root？

**答：** 不能。应通过组织SCP拒绝相应CloudTrail操作，并应用到该成员账户。

**考点：** 服务角色和root是不同身份：角色策略约束该角色的操作，不约束root本人；SCP可以约束成员账户的root。

**易错提醒：** root不能像IAM用户那样附加身份策略，因此不能靠“给root挂一条IAM拒绝策略”实现限制。

**Question：** Developers have root access to an Organizations member account. Does restricting the role used by CloudTrail prevent the root user from modifying CloudTrail? How should you restrict the root user?

**Answer：** No. Apply an organization SCP to the member account that denies the relevant CloudTrail actions.

**Key point：** The service role and root user are different identities. A role policy controls that role’s actions, not the root user’s actions; an SCP can restrict the root user of a member account.

**Watch out：** You cannot attach an identity-based policy to the root user as you can to an IAM user, so attaching an IAM deny policy to root is not a solution.


## 原题缺口

| 原题 | 状态 | 缺口 |
| --- | --- | --- |
| Q13 | partial | 原题未确认跨Region数据库共享凭据/复制关系；同一secret副本的自动传播不能证明所有独立数据库均被改密，因此不升级为整题充分。 |
| Q339 | partial | B/C两个Secrets Manager轮换方案的编程差异未被选项文字明确界定；当前卡可说明推荐机制，但不足以唯一排除另一个Secrets Manager选项。 |
| Q418 | partial | 原题未明确调用方对生产角色的AssumeRole权限，故不能把“加开发账户principal”独自当成完整可行授权。 |
| Q619 | partial | organization trail选项的创建主体与保护范围尚无当前卡正文支撑；此缺口属于原题支撑，不要求加长本张身份主体辨析卡。 |
| Q854 | sufficient_decision_support | 无已确认必要缺口 |
| Q951 | sufficient_decision_support | 无已确认必要缺口 |

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch05-20261105/deliverables/69e59468f1f4800e8224/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch05-20261105/deliverables/69e59468f1f4800e8224/cards.json) · [逐题记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch05-20261105/question-support.current.json)

本批通过现有独立语义与确定性门禁；题目部分支撑不升级，未发布。

从本批准备开始至自动交付：16.49分钟。包含本次工具接入、审查等待及修正；CLI派发次数0，native token未知。

最终回读与规范登记后完整耗时：18.01分钟；首稿就绪12.70分钟。分段：{'tooling_selection_sources_and_freeze': 10.199, 'frozen_input_to_draft': 2.498, 'review_request_to_result': 3.33}。
本批首轮5卡全PASS、零卡片返修，题目2充分/4部分。与上一批23.43分钟相比，本批审查6题（上一批9题）且无返修，不能把全部差异归因于流程优化。
