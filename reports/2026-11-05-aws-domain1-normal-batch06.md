# AWS领域1：本批5张卡

累计接受47张。本批新增5张，修订0张。

本批原题支撑：{'sufficient_decision_support': [887, 688, 981], 'partial': [410, 419, 681, 942, 982], 'unknown': []}。这是设计支撑，学习者记忆与正确率尚未测量。

# 5张AWS双语卡片

## 1．团队跨账户授权 / Team access across accounts · Rare

**问：** 公司已配置IAM Identity Center。开发与管理员团队需要不同的跨账户权限，新人不断入职。怎样组织授权，才能避免逐人、逐账户重复配置，为什么？

**答：** 按团队建组，配置对应的permission sets（权限集），把组与权限集分配到目标账户；新人加入相应组。

**考点：** 权限集是可复用的IAM策略模板，Identity Center据此在目标账户配置角色；组成员使用该组已分配的账户权限。

**易错提醒：** 不必为同一个员工在每个账户重复创建一套IAM用户。

**Question：** A company has configured IAM Identity Center. Developer and administrator teams need different access across AWS accounts, and new employees join frequently. How should it organize access without repeating configuration for each person in every account, and why?

**Answer：** Create team groups and appropriate permission sets, assign each group with its permission set to the target accounts, and add new employees to the appropriate group.

**Key point：** A permission set is a reusable IAM policy template. Identity Center provisions roles in the target accounts from it, and group members use the account access assigned to their group.

**Watch out：** You do not need to create a separate IAM user for the same employee in every account.

## 2．机房应用临时身份 / Temporary identity for on-premises workloads · Rare

**问：** 机房VM上的无人值守应用要访问S3，不想保存长期AWS访问密钥。公司已有受信任CA签发的X.509证书。应采用什么凭据方案，为什么？

**答：** 使用IAM Roles Anywhere，让应用用证书验证身份，换取有相应S3权限的IAM角色临时凭据。

**考点：** CA是证书签发机构。将其登记为信任锚后，证书用于验证外部应用身份，角色规定它能执行哪些AWS操作。

**易错提醒：** 已有Identity Center供员工登录，不等于机房应用已经获得这种机器身份。

**Question：** An unattended application on an on-premises VM needs S3 access without storing long-term AWS access keys. It has an X.509 certificate issued by a trusted CA. Which credential approach should it use, and why?

**Answer：** Use IAM Roles Anywhere to authenticate the application with its certificate and obtain temporary credentials for an IAM role with the required S3 permissions.

**Key point：** A CA is a certificate authority. After registering it as a trust anchor, the certificate authenticates the external workload, while the role defines which AWS actions it can perform.

**Watch out：** Having Identity Center for employee sign-in does not automatically give the on-premises application this workload identity.

## 3．权限边界与SCP / Permissions boundaries and SCPs · Rare

**问：** 组织要统一限制多个成员账户中用户、角色及root能执行的EC2操作。能把一个IAM permissions boundary挂到OU上实现吗？应该用什么策略，为什么？

**答：** 不能。应将SCP应用到相应OU或成员账户；permissions boundary是为单个IAM用户或角色设置的。

**考点：** 权限边界限定某个身份通过身份策略可获得的权限；SCP按组织层级约束成员账户中的身份，包括root。

**易错提醒：** 权限边界本身不授予权限，不能用它替代实际的IAM授权。

**Question：** An organization needs to limit the EC2 actions available to users, roles, and root users across several member accounts. Can it attach an IAM permissions boundary to an OU for this purpose? Which policy type should it use, and why?

**Answer：** No. Apply an SCP to the appropriate OU or member accounts. A permissions boundary is set for an individual IAM user or role.

**Key point：** A permissions boundary limits the permissions an identity can receive through identity-based policies. An SCP applies organization-level limits to identities in member accounts, including root users.

**Watch out：** A permissions boundary does not itself grant permissions and cannot replace an actual IAM permission grant.

## 4．EBS默认加密 / Default EBS encryption · Rare

