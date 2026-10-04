# 通知渠道配置

> 预警通知渠道的统一配置指南。覆盖飞书/钉钉 Webhook、邮件、通用 Webhook 负载格式、看板内告警展示与渠道分级选择策略。

## 一、渠道总览

| 渠道 | 适用场景 | 实时性 | 适用等级 |
|------|----------|--------|----------|
| 飞书 Webhook | 主力通知（群机器人） | 秒级 | 🔴 / 🟡 |
| 钉钉 Webhook | 主力通知（群机器人） | 秒级 | 🔴 / 🟡 |
| 邮件 | 归档与详细报告 | 分钟级 | 🟡 / 💡 |
| 看板告警条 | 站内展示 | 实时 | 全部 |
| 短信/电话 | 严重升级兜底 | 秒级 | 🔴（可选） |

## 二、飞书 Webhook 配置

### 2.1 获取方式

群设置 → 群机器人 → 添加「自定义机器人」，复制 Webhook `https://open.feishu.cn/open-apis/bot/v2/hook/{token}`，建议开启签名校验。

### 2.2 消息示例

```bash
curl -X POST 'https://open.feishu.cn/open-apis/bot/v2/hook/{token}' -H 'Content-Type: application/json' -d '{
  "msg_type":"interactive",
  "card":{
    "config":{"wide_screen_mode":true},
    "header":{"title":{"tag":"plain_text","content":"🔴 严重预警：DAU 环比下跌 22%"},"template":"red"},
    "elements":[
      {"tag":"div","text":{"tag":"lark_md","content":"**指标**：DAU\n**当前值**：152,000\n**环比**：-22%\n**规则命中**：B1"}},
      {"tag":"hr"},
      {"tag":"div","text":{"tag":"lark_md","content":"**建议动作**：排查服务故障与负面舆情"}}
    ]
  }
}'
```

## 三、钉钉 Webhook 配置

### 3.1 获取方式

群设置 → 智能群助手 → 自定义（Webhook），复制地址 `https://oapi.dingtalk.com/robot/send?access_token={token}`，安全设置建议加签（Secret）。

### 3.2 加签计算（Python）

```python
def dingtalk_sign(secret: str) -> tuple[str, str]:
    timestamp = str(round(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(secret.encode(), string_to_sign.encode(), digestmod=hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
    return timestamp, sign
```

### 3.3 Markdown 消息示例

```json
{"msgtype":"markdown","markdown":{"title":"🟡 警告：负面舆情占比达 32%",
  "text":"### 🟡 警告：负面舆情占比达 32%\n\n- **渠道**：应用商店\n- **负面占比**：32%（基线 20%）\n- **Top 痛点**：闪退（P0，得分 40）"},
 "at":{"isAtAll":false,"atMobiles":["138xxxx"]}}
```

## 四、邮件通知模板

### 4.1 主题规范

```
[🔴严重] 指标预警 - DAU 环比下跌 22% - 2026-08-19
[🟡警告] 舆情预警 - 负面评论占比 32% - 2026-08-19
[💡关注] 趋势预警 - 渗透率连续 2 周下滑 - 2026-08-19
```

### 4.2 正文模板（HTML）

```html
<h2>🔴 严重预警：DAU 环比下跌 22%</h2>
<table border="1" cellpadding="6">
  <tr><th>指标</th><td>DAU</td></tr>
  <tr><th>当前值 / 环比</th><td>152,000 / <span style="color:#F5222D">-22%</span></td></tr>
  <tr><th>命中规则</th><td>B1（日环比跌幅 &gt; 20%）</td></tr>
  <tr><th>证据链</th><td>z=-3.2；成功率 88%</td></tr>
</table>
<p><strong>建议动作</strong>：排查服务故障、交叉验证负面舆情。— 响应时限 15 分钟</p>
```

### 4.3 发送要求

- 收件人：🔴 → 值班全员 + 负责人；🟡 → 负责人；💡 → 汇总邮件。
- 同主题 24h 内仅发 1 封；正文必须含完整证据链与建议动作。

## 五、Webhook 负载格式（通用规范）

```json
{
  "alert_id": "ALT-20260819-001",
  "level": "critical",
  "level_emoji": "🔴",
  "category": "metric|sentiment|composite",
  "title": "DAU 环比下跌 22%",
  "metric": "dau",
  "current_value": 152000,
  "baseline_value": 195000,
  "change_percent": -22.0,
  "triggered_rules": ["B1"],
  "window": "2026-08-19",
  "evidence": [
    {"method": "business_rule", "detail": "日环比跌幅 > 20%"},
    {"method": "zscore", "detail": "z = -3.2"}
  ],
  "suggested_actions": ["排查服务故障", "交叉验证负面舆情"],
  "link": "https://dashboard.example.com/alerts/ALT-20260819-001"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| alert_id / level / level_emoji / category / title | ✅ | 唯一ID、等级、类别、标题 |
| metric / current_value / baseline_value / change_percent | 指标类 | 数值与变化 |
| triggered_rules / evidence / suggested_actions | ✅ | 命中规则、证据链、建议动作 |
| link | 可选 | 看板详情链接 |

## 六、看板告警展示

- 顶部展示预警汇总条：`🔴 2 · 🟡 5 · 💡 3`，点击展开明细。
- 命中预警的 KPI 卡片显示对应等级徽标（红色光晕限 🔴 级）。
- 预警详情弹层：规则、证据链、处置状态（待处理/处理中/已关闭）。
- 已处理告警可标记关闭，关闭理由需记录用于误报复盘。

## 七、按预警等级选择渠道

| 预警等级 | 推送渠道 | 顺序 | 说明 |
|----------|----------|------|------|
| 🔴 严重 | 飞书/钉钉 + 邮件 + 看板 | 立即全发 | 15 分钟未确认 → 短信升级 |
| 🟡 警告 | 飞书/钉钉 + 看板 | 立即 | 每日 17:00 汇总邮件 |
| 💡 关注 | 看板 + 日汇总 | 定时 | 次日 10:00 汇总推送 |
| 聚合汇总 | 邮件 + 看板 | 每日 | 全量预警日报 |

### 渠道配置建议

- 飞书群 A（全员值班）：🔴 全部 + 🟡 核心指标
- 飞书群 B（产品/舆情组）：🟡 舆情类 + 💡 汇总
- 钉钉群（技术值班）：🔴 技术指标 + 🟡 成功率类
- 邮件（管理层）：🔴 + 周报摘要

### 告警疲劳控制

- 每渠道设置每日推送上限（如飞书每日 ≤ 20 条，超出合并为摘要）。
- 同一根因的多条告警合并为一条主告警 + 证据列表。
- 非工作时间（23:00~08:00）仅推送 🔴，其余延迟到次日。
