# AWS领域1：本批5张卡

累计接受57张。本批新增5张，修订0张。

本批原题支撑：{'sufficient_decision_support': [131, 542, 638, 856], 'partial': [359, 412, 506, 907], 'unknown': []}。这是设计支撑，学习者记忆与正确率尚未测量。

# 5张AWS双语卡片

## 1．S3强制HTTPS / Enforcing HTTPS for S3 · Rare

**问：** 应用已有S3读写授权，数据也已静态加密。现在还要禁止普通客户端通过HTTP访问，只允许HTTPS。应增加什么控制，为什么？

**答：** 在S3桶策略中显式拒绝aws:SecureTransport为false的请求。

**考点：** false表示请求使用HTTP，因此会被拒绝；HTTPS请求仍按原有权限判断，拒绝HTTP本身不授予访问权限。

**易错提醒：** 静态加密保护存储的数据，不负责强制传输使用TLS。

**Question：** An application already has S3 read and write permissions, and its data is encrypted at rest. It must now block ordinary clients from accessing S3 over HTTP and require HTTPS. What control should be added, and why?

**Answer：** Add an explicit Deny in the S3 bucket policy for requests where aws:SecureTransport is false.

**Key point：** A false value indicates an HTTP request, so it is denied. HTTPS requests are still evaluated against existing permissions; denying HTTP does not itself grant access.

**Watch out：** Encryption at rest protects stored data; it does not enforce TLS for data in transit.

## 2．S3临时直传与分享 / Temporary direct S3 access · Rare

**问：** 客户没有AWS凭据，S3桶也不能公开。应用要临时允许客户上传或下载指定对象，同时避免文件经过应用服务器中转。怎样实现，为什么？

**答：** 由有相应权限的后端签发S3预签名URL，按需指定GET下载或PUT上传、对象和期限；客户端直接请求S3。

**考点：** URL的权限受签发者及指定操作范围限制，客户无需拿到AWS凭据；文件直接在客户端与S3之间传输，减少应用服务器的中转负担。

**易错提醒：** CLI或SDK可设置最长7天，但URL会随签发凭据提前失效，不能只看链接上填写的期限。

**Question：** Customers have no AWS credentials, and an S3 bucket must remain private. An application needs to let them temporarily upload or download specific objects without relaying file data through its servers. How should it do this, and why?

**Answer：** Have an authorized backend generate an S3 presigned URL for the required object, expiration, and operation: GET for download or PUT for upload. The client requests S3 directly.

**Key point：** The URL is limited by the signer's permissions and the specified operation, without giving the customer AWS credentials. File data moves directly between the client and S3, reducing relay load on application servers.

**Watch out：** The CLI or SDK can set an expiration of up to seven days, but the URL expires earlier if the signing credentials expire first.

## 3．CloudFront私有源站 / Private CloudFront origins · Rare

**问：** 网站文件存放在S3 API源站，而非S3网站端点。用户只能经CloudFront读取，不能用S3对象直链绕过分发。应如何授权源站读取，为什么？

**答：** 可为分发配置OAC（源站访问控制），并用桶策略只允许对应分发读取；适用的既有系统也可关联OAI（源站访问身份），仅授权该身份读取。

**考点：** 浏览器向CloudFront取文件，由CloudFront获得私有S3源站的读取权限；桶不必公开，直接S3对象URL也不会因此成为公开入口。

**易错提醒：** AWS推荐新配置使用OAC；OAI不适用于所有Region、加密方式和请求类型，不能无条件替换。

**Question：** Website files are stored in an S3 API origin, not an S3 website endpoint. Users must read them through CloudFront rather than bypassing the distribution with direct S3 object URLs. How should origin reads be authorized, and why?

**Answer：** Configure OAC (origin access control) for the distribution and a bucket policy allowing reads only for that distribution. An applicable existing setup can instead associate an OAI (origin access identity) and grant read access only to that identity.

**Key point：** The browser requests files from CloudFront, which is authorized to read the private S3 origin. The bucket need not be public, and direct S3 object URLs do not become public entry points.

**Watch out：** AWS recommends OAC for new configurations. OAI does not support every Region, encryption mode, or request type, so the two are not universally interchangeable.

