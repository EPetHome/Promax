# 预警规则配置指南

## 预警级别定义

### 🔴 严重 (Critical)
- **触发条件**：
  - 爆发式负面舆情：1小时内负面评论 > 50条且增长率 > 300%
  - 指标严重异常：偏离均值 > 3σ
  - DAU单日下降 > 20%
  - 核心功能完全不可用
- **响应时间**：立即（5分钟内）
- **通知方式**：飞书/钉钉 + 邮件 + 短信
- **处理要求**：必须立即响应，启动应急流程

### 🟡 警告 (Warning)
- **触发条件**：
  - 版本问题：新版本负面率 > 30%
  - 指标异常：偏离均值 > 2σ
  - 功能渗透率连续3天下降
  - 用户反馈量突增 > 200%
- **响应时间**：30分钟内
- **通知方式**：飞书/钉钉 + 邮件
- **处理要求**：需关注并准备应对方案

### 💡 关注 (Notice)
- **触发条件**：
  - 指标波动：偏离均值 > 1.5σ
  - 新出现的问题类型首次出现
  - 竞品发布新功能
- **响应时间**：2小时内
- **通知方式**：飞书/钉钉
- **处理要求**：记录并观察趋势

## 规则配置示例

```json
{
  "sentiment_rules": [
    {
      "name": "爆发式负面舆情",
      "condition": "negative_count > 50 AND growth_rate > 300%",
      "level": "critical",
      "window": "1h",
      "cooldown": "2h"
    },
    {
      "name": "版本问题预警",
      "condition": "version_negative_rate > 30%",
      "level": "warning",
      "window": "24h",
      "cooldown": "24h"
    },
    {
      "name": "负面情感上升",
      "condition": "negative_rate_increase > 50%",
      "level": "warning",
      "window": "24h",
      "cooldown": "12h"
    }
  ],
  "metrics_rules": [
    {
      "name": "DAU骤降",
      "metric": "dau",
      "condition": "drop_rate > 20%",
      "level": "critical",
      "cooldown": "4h"
    },
    {
      "name": "DAU下降",
      "metric": "dau",
      "condition": "drop_rate > 10%",
      "level": "warning",
      "cooldown": "4h"
    },
    {
      "name": "容量异常",
      "metric": "upload_capacity",
      "condition": "deviation > 2sigma",
      "level": "warning",
      "cooldown": "6h"
    },
    {
      "name": "功能渗透率下降",
      "metric": "upload_penetration",
      "condition": "decline_days >= 3",
      "level": "notice",
      "cooldown": "24h"
    }
  ],
  "composite_rules": [
    {
      "name": "量价背离",
      "condition": "user_up_capacity_down OR user_down_capacity_up",
      "level": "warning",
      "cooldown": "12h"
    }
  ]
}
```

## 降噪策略

### 重复预警抑制
- 相同规则2小时内不重复触发
- 相关预警合并发送
- 阈值自适应调整

### 误报过滤
- 排除已知活动影响（促销活动、版本发布）
- 排除节假日效应
- 排除数据采集异常

### 智能阈值
- 基于历史数据自动调整阈值
- 考虑季节性因素
- 考虑业务周期（工作日/周末）