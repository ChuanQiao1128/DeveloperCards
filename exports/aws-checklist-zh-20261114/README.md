# 中文答题自查要点补译

2026-11-14，379 张卡、757 条英文自查要点已逐条补译并通过独立双语复核，38 批当前输入与译文哈希全部匹配。当前状态为本地候选，未导入生产或发布。

本次仅新增 `teaching.zh-CN.mustAnswer`。原题面、英文要点、英中答案与解析、来源、UID、顺序、revision、领域和先修引用逐字段保持一致。没有重新制卡、修改 AWS 技术事实或升级原有题卡覆盖结论；没有测量记忆或考试正确率。

## 文件与复核

- `source-public-deck.json`：冻结的原公开 379 卡包，SHA-256 记录在 `source.json`。
- `public-deck.candidate.json`：完整候选卡包。外层版本标为 `local-candidate-zh-checklist-20261114`，避免冒用已发布 build ID；正式 build 仍由发布系统分配。
- `import-cards.candidate.json`：本地生成的完整导入候选，不纳入 Git，可由脚本重建。
- `batches/NN-input.json`、`NN-zh.json`、`NN-review.json`：每批最多 10 张卡的冻结输入、译文和独立语义复核。
- `*.r1.json`：首次退回的译文和审查，保留修复谱系。修订只复核受影响条目，其余有效结果复用。
- `translation-receipts.json`、`completion.json`：当前批次审查绑定及最终哈希。

复核逐条核对英中含义、条件、否定、连接词、主体与技术名，检查是否增添答题要求。共 10 批的 12 条措辞经定向修正；全部当前版本通过。旧 FAIL 不删除、不改写为首轮通过。

## 本地验证与发布条件

运行 `python3 exports/aws-checklist-zh-20261114/assemble.py`，检查 379 个 UID、757 条对齐、长度、重复项、逐卡仅新增中文要点，以及当前独立审查哈希，再生成候选包。真实后端 `TeachingValidation.Canonicalize` 的测试逐卡回读全部 757 条，并覆盖条数不匹配、空数组和重复条目的拒绝。

当前生产后端会丢弃这个中文数组。本轮已修改后端规范化器和共享契约，使其保留并验证一一对应的中文要点。后续须先部署后端支持，再按已有内容发布门禁导入、取得发布回执并核验 CDN；本地 review JSON 不能代替服务端发布授权收据。手机使用完整 App 修复仍需新的 2.1.1 原生包与设备验收。上述部署、导入与发布均未执行。
