---
context: fork
name: requirement-archive
description: 需求归档统计。扫描需求表格，统计已上线和已转出的需求，生成归档报告。触发词：归档、需求归档、archive requirements、生成归档报告。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`requirement-archive`；默认角色：`requirement_management`；版本：2.1.5。**

# 需求归档技能

## 核心说明

本版通过当前目录 `scripts/feishu_data.py` 直连飞书。先读 `references/platform.md` 的业务读写命令；目标业务表由本次用户提供，不能使用采集表代替。

## 流程概要

```
检测飞书能力 → 获取多维表格 → 读取记录 → 筛选统计 → 输出报告
```

## 第一步：获取多维表格

### 用户提供了链接
提示用户提供飞书多维表格链接，解析出 app_token 和 table_id。

### 用户没提供链接
```
请提供你的飞书多维表格链接：https://my.feishu.cn/base/xxxxxxxxx
```

## 第二步：读取并统计

1. 用 feishu_data.py fields 获取字段
2. 用 feishu_data.py records 完整分页读取记录
3. 筛选状态为"已上线"和"需求转出"的记录

计算指标：

| 指标 | 说明 |
|------|------|
| 本周新增已上线 | 真实上线时间在本周的记录数 |
| 本周新增转出 | 本周状态变为"需求转出"的记录数 |
| 累计已上线 | 所有"已上线"记录 |
| 累计转出 | 所有"需求转出"记录 |
| 模块分布 | 按一级模块统计 |

## 第三步：输出报告

保存 Markdown 统计报告。缺少上线/转出时间时，仅统计累计数量；不能用当前状态推造本周变更。

## 注意事项

- **业务接口：** 使用当前技能自带的 feishu_data.py；采集使用 feishu_usage.py
- **不要硬编码 app_token 和 table_id**，从用户提供的 URL 解析
- **不要硬编码用户个人信息**
- **不要硬编码字段名**，用 list_fields 获取实际定义
- **凭证：** 复用本机独立配置，不在对话中索要或打印 Secret


---


## 本次任务输入

$ARGUMENTS
