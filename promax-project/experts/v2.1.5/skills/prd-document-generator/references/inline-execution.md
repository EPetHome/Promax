# 内联生成：一次上下文、逐份成果、明确结束

适用 `prd-document-generator`、`business-diagram-generator`、`interactive-prototype-generator`。它们加载后由当前执行者继续工作，不启动 fork 子模型。其它业务 Skill 仍按自己的声明执行。

## 执行

1. 读取本次真实输入与已确认规则一次，按用户要求选择产物；不要为每份文件重新启动子 Agent / Skill。主理人已给出的路径和要求不重复确认。
2. 使用 Hook 注入的 `product-agent-context`。`run_id`、`artifact_dir`、`receipt_cli` 均来自实际调用，不自造、不手工启动另一条统计。缺少这些字段则报告安装 / Hook 未就绪，不冒充已经采集。
3. 成果写入本次 `artifact_dir`。每完成一份可用产物，写阶段 JSON，调用 checkpoint，并立即把真实路径与状态回传主理人；仅 Skill 入口直接向用户展示。有 `present_files` 时可直接展示已有文件，不等待全部完成。
4. 完成其余明确要求的产物后，以同一 run_id 调用 complete。统计前台只落本地回执，远端由既有后台 worker 补传，不等待远端网络。

## 回执 JSON

```json
{
  "run_id": "本次 Hook 注入值",
  "phase": "原型已生成，可查看",
  "status": "成功",
  "reason": "",
  "artifacts": ["本次 artifact_dir 内真实非空成果的绝对路径"],
  "checks": [
    {"name":"浏览器交互", "status":"not-run", "reason":"默认生成链不启动浏览器；待单独验收"}
  ]
}
```

按 `receipt_cli` 给出的解释器和脚本路径执行（逐参数按当前 shell 正确引用），在本次任务工作目录运行：

```text
<receipt_cli[0]> <receipt_cli[1]> checkpoint --result-file <阶段JSON绝对路径>
<receipt_cli[0]> <receipt_cli[1]> complete --result-file <结束JSON绝对路径>
```

- checkpoint 只表示阶段成果出现，不表示任务完成；重复相同回执不新增阶段。新产物与检查自动按路径 / 检查名累积，同一路径更新会记录新 hash。
- artifacts 只放本次真实交付成果；回执 JSON 不充当业务成果。检查证据可仅放 checks.evidence，不用计入业务产物数。
- 检查状态只能是 pass / fail / not-run。pass 或 fail 必须给本次目录内真实非空 evidence 文件；not-run 必须说明原因。文件校验只是元数据核验，不保证检查结论正确。
- 生成草稿完成可以是成功，同时保留未验证项；用户明确要求的验收没有执行则整体仍未完成，complete 使用失败 / 工具失败，已有成果照实保留。取消使用取消 / 用户取消。不能把生成成功写成业务验收通过。
- 工具失败立即保留成果、记录未验证项并 complete；不在任务里安装工具、切换多种浏览器命令或反复等待。调用命令不加 head / tail、管道或 `|| true` 掩盖真实退出码。
- 原型默认只跑已有静态检查并核对规则，浏览器验收单独发起。不得临时重写一份“测试引擎”复制业务逻辑再自证正确；没有针对真实产物执行的行为检查就写未验证。
- 宿主强制取消时可能没有执行结束回执的机会，此时保留未结束记录，不自动猜成功；后续核查后可用同一 run_id 明确关闭，不重复生成整套成果。
