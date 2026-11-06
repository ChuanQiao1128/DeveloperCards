# 从原题考点到卡片：Q282单张试样

这是一次小范围教学设计示范，不登记正式UID，不增加正式卡数或题卡覆盖。前序考点分析见[5题分析](/Users/qc/Desktop/DeveloperCards/reports/2026-11-04-aws-question-exam-analysis-5.md)。

## 先决定这张卡要教会什么

Q282的决定性要求是“后端只接受ALB的流量，排除其他内部和外部来源”。需要学会的判断是：根据允许的发送者，在接收端限制来源。保留一个完整场景判断，来源引用和许可收口放在同一因果链中。

适用前提：ALB已经可以向后端EC2转发请求；本卡解决来源限制，其他网络条件沿用原题。ALB专用安全组仅关联该ALB。

## 中文试样 · Rare

**问：** EC2位于私有子网，通过ALB提供Web服务。要让EC2只接受ALB的请求，应怎样限制入站来源，为什么？

**答：** 在EC2关联的全部安全组中，只保留ALB专用安全组来源的入站许可。

**考点：** 来源安全组代表关联它的发送资源。只有ALB使用这个组，EC2就能据此放行ALB的流量，阻止其他服务器直接连接。

**易错提醒：** 私有子网、路由和公网IP影响网络位置或可达性，不能代替这项来源限制。

## English counterpart · Rare

**Question:** EC2 instances in a private subnet serve a web application through an ALB. How should inbound sources be restricted so that the instances accept requests only from the ALB, and why?

**Answer:** Across all security groups associated with the EC2 instances, retain inbound permissions only from the ALB's dedicated security group.

**Key point:** A source security group represents the sending resources associated with it. If only the ALB uses that group, EC2 can use this association to allow traffic from the ALB and block direct connections from other servers.

**Watch out:** Private subnets, routes, and public IP addresses affect network placement or reachability; they do not replace this source restriction.

## 带回原题，检查是否有实际用途

| 原题方案 | 当前卡面提供的判断依据 |
| --- | --- |
| A：改路由，指向EC2私有IP | 提醒说明改变可达性没有实施所需来源限制。 |
| B：EC2安全组只允许ALB安全组来源 | 答和考点同时给出控制位置、允许来源及其机制。 |
| C：移入公有子网并分配EIP | 提醒说明改变位置和寻址没有实施所需来源限制。 |
| D：放宽ALB安全组任意TCP端口 | 答明确要求在接收方EC2实施限制；放宽ALB本身不实现该条件。 |

来源限制应覆盖EC2关联的全部安全组，不可保留来自其他来源的入站许可；本试样不把范围收窄成仅某个Web端口。来源组若还关联其他资源，也会允许这些发送资源，因此不能把共享安全组冒称单个ALB身份。

自评只看一个主要判断及原因：在EC2端把允许来源限定为ALB专用组，并说明来源组为什么能区分ALB与其他发送者。移除其他来源许可属于实现“只允许”的组成部分，不另加部署配置清单；题面给定前提不评分。

## 官方依据与试验边界

- [安全组控制关联资源的入站与出站](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)，N02。
- [来源组引用、关联发送者与多组规则合并](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)，N03/N04。
- [ALB目标的来源限制](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html)，N05："This can be achieved by setting the load balancer's security group as the source in the ingress rule of the target's security group."

本例消费已核对的Q282原题分析和官方原文，不使用旧卡正文。单张试样的设计复核与原题映射，均不等于已验证学习者理解、记忆或答题效果。Q282答案已经公开，本例只检查教学转换，不再用重复选B充当未见题测试。

其余4题暂不强行凑卡：Q562保留自动路由措辞限制；Q324先保留唯一答案未决，仅可另行设计明确限容的知识卡；Q456保留管理职责解释边界；Q508可以围绕异地恢复点与原生自动复制组织后续试样。完成这一步的小样反馈后，再决定扩大分析和制作的节奏。
