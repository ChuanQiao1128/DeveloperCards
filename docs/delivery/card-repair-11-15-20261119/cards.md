# AWS第11—15张确认稿（2026-11-19）

## 顺序 110 · Geo-based access filtering / 按来源国家过滤

**问：** 网站通过同一个 CloudFront 入口提供内容。产品介绍页对所有国家开放，下载页面只允许 IP 定位在新西兰的请求访问。

应使用 CloudFront 自带地域限制，还是 AWS WAF？为什么？

答：用 AWS WAF，拦截“访问下载页面，且 IP 不属于新西兰”的请求。
考点：CloudFront 自带地域限制对同一个分配下的所有页面统一生效，会连介绍页一起限制。WAF 能同时判断“访问哪个页面”和“IP 来自哪个国家”，所以可以只限制下载页。

**Question:** A website serves its content through one CloudFront distribution. Product pages are open to every country, but download pages must accept only requests whose IP addresses geolocate to New Zealand.

Should you use CloudFront’s built-in geographic restrictions or AWS WAF? Why?

Answer: Use AWS WAF to block requests that access the download pages AND have an IP address that does not geolocate to New Zealand.
Key point: CloudFront’s built-in geographic restrictions apply to every page in the same distribution, so they would also restrict the product pages. WAF can check both which page is requested and which country the IP address comes from, allowing country restrictions to apply only to the download pages.

## 顺序 120 · ACM certificate Regions / ACM证书Region

**问：** 你要给两个应用的自有域名配置 HTTPS，证书由 ACM（AWS 的证书管理服务）管理。一个应用通过悉尼的区域型 API Gateway 提供服务，另一个通过 CloudFront 提供服务。

两者的证书分别应放在 ACM 的哪个区域？

答：区域型 API Gateway 的证书放在悉尼，与 API 同区域；CloudFront 的证书固定放在 us-east-1（美国东部，弗吉尼亚北部）。
考点：看的是接收用户 HTTPS 连接的入口。用户先连接 CloudFront 时，用到的是 CloudFront 入口的证书，需要满足它固定的区域要求；后端服务器即使在悉尼，也不会改变这个要求。

**Question:** You need to enable HTTPS for two applications’ custom domains, with certificates managed by ACM (AWS Certificate Manager). One application is served through a Regional API Gateway API in Sydney, and the other through CloudFront.

In which ACM Region should each certificate be placed?

Answer: Place the Regional API Gateway certificate in Sydney, in the same Region as the API. Place the CloudFront certificate in us-east-1 (US East, N. Virginia).
Key point: Identify the entry that receives the user’s HTTPS connection. When the user connects to CloudFront first, the certificate used is the one on the CloudFront entry, so it must meet CloudFront’s fixed Region requirement. Even if the backend server is in Sydney, that does not change the requirement.

## 顺序 130 · Stateful SG vs NACL return traffic / 有状态安全组与NACL回程

**问：** 客户端本次使用 50000 端口，访问 EC2 服务器的 HTTPS 443 端口。请求已被服务器的安全组和服务器所在子网的 NACL（子网级网络访问规则）放行。

响应返回客户端时，安全组和这份 NACL 分别需要怎样设置？

答：安全组会自动允许这次响应，无需另加出站规则；NACL 的出站规则须允许目的端口 50000 的响应流量。
考点：响应方向是“服务器 443 → 客户端 50000”。安全组记住已放行的连接，自动允许响应；NACL 不记录连接，响应离开子网时还要检查出站规则，因此目的端口要匹配客户端的 50000。

**Question:** For this connection, a client uses port 50000 to access an EC2 server’s HTTPS port 443. The request has been allowed by the server’s security group and by the NACL (subnet-level network access rules) associated with the server’s subnet.

What settings do the security group and this NACL need for the response to return to the client?

Answer: The security group automatically allows this response, so no additional outbound rule is needed. The NACL’s outbound rules must allow the response traffic with destination port 50000.
Key point: The response travels from server port 443 to client port 50000. The security group remembers the allowed connection and automatically allows its response. The NACL does not remember connections and checks its outbound rules as the response leaves the subnet, so the destination port must match the client’s port 50000.

## 顺序 140 · Rate-based rules / 速率限制规则

**问：** HTTP请求洪泛的来源IP不断变化，固定黑名单难维护。要自动拦截超过速率限制的请求组，应怎样做？

答：用AWS WAF基于速率的规则，设置请求分组条件、请求量阈值和Block（拦截）动作。
考点：规则统计每组在一个时间窗口内的请求量，对超阈值的组执行动作，不依赖逐个手工维护来源IP黑名单。
易错提醒：若按单个IP分组，每个IP都未超阈值的分布式洪泛仍可能漏过。

**Question:** An HTTP request flood keeps changing source IPs, making a fixed blacklist hard to maintain. How can you automatically block request groups that exceed a rate limit?

Answer: Use an AWS WAF rate-based rule. Set how requests are grouped, the request threshold, and the Block action.
Key point: The rule counts each group’s requests over an evaluation window and applies the action to groups over the threshold, rather than relying on a manually maintained list of source IPs.
Watch out: With per-IP grouping, a distributed flood can evade the rule if each IP remains below the threshold.

## 顺序 150 · Managed patching vs custom commands / 托管补丁与自定义命令

**问：** 一批 EC2 服务器已由 Systems Manager 统一管理。你要统一安装已批准且受支持的系统补丁，并检查哪些服务器还有补丁没装。

这项工作应主要用 Patch Manager，还是 Run Command？为什么？

答：用 Patch Manager 统一管理这批服务器的补丁。
考点：Patch Manager 按批准规则检查缺失补丁并组织安装；Run Command 负责下发和执行指定命令，Patch Manager 可以借助它执行补丁操作。

**Question:** A fleet of EC2 servers is already managed through Systems Manager. You need to install approved, supported operating system patches across the fleet and identify servers that are still missing patches.

Should you primarily use Patch Manager or Run Command to manage this work? Why?

Answer: Use Patch Manager to manage patching across the fleet.
Key point: Patch Manager checks which patches are missing according to approval rules and organizes their installation. Run Command sends specified commands to servers for execution; Patch Manager can use it to carry out patching operations.
