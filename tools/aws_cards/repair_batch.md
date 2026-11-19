# 现有卡片修订试跑

只生成本地审查稿，不发布，不恢复全库生成。沿用当前认可的短卡写法。

1. 用 `repair_batch.py prepare BASELINE PRIVATE SOURCE_BINDINGS PACKET_DIR --first 16 --count 5 [--supplements FILE]` 构包。`first` 是按 `orderInDeck` 排序后的第几张，不是该字段的数值。
2. 用 `repair_batch.py run PACKET_DIR/input.json BASELINE RESULT_DIR [--primary-session 本聊天的JSONL路径]` 完成作者、独立审查、Linter、真实解析回读和用量汇总。

输出目录必须不存在；失败后先检查已有记录，不覆盖或盲目重试。任何语义FAIL保留并停止，不能将机械通过改称语义通过。必要定向返修另行保留谱系。

若作者已完成但审查尚未发出，可在核对停止原因后对同一`run`命令加`--resume-review`：校验原作者输入、输出与冻结baseline绑定，只派审查，保留原起点及停止记录。已有审查目录时拒绝此恢复入口。审查包仅包含候选实际引用的证据，同时保留原卡范围供比较。

`prepare` 复用原句及每卡已有proof输入，从原始事实文件验证原句与哈希；完全包含的重复摘录才去重。补证文件格式为 `{"quotes":[{"uids":["..."],"url":"官方URL","text":"完整原句","path":"本地事实快照","sha256":"文件哈希"}]}`。先补齐事实依据再调用模型，不能截断决定条件来满足25KB限制。

云端目录文件可能阻塞，准备时单文件读取限15秒并复用同次读取的字节。优先传已保存的本地快照路径。冻结包可按自身SHA精确复用；dispatch校验实际事实文件，旧private/proof等来源记录保留在`provenanceFiles`，不重复读云端目录。冻结baseline副本用于整个批次，审查同时看原题面、原目标、原必答点及候选，不能悄悄缩小目标。

作者与Reviewer直接向已配置的本机Responses模型代理分别发送冻结文本，不启动编码Agent或加载插件、Skill目录和聊天历史。沿用既有认证hook与`gpt-6.1-sol/high`；凭证只留内存，不写请求文件或日志，禁止重定向，不改全局配置。每角色只调用一次，无工具；失败保留用量unknown并停止，不自动换通道重试。输出schema另在本地验证；实际上游型号未暴露。

定向返修仍只处理失败卡，保留原FAIL及未变卡审查。当前`finish-repair PACKET TRIAL REPAIR OUTPUT [--source-overrides FILE]`收尾入口支持一次局部返修和一份官方补证：校验原审查、候选和新审查绑定，复用未变PASS，重新执行Linter/真实解析。范围收窄导致显示来源变化时，override必须是该卡实际引用的官方来源。不能用该命令把未通过的语义结论改为PASS。

`result.json`绑定候选、审查输入和审查输出；只有七项逐卡审查、两项条件迁移及机械校验均通过才记为`REVIEWED_DRAFT`。`cards.md`为双语阅读稿，`usage-summary.json`区分缓存输入、非缓存输入、输出与未观测尾部。推理已含输出，不重复加；未重测的原题支撑保持`needs_recheck`。

计时须同时报告首次工具维护、资料准备/等待、模型与校验及总耗时。已冻结输入的模型耗时不能冒称每批端到端耗时。现有合格稿不为测速重做，下一批默认接续未修的五张。

当前常规预算为每5张约10分钟（用户接受，取代5分钟目标），涵盖取卡、证据准备、改写、独立审查、至多一次必要局部返修、校验及出稿；授权发布和核验也计实际总时长。稳定修卡优先，符合标准且审查绑定有效的内容保留。预计超时说明具体卡与阻点，事实缺证不降低门槛；一次返修仍未闭合则保留待处理，不反复调用或扩成工具重构。实际token照实记录，2万只作观察参考，既有明确预算门禁不变。

## 固定发布构包（用户看稿后说“发布”）

