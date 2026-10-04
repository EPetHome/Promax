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
from datetime import datetime

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

# 核心指标展示配置（顺序、中文名、单位）
METRIC_META = [
    ('dau', 'DAU（日活跃）', '人'),
    ('mau', 'MAU（月活跃）', '人'),
    ('upload_users', '上传用户数', '人'),
    ('download_users', '下载用户数', '人'),
    ('upload_capacity', '上传容量', 'GB'),
    ('download_capacity', '下载容量', 'GB'),
]


class DashboardGenerator(object):
    """看板生成器：将 JSON 数据渲染为自包含的 HTML 看板页面。"""

    def __init__(self):
        self.base_css = self._build_base_css()
        self.chart_js_framework = self._build_chart_js_framework()

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
    def _page_start(self, title, subtitle=''):
        """页面头部 + 公共样式。"""
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
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
""" % (title_esc, self.base_css, title_esc,
       (subtitle_esc + ' · ' if subtitle_esc else ''), now)

    def _page_end(self, chart_configs):
        """页面结尾 + 图表配置注入 + Chart.js 初始化。"""
        return """
  <div class="footer">数据可视化看板 · 由 generate_dashboard.py 生成</div>
</div>
<script>window.__DASHBOARD_CHARTS__ = %s;</script>
%s
</body>
</html>
""" % (self._json_dumps(chart_configs), self.chart_js_framework)

    # ------------------------------------------------------------------
    # 基础组件
    # ------------------------------------------------------------------
    def _card(self, title, body_html):
        """通用卡片容器。"""
        return ('<div class="card"><div class="card-title">%s</div>%s</div>'
                % (self._esc(title), body_html))

    def _chart_card(self, card_id, title, chart_type, labels, datasets, options=None):
        """生成图表卡片：返回 (卡片HTML, 图表配置dict)。"""
        canvas_id = 'chart_%s' % card_id
        body = '<div class="chart-box"><canvas id="%s"></canvas></div>' % canvas_id
        config = {
            'id': canvas_id,
            'type': chart_type,
            'data': {'labels': labels, 'datasets': datasets},
            'options': options or {},
        }
        return self._card(title, body), config

    def _empty_state(self, text='暂无数据'):
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

    def _comprehensive_template(self, data):
        """综合看板：用户之声 + 核心指标 + 统一告警面板 + 联动洞察。
        注意：不委托给单个模板，而是真实的两区块合并布局。"""
        data = data if isinstance(data, dict) else {}
        # 兼容两种输入结构：嵌套 {user_voice:..., core_metrics:...} 或扁平混合结构
        uv = self._safe_get(data, 'user_voice', None)
        if not isinstance(uv, dict):
            uv = data
        cm = self._safe_get(data, 'core_metrics', None)
        if not isinstance(cm, dict):
            cm = data

        uv_body, uv_charts = self._user_voice_section(uv, include_alerts=False)
        cm_body, cm_charts = self._core_metrics_section(cm, include_anomalies=False)
        all_charts = uv_charts + cm_charts

        # 联动洞察（情感 x 指标 交叉引用）
        insights_card = self._card('联动洞察', self._build_insights(uv, cm))

        # 统一告警面板：合并用户之声告警 + 指标异常
        uv_alerts = self._safe_get(uv, 'alerts', [])
        cm_anomalies = self._safe_get(cm, 'anomalies', [])
        combined = (uv_alerts if isinstance(uv_alerts, list) else []) \
            + (cm_anomalies if isinstance(cm_anomalies, list) else [])
        alert_card = self._alert_section(combined, title='统一告警面板',
                                         empty_text='当前无告警与异常')

        return (
            self._page_start('综合运营看板', '用户之声 × 核心指标联动监控')
            + self._cross_summary(uv, cm)
            + '<div class="grid">%s%s</div>' % (insights_card, alert_card)
            + uv_body
            + cm_body
            + self._page_end(all_charts)
        )


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
