# 领域1第4批：5张权限与凭据卡

本批新增5张正式接受卡（1 Easy、4 Rare），领域1本轮累计22张，全项目当前接受37张。采用优化后的制作流程，未发布或做手机/OTA验收。

**效果：** 9道原题同次核查，5题判题支撑充分、4题部分；Secrets Manager这一张卡完整支撑Q61、Q336、Q994三个判断场景，并帮助Q339/Q951的部分判断。学习者实际记忆和正确率尚未测量。

| 本批知识 | 级别 | 对应原题及结果 |
| --- | --- | --- |
| EC2实例角色与临时凭据 | Easy | Q556充分；参与Q61、Q403的判断 |
| Lambda执行角色与权限方向 | Rare | Q403部分；执行角色方向已教，显式使用用户凭据的竞争方案仍有限制 |
| Secrets Manager数据库密码轮换 | Rare | Q61/Q336/Q994充分；Q339/Q951部分 |
| SCP约束成员账户root | Rare | Q619部分；并为Q709提供管理账户边界 |
| SCP挂到账户或OU的范围 | Rare | 与上一卡共同支撑Q709，充分 |

一次修正只改OU卡的私有mustAnswer：明确两种位置均需回答，取消强制复述共同根提醒。卡片正文与证据未变；4张有效卡和8题结果未重审，独立局部复审仅处理1卡/1题，B04-S1-001已闭合。

## 五张卡

# 5张AWS双语卡片

## 1．EC2临时凭据 / EC2 temporary credentials · Easy

**问：** EC2应用需要读写DynamoDB，不希望在代码或部署模板里保存长期访问密钥。应怎样授予权限，为什么？

**答：** 创建具有所需DynamoDB读写权限的IAM角色，通过实例配置文件（instance profile）关联到EC2。

**考点：** 实例配置文件把角色交给EC2使用；应用取得角色的临时凭据，凭据会自动更新，无需分发长期密钥。

**易错提醒：** 角色只给读权限，就不能满足应用的写入需求。

**Question：** An EC2 application must read and write DynamoDB without storing long-term access keys in code or a deployment template. How should it receive permissions, and why?

**Answer：** Create an IAM role with the required DynamoDB read and write permissions, put it in an instance profile, and associate the profile with EC2.

**Key point：** The instance profile makes the role available to EC2. The application obtains temporary role credentials that are refreshed automatically, avoiding distribution of long-term keys.

**Watch out：** A role that grants only read access does not meet the application’s write requirement.

## 2．Lambda权限方向 / Lambda permission direction · Rare

**问：** Lambda已能正常被调用，但函数还需要上传文件到S3。应给函数配置哪种权限，为什么不能只修改函数的资源策略？

**答：** 给Lambda配置允许向目标S3上传文件的执行角色（execution role）。

**考点：** 执行角色决定函数运行时能访问什么AWS资源；函数的资源策略则控制谁能访问或调用这个函数。

**易错提醒：** 开发者自己的IAM用户已有S3权限，并不会自动让函数获得同样权限。

**Question：** A Lambda function can already be invoked, but its code also needs to upload files to S3. Which permissions should you configure, and why is changing only the function’s resource-based policy insufficient?

**Answer：** Configure a Lambda execution role that allows uploads to the target S3 bucket.

**Key point：** The execution role controls which AWS resources the running function can access. The function’s resource-based policy controls who can access or invoke the function.

**Watch out：** The developer’s IAM user having S3 permissions does not automatically give those permissions to the function.

## 3．数据库密码轮换 / Database credential rotation · Rare

**问：** EC2应用使用Aurora MySQL用户名和密码，要求加密保存并每14天自动轮换，尽量少维护。网络和访问权限已具备，应选什么方案，为什么？

**答：** 把凭据存入Secrets Manager，配置每14天自动轮换，应用运行时从中读取凭据。

**考点：** Secrets Manager用KMS保护秘密，可创建轮换Lambda函数，按计划同步更新数据库和secret里的密码。

**易错提醒：** Parameter Store的SecureString负责加密保存参数，本身不提供数据库凭据自动轮换。

**Question：** An EC2 application uses an Aurora MySQL username and password. The credentials must be encrypted and rotated automatically every 14 days with minimal maintenance. Network access and permissions are in place. What should you use, and why?

**Answer：** Store the credentials in Secrets Manager, configure automatic rotation every 14 days, and have the application retrieve the credentials at runtime.

**Key point：** Secrets Manager protects secrets with KMS and can create a rotation Lambda function that updates both the database password and the secret on the configured schedule.

**Watch out：** Parameter Store SecureString encrypts stored parameters; it does not itself provide automatic database credential rotation.

## 4．组织权限上限 / Organization permission guardrails · Rare

**问：** 公司使用AWS Organizations，已启用全部功能及SCP。开发人员掌握成员账户的root权限，仍必须禁止他们关闭CloudTrail。应在哪里设置限制，为什么？

