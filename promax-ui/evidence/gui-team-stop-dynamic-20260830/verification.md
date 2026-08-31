# 团队停止按钮动态浏览器验收（2026-08-30）

## 结论

安装态 `@promax/promax-ui-console@0.3.41` 已在隔离的真实 dsh Web 运行时完成一次浏览器可见的一键停止：父会话和一个运行中的 subagent 会话均从运行态转为 `idle`，两边最后一个 turn 均为 `aborted`；界面药丸从「团队运行中」恢复为「团队待命」，主按钮恢复为「发送任务」。本验收使用 `llm-replay` 脱敏挂起夹具，没有调用模型，也没有操作或重启共享 3080。

## 根因与修复

- Promax 影子注册了 `conversation.composer.bar`。dsh 原 InputBar 私下向该槽位注入 `stop`，但 Promax 的影子注册此前只返回 shell 公共 props，导致图标能随运行态变成停止图标，而 `stop` 为 `undefined`，按钮因此被禁用。
- Promax 现在通过公开 session binding 调用 `session.cancel()`，并订阅 session snapshot，等待父会话确实停止：`packages/promax-ui-console/src/client/index.tsx:392-425`。
- 运行后代仍通过 dsh 公共 `subagents.interrupt(..., mode: 'continuable')` 中断，并等待会话列表中的所有目标停止：`packages/promax-ui-console/src/client/index.tsx:199-216`。
- 动态浏览器验收还复现了第二个竞态：子 Agent 结束反馈可能在首次父会话停止后重新唤醒父会话。因此一次点击的最终顺序是“父会话停止并静止 → 运行后代停止并静止 → 父会话再次停止并静止”：`packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:1372-1400`。

## 浏览器可见证据

1. 在隔离的 dsh Web 页面从 Promax GUI 发起真实团队任务；replay 夹具使父会话和一个 child session 保持运行，不调用模型 API。
2. 页面显示「团队运行中」，主按钮的可访问名称为「停止团队任务」且处于 enabled。
3. 浏览器点击一次该按钮。
4. 页面最终显示「团队待命」，主按钮恢复为「发送任务」；父、子会话原生消息均显示 `Stopped`。
5. 运行时结果：

```json
{
  "parentStatus": "idle",
  "childStatus": "idle",
  "parentTurnEnd": "aborted",
  "childTurnEnd": "aborted"
}
```

截图：`team-stop-after.png`。

## 自动化与工程验证

- 动态浏览器命令：`PROMAX_STOP_CONTROL_DIR=/tmp/promax-team-stop-control.20260830-1316 pnpm vitest run --config evidence/gui-team-stop-dynamic-20260830/vitest.config.ts`
- 结果：`Test Files 1 passed (1)`、`Tests 1 passed (1)`、`Duration 163.95s`。
- 全量工程验证：`pnpm test` 为 16 文件 / 73 项通过；`pnpm typecheck`、`pnpm build`、`pnpm package:dist` 通过。
- 安装态：console `0.3.41`、report `0.1.1`；安装前后准确 `dump-config` 逐字相同。
- 共享 `http://127.0.0.1:3080/` 只读检查为 HTTP 200；按负责人约束未重启，因此共享进程要到下一次获准重启才会加载 0.3.41。

## 边界

- 这份证据只证明“停止团队任务”按钮的可点击性和父子会话一键终止闭环，不扩大为人工决策流、Judge 动态闭环或整轮 GUI 全部完成。
- A 方案保留的 dsh 对话流内部结构仍由 dsh 渲染。