完整顺序与第2步检查契约见 [五卡内容发布 workflow](../../docs/delivery/card-content-release-workflow.md)。第一步完成一次必要独立语义核对并冻结内容就绪；第二步使用真实Console JSON解析器检查完整发布包，并机械验证已有记录，不重新写卡或例行重审整批。JSON 是发布真源，Markdown 仅作阅读输出，避免已知的题面空行丢失。

**人工定稿入口**：先使用已准备且证据绑定有效的原卡 packet：

```sh
python3 tools/aws_cards/repair_batch.py run PACKET/input.json BASELINE.json RESULT --manual-patch FINAL.patch.json
python3 tools/aws_cards/repair_release.py prepare-manual REQUEST.json OUTPUT
```

上面的`run --manual-patch`属于流程第一步的冻结前核对：只调用Reviewer，不调用作者，保留真实人工来源与原任务；失败只做一次受限定向返修。`prepare-manual`是流程第二步唯一入口：一次执行冻结包一致性（含变更范围和既有审查绑定）与发布数据格式检查，再构包；读取既有Responses记录，不再次调用模型。普通自动作者批次继续用 `prepare`，不能将人工稿伪造成作者运行。发布器保留实际模型输入/响应/来源的逐文件归档。`mainSHA` 引用已验证的发布代码 main 提交，正文由独立全包哈希绑定，Git 内容归档不阻塞发布。代码或规则变化先合并验证，所有实际 PR 仍遵守强制检查。

聊天人工稿命令：`python3 tools/aws_cards/repair_release.py prepare-manual REQUEST.json OUTPUT`（自动作者批次使用`prepare`）。已有本批发布指令后执行；成功读取`preflight.json`并简报实际变化/未变数量，失败保留实际错误并定向定位，不重开整批审稿。REQUEST只有以下字段，路径均填当前冻结产物的绝对路径：

```json
{
  "priorRelease": "上次已核验发布目录",
  "packet": "本批input.json",
  "trial": "本批原始run目录",
  "reviewed": "含candidate.cards.json及cards.import.json的当前通过稿目录",
  "repair": null,
  "mainSHA": "实际核对的40位main提交",
  "releaseId": "本批固定发布身份",
  "authorization": "引用用户本次实际发布指令的JSON文件",
  "publisherCodeVerification": "已核对main与成功CI及12个关键文件的缓存JSON"
}
```

有一次定向补审时repair指向其原始目录。授权文件须保留非空userRequest及humanPerCardReview:false；构包器不生成用户授权或人审声明。输出目录必须不存在，失败目录保留；无模型调用或生产写入。

Console 载入 v2 `release-bundle.json` 后执行一次 **Run reviewed release**。首次可选择自动保存目录；以后复用该目录和登录权限。Console 自动核对包内 `expectedBaseline`，保存完整备份，再导入、一次全量回读、登记已有审查、发布及 CDN 核验。基线变化在导入前停止；不重新捕获当前状态来覆盖并发修改。`verify-baseline` 仅用于诊断，不再例行人工执行。

完成后，使用自动保存的本批子目录（或 **Download verified release artifacts** 的单文件）统一收尾：

```sh
python3 tools/aws_cards/repair_release.py finalize OUTPUT ARTIFACT_DIRECTORY_OR_PACKET.json
```

`finalize` 校验已完成的原 journal、同一 bundle/job/build/hash 和保存的真实 CDN 字节，保留全部双语内容、revision 及回执，输出可作下一批 `priorRelease` 的目录。不调用模型、不重复下载；相同字节重试幂等，不覆盖不同结果。

`publisherCodeVerification` 由实际 GitHub main 文件与成功 required checks 形成，发布器消费它并比较本机12个关键文件的SHA；改动或缺少成功检查时不能复用。正常内容批次复用未变代码的缓存，代码/规则/契约变化先合入验证。恢复沿用同一 releaseId/actionId/正文/job/build，先查后续。普通内容走内容CDN；App代码变化才安排兼容OTA。