**答：** 在组织中配置显式拒绝相关CloudTrail操作的SCP，并应用到这些成员账户。

**考点：** SCP限定成员账户可用权限的上限，连成员账户root也受约束；账户内的管理员权限不能越过这条拒绝。

**易错提醒：** SCP不约束组织管理账户中的用户和角色。

**Question：** A company uses AWS Organizations with all features and SCPs enabled. Developers have root access in member accounts but must still be prevented from disabling CloudTrail. Where should you enforce the restriction, and why?

**Answer：** Configure an SCP in the organization that explicitly denies the relevant CloudTrail actions and apply it to those member accounts.

**Key point：** An SCP limits the permissions available in a member account, including its root user. Administrator permissions within that account cannot override the denial.

**Watch out：** SCPs do not restrict users or roles in the organization’s management account.

## 5．SCP应用范围 / SCP attachment scope · Rare

**问：** 组织内有3个非生产成员账户和1个生产成员账户。已有SCP禁止某类EC2实例，只想限制非生产。给出两种正确的挂载位置，并解释范围。

**答：** 分别挂到3个非生产账户；或者把这3个账户放入一个专用OU，再挂到该OU。

**考点：** OU是账户分组。挂在OU上的SCP会影响其下的账户；生产账户留在该OU之外，就不继承这条限制。

**易错提醒：** 挂到四个账户共同的组织根，会把限制也施加到生产成员账户。

**Question：** An organization has three nonproduction member accounts and one production member account. An existing SCP denies certain EC2 instance types, and only nonproduction should be restricted. Give two valid attachment choices and explain their scope.

**Answer：** Attach it directly to each of the three nonproduction accounts, or place those accounts in a dedicated OU and attach it to that OU.

**Key point：** An OU groups accounts. An SCP attached to an OU affects the accounts beneath it; a production account outside that OU does not inherit this restriction.

**Watch out：** Attaching it to the organization root shared by all four accounts also restricts the production member account.


## 对应原题的必要缺口

| 原题 | 状态 | 未闭合事项 |
| --- | --- | --- |
| Q61 | 充分 | 无已确认必要缺口 |
| Q336 | 充分 | 无已确认必要缺口 |
| Q339 | 部分 | KMS密钥管理/密钥轮换与数据库凭据保管/密码轮换的必要区别尚未进入学习正文；不据官方摘录替学习者补齐。 |
| Q403 | 部分 | 执行角色方向正确且资源策略区别已教；显式使用IAM用户凭据的竞争方案仍未由当前Lambda正文与原题条件可靠排除，整题唯一选择不升级。 |
| Q556 | 充分 | 无已确认必要缺口 |
| Q619 | 部分 | 需核实并教会普通IAM策略/CloudTrail服务角色与成员账户root约束的必要主体边界；当前正文不能独立支撑整题唯一选择。 |
| Q951 | 部分 | KMS密钥/数据库凭据及其轮换对象的区别未教；其余托管轮换与手工维护的主要取舍已有支撑。 |
| Q994 | 充分 | 无已确认必要缺口 |
| Q709 | 充分 | 无已确认必要缺口 |

本批没有把缺口塞回一张长卡。KMS密钥轮换与数据库密码轮换、显式用户凭据方案、root与服务角色边界分别保留待补；后续只针对真实必要判断处理。

## 流程与时间

资料/选题/首稿就绪：11.21分钟；首次审查请求到返回：4.77分钟；局部审查请求到返回：2.28分钟。实际导出与真实导入校验0.190秒，累计清单/领域索引收尾1.967秒。

完整耗时见文末最终交付计时，包含预检旧索引哈希修复、修正交接、封装、报告和最终回读；未重置原时钟。新CLI作者调用0、native token未知。首稿阶段一次摘录边界构包失败已修正，不算事实或语义PASS；预检另抓到旧run中索引哈希过期，校验索引后仅修正引用元数据。

收尾已压到秒级，但前期选题和证据组织仍占主要时间；本批不能证明一分钟一张，也不能据单批比较承诺稳定吞吐。

## 接受状态与文件

原14题的旧支撑报告仍保留。新累计视图对缺少新协议完整依赖绑定的14条旧记录标needs_recheck，同时保存previousStatus，不伪造当前复核通过；本次没有重复提取或重审这14题。当前累计视图为23题：本批5充分、4部分，旧14待补新绑定。这一迁移不影响本批5卡的正式接受，也不改变旧50题试验或原题分析账本。

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch04-20261105/deliverables/229168790638620d53ca/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch04-20261105/deliverables/229168790638620d53ca/cards.json) · [本批逐题支撑](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch04-20261105/question-support.current.json) · [累计清单与题卡索引](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch04-20261105/closeout/7edb2f0198a440e111d1/manifest.json)

官方原句、URL、字符偏移、源哈希、初审FAIL和局部复审原件均在本批运行目录；无需学习者背审计资料。

最终交付计时：23.43分钟（约4.69分钟/新增卡，含准备、两次审查区间、一次评分修正及全部交付）。
