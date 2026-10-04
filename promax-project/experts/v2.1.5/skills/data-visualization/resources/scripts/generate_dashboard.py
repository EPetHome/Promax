#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_dashboard.py —— 数据可视化看板生成器

支持三种看板类型：
  1. user_voice     用户之声看板（情感分布 / TOP问题 / 情感趋势 / 关键词云 / 告警）
  2. core_metrics   核心指标看板（指标卡片 / 指标趋势 / 量价散点 / 异常标注 / 异常明细）
  3. comprehensive  综合看板（用户之声 + 核心指标 + 统一告警面板 + 联动洞察）

依赖：仅 Python 标准库，无第三方依赖。
图表：Chart.js（CDN 引入），生成的 HTML 直接浏览器打开即可渲染真实图表。

用法示例：
  python generate_dashboard.py --type user_voice --input data.json --output dashboard.html
  python generate_dashboard.py --type core_metrics --input metrics.json --output metrics.html
  python generate_dashboard.py --type comprehensive --input all.json --output all.html
"""

import argparse
import html
import json
import os
import sys
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))

# ---------------------------------------------------------------------------
# 全局配色常量（与设计规范保持一致）
# ---------------------------------------------------------------------------
COLOR_PRIMARY = '#1890ff'   # 主色：蓝
COLOR_SUCCESS = '#52c41a'   # 正向：绿
COLOR_ERROR = '#f5222d'     # 负向：红
COLOR_WARNING = '#faad14'   # 警示：黄
COLOR_BG = '#f0f2f5'        # 页面背景
COLOR_CARD_BG = '#ffffff'   # 卡片背景
COLOR_TEXT = '#262626'      # 主文字
COLOR_TEXT_SUB = '#8c8c8c'  # 次要文字
COLOR_BORDER = '#f0f0f0'    # 卡片边框

CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js'

# 数据缺失时的统一占位文案（页面与 stdout 汇总复用同一个常量）
EMPTY_TEXT = '暂无数据'

# 综合看板配色（顺序即取色顺序）
CS_PALETTE = [COLOR_PRIMARY, '#13c2c2', '#722ed1', '#eb2f96',
              COLOR_WARNING, COLOR_SUCCESS, '#fa541c', '#2f54eb']

# 速率类字段识别后缀：用于把「率」类字段单独画折线并补 %
# 只看字段名后缀，任何业务词都不写进代码
CS_RATE_SUFFIXES = ('rate', 'ratio', 'pct', 'percent')

# meta 字段的中性中文名（schema 字段名映射，不是业务词）
CS_META_LABELS = (
    ('project', '项目'),
    ('task', '任务'),
    ('mode', '模式'),
    ('data_nature', '数据性质'),
)

# 核心指标展示配置（顺序、中文名、单位）
METRIC_META = [
    ('dau', 'DAU（日活跃）', '人'),
    ('mau', 'MAU（月活跃）', '人'),
    ('upload_users', '上传用户数', '人'),
    ('download_users', '下载用户数', '人'),
    ('upload_capacity', '上传容量', 'GB'),
    ('download_capacity', '下载容量', 'GB'),
]


class RawJS(str):
    """标记「原样注入 JS」的字符串。

    Chart.js 的 options 里可能带函数（ticks.callback / tooltip.callbacks），
    这类值不能当普通字符串加引号，否则图表回调会被转义坏掉。
    """


def js_dump(obj, indent=0):
    """把 Python 结构序列化为 JavaScript 字面量（RawJS 原样输出，字符串转义 </）。"""
    pad = '  ' * indent
    if isinstance(obj, RawJS):
        return str(obj)
    if obj is None:
        return 'null'
    if isinstance(obj, bool):
        return 'true' if obj else 'false'
    if isinstance(obj, (int, float)):
        return json.dumps(obj)
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False).replace('</', '<\\/')
    if isinstance(obj, dict):
        if not obj:
            return '{}'
        parts = ['%s%s: %s' % ('  ' * (indent + 1),
                               json.dumps(str(k), ensure_ascii=False),
                               js_dump(v, indent + 1))
                 for k, v in obj.items()]
        return '{\n' + ',\n'.join(parts) + '\n' + pad + '}'
    if isinstance(obj, (list, tuple)):
        if not obj:
            return '[]'
        parts = ['  ' * (indent + 1) + js_dump(v, indent + 1) for v in obj]
        return '[\n' + ',\n'.join(parts) + '\n' + pad + ']'
    return json.dumps(str(obj), ensure_ascii=False)


class DashboardGenerator(object):
    """看板生成器：将 JSON 数据渲染为自包含的 HTML 看板页面。"""

    def __init__(self):
        self.base_css = self._build_base_css()
        self.chart_js_framework = self._build_chart_js_framework()
        # 最近一次 comprehensive 渲染的区块统计，供 main() 打印 schema 反馈
        self.comprehensive_summary = None

    # ------------------------------------------------------------------
    # 对外入口
    # ------------------------------------------------------------------
    def generate(self, dashboard_type, input_path, output_path):
        """读取 JSON -> 渲染 HTML -> 写出文件。"""
        data = self._load_json(input_path)
        html_str = self.render(dashboard_type, data)
        self._write_output(output_path, html_str)
        return output_path

    def render(self, dashboard_type, data):
        """根据看板类型选择对应模板渲染。"""
        if dashboard_type == 'user_voice':
            return self._user_voice_template(data)
        if dashboard_type == 'core_metrics':
            return self._core_metrics_template(data)
        if dashboard_type == 'comprehensive':
            return self._comprehensive_template(data)
        raise ValueError('未知看板类型：%s（可选：user_voice / core_metrics / comprehensive）'
                         % dashboard_type)

    # ------------------------------------------------------------------
    # 文件读写
    # ------------------------------------------------------------------
    def _load_json(self, input_path):
        """以 UTF-8 读取并解析输入 JSON 文件。"""
        with open(input_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _write_output(self, output_path, html_str):
        """以 UTF-8 写出 HTML，自动创建父目录。"""
        parent = os.path.dirname(os.path.abspath(output_path))
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_str)

    # ------------------------------------------------------------------
    # 安全取值 / 格式化工具
    # ------------------------------------------------------------------
    @staticmethod
    def _safe_get(obj, key, default=None):
        """安全取值：obj 非 dict 或 key 缺失时返回 default。"""
        if isinstance(obj, dict):
            return obj.get(key, default)
        return default

    @staticmethod
    def _safe_int(value, default=0):
        """安全转 int。"""
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_float(value, default=0.0):
        """安全转 float。"""
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _esc(value):
        """HTML 转义，避免特殊字符破坏页面结构。"""
        if value is None:
            return ''
        return html.escape(str(value))

    @staticmethod
    def _fmt_number(value):
        """数值格式化：>=10000 显示为 x.xx 万。"""
        v = DashboardGenerator._safe_float(value, None)
        if v is None:
            return '--'
        if abs(v) >= 10000:
            return '%.2f万' % (v / 10000.0)
        if v == int(v):
            return str(int(v))
        return ('%.2f' % v).rstrip('0').rstrip('.')

    @staticmethod
    def _change_html(change):
        """根据 change 值生成带颜色/箭头的涨跌标签 HTML。
        约定：change 直接按百分比数值处理（如 3.5 表示 +3.5%）。"""
        c = DashboardGenerator._safe_float(change, None)
        if c is None:
            return '<span class="change" style="color:%s">--</span>' % COLOR_TEXT_SUB
        if c > 0:
            arrow, color = '▲', COLOR_SUCCESS
        elif c < 0:
            arrow, color = '▼', COLOR_ERROR
        else:
            arrow, color = '■', COLOR_TEXT_SUB
        return '<span class="change" style="color:%s">%s %.2f%%</span>' % (color, arrow, abs(c))

    @staticmethod
    def _json_dumps(obj):
        """JSON 序列化并转义 </，防止嵌入 <script> 时被提前截断。"""
        return json.dumps(obj, ensure_ascii=False).replace('</', '<\\/')

    # ------------------------------------------------------------------
    # 公共 CSS 骨架
    # ------------------------------------------------------------------
    def _build_base_css(self):
        css = """
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
                         'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: %(bg)s;
            color: %(text)s;
            line-height: 1.6;
        }
        .container { max-width:1200px; margin:0 auto; padding:24px 16px 48px; }
        .page-header {
            display:flex; justify-content:space-between; align-items:center;
            margin-bottom:24px; flex-wrap:wrap; gap:12px;
        }
        .page-title { font-size:24px; font-weight:600; }
        .page-meta { color:%(text_sub)s; font-size:13px; }
        .grid {
            display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
            gap:16px; margin-bottom:16px;
        }
        .card {
            background:%(card_bg)s; border-radius:12px;
            box-shadow:0 2px 8px rgba(0,0,0,.06);
            padding:20px; border:1px solid %(border)s;
        }
        .card-title { font-size:16px; font-weight:600; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
        .card-title::before {
            content:''; width:4px; height:16px;
            background:%(primary)s; border-radius:2px;
        }
        .chart-box { position:relative; height:300px; }
        .chart-box.tall { height:340px; }
        .empty-tip { color:%(text_sub)s; text-align:center; padding:48px 0; font-size:14px; }
        .summary-row {
            display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
            gap:16px; margin-bottom:16px;
        }
        .summary-item {
            background:%(card_bg)s; border-radius:12px; padding:16px 18px;
            text-align:center; border:1px solid %(border)s;
            box-shadow:0 2px 8px rgba(0,0,0,.06);
        }
        .summary-value { font-size:24px; font-weight:700; }
        .summary-label { font-size:13px; color:%(text_sub)s; margin-top:2px; }
        .metric-grid {
            display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
            gap:16px; margin-bottom:16px;
        }
        .metric-card {
            background:%(card_bg)s; border-radius:12px; padding:18px 20px;
            box-shadow:0 2px 8px rgba(0,0,0,.06); border:1px solid %(border)s;
        }
        .metric-name { font-size:13px; color:%(text_sub)s; }
        .metric-value { font-size:28px; font-weight:700; margin:6px 0 4px; }
        .metric-unit { font-size:13px; color:%(text_sub)s; font-weight:400; }
        .metric-change { font-size:13px; }
        .alert-list { display:flex; flex-direction:column; gap:10px; }
        .alert-item { border-radius:8px; padding:12px 14px; border-left:4px solid; font-size:14px; }
        .alert-item.high { background:%(alert_high_bg)s; border-color:%(error)s; color:%(error)s; }
        .alert-item.medium { background:%(alert_medium_bg)s; border-color:%(warning)s; color:#ad6800; }
        .alert-item.low { background:%(alert_low_bg)s; border-color:%(primary)s; color:#0050b3; }
        .alert-item .alert-title { font-weight:600; }
        .alert-item .alert-desc { margin-top:2px; opacity:.85; }
        .keyword-cloud {
            display:flex; flex-wrap:wrap; gap:10px; align-items:center;
            justify-content:center; min-height:200px; align-content:center;
        }
        .keyword-tag { display:inline-block; border-radius:16px; padding:6px 14px; cursor:default; }
        .footer { text-align:center; color:%(text_sub)s; font-size:12px; margin-top:32px; }
        @media (max-width:768px) {
            .grid { grid-template-columns:1fr; }
            .metric-grid { grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
            .page-title { font-size:20px; }
        }
        """
        return css % {
            'bg': COLOR_BG,
            'text': COLOR_TEXT,
            'text_sub': COLOR_TEXT_SUB,
            'card_bg': COLOR_CARD_BG,
            'border': COLOR_BORDER,
            'primary': COLOR_PRIMARY,
            'error': COLOR_ERROR,
            'warning': COLOR_WARNING,
            'alert_high_bg': '#fff1f0',
            'alert_medium_bg': '#fffbe6',
            'alert_low_bg': '#f0f5ff',
        }

    def _build_comprehensive_css(self):
        """综合看板专用样式（cs- 前缀）。

        只在 comprehensive 页面通过 _page_start(extra_css=...) 注入，
        不改 base_css，保证 user_voice / core_metrics 两个 type 的输出不变。
        """
        return """
        .cs-meta-line { color:%(text_sub)s; font-size:12px; margin:-16px 0 18px; }
        .cs-section { display:flex; align-items:baseline; gap:10px; margin:28px 0 12px; flex-wrap:wrap; }
        .cs-idx { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px;
                  border-radius:6px; background:#e6f4ff; color:%(primary)s; font-size:12px; font-weight:700; }
        .cs-title { font-size:16px; font-weight:600; }
        .cs-note { font-size:12px; color:%(text_sub)s; font-weight:400; margin-left:auto; }
        .cs-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
                       gap:14px; margin-bottom:16px; }
        .cs-kpi { background:%(card_bg)s; border:1px solid %(border)s; border-radius:12px;
                  padding:14px 16px; box-shadow:0 2px 8px rgba(0,0,0,.06); }
        .cs-kpi-label { font-size:12px; color:%(text_sub)s; word-break:break-all; }
        .cs-kpi-value { font-size:24px; font-weight:700; margin:4px 0 2px; }
        .cs-kpi-value.is-empty { font-size:16px; color:%(text_sub)s; font-weight:600; }
        .cs-kpi-note { font-size:11px; color:%(text_sub)s; }
        .cs-empty-box { border:1px dashed #e5e6eb; border-radius:10px; }
        .cs-empty-note { font-size:12px; color:%(text_sub)s; padding:0 14px 14px; line-height:1.7; }
        .cs-badge-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
        .cs-badge { display:inline-flex; align-items:center; gap:6px; border-radius:14px;
                    padding:3px 12px; font-size:12px; font-weight:600; border:1px solid; }
        .cs-badge.high { color:#a8071a; background:#fff1f0; border-color:#ffa39e; }
        .cs-badge.medium { color:#ad6800; background:#fffbe6; border-color:#ffe58f; }
        .cs-badge.low { color:#0958d9; background:#e6f4ff; border-color:#91caff; }
        .cs-badge.ok { color:#237804; background:#f6ffed; border-color:#b7eb8f; }
        .cs-alert-head { display:flex; align-items:center; gap:8px; font-weight:600; }
        .cs-alert-body { margin-top:8px; font-size:12px; color:#434343; display:grid; gap:4px; }
        .cs-alert-body .row { display:flex; gap:8px; }
        .cs-alert-body .k { color:%(text_sub)s; flex:0 0 68px; }
        .cs-alert-body .v { flex:1; word-break:break-word; }
        .cs-alert-status { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px;
                           background:#fff; border:1px solid #d9d9d9; color:#595959; }
        .cs-lead-list { display:flex; flex-direction:column; gap:8px; }
        .cs-lead { display:flex; gap:10px; align-items:flex-start; font-size:13px; padding:9px 12px;
                   background:#fafafa; border:1px solid #f0f0f0; border-radius:8px; }
        .cs-rid { flex:0 0 auto; font-weight:700; color:%(primary)s; background:#e6f4ff;
                  border-radius:6px; padding:0 7px; font-size:12px; line-height:20px; }
        .cs-table-wrap { overflow-x:auto; margin-top:14px; }
        table.cs-table { width:100%%; border-collapse:collapse; font-size:12px; min-width:520px; }
        table.cs-table th, table.cs-table td { border-bottom:1px solid #f0f0f0; padding:8px 10px;
                                               text-align:right; white-space:nowrap; }
        table.cs-table th:first-child, table.cs-table td:first-child { text-align:left; }
        table.cs-table thead th { background:#fafafa; color:%(text_sub)s; font-weight:600; }
        table.cs-table tbody tr:hover { background:#f7f9fc; }
        .cs-def-list { display:flex; flex-direction:column; gap:6px; font-size:12px; list-style:none; }
        .cs-def-list dt { font-weight:600; }
        .cs-def-list dd { color:%(text_sub)s; }
        .cs-src-list { display:flex; flex-direction:column; gap:12px; }
        .cs-src-item { font-size:12px; padding:10px 12px; background:#fafafa;
                       border:1px solid #f0f0f0; border-radius:8px; }
        .cs-src-name { font-weight:600; font-size:13px; }
        .cs-src-path { color:#0958d9; word-break:break-all;
                       font-family:ui-monospace, SFMono-Regular, Menlo, monospace; margin-top:2px; }
        .cs-src-note { color:%(text_sub)s; margin-top:4px; }
        .cs-disclaimer { margin-top:14px; font-size:12px; color:%(text_sub)s; }
        .cs-disclaimer li { margin-left:18px; margin-top:2px; }
        @media (max-width:768px) {
            .cs-kpi-grid { grid-template-columns:1fr; }
            .cs-note { margin-left:0; }
        }
        """ % {
            'text': COLOR_TEXT,
            'text_sub': COLOR_TEXT_SUB,
            'card_bg': COLOR_CARD_BG,
            'border': COLOR_BORDER,
            'primary': COLOR_PRIMARY,
        }

    # ------------------------------------------------------------------
    # 公共 JS 骨架（Chart.js CDN + 初始化脚本）
    # ------------------------------------------------------------------
    def _build_chart_js_framework(self):
        """Chart.js CDN 引入 + 全局图表初始化脚本。"""
        return """
        <script src="%s"></script>
        <script>
        document.addEventListener('DOMContentLoaded', function () {
          var configs = window.__DASHBOARD_CHARTS__ || [];
          configs.forEach(function (cfg) {
            var el = document.getElementById(cfg.id);
            if (!el || typeof Chart === 'undefined') { return; }
            var defaults = {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { labels: { boxWidth: 12, padding: 12 } } }
            };
            cfg.options = Object.assign(defaults, cfg.options || {});
            new Chart(el, cfg);
          });
        });
        </script>
        """ % CHART_CDN

    # ------------------------------------------------------------------
    # 页面骨架
    # ------------------------------------------------------------------
    def _page_start(self, title, subtitle='', extra_css=''):
        """页面头部 + 公共样式（extra_css 仅供综合看板追加区块样式，其它 type 传空即保持原样）。"""
        now = datetime.now(CST).isoformat(sep=" ", timespec="seconds")
        title_esc = self._esc(title)
        subtitle_esc = self._esc(subtitle)
        return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%s</title>
<style>
%s
</style>
</head>
<body>
<div class="container">
  <div class="page-header">
    <div class="page-title">%s</div>
    <div class="page-meta">%s生成时间 %s</div>
  </div>
""" % (title_esc, self.base_css + extra_css, title_esc,
       (subtitle_esc + ' · ' if subtitle_esc else ''), now)

    def _page_end(self, chart_configs, raw_js=False):
        """页面结尾 + 图表配置注入 + Chart.js 初始化。
        raw_js=True 时用 js_dump 注入，支持 options 里的 RawJS 回调。"""
        payload = js_dump(chart_configs) if raw_js else self._json_dumps(chart_configs)
        return """
  <div class="footer">数据可视化看板 · 由 generate_dashboard.py 生成</div>
</div>
<script>window.__DASHBOARD_CHARTS__ = %s;</script>
%s
</body>
</html>
""" % (payload, self.chart_js_framework)

    # ------------------------------------------------------------------
    # 基础组件
    # ------------------------------------------------------------------
    def _card(self, title, body_html):
        """通用卡片容器。"""
        return ('<div class="card"><div class="card-title">%s</div>%s</div>'
                % (self._esc(title), body_html))

    def _chart_card(self, card_id, title, chart_type, labels, datasets, options=None, extra=''):
        """生成图表卡片：返回 (卡片HTML, 图表配置dict)。extra 为图表下方的附加说明。"""
        canvas_id = 'chart_%s' % card_id
        body = '<div class="chart-box"><canvas id="%s"></canvas></div>%s' % (canvas_id, extra)
        config = {
            'id': canvas_id,
            'type': chart_type,
            'data': {'labels': labels, 'datasets': datasets},
            'options': options or {},
        }
        return self._card(title, body), config

    def _empty_state(self, text=EMPTY_TEXT):
        """数据缺失时的占位提示。"""
        return '<div class="empty-tip">%s</div>' % self._esc(text)

    # ------------------------------------------------------------------
    # 告警 / 异常
    # ------------------------------------------------------------------
    def _alert_item_html(self, alert):
        """渲染单条告警（支持字符串或 dict 两种输入）。"""
        if isinstance(alert, str):
            return ('<div class="alert-item medium"><div class="alert-title">%s</div></div>'
                    % self._esc(alert))
        level = str(self._safe_get(alert, 'level', 'medium')).lower()
        level = level if level in ('high', 'medium', 'low') else 'medium'
        metric = self._safe_get(alert, 'metric')
        title = self._safe_get(alert, 'title')
        if not title:
            title = '指标异常：%s' % metric if metric else '告警'
        desc = self._safe_get(alert, 'description') or self._safe_get(alert, 'desc') or ''
        value = self._safe_get(alert, 'value')
        if value is not None:
            desc = '%s（当前值：%s）' % (desc, value) if desc else '当前值：%s' % value
        return ('<div class="alert-item %s"><div class="alert-title">%s</div>'
                '<div class="alert-desc">%s</div></div>'
                % (level, self._esc(title), self._esc(desc)))

    def _alert_section(self, alerts, title='告警信息', empty_text='当前无告警'):
        """告警/异常列表卡片。"""
        if not isinstance(alerts, list) or not alerts:
            return self._card(title, self._empty_state(empty_text))
        body = '<div class="alert-list">%s</div>' % ''.join(
            self._alert_item_html(a) for a in alerts)
        return self._card(title, body)

    # ------------------------------------------------------------------
    # 关键词云（纯 HTML/CSS 实现，无外部依赖）
    # ------------------------------------------------------------------
    def _keyword_cloud(self, keywords):
        """根据词频生成带大小/颜色差异的关键词云。"""
        if not isinstance(keywords, list) or not keywords:
            return self._empty_state('暂无关键词数据')
        max_count = 1
        for kw in keywords:
            c = self._safe_int(self._safe_get(kw, 'count'), 1)
            max_count = max(max_count, c)
        palette = [COLOR_PRIMARY, '#36cfc9', '#722ed1', '#eb2f96',
                   COLOR_WARNING, '#13c2c2', COLOR_SUCCESS, '#fa541c']
        items = []
        for i, kw in enumerate(keywords[:60]):
            word = self._safe_get(kw, 'word') or self._safe_get(kw, 'name')
            if not word:
                continue
            count = self._safe_int(self._safe_get(kw, 'count'), 1)
            ratio = count / float(max_count)
            font_size = 14 + ratio * 18  # 14 ~ 32px
            color = palette[i % len(palette)]
            items.append(
                '<span class="keyword-tag" style="font-size:%.0fpx;color:%s;background:%s22;">'
                '%s<span style="font-size:12px;opacity:.6;margin-left:4px;">%d</span></span>'
                % (font_size, color, color, self._esc(word), count))
        return '<div class="keyword-cloud">%s</div>' % ''.join(items)

    # ------------------------------------------------------------------
    # 用户之声区块
    # ------------------------------------------------------------------
    def _user_voice_section(self, data, include_alerts=True):
        """用户之声区块：返回 (区块HTML, 图表配置列表)。"""
        data = data if isinstance(data, dict) else {}
        charts = []

        # ---- 顶部摘要 ----
        today = self._safe_int(self._safe_get(data, 'today_count'), None)
        week = self._safe_int(self._safe_get(data, 'week_count'), None)
        day_chg = self._safe_float(self._safe_get(data, 'day_change'), None)
        week_chg = self._safe_float(self._safe_get(data, 'week_change'), None)

        def _sum_val(v):
            return '--' if v is None else ('%d' % v)

        def _sum_chg(c):
            if c is None:
                return '<span class="change" style="color:%s">--</span>' % COLOR_TEXT_SUB
            if c > 0:
                arrow, color = '▲', COLOR_SUCCESS
            elif c < 0:
                arrow, color = '▼', COLOR_ERROR
            else:
                arrow, color = '■', COLOR_TEXT_SUB
            return '<span class="change" style="color:%s">%s %.2f%%</span>' % (color, arrow, abs(c))

        summary_html = (
            '<div class="summary-row">'
            '<div class="summary-item"><div class="summary-value">%s</div>'
            '<div class="summary-label">今日反馈数</div></div>'
            '<div class="summary-item"><div class="summary-value">%s</div>'
            '<div class="summary-label">本周反馈数</div></div>'
            '<div class="summary-item"><div class="summary-value">%s</div>'
            '<div class="summary-label">日环比</div></div>'
            '<div class="summary-item"><div class="summary-value">%s</div>'
            '<div class="summary-label">周环比</div></div>'
            '</div>'
        ) % (_sum_val(today), _sum_val(week), _sum_chg(day_chg), _sum_chg(week_chg))

        # ---- 情感分布（环形图）----
        senti = self._safe_get(data, 'sentiment', {})
        senti_values = [
            self._safe_int(self._safe_get(senti, 'positive'), 0),
            self._safe_int(self._safe_get(senti, 'neutral'), 0),
            self._safe_int(self._safe_get(senti, 'negative'), 0),
        ]
        if sum(senti_values) == 0:
            sentiment_card = self._card('情感分布', self._empty_state())
        else:
            sentiment_card, scfg = self._chart_card(
                'sentiment', '情感分布', 'doughnut',
                ['正面', '中性', '负面'],
                [{'data': senti_values,
                  'backgroundColor': [COLOR_SUCCESS, COLOR_PRIMARY, COLOR_ERROR],
                  'borderWidth': 2, 'borderColor': COLOR_CARD_BG}],
                {'plugins': {'legend': {'position': 'bottom'}}})
            charts.append(scfg)

        # ---- TOP 问题（横向条形图）----
        problems = self._safe_get(data, 'top_problems', [])
        if not isinstance(problems, list) or not problems:
            problems_card = self._card('TOP 问题分布', self._empty_state())
        else:
            p_labels = [str(self._safe_get(p, 'category') or ('问题%d' % (i + 1)))
                        for i, p in enumerate(problems)]
            p_counts = [self._safe_int(self._safe_get(p, 'count'), 0) for p in problems]
            # 传入时按数量降序排列，条形图第一条目位于顶部（无需反转）
            problems_card, pcfg = self._chart_card(
                'problems', 'TOP 问题分布', 'bar', p_labels,
                [{'data': p_counts, 'backgroundColor': COLOR_PRIMARY,
                  'borderRadius': 6, 'barThickness': 22}],
                {'indexAxis': 'y',
                 'scales': {'x': {'grid': {'display': False}},
                            'y': {'grid': {'display': False}}},
                 'plugins': {'legend': {'display': False}}})
            charts.append(pcfg)

        # ---- 情感趋势（折线图）----
        trend = self._safe_get(data, 'trend', [])
        if not isinstance(trend, list) or not trend:
            trend_card = self._card('情感趋势', self._empty_state())
        else:
            t_labels = [str(self._safe_get(t, 'date') or (i + 1))
                        for i, t in enumerate(trend)]
            t_positive = [self._safe_int(self._safe_get(t, 'positive'), 0) for t in trend]
            t_neutral = [self._safe_int(self._safe_get(t, 'neutral'), 0) for t in trend]
            t_negative = [self._safe_int(self._safe_get(t, 'negative'), 0) for t in trend]
            trend_card, tcfg = self._chart_card(
                'trend', '情感趋势', 'line', t_labels,
                [
                    {'label': '正面', 'data': t_positive, 'borderColor': COLOR_SUCCESS,
                     'backgroundColor': COLOR_SUCCESS, 'tension': 0.35, 'fill': False},
                    {'label': '中性', 'data': t_neutral, 'borderColor': COLOR_PRIMARY,
                     'backgroundColor': COLOR_PRIMARY, 'tension': 0.35, 'fill': False},
                    {'label': '负面', 'data': t_negative, 'borderColor': COLOR_ERROR,
                     'backgroundColor': COLOR_ERROR, 'tension': 0.35, 'fill': False},
                ],
                {'scales': {'y': {'beginAtZero': True, 'grid': {'color': '#f5f5f5'}}}})
            charts.append(tcfg)

        # ---- 关键词云 ----
        cloud_card = self._card('关键词云',
                                self._keyword_cloud(self._safe_get(data, 'keywords', [])))

        html_parts = [
            summary_html,
            '<div class="grid">%s%s</div>' % (sentiment_card, problems_card),
            '<div class="grid">%s%s</div>' % (trend_card, cloud_card),
        ]
        if include_alerts:
            html_parts.append('<div class="grid">%s</div>' % self._alert_section(
                self._safe_get(data, 'alerts', [])))
        return ''.join(html_parts), charts

    # ------------------------------------------------------------------
    # 量价关系散点图（量价背离分析）
    # ------------------------------------------------------------------
    def _divergence_chart(self, metrics):
        """上传用户数 vs 上传容量散点图。
        返回 (卡片HTML, 图表配置或None)。"""
        uu_trend = self._safe_get(self._safe_get(metrics, 'upload_users', {}), 'trend', [])
        uc_trend = self._safe_get(self._safe_get(metrics, 'upload_capacity', {}), 'trend', [])
        points = []
        if isinstance(uu_trend, list) and isinstance(uc_trend, list):
            n = min(len(uu_trend), len(uc_trend))
            for i in range(n):
                u = self._safe_float(self._safe_get(uu_trend[i], 'value'), None)
                c = self._safe_float(self._safe_get(uc_trend[i], 'value'), None)
                if u is not None and c is not None:
                    points.append({'x': u, 'y': c})
        if not points:
            return self._card('量价关系散点', self._empty_state('暂无量价数据')), None
        card, cfg = self._chart_card(
            'divergence', '量价关系散点（上传用户数 vs 上传容量）', 'scatter', [],
            [{'label': '量价点', 'data': points, 'backgroundColor': COLOR_PRIMARY,
              'pointRadius': 6, 'pointHoverRadius': 9}],
            {'scales': {
                'x': {'title': {'display': True, 'text': '上传用户数'},
                      'grid': {'color': '#f5f5f5'}},
                'y': {'title': {'display': True, 'text': '上传容量（GB）'},
                      'grid': {'color': '#f5f5f5'}}},
             'plugins': {'legend': {'display': False}}})
        return card, cfg

    # ------------------------------------------------------------------
    # 核心指标区块
    # ------------------------------------------------------------------
    def _core_metrics_section(self, data, include_anomalies=True):
        """核心指标区块：返回 (区块HTML, 图表配置列表)。"""
        data = data if isinstance(data, dict) else {}
        charts = []
        metrics = self._safe_get(data, 'metrics', {})
        if not isinstance(metrics, dict):
            metrics = {}
        anomalies = self._safe_get(data, 'anomalies', [])
        if not isinstance(anomalies, list):
            anomalies = []

        # ---- 指标卡片（当前值 + 变化率）----
        metric_cards = []
        for key, name, unit in METRIC_META:
            item = self._safe_get(metrics, key, {})
            current = self._safe_get(item, 'current')
            change = self._safe_get(item, 'change')
            if current is None:
                metric_cards.append(
                    '<div class="metric-card"><div class="metric-name">%s</div>'
                    '<div class="metric-value">暂无数据</div></div>' % name)
            else:
                metric_cards.append(
                    '<div class="metric-card"><div class="metric-name">%s</div>'
                    '<div class="metric-value">%s<span class="metric-unit"> %s</span></div>'
                    '<div class="metric-change">%s</div></div>'
                    % (name, self._fmt_number(current), unit, self._change_html(change)))
        metric_grid = '<div class="metric-grid">%s</div>' % ''.join(metric_cards)

        # ---- 指标趋势（多指标折线图 + 异常标注）----
        trend_series = []
        for key, name, unit in METRIC_META:
            t = self._safe_get(self._safe_get(metrics, key, {}), 'trend', [])
            if isinstance(t, list) and t:
                trend_series.append((name, t))

        if not trend_series:
            trend_card = self._card('指标趋势', self._empty_state())
        else:
            labels = None
            datasets = []
            palette = [COLOR_PRIMARY, COLOR_SUCCESS, COLOR_ERROR,
                       COLOR_WARNING, '#722ed1', '#13c2c2']
            for idx, (name, t) in enumerate(trend_series):
                if labels is None:
                    labels = [str(self._safe_get(x, 'date') or (i + 1))
                              for i, x in enumerate(t)]
                values = [self._safe_float(self._safe_get(x, 'value'), None)
                          for x in t]
                datasets.append({
                    'label': name, 'data': values,
                    'borderColor': palette[idx % len(palette)],
                    'backgroundColor': palette[idx % len(palette)],
                    'tension': 0.3, 'fill': False,
                    'pointRadius': 2, 'borderWidth': 2,
                })
            # 异常标注：若异常含 date/time 且能匹配到趋势日期，
            # 则以旋转方块叠加到趋势图上
            marker_points = []
            for anom in anomalies:
                adate = self._safe_get(anom, 'date') or self._safe_get(anom, 'time')
                adate = str(adate) if adate is not None else None
                if not adate or adate not in labels:
                    continue
                idx = labels.index(adate)
                val = None
                for ds in datasets:
                    vals = ds.get('data', [])
                    if idx < len(vals):
                        val = vals[idx]
                        break
                if val is None:
                    continue
                level = str(self._safe_get(anom, 'level', 'medium')).lower()
                color = COLOR_ERROR if level == 'high' else (
                    COLOR_WARNING if level == 'medium' else COLOR_PRIMARY)
                marker_points.append({'x': idx, 'y': val})
            if marker_points:
                datasets.append({
                    'label': '异常点', 'type': 'scatter', 'data': marker_points,
                    'backgroundColor': '#ffffff', 'borderColor': COLOR_ERROR,
                    'borderWidth': 2, 'pointStyle': 'rectRot', 'pointRadius': 7,
                })
            trend_card, tcfg = self._chart_card(
                'metric_trend', '核心指标趋势', 'line', labels or [], datasets,
                {'scales': {'y': {'beginAtZero': True, 'grid': {'color': '#f5f5f5'}}},
                 'plugins': {'legend': {'position': 'bottom'}}})
            charts.append(tcfg)

        # ---- 量价散点图 ----
        scatter_card, scatter_cfg = self._divergence_chart(metrics)
        if scatter_cfg:
            charts.append(scatter_cfg)

        html_parts = [
            metric_grid,
            '<div class="grid">%s</div>' % trend_card,
            '<div class="grid">%s</div>' % scatter_card,
        ]
        if include_anomalies:
            html_parts.append('<div class="grid">%s</div>' % self._alert_section(
                anomalies, title='异常明细', empty_text='当前无异常'))
        return ''.join(html_parts), charts

    # ------------------------------------------------------------------
    # 联动洞察（综合看板专用：情感 x 指标交叉引用）
    # ------------------------------------------------------------------
    def _insight_item(self, color, text):
        """联动洞察单条条目（彩色小卡片）。"""
        return ('<div class="alert-item" style="border-left-color:%s;background:%s22;color:%s;">'
                '<div class="alert-desc">%s</div></div>'
                % (color, color, color, self._esc(text)))

    def _build_insights(self, uv, cm):
        """基于情感数据与指标数据生成联动洞察。"""
        items = []
        senti = self._safe_get(uv, 'sentiment', {})
        pos = self._safe_int(self._safe_get(senti, 'positive'), 0)
        neu = self._safe_int(self._safe_get(senti, 'neutral'), 0)
        neg = self._safe_int(self._safe_get(senti, 'negative'), 0)
        total = pos + neu + neg
        if total > 0:
            neg_ratio = neg * 100.0 / total
            if neg_ratio >= 10:
                items.append(self._insight_item(
                    COLOR_ERROR,
                    '负面情感占比 %.1f%%（%d/%d），超过 10%% 阈值，建议优先跟进处理。'
                    % (neg_ratio, neg, total)))
            else:
                items.append(self._insight_item(
                    COLOR_SUCCESS,
                    '负面情感占比 %.1f%%（%d/%d），处于正常范围。'
                    % (neg_ratio, neg, total)))

        metrics = self._safe_get(cm, 'metrics', {})
        dau = self._safe_get(metrics, 'dau', {})
        dau_chg = self._safe_float(self._safe_get(dau, 'change'), None)
        if dau_chg is not None:
            if dau_chg < 0:
                hint = ('，且负面情感偏高'
                        if total > 0 and neg * 100.0 / total >= 10 else '')
                color = COLOR_ERROR if hint else COLOR_WARNING
                items.append(self._insight_item(
                    color, 'DAU 环比下滑 %.2f%%%s，建议结合用户之声定位原因。'
                    % (abs(dau_chg), hint)))
            else:
                items.append(self._insight_item(
                    COLOR_SUCCESS, 'DAU 环比上涨 %.2f%%，运营状态良好。' % dau_chg))

        cap = self._safe_get(metrics, 'upload_capacity', {})
        cap_chg = self._safe_float(self._safe_get(cap, 'change'), None)
        if cap_chg is not None:
            sign = '+' if cap_chg > 0 else ('-' if cap_chg < 0 else '±')
            items.append(self._insight_item(
                COLOR_PRIMARY,
                '上传容量环比 %s%.2f%%，可对比上传用户数判断量价是否同步。'
                % (sign, abs(cap_chg))))

        if not items:
            return self._empty_state('暂无足够的联动数据，无法生成洞察')
        return '<div class="alert-list">%s</div>' % ''.join(items)

    def _cross_summary(self, uv, cm):
        """交叉摘要条：反馈量 / 情感健康度 / DAU / 异常数。"""
        today = self._safe_int(self._safe_get(uv, 'today_count'), None)
        senti = self._safe_get(uv, 'sentiment', {})
        pos = self._safe_int(self._safe_get(senti, 'positive'), 0)
        neu = self._safe_int(self._safe_get(senti, 'neutral'), 0)
        neg = self._safe_int(self._safe_get(senti, 'negative'), 0)
        total = pos + neu + neg
        health = '--' if total == 0 else ('%.1f%%' % ((pos + neu) * 100.0 / total))
        dau = self._safe_get(self._safe_get(cm, 'metrics', {}), 'dau', {})
        dau_cur = self._safe_get(dau, 'current')
        anomalies = self._safe_get(cm, 'anomalies', [])
        anom_n = len(anomalies) if isinstance(anomalies, list) else 0

        cells = [
            ('今日反馈', '--' if today is None else ('%d' % today)),
            ('情感健康度', health),
            ('DAU', self._fmt_number(dau_cur)),
            ('指标异常', '%d' % anom_n),
        ]
        parts = ['<div class="summary-row">']
        for label, value in cells:
            parts.append(
                '<div class="summary-item"><div class="summary-value">%s</div>'
                '<div class="summary-label">%s</div></div>' % (value, label))
        parts.append('</div>')
        return ''.join(parts)

    # ------------------------------------------------------------------
    # 三大看板模板
    # ------------------------------------------------------------------
    def _user_voice_template(self, data):
        """用户之声看板。"""
        data = data if isinstance(data, dict) else {}
        body, charts = self._user_voice_section(data, include_alerts=True)
        return (self._page_start('用户之声看板', '舆情与用户反馈分析')
                + body + self._page_end(charts))

    def _core_metrics_template(self, data):
        """核心指标看板。"""
        data = data if isinstance(data, dict) else {}
        body, charts = self._core_metrics_section(data, include_anomalies=True)
        return (self._page_start('核心指标看板', '核心业务指标监控')
                + body + self._page_end(charts))

    # ------------------------------------------------------------------
    # 综合看板（schema 驱动：按数据里实际存在的区块渲染）
    # ------------------------------------------------------------------
    @staticmethod
    def _cs_is_number(value):
        """是否为可参与图表/数值展示的数字（bool 不算）。"""
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    @staticmethod
    def _cs_is_rate_key(key):
        """字段名是否表示「率」：只看后缀，不看任何业务词。"""
        k = str(key).lower()
        return any(k.endswith(suffix) for suffix in CS_RATE_SUFFIXES)

    @classmethod
    def _cs_format_value(cls, key, value):
        """字段值格式化：None/空 -> 「暂无数据」，率类字段补 %，数值走 _fmt_number。"""
        if value is None or value == '':
            return EMPTY_TEXT
        if cls._cs_is_number(value):
            text = cls._fmt_number(value)
            return text + '%' if cls._cs_is_rate_key(key) else text
        return str(value)

    @staticmethod
    def _cs_label(container, key):
        """字段名 -> 展示名：优先数据里的 field_labels，否则回落字段名。"""
        labels = DashboardGenerator._safe_get(container, 'field_labels', None)
        if isinstance(labels, dict) and labels.get(key) not in (None, ''):
            return str(labels[key])
        return str(key)

    @classmethod
    def _cs_kpi_label(cls, container, key):
        """KPI 标签：field_labels -> 口径文字 '=' 左侧 -> 字段名
        （三级回退都取自数据，模板代码里不写死业务词）。"""
        labels = DashboardGenerator._safe_get(container, 'field_labels', None)
        if isinstance(labels, dict) and labels.get(key) not in (None, ''):
            return str(labels[key])
        definition = DashboardGenerator._safe_get(container, 'definition', None)
        text = definition.get(key) if isinstance(definition, dict) else None
        if isinstance(text, str) and '=' in text:
            left = text.split('=', 1)[0].strip()
            if left:
                return left
        return str(key)

    def _cs_dict_list(self, container, key):
        """取出 dict 列表字段并过滤杂质，省得上层到处写 isinstance 判断。"""
        value = self._safe_get(container, key, [])
        return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []

    def _cs_section(self, index, title, note=''):
        """区块标题：编号 + 标题 + 右侧数据说明。"""
        note_html = ('<span class="cs-note">%s</span>' % self._esc(note)) if note else ''
        return ('<div class="cs-section"><span class="cs-idx">%s</span>'
                '<span class="cs-title">%s</span>%s</div>'
                % (index, self._esc(title), note_html))

    def _cs_empty_card(self, title, text=EMPTY_TEXT, note=''):
        """缺块占位：显式渲染「暂无数据」，不留空白 div。"""
        body = self._empty_state(text)
        if note:
            body += '<div class="cs-empty-note">%s</div>' % self._esc(note)
        return '<div class="grid">%s</div>' % self._card(title, body)

    def _cs_kpi_card(self, label, value, note=''):
        """关键指标卡：value 为空或已是占位文案时按空态样式渲染。"""
        if value in (None, EMPTY_TEXT):
            value_html = '<div class="cs-kpi-value is-empty">%s</div>' % self._esc(EMPTY_TEXT)
        else:
            value_html = '<div class="cs-kpi-value">%s</div>' % self._esc(value)
        note_html = ('<div class="cs-kpi-note">%s</div>' % self._esc(note)) if note else ''
        return ('<div class="cs-kpi"><div class="cs-kpi-label">%s</div>%s%s</div>'
                % (self._esc(label), value_html, note_html))

    def _cs_table(self, container, records, cap=30, note=''):
        """通用明细表：表头取自首条记录的字段，展示名走 _cs_label。"""
        rows = [r for r in records if isinstance(r, dict)]
        if not rows:
            return ''
        headers = list(rows[0].keys())
        head_html = ''.join('<th>%s</th>' % self._esc(self._cs_label(container, k))
                            for k in headers)
        body = []
        for record in rows[:cap]:
            cells = []
            for key in headers:
                value = record.get(key)
                if isinstance(value, (dict, list)):
                    value = '' if not value else json.dumps(value, ensure_ascii=False)
                cells.append('<td>%s</td>' % self._esc(self._cs_format_value(key, value)))
            body.append('<tr>%s</tr>' % ''.join(cells))
        tail = ''
        if len(rows) > cap:
            tail = ('<div class="cs-empty-note">仅展示前 %d 行，共 %d 行。</div>'
                    % (cap, len(rows)))
        note_html = ('<div class="cs-empty-note">%s</div>' % self._esc(note)) if note else ''
        return ('<div class="cs-table-wrap"><table class="cs-table"><thead><tr>%s</tr></thead>'
                '<tbody>%s</tbody></table></div>%s%s'
                % (head_html, ''.join(body), note_html, tail))

    def _cs_sentiment_values(self, sentiment):
        """情感分布 -> (labels, values)：兼容 {字段: 数值} 与 [{name, count}] 两种形态。"""
        labels, values = [], []
        if isinstance(sentiment, dict):
            for key, value in sentiment.items():
                if self._cs_is_number(value):
                    labels.append(self._cs_label(sentiment, key))
                    values.append(value)
        elif isinstance(sentiment, list):
            for item in sentiment:
                if not isinstance(item, dict):
                    continue
                name = item.get('name') or item.get('label') or item.get('sentiment')
                count = item.get('count') if self._cs_is_number(item.get('count')) \
                    else item.get('value')
                if name not in (None, '') and self._cs_is_number(count):
                    labels.append(str(name))
                    values.append(count)
        return labels, values

    # ---- ① 顶部摘要 ----
    def _cs_overview(self, meta, metrics):
        """① 顶部摘要：meta 附加信息 + overall 关键指标卡 + 未提供指标说明。"""
        parts = [self._cs_section(1, '概览')]

        meta_bits = []
        for key, label in CS_META_LABELS:
            value = self._safe_get(meta, key)
            if value not in (None, ''):
                meta_bits.append('%s：%s' % (label, self._esc(value)))
        if meta_bits:
            parts.append('<div class="cs-meta-line">%s</div>' % ' · '.join(meta_bits))

        overall = self._safe_get(metrics, 'overall', {})
        overall = overall if isinstance(overall, dict) else {}
        definition = self._safe_get(metrics, 'definition', {})
        definition = definition if isinstance(definition, dict) else {}
        cards = []
        for key, value in overall.items():
            note = definition.get(key) if isinstance(definition.get(key), str) else ''
            cards.append(self._cs_kpi_card(self._cs_kpi_label(metrics, key),
                                           self._cs_format_value(key, value), note))
        if not cards:
            cards.append(self._cs_kpi_card('关键指标', None, '未在 metrics.overall 提供任何指标'))
        parts.append('<div class="cs-kpi-grid">%s</div>' % ''.join(cards))

        # metrics.unavailable：不为不存在的指标画空图，只按 note 呈现「本区域不展示」
        unavailable = self._safe_get(metrics, 'unavailable', {})
        if isinstance(unavailable, dict) and unavailable:
            note = unavailable.get('note') or ''
            missing = [k for k, v in unavailable.items() if k != 'note' and v in (None, '')]
            if missing:
                parts.append('<div class="cs-empty-note">本区域不展示：%s%s</div>'
                             % (' / '.join(self._esc(k) for k in missing),
                                ('（%s）' % self._esc(note)) if note else ''))
            elif note:
                parts.append('<div class="cs-empty-note">%s</div>' % self._esc(note))
        return ''.join(parts)

    # ---- ② 指标 ----
    def _cs_metrics_block(self, metrics):
        """② 指标：周期序列三图 + 口径/限制文字。返回 (html, charts, rendered, reason)。"""
        charts = []
        if not isinstance(metrics, dict) or not metrics:
            return (self._cs_section(2, '指标') + self._cs_empty_card('指标图表'),
                    charts, False, '缺失')

        weeks = self._cs_dict_list(metrics, 'weeks')
        overall = self._safe_get(metrics, 'overall', {})
        overall = overall if isinstance(overall, dict) else {}
        definition = self._safe_get(metrics, 'definition', {})
        definition = definition if isinstance(definition, dict) else {}
        limitations = self._safe_get(metrics, 'limitations', [])
        limitations = [x for x in limitations if x not in (None, '')] \
            if isinstance(limitations, list) else []

        parts = [self._cs_section(2, '指标', ('%d 个周期' % len(weeks)) if weeks else '')]
        if not weeks:
            parts.append(self._cs_empty_card('指标图表', note='metrics 缺少可用的 weeks 序列'))
        else:
            labels = [w.get('label') or (i + 1) for i, w in enumerate(weeks)]
            first = weeks[0]
            series_keys = [k for k, v in first.items()
                           if self._cs_is_number(v) and not self._cs_is_rate_key(k)][:6]
            rate_key = next((k for k, v in first.items()
                             if self._cs_is_number(v) and self._cs_is_rate_key(k)), None)
            volume_key = 'effective' if self._cs_is_number(first.get('effective')) else \
                (series_keys[0] if series_keys else None)

            cards = []
            if series_keys:
                datasets = [{'label': self._cs_label(metrics, key),
                             'data': [w.get(key) for w in weeks],
                             'backgroundColor': CS_PALETTE[i % len(CS_PALETTE)],
                             'borderRadius': 4}
                            for i, key in enumerate(series_keys)]
                card, cfg = self._chart_card(
                    'cs_weekly_series', '周期序列构成', 'bar', labels, datasets,
                    {'plugins': {'legend': {'position': 'bottom'}},
                     'scales': {'x': {'grid': {'display': False}},
                                'y': {'beginAtZero': True, 'grid': {'color': '#f5f5f5'}}}})
                cards.append(card)
                charts.append(cfg)
            else:
                cards.append(self._card('周期序列构成', self._empty_state()))

            rate_label = self._cs_label(metrics, rate_key) if rate_key else ''
            if rate_key:
                datasets = [{'label': rate_label,
                             'data': [w.get(rate_key) for w in weeks],
                             'borderColor': COLOR_ERROR, 'backgroundColor': COLOR_ERROR,
                             'tension': 0.25, 'borderWidth': 2, 'pointRadius': 5, 'fill': False}]
                baseline = overall.get(rate_key)
                if self._cs_is_number(baseline):
                    datasets.append({'label': '%s · 总体基线' % rate_label,
                                     'data': [baseline for _ in weeks],
                                     'borderColor': COLOR_PRIMARY,
                                     'backgroundColor': COLOR_PRIMARY,
                                     'borderDash': [6, 4], 'borderWidth': 2,
                                     'pointRadius': 0, 'fill': False})
                card, cfg = self._chart_card(
                    'cs_rate_trend', '%s 趋势' % rate_label, 'line', labels, datasets,
                    {'plugins': {'legend': {'position': 'bottom'}},
                     'scales': {'x': {'grid': {'display': False}},
                                'y': {'beginAtZero': True, 'grid': {'color': '#f5f5f5'},
                                      'ticks': {'callback': RawJS(
                                          "function (v) { return v + ' %'; }")}}}})
                cards.append(card)
                charts.append(cfg)
            else:
                cards.append(self._card('速率趋势', self._empty_state()))

            if rate_key and volume_key:
                points = [{'x': w.get(volume_key), 'y': w.get(rate_key)} for w in weeks
                          if self._cs_is_number(w.get(volume_key))
                          and self._cs_is_number(w.get(rate_key))]
                volume_label = self._cs_label(metrics, volume_key)
                if points:
                    card, cfg = self._chart_card(
                        'cs_volume_rate', '%s × %s 关系' % (volume_label, rate_label),
                        'scatter', [],
                        [{'label': '%s × %s' % (volume_label, rate_label), 'data': points,
                          'backgroundColor': '#722ed1', 'pointRadius': 7, 'pointHoverRadius': 10}],
                        {'plugins': {'legend': {'display': False}},
                         'scales': {'x': {'beginAtZero': True,
                                          'title': {'display': True, 'text': volume_label},
                                          'grid': {'color': '#f5f5f5'}},
                                    'y': {'beginAtZero': True,
                                          'title': {'display': True, 'text': rate_label},
                                          'grid': {'color': '#f5f5f5'},
                                          'ticks': {'callback': RawJS(
                                              "function (v) { return v + ' %'; }")}}}})
                    cards.append(card)
                    charts.append(cfg)
            parts.append('<div class="grid">%s</div>' % ''.join(cards))
            parts.append(self._cs_table(metrics, weeks,
                                        note='逐条列出原始序列；数据未提供的总体值不自行求和补填。'))

        # 口径与限制：即使没有 weeks 序列，只要数据给了文字也应呈现
        text_cards = []
        if definition:
            rows = ''.join('<dt>%s</dt><dd>%s</dd>' % (self._esc(k), self._esc(v))
                           for k, v in definition.items())
            text_cards.append(self._card('口径说明', '<dl class="cs-def-list">%s</dl>' % rows))
        if limitations:
            rows = ''.join('<li>%s</li>' % self._esc(x) for x in limitations)
            text_cards.append(self._card('已知限制', '<ul class="cs-def-list">%s</ul>' % rows))
        if text_cards:
            parts.append('<div class="grid">%s</div>' % ''.join(text_cards))
        return ''.join(parts), charts, True, ''

    # ---- ③ 反馈 ----
    def _cs_feedback_block(self, feedback):
        """③ 反馈：分类/主题/样本量三图 + 明细表 + 需求线索。"""
        charts = []
        if not isinstance(feedback, dict) or not feedback:
            return (self._cs_section(3, '反馈') + self._cs_empty_card('反馈图表'),
                    charts, False, '缺失')

        cats = self._cs_dict_list(feedback, 'category_distribution')
        themes = self._cs_dict_list(feedback, 'theme_distribution')
        items = self._cs_dict_list(feedback, 'items')
        leads = self._cs_dict_list(feedback, 'requirement_leads')
        limitation = self._safe_get(feedback, 'sample_limitation', {})
        limitation = limitation if isinstance(limitation, dict) else {}

        note_bits = []
        channel = self._safe_get(feedback, 'channel')
        total = self._safe_get(feedback, 'total')
        if channel not in (None, ''):
            note_bits.append('渠道：%s' % channel)
        if total not in (None, ''):
            note_bits.append('总数：%s' % self._cs_format_value('total', total))
        parts = [self._cs_section(3, '反馈', ' · '.join(note_bits))]

        cards = []
        cat_labels = [str(c.get('name') or c.get('label') or (i + 1))
                      for i, c in enumerate(cats)]
        cat_values = [c.get('count') for c in cats]
        if cat_labels and any(self._cs_is_number(v) for v in cat_values):
            card, cfg = self._chart_card(
                'cs_feedback_category', '分类分布', 'doughnut', cat_labels,
                [{'data': cat_values,
                  'backgroundColor': [CS_PALETTE[i % len(CS_PALETTE)] for i in range(len(cats))],
                  'borderWidth': 2, 'borderColor': COLOR_CARD_BG}],
                {'cutout': '55%',
                 'plugins': {
                     'legend': {'position': 'bottom'},
                     'tooltip': {'callbacks': {'label': RawJS(
                         "function (ctx) { var d = ctx.dataset.data || [];"
                         " var t = d.reduce(function (a, b) { return a + (b || 0); }, 0);"
                         " var v = ctx.parsed || 0;"
                         " return ctx.label + '：' + v + '（'"
                         " + (t ? (v * 100 / t).toFixed(1) : '0.0') + '%）'; }")}}}})
            cards.append(card)
            charts.append(cfg)
        else:
            cards.append(self._card('分类分布', self._empty_state()))

        theme_labels = [str(t.get('name') or t.get('label') or (i + 1))
                        for i, t in enumerate(themes)]
        theme_values = [t.get('count') for t in themes]
        if theme_labels and any(self._cs_is_number(v) for v in theme_values):
            card, cfg = self._chart_card(
                'cs_feedback_theme', '主题分布', 'bar', theme_labels,
                [{'label': '数量', 'data': theme_values,
                  'backgroundColor': '#13c2c2', 'borderRadius': 5, 'barThickness': 20}],
                {'indexAxis': 'y',
                 'plugins': {'legend': {'display': False}},
                 'scales': {'x': {'beginAtZero': True, 'ticks': {'precision': 0},
                                  'grid': {'color': '#f5f5f5'}},
                            'y': {'grid': {'display': False}}}})
            cards.append(card)
            charts.append(cfg)
        else:
            cards.append(self._card('主题分布', self._empty_state()))

        size_values = [limitation.get('count'), limitation.get('threshold')]
        if any(self._cs_is_number(v) for v in size_values):
            size_labels = [limitation.get('label') or '实测值',
                           limitation.get('threshold_label') or '参考阈值']
            extra = ('<div class="cs-empty-note">%s</div>' % self._esc(limitation.get('text'))) \
                if limitation.get('text') else ''
            card, cfg = self._chart_card(
                'cs_feedback_sample', '样本量对照', 'bar', size_labels,
                [{'label': '数量', 'data': size_values,
                  'backgroundColor': [COLOR_WARNING, COLOR_PRIMARY],
                  'borderRadius': 5, 'barThickness': 26}],
                {'indexAxis': 'y',
                 'plugins': {'legend': {'display': False}},
                 'scales': {'x': {'beginAtZero': True, 'ticks': {'precision': 0}},
                            'y': {'grid': {'display': False}}}},
                extra=extra)
            cards.append(card)
            charts.append(cfg)
        parts.append('<div class="grid">%s</div>' % ''.join(cards))

        if items:
            parts.append('<div class="grid"><div class="card">'
                         '<div class="card-title">反馈明细</div>%s</div></div>'
                         % self._cs_table(feedback, items))
        if leads:
            lead_html = ''.join(
                '<div class="cs-lead"><span class="cs-rid">%s</span><span>%s</span></div>'
                % (self._esc(l.get('id')), self._esc(l.get('text'))) for l in leads)
            parts.append('<div class="grid"><div class="card">'
                         '<div class="card-title">需求线索</div>'
                         '<div class="cs-lead-list">%s</div></div></div>' % lead_html)
        return ''.join(parts), charts, True, ''

    # ---- ④ 舆情 ----
    def _cs_sentiment_block(self, market_sentiment):
        """④ 舆情：available 开关说了算；false 时整块只渲染空数据说明，不画空图。"""
        charts = []
        if not isinstance(market_sentiment, dict) or not market_sentiment:
            return (self._cs_section(4, '舆情') + self._cs_empty_card('舆情图表'),
                    charts, False, '缺失')

        source_name = self._safe_get(market_sentiment, 'source_name') or ''
        title = source_name or '舆情'
        parts = [self._cs_section(4, '舆情', source_name)]

        if not market_sentiment.get('available'):
            empty_text = self._safe_get(market_sentiment, 'empty_text') or EMPTY_TEXT
            note = self._safe_get(market_sentiment, 'note') or ''
            body = ('<div class="cs-empty-box">%s%s</div>'
                    % (self._empty_state(empty_text),
                       ('<div class="cs-empty-note">%s</div>' % self._esc(note)) if note else ''))
            parts.append('<div class="grid"><div class="card">'
                         '<div class="card-title">%s</div>%s</div></div>'
                         % (self._esc(title), body))
            return ''.join(parts), charts, False, 'available=false'

        cards = []
        senti_labels, senti_values = self._cs_sentiment_values(
            self._safe_get(market_sentiment, 'sentiment'))
        if senti_labels:
            card, cfg = self._chart_card(
                'cs_sentiment', '情感分布', 'doughnut', senti_labels,
                [{'data': senti_values,
                  'backgroundColor': [CS_PALETTE[i % len(CS_PALETTE)]
                                      for i in range(len(senti_labels))],
                  'borderWidth': 2, 'borderColor': COLOR_CARD_BG}],
                {'cutout': '55%', 'plugins': {'legend': {'position': 'bottom'}}})
            cards.append(card)
            charts.append(cfg)

        problems = self._cs_dict_list(market_sentiment, 'top_problems') \
            or self._cs_dict_list(market_sentiment, 'pain_points')
        if problems:
            p_labels = [str(p.get('name') or p.get('category') or (i + 1))
                        for i, p in enumerate(problems)]
            card, cfg = self._chart_card(
                'cs_sentiment_problems', 'TOP 问题分布', 'bar', p_labels,
                [{'label': '数量', 'data': [p.get('count') for p in problems],
                  'backgroundColor': COLOR_PRIMARY, 'borderRadius': 6, 'barThickness': 22}],
                {'indexAxis': 'y',
                 'plugins': {'legend': {'display': False}},
                 'scales': {'x': {'beginAtZero': True, 'grid': {'display': False}},
                            'y': {'grid': {'display': False}}}})
            cards.append(card)
            charts.append(cfg)

        keywords = self._cs_dict_list(market_sentiment, 'keywords')
        if keywords:
            cards.append(self._card('关键词云', self._keyword_cloud(keywords)))

        if not cards:
            parts.append(self._cs_empty_card(
                title, note=self._safe_get(market_sentiment, 'note') or ''))
            return ''.join(parts), charts, False, 'available=true 但无可渲染字段'
        parts.append('<div class="grid">%s</div>' % ''.join(cards))
        return ''.join(parts), charts, True, ''

    # ---- ⑤ 预警 ----
    def _cs_alerts_block(self, alerts):
        """⑤ 预警：分级徽标 + 触发规则/证据/状态清单。"""
        charts = []
        if not isinstance(alerts, dict) or not alerts:
            return (self._cs_section(5, '预警') + self._cs_empty_card('预警清单'),
                    charts, False, '缺失')

        items = self._cs_dict_list(alerts, 'items')
        counts = self._safe_get(alerts, 'badge_counts', {})
        counts = counts if isinstance(counts, dict) else {}
        n_high = self._safe_int(counts.get('high'), 0)
        n_medium = self._safe_int(counts.get('medium'), 0)
        n_low = self._safe_int(counts.get('low'), 0)
        if not counts:
            # 计数缺失时按实际条目回算，避免徽标与清单不一致
            for item in items:
                level = str(item.get('level') or '').strip().lower()
                if level == 'high':
                    n_high += 1
                elif level == 'medium':
                    n_medium += 1
                else:
                    n_low += 1

        badges = []
        if n_high:
            badges.append('<span class="cs-badge high">🔴 严重 %d</span>' % n_high)
        if n_medium:
            badges.append('<span class="cs-badge medium">🟡 警告 %d</span>' % n_medium)
        if n_low:
            badges.append('<span class="cs-badge low">💡 关注 %d</span>' % n_low)
        if not badges:
            badges.append('<span class="cs-badge ok">✔ 无预警</span>')

        parts = [self._cs_section(5, '预警', '%d 严重 / %d 警告 / %d 关注'
                                  % (n_high, n_medium, n_low)),
                 '<div class="cs-badge-row">%s</div>' % ''.join(badges)]
        if not items:
            parts.append(self._cs_empty_card('预警清单'))
            return ''.join(parts), charts, True, ''

        blocks = []
        level_icon = {'high': '🔴', 'medium': '🟡', 'low': '💡'}
        for item in items:
            raw_level = item.get('level')
            level = str(raw_level).strip().lower() if raw_level is not None else ''
            level_missing = level not in level_icon
            if level_missing:
                # 级别缺失/非法时按最低级呈现并显式标注，不默认抬成「警告」
                level = 'low'
            icon = item.get('icon') or level_icon[level]
            title = item.get('title') or ''
            if level_missing:
                title = '【级别未标注，按最低级呈现】' + title
            rows = ''.join(
                '<div class="row"><span class="k">%s</span><span class="v">%s</span></div>'
                % (label, self._esc(item.get(key) or ''))
                for key, label in (('rule', '触发规则'), ('evidence', '证据')))
            status = item.get('status') or '待人工确认'
            blocks.append(
                '<div class="alert-item %s"><div class="cs-alert-head">'
                '<span>%s</span><span>%s</span></div><div class="cs-alert-body">%s'
                '<div class="row"><span class="k">处置状态</span>'
                '<span class="v"><span class="cs-alert-status">%s</span></span></div>'
                '</div></div>' % (level, self._esc(icon), self._esc(title), rows,
                                  self._esc(status)))
        parts.append('<div class="grid"><div class="card">'
                     '<div class="card-title">预警清单</div>'
                     '<div class="alert-list">%s</div></div></div>' % ''.join(blocks))
        return ''.join(parts), charts, True, ''

    # ---- ⑥ 来源与声明 ----
    def _cs_sources_block(self, sources, disclaimer):
        """⑥ 来源与声明：两者都缺时整块不渲染。"""
        if not sources and not disclaimer:
            return '', [], False, '缺失'
        parts = [self._cs_section(6, '来源与声明')]
        inner = []
        if sources:
            blocks = ''.join(
                '<div class="cs-src-item"><div class="cs-src-name">%s</div>'
                '<div class="cs-src-path">%s</div><div class="cs-src-note">%s</div></div>'
                % (self._esc(s.get('name')), self._esc(s.get('path')),
                   self._esc(s.get('note')))
                for s in sources)
            inner.append('<div class="cs-src-list">%s</div>' % blocks)
        if disclaimer:
            inner.append('<ul class="cs-disclaimer">%s</ul>'
                         % ''.join('<li>%s</li>' % self._esc(x) for x in disclaimer))
        parts.append('<div class="grid"><div class="card">'
                     '<div class="card-title">来源文件与免责声明</div>%s</div></div>'
                     % ''.join(inner))
        return ''.join(parts), [], True, ''

    def _comprehensive_template(self, data):
        """综合看板：schema 驱动，按数据里实际存在的区块渲染，缺块显式「暂无数据」。

        不再委托 _user_voice_section / _core_metrics_section —— 它们面向另一套输入
        schema，正是此前喂真实数据只出空看板的根因。渲染完把区块统计写入
        self.comprehensive_summary，供 main() 打印 schema 反馈。"""
        data = data if isinstance(data, dict) else {}
        meta = self._safe_get(data, 'meta', {})
        meta = meta if isinstance(meta, dict) else {}
        metrics = self._safe_get(data, 'metrics', {})
        feedback = self._safe_get(data, 'feedback', {})
        market_sentiment = self._safe_get(data, 'market_sentiment', {})
        alerts = self._safe_get(data, 'alerts', {})
        sources = self._cs_dict_list(data, 'sources')
        disclaimer = self._safe_get(data, 'disclaimer', [])
        disclaimer = [x for x in disclaimer if x not in (None, '')] \
            if isinstance(disclaimer, list) else []

        title = self._safe_get(meta, 'title') or '综合分析看板'
        subtitle = self._safe_get(meta, 'subtitle') or ''

        charts = []
        rendered, skipped = [], []
        parts = [self._cs_overview(meta, metrics)]
        for name, builder, args in (
                ('指标', self._cs_metrics_block, (metrics,)),
                ('反馈', self._cs_feedback_block, (feedback,)),
                ('舆情', self._cs_sentiment_block, (market_sentiment,)),
                ('预警', self._cs_alerts_block, (alerts,)),
                ('来源', self._cs_sources_block, (sources, disclaimer))):
            block_html, block_charts, ok, reason = builder(*args)
            parts.append(block_html)
            charts.extend(block_charts)
            if ok:
                rendered.append(name)
            else:
                skipped.append((name, reason))

        self.comprehensive_summary = {
            'rendered': rendered,
            'skipped': skipped,
            'charts': charts,
        }
        return (self._page_start(title, subtitle,
                                 extra_css=self._build_comprehensive_css())
                + ''.join(parts)
                + self._page_end(charts, raw_js=True))


def main():
    parser = argparse.ArgumentParser(
        description='生成数据可视化 HTML 看板（Chart.js 真实图表，无占位符）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            '示例：\n'
            '  python generate_dashboard.py --type user_voice --input data.json --output dashboard.html\n'
            '  python generate_dashboard.py --type core_metrics --input metrics.json --output metrics.html\n'
            '  python generate_dashboard.py --type comprehensive --input all.json --output all.html\n'
        ),
    )
    parser.add_argument('--type', required=True,
                        choices=['user_voice', 'core_metrics', 'comprehensive'],
                        help='看板类型：user_voice / core_metrics / comprehensive')
    parser.add_argument('--input', required=True, help='输入 JSON 文件路径')
    parser.add_argument('--output', required=True, help='输出 HTML 文件路径')
    args = parser.parse_args()

    try:
        generator = DashboardGenerator()
        output = generator.generate(args.type, args.input, args.output)
        print('[OK] 看板已生成：%s' % output)
        # 综合看板：把 schema 适配情况打到 stdout，调用方喂错数据能立刻看出来
        summary = generator.comprehensive_summary
        if args.type == 'comprehensive' and summary:
            rendered = summary['rendered']
            skipped = summary['skipped']
            print('[INFO] 已渲染区块：%s （%d 个）'
                  % (' / '.join(rendered) if rendered else '无', len(rendered)))
            print('[INFO] 跳过区块：%s （%d 个）'
                  % ('、'.join('%s（%s）' % (name, reason) for name, reason in skipped)
                     if skipped else '无', len(skipped)))
            print('[INFO] 图表数：%d' % len(summary['charts']))
            if not summary['charts']:
                # 一张图都画不出来，说明输入 schema 与综合看板不匹配，不能静静产出空壳
                print('[ERROR] 输入 schema 与综合看板不匹配：未渲染任何区块。'
                      '期望顶层包含 metrics / feedback / market_sentiment / alerts。',
                      file=sys.stderr)
                sys.exit(5)
    except FileNotFoundError as exc:
        print('[错误] 输入文件不存在：%s' % exc, file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print('[错误] JSON 解析失败：%s' % exc, file=sys.stderr)
        sys.exit(2)
    except ValueError as exc:
        print('[错误] 数据格式不正确：%s' % exc, file=sys.stderr)
        sys.exit(3)
    except Exception as exc:  # 兜底，避免堆栈直接抛给用户
        print('[错误] 生成失败：%s' % exc, file=sys.stderr)
        sys.exit(4)


if __name__ == '__main__':
    main()