## 4．CloudFront付费内容授权 / Paid CloudFront content · Rare

**问：** 私有S3源站已通过OAC限制给CloudFront。现在只有付费客户能在限定时间内下载某个文件，OAC本身够吗？还需怎样授权，为什么？

**答：** 不够。应用确认客户有访问资格后，签发对应文件的CloudFront签名URL，并让分发对受保护内容要求签名访问。

**考点：** OAC控制CloudFront到S3的源站访问；签名URL控制客户到CloudFront的内容访问，由CloudFront检查签名和有效期。

**易错提醒：** S3预签名URL直接授权S3请求，不能当成CloudFront分发的客户访问授权。

**Question：** A private S3 origin is already restricted to CloudFront through OAC. Only paying customers should be able to download a particular file for a limited time. Is OAC sufficient? What additional authorization is needed, and why?

**Answer：** No. After verifying the customer's entitlement, the application should issue a CloudFront signed URL for the file and require signed access for the protected content.

**Key point：** OAC controls CloudFront-to-S3 origin access. A signed URL controls customer-to-CloudFront content access, with CloudFront checking the signature and validity period.

**Watch out：** An S3 presigned URL authorizes an S3 request directly; it is not customer access authorization for a CloudFront distribution.

## 5．S3账户级防公开 / Account-wide S3 safeguards · Rare

**问：** Organizations成员账户的现有和未来S3桶都不能被员工误公开，员工也不能关闭防护。可采用什么控制组合？为什么比发现公开后再修复更合适？

**答：** 例如：启用账户级全部S3 Block Public Access设置，再用SCP拒绝员工更改这些防护设置。

**考点：** Block Public Access预先阻止公共策略或ACL造成公开；SCP是组织层权限上限，可保护设置本身，不必等对象已公开再补救。

**易错提醒：** 只给某一个桶开启防护不能覆盖全账户；账户级设置作用于现有和未来的桶。

**Question：** Employees must not accidentally expose existing or future S3 buckets in an Organizations member account, and must not disable the safeguards. What combination of controls could meet this goal, and why is it better than repairing public exposure after detection?

**Answer：** For example, enable all account-level S3 Block Public Access settings and use an SCP to deny employees changes to those safeguards.

**Key point：** Block Public Access prevents public policies or ACLs from exposing data. An SCP is an organization-level permissions limit that can protect the settings themselves, without waiting for exposure before remediation.

**Watch out：** Enabling safeguards on just one bucket does not cover the entire account. Account-level settings apply to existing and future buckets.


## 原题缺口

| 原题 | 状态 | 缺口 |
| --- | --- | --- |
| Q131 | sufficient_decision_support | 无已确认必要缺口 |
| Q359 | partial | 缺少满足合规团队管理静态加密key的选型及原因；当前只能支撑HTTPS这一部分。 |
| Q412 | partial | Organizations目标账户身份/适用域未在原题确认；保留成员账户方案的条件性支撑，不升级为无条件全题充分。 |
| Q506 | partial | 缺少区分原题另外两种“浏览器直传”路径的必要接口/协议边界；当前只充分支持C的可行路径及相对A的减载。 |
| Q542 | sufficient_decision_support | 无已确认必要缺口 |
| Q638 | sufficient_decision_support | 无已确认必要缺口 |
| Q856 | sufficient_decision_support | 无已确认必要缺口 |
| Q907 | partial | CloudFormation模板URL支持及取用路径未被当前卡面支撑；通用S3预签名知识不等于该服务集成充分。 |

[Deck导入文件](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch08-20261105/deliverables/2f532472aee5874abb09/cards.deck.md) · [双语JSON](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch08-20261105/deliverables/2f532472aee5874abb09/cards.json) · [逐题记录](/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/runtime/full-card-rebuild-v2-20261102/domain1-normal-batch08-20261105/question-support.current.json)

本批通过现有独立语义与确定性门禁；题目部分支撑不升级，未发布。

从本批准备开始至自动交付：15.33分钟，包含准备、审查、修正与交付。工具：无版本变化。CLI派发次数0，native token未知。