**问：** 同一账户在一个Region新建的EBS卷都要自动加密，不希望员工每次手动勾选。应开启什么设置，它为什么能满足要求？

**答：** 开启该账户在这个Region的EBS encryption by default（默认加密）。

**考点：** 它在新卷创建时就执行加密，不需要等卷创建后再检查和补救。

**易错提醒：** 它不会追溯加密已有卷，也不会自动替其他账户或Region开启此设置。

**Question：** Every new EBS volume in one Region of an account must be encrypted automatically, without employees selecting encryption each time. Which setting should be enabled, and why does it meet the requirement?

**Answer：** Enable EBS encryption by default for that account in that Region.

**Key point：** It applies encryption when a new volume is created, instead of waiting to inspect and remediate the volume after creation.

**Watch out：** It does not retroactively encrypt existing volumes or automatically enable the setting in other accounts or Regions.

## 5．KMS控制与费用 / KMS control and cost · Rare

**问：** 某AWS服务同时支持AWS管理和客户管理的KMS密钥。只需年度自动轮换、CloudTrail可查看密钥活动，不需自定义控制，希望减少每把密钥的固定费用。选哪类，为什么？

**答：** 选择该服务支持的AWS managed key（AWS管理的KMS密钥）。

**考点：** AWS管理密钥按年轮换、密钥活动可见CloudTrail，且无密钥存储月费；客户管理密钥有固定存储费用，换取自行控制能力。调用仍可能收费。

**易错提醒：** 若必须自行设置轮换开关或周期，应选择支持所需控制的客户管理密钥。

**Question：** An AWS service supports both AWS managed and customer managed KMS keys. Annual automatic rotation and CloudTrail visibility into key activity are sufficient, with no custom controls required. Which type minimizes fixed per-key charges, and why?

**Answer：** Choose an AWS managed KMS key supported by that service.

**Key point：** AWS managed keys rotate annually, expose key activity in CloudTrail, and have no monthly key-storage fee. Customer managed keys have fixed storage charges in exchange for customer control. API usage may still be charged.

**Watch out：** If you must control rotation settings or the rotation period, choose a customer managed key that supports the required controls.


## 原题缺口

| 原题 | 状态 | 缺口 |
| --- | --- | --- |
| Q410 | partial | 原题的显式加密卷创建/挂载路径与仅附加角色、标签、密钥策略之间的必要区别尚未由当前卡面完整教会。 |
| Q419 | partial | 具体CreateVolume加密条件拒绝控制尚未由当前正文教会。；原题工作负载账户范围未明确；SCP的成员账户root覆盖不能外推到管理账户。 |
| Q681 | partial | EBS适用密钥类型及AWS owned key控制边界尚未由当前正文建立。；导入材料与普通客户管理密钥的轮换/运维差异未教，最低运维结论仍有缺口。 |
| Q887 | sufficient_decision_support | 无已确认必要缺口 |
| Q688 | sufficient_decision_support | 无已确认必要缺口 |
| Q942 | partial | S3各SSE方式与KMS密钥类别的映射未教。；CloudTrail轮换事件证据与教学未覆盖。；O3/O4范围重叠保留，不能声称选项措辞已被唯一化。 |
| Q981 | sufficient_decision_support | 无已确认必要缺口 |
| Q982 | partial | 原题O2的Identity Center凭据来源措辞与当前已教机制不符，尚无可按字面确认的完整选项。；证书/信任锚建立、所提CLI流程，以及IP限制和保存长期密钥的临时身份边界未完整覆盖。 |

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch06-20261105/deliverables/dfe476116d1e1dca9db6/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch06-20261105/deliverables/dfe476116d1e1dca9db6/cards.json) · [逐题记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch06-20261105/question-support.current.json)

本批通过现有独立语义与确定性门禁；题目部分支撑不升级，未发布。

从本批准备开始至自动交付：15.41分钟，包含准备、审查、修正与交付。工具：无版本变化。CLI派发次数0，native token未知。
