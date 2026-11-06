# 安全组小范围教学试验：3张卡＋1道新题

状态：用户否决本次出题设计，停止此试样；未进行测验作答，不能据此评价用户理解或记忆。仅为教学试样，不计入正式卡数，不增加原题覆盖PASS。

用户反馈：应先思考每道原题判断的知识点和考点，再决定卡片内容。

目的：检验学习者能否理解规则，再用它处理变化后的场景。原题Q282的答案已经公开，因此本次使用新编变式；一次即时作答也不能证明长期记忆。

## 中文试用

安全组（SG）是关联在服务器等资源上的网络放行规则；“入站”就是请求进入这个资源。

以下均在同一VPC内，用私有IP直接通信；网络路径、发送端出站权限等其他条件已经满足，只判断新请求能否通过接收端的安全组。端口是服务的通信入口，数字由题目给出，不要求背。

### 卡1 · Easy：限制访问，规则放在哪一侧？

**问：** 前端向后端发送请求。要限制谁能访问后端，应修改哪一侧的入站安全组？

**答：** 后端。

**考点：** 请求进入后端，由后端的入站规则检查来源。前端的入站规则管的是别人访问前端。

### 卡2 · Easy：来源写一个安全组，代表谁？

**问：** 后端入站允许来自`sg-front`的TCP 8080。A、B绑定了`sg-front`，C没有。三者都向后端的TCP 8080发起请求，仅看这条规则，谁会被放行？

**答：** A、B。

**考点：** 来源填安全组，是按绑定关系圈定发送者；以后加入`sg-front`的服务器，也会被这条规则放行。

**易错提醒：** 不会把`sg-front`自身的入站规则复制到后端。

### 卡3 · Rare：新增一条窄规则，会收紧原来的宽规则吗？

**问：** 后端同时绑定两个安全组：一个允许所有IPv4来源访问TCP 8080；另一个只允许`sg-front`访问TCP 8080。现在这个端口只允许`sg-front`的成员访问吗？

**答：** 不是，第一组仍允许其他IPv4来源。

**考点：** 多个安全组的放行规则合并；只要一组允许，就能通过这道安全组检查。新增窄规则不会撤销原来的宽规则。

## 新题：先作答，再看效果

应用服务器绑定`sg-app`，运维服务器绑定`sg-ops`，两组没有共同成员。数据库运行在另一台EC2上，同时绑定两个安全组，入站只有以下规则：

| 数据库关联的安全组 | 允许的来源 | 协议与端口 |
| --- | --- | --- |
| 甲 | `sg-app` | TCP 3306 |
| 乙 | `sg-ops` | TCP 3306 |

现在要求数据库的3306端口**只接受应用服务器的新请求**。哪项修改最小且有效？

- **A．** 在应用服务器的入站规则中允许数据库访问3306。
- **B．** 再给数据库添加一个只允许`sg-app`访问TCP 3306的安全组，保留甲、乙。
- **C．** 删除乙中允许`sg-ops`访问TCP 3306的规则，保留甲。

请选一项，并用一句话解释理由。本文件暂不展示答案，避免先看到答案影响试验。

## English counterpart

A security group (SG) is a set of network allow rules associated with resources such as servers. Inbound traffic enters the associated resource.

All examples use direct communication over private IP addresses within the same VPC. Routing, sender outbound permissions, and other prerequisites are satisfied. Consider only new requests passing the receiver's security groups. A port identifies a service's communication entry point; the question supplies the number, so it need not be memorized.

### Card 1 · Easy: Where should access be restricted?

**Question:** A frontend sends requests to a backend. To restrict who can access the backend, which side's inbound security group should you modify?

**Answer:** The backend's.

**Key point:** The request enters the backend, whose inbound rules check its source. The frontend's inbound rules govern requests entering the frontend.

### Card 2 · Easy: Who does a source security group represent?

**Question:** A backend inbound rule allows TCP 8080 from `sg-front`. A and B are associated with `sg-front`; C is not. All three send requests to TCP 8080 on the backend. Considering only this rule, which senders does it allow?

**Answer:** A and B.

**Key point:** A source security group selects senders by their association with that group. A server subsequently associated with `sg-front` is also allowed by this rule.

**Watch out:** The inbound rules of `sg-front` are not copied to the backend.

### Card 3 · Rare: Does a new narrow rule restrict an existing broad rule?

**Question:** A backend is associated with two security groups. One allows TCP 8080 from all IPv4 sources; the other allows TCP 8080 only from `sg-front`. Is this port now restricted to members of `sg-front`?

**Answer:** No. The first group still allows other IPv4 sources.

**Key point:** Rules from multiple security groups are combined. An allow rule in any associated group is sufficient to pass this security-group check. Adding a narrow rule does not revoke an existing broad rule.

### New transfer question

Application servers are associated with `sg-app`; operations servers are associated with `sg-ops`. The groups have no shared members. A database runs on another EC2 instance associated with two security groups. Their only inbound rules are: group Alpha allows TCP 3306 from `sg-app`; group Beta allows TCP 3306 from `sg-ops`.

The database's port 3306 must accept new requests only from application servers. Which change is minimal and effective?

- **A.** Add an inbound rule on the application servers allowing the database to access port 3306.
- **B.** Add another security group to the database allowing TCP 3306 only from `sg-app`, retaining Alpha and Beta.
- **C.** Delete Beta's rule allowing TCP 3306 from `sg-ops`, retaining Alpha.

Choose one option and explain your reason in one sentence. The answer is withheld until the learner responds.

## 官方依据与范围

- [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)：安全组控制关联资源的入站和出站流量，入站规则可指定来源、协议和端口。对应卡1。
- [Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)：安全组只有allow规则；多个关联安全组的规则合并；来源组引用适用于关联该组的实例，不会复制被引用组的规则。对应卡2、卡3及变式题。

沿用已核官方摘录N02/N03/N04。完整摘录、来源哈希、逐卡映射、自评边界和独立检查结果另存本次运行资料。卡组服务于Q282涉及的接收端、来源组引用和放行合并判断；本次未验收Q282整题覆盖，也未测试ALB角色迁移。
