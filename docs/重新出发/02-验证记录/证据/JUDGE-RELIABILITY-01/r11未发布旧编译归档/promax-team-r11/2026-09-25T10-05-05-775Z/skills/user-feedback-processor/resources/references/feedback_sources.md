# 反馈渠道配置指南

## 支持的数据源

### 客服系统
- **工单系统**：Zendesk、Freshdesk、Udesk等
- **在线客服**：聊天记录导出
- **电话客服**：录音转写文本
- **数据格式**：CSV/JSON，包含时间、渠道、内容、客户ID

### 社群平台
- **微信群**：聊天记录导出（需合规授权）
- **QQ群**：消息记录导出
- **Discord/Slack**：API导出
- **论坛/社区**：爬虫采集或API

### 问卷系统
- **NPS调查**：净推荐值问卷
- **满意度调查**：功能/整体满意度
- **需求调研**：功能需求优先级
- **数据格式**：CSV/Excel，包含问卷ID、答案、时间

### 应用商店
- 详见 `app-market-sentiment` skill的`review_sources.md`

## 数据标准化

### 统一字段
```json
{
  "id": "反馈唯一ID",
  "channel": "来源渠道",
  "content": "反馈内容",
  "user_id": "用户标识（脱敏）",
  "timestamp": "反馈时间",
  "metadata": {
    "version": "应用版本",
    "device": "设备信息",
    "rating": "评分（如有）"
  }
}
```

### 渠道标识
- `customer_service`：客服系统
- `wechat_group`：微信群
- `qq_group`：QQ群
- `discord`：Discord
- `app_store`：应用商店
- `survey_nps`：NPS问卷
- `survey_satisfaction`：满意度调查
- `email`：邮件反馈
- `forum`：论坛/社区

## 去重策略

### 文本去重
- 基于内容相似度（Jaccard系数 > 0.8）
- 保留最早的一条
- 标记重复次数

### 用户去重
- 同一用户24小时内相同问题视为重复
- 保留最新的一条
- 累计反馈次数

## 数据清洗

### 过滤规则
- 删除纯表情、无意义字符
- 删除广告/ spam
- 删除过短内容（< 5个字符）
- 敏感信息脱敏（手机号、邮箱等）