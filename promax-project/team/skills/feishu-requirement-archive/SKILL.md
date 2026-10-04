---
name: feishu-requirement-archive
description: "飞书需求归档统计。扫描需求表格，统计已上线和已转出的需求，生成归档报告。触发词：归档、需求归档、archive requirements、生成归档报告。"
---

# 飞书需求归档技能

## 核心说明

本技能依赖 `feishu_bitable_app_table_*` 工具（当前 dsh 环境未接入飞书工具，接入前不执行写操作），不调飞书 HTTP API，不写独立脚本。

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

1. `feishu_bitable_app_table_field(app_token, table_id)` 获取字段
2. `feishu_bitable_app_table_record(app_token, table_id, page_size=500)` 读取记录
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

AI 直接输出文本统计报告。

## 注意事项

- **所有操作走 `feishu_bitable_app_table_*` 官方工具**，不走 HTTP API
- **不要硬编码 app_token 和 table_id**，从用户提供的 URL 解析
- **不要硬编码用户个人信息**
- **不要硬编码字段名**，用 list_fields 获取实际定义
- **不要要求用户提供 app_id/app_secret**，凭证由 channels.feishu 管理
