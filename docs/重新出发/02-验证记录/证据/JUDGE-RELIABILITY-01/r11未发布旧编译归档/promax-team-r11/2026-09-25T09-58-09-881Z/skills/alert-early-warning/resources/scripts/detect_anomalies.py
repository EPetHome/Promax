#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
detect_anomalies.py —— 智能异常检测与预警脚本

功能概览：
1. 舆情（sentiment）检测
   - 负向舆情爆发检测：窗口内负向占比 > 50%，且负向数量较前序窗口平均环比增长 >= 1.5 倍
   - 版本级问题检测：某版本负向率 > 30%（严重 > 50%）
   - 爆发关键词提取：内置中文切分 + 停用词过滤 + 词频统计，无需外部 NLP 库
2. 核心指标（metrics）检测
   - Z-score 离群点检测：|z| >= 2σ 预警，|z| >= 3σ 严重
   - 趋势恶化检测：后半期均值较前半期均值下滑 > 20%（严重 > 50%）
   - 逐指标独立检测
3. 综合（both）模式：同时检测舆情与指标（输入 JSON 同时含 reviews 与 metrics 字段）
4. 预警后处理
   - 冷却去重：同类预警在冷却期内不重复告警（状态可持久化到本地文件）
   - 预警合并：同一类型 + 级别预警合并为一条，附全部明细
   - 风险评估：为每条预警计算 0~100 风险分与高中低评级
   - 处置建议：基于预警类型给出可执行的动作建议

用法示例：
    python detect_anomalies.py --type sentiment --input reviews.json
    python detect_anomalies.py --type metrics --input metrics.json --threshold 2 --format json
    python detect_anomalies.py --type both --input all.json --output report.md --window 2

输入格式：
    sentiment: JSON 数组，元素为 {content, sentiment, version, timestamp 或 date}
    metrics  : JSON 对象，{指标名: [{date, value}, ...]}
    both     : JSON 对象，{"reviews": [...], "metrics": {...}}

纯 Python 标准库实现，无任何第三方依赖。
"""

import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# 常量定义
# ---------------------------------------------------------------------------

# 预警级别：emoji / 中文名 / 风险基础分
ALERT_LEVELS = {
    "critical": {"emoji": "🔴", "name": "严重", "weight": 40},
    "warning":  {"emoji": "🟡", "name": "警告", "weight": 25},
    "notice":   {"emoji": "💡", "name": "提示", "weight": 10},
}
LEVEL_ORDER = ["critical", "warning", "notice"]

# Z-score 分级阈值：2σ 预警 / 3σ 严重
ZSCORE_WARNING = 2.0
ZSCORE_CRITICAL = 3.0

# 负向舆情爆发判定参数
MIN_WINDOW_REVIEWS = 3        # 窗口内最小样本量，低于该值不做爆发判定
BURST_NEGATIVE_RATIO = 0.5    # 窗口内负向占比阈值（> 50%）
BURST_GROWTH_RATE = 1.5       # 负向数量较前序窗口平均值的环比增长阈值
BURST_FALLBACK_RATIO = 0.7    # 无历史窗口可对比时的兜底占比阈值
BURST_FALLBACK_MIN = 5        # 无历史窗口可对比时的最小样本量

# 版本级负向问题参数
VERSION_MIN_REVIEWS = 5       # 版本分析最小样本量
VERSION_NEGATIVE_RATE = 0.3   # 版本负向率阈值（> 30% 预警，> 50% 严重）

# 指标分析参数
MIN_METRIC_POINTS = 8         # Z-score / 趋势分析所需最小点数
TREND_DECLINE_RATIO = 0.2     # 后半期均值下滑阈值（> 20% 预警，> 50% 严重）

# 关键词提取：常见中文停用词
STOPWORDS = set("""
的 了 是 我 你 他 她 它 我们 你们 他们 这 那 就 都 而 及 与 着 或 一个 没有 不 也
在 有 很 到 说 要 去 会 可以 一下 什么 现在 还是 但是 因为 所以 如果 自己 这个 那个
怎么 这样 那样 被 把 让 对 能 得 从 和 等 啊 呢 吗 吧 嘛 哈 哦 嗯 上 下 里 外 中 又
再 每 些 们 于 之 其 各 种 为 即 只 则 却 并 并且 以及 或者 然后 而且 虽然 无论 由于
关于 对于 出来 起来 大家 真的 觉得 感觉 有点 比较 特别 非常 就是 给 做 用 打 开 关
找 看 听 想 知道 应该 需要 可能 一定 肯定 必须 东西 时候 已经 也 都 会 要 不要 别
the a an of to in and for on with at by from this that is are was were be been
""".split())

# 中文噪声字符：二元词组中含有这些字符时整组丢弃（去掉"的了是"等虚词粘连）
NOISE_CHARS = set("的了是在有和就都而及与着或我你他她它这那个不也于之其等吗呢吧啊让把被对从到要会能一直后前还又太再每些们好")

# 文本切分所用的标点 / 空白
PUNCT_RE = re.compile(r"[\s\-_+.,!?;:，。！？；：、（）()【】\[\]{}《》〈〉「」『』…—～·％%&*#@$^~`|=/\\<>]")
CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")

# 各预警类型对应的处置建议模板
RECOMMENDATIONS = {
    "sentiment_burst_negative": [
        "结合爆发窗口与高频关键词定位直接导火索（版本发布 / 活动 / 故障等）",
        "对受影响用户进行主动安抚与快速跟进",
        "优先处理高词频问题点，并评估问题影响面",
        "联动核心指标确认影响是否已传导至业务数据",
    ],
    "sentiment_version_issue": [
        "核对对应版本上线内容与变更点，定位引入问题的改动",
        "必要时暂停灰度 / 回滚相关版本",
        "整理负向反馈明细转交研发快速修复",
        "评估受影响用户规模并准备补偿预案",
    ],
    "metric_zscore": [
        "检查异常时间点的服务发布、配置变更与上下游依赖状态",
        "查看对应时段的日志与告警，确认根因",
        "若为持续异常，及时扩容或回滚相关变更",
    ],
    "metric_trend_decline": [
        "排查近期产品改动、渠道投放与竞品动态",
        "结合舆情反馈确认是否由体验问题导致",
        "制定指标修复方案并持续跟踪观察",
    ],
    "metrics_insufficient_data": [
        "检查埋点 / 上报链路是否正常",
        "补充数据采集配置，保证样本充足",
    ],
    "sentiment_no_data": [
        "检查评论数据源是否接入或拉取正常",
    ],
    "metrics_no_data": [
        "检查指标数据源是否接入或拉取正常",
    ],
}

# 级别通用处置基调
LEVEL_RECOMMENDATIONS = {
    "critical": "高优处理：立即组织排查，必要时启动应急预案",
    "warning":  "尽快处理：安排专人跟进并明确闭环时间",
    "notice":   "持续关注：纳入例行监控，观察后续走势",
}


# ---------------------------------------------------------------------------
# 自定义异常
# ---------------------------------------------------------------------------

class DataError(Exception):
    """输入数据相关的错误（格式不正确 / 字段缺失等）。"""


# ---------------------------------------------------------------------------
# 检测器主体
# ---------------------------------------------------------------------------

class AnomalyDetector:
    """
    异常检测器：负责数据加载、异常发现、预警后处理（冷却 / 合并 / 风险评估）与报告输出。
    """

    def __init__(self, alert_type="both", input_path=None, threshold=2.0,
                 window_hours=1, cooldown_hours=4, top_keywords=10,
                 output_format="markdown", state_path=None):
        self.alert_type = alert_type
        self.input_path = input_path
        self.threshold = threshold
        self.window_hours = max(1, int(window_hours))
        self.cooldown_hours = max(0, int(cooldown_hours))
        self.top_keywords = max(1, int(top_keywords))
        self.output_format = output_format
        self.state_path = state_path
        # 冷却记录：{cooldown_key: 最近一次告警时间}
        self._cooldown_log = {}
        self.suppressed_count = 0

    # ------------------------------------------------------------------
    # 数据加载与校验
    # ------------------------------------------------------------------

    def load_input(self):
        """读取输入 JSON 文件（强制 UTF-8）。"""
        with open(self.input_path, "r", encoding="utf-8") as fp:
            return json.load(fp)

    @staticmethod
    def _extract_reviews(data):
        """从输入中抽取评论数组，兼容「数组」与「含 reviews 字段的对象」两种结构。"""
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
        if isinstance(data, dict):
            if "reviews" in data:
                reviews = data["reviews"]
                if not isinstance(reviews, list):
                    raise DataError("'reviews' 字段必须是数组")
                return [r for r in reviews if isinstance(r, dict)]
            raise DataError("舆情数据格式错误：应为评论对象数组，或包含 'reviews' 字段的对象")
        raise DataError("舆情数据格式错误：期望 JSON 数组或对象")

    @staticmethod
    def _extract_metrics(data):
        """从输入中抽取指标字典 {指标名: 序列数组}。"""
        if isinstance(data, dict):
            if "metrics" in data:
                metrics = data["metrics"]
                if not isinstance(metrics, dict):
                    raise DataError("'metrics' 字段必须是对象结构")
                return metrics
            return data
        raise DataError("指标数据格式错误：应为 {指标名: 序列数组} 的对象结构")

    # ------------------------------------------------------------------
    # 时间解析与窗口聚合
    # ------------------------------------------------------------------

    @staticmethod
    def parse_datetime(value):
        """
        解析时间字段，支持：
        - unix 时间戳（秒 / 毫秒）
        - ISO / 常规字符串（如 2026-08-19、2026-08-19 14:00:00）
        解析失败时抛出 ValueError。
        """
        if value is None:
            raise ValueError("时间为空")
        if isinstance(value, bool):
            raise ValueError("布尔值不能作为时间")
        if isinstance(value, (int, float)):
            ts = float(value)
            if ts <= 0:
                raise ValueError("时间戳必须为正数")
            if ts > 1e12:  # 毫秒级时间戳转秒
                ts /= 1000.0
            return datetime.fromtimestamp(ts)
        s = str(value).strip().replace("Z", "").replace("z", "")
        # 常见时间格式，按优先级尝试
        formats = (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%d",
            "%Y/%m/%d %H:%M:%S",
            "%Y/%m/%d",
        )
        for fmt in formats:
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        raise ValueError("无法识别的时间格式: %r" % str(value)[:50])

    @staticmethod
    def is_negative(sentiment):
        """
        判断一条评论是否为负向。支持多种常见取值形态：
        - 字符串标签：negative / neg / 差评 / 负面 / 差 等
        - 1~5 星评分：<= 2 视为负向（含 "2分" / "1星" 等写法）
        - 0/1 极性：0 为负向
        - 概率值：(0,1) 内 < 0.5 视为负向；负数一律视为负向
        """
        if sentiment is None:
            return False
        if isinstance(sentiment, bool):
            return sentiment is False
        if isinstance(sentiment, (int, float)):
            v = float(sentiment)
            if v < 0:
                return True
            if v in (0.0, 1.0):
                return v < 0.5          # 0/1 极性
            if 1.0 < v <= 5.0:
                return v <= 2.0         # 1-5 星评分
            return v < 0.5              # 其他数值按概率处理
        s = str(sentiment).strip().lower()
        if s in {"negative", "neg", "bad", "poor", "差评", "负面", "差", "中差评",
                 "一星", "1星", "0", "-1", "false", "no", "不满"}:
            return True
        m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*(?:星|分)$", s)
        if m:
            return float(m.group(1)) <= 2.0
        return False

    def _aggregate_windows(self, reviews, window_hours):
        """
        将带时间的评论按窗口聚合。以最新评论时间为基准向前切分窗口，
        返回按时间升序排列的窗口列表：
        [{start, end, total, negative, positive, reviews}]
        无有效时间的评论不参与窗口聚合。
        """
        window_sec = max(1, int(window_hours)) * 3600
        buckets = defaultdict(list)
        parsed = []
        for r in reviews:
            raw_time = r.get("timestamp", r.get("date"))
            try:
                t = self.parse_datetime(raw_time)
            except (ValueError, TypeError):
                continue
            parsed.append((t, r))
        if not parsed:
            return []
        latest = max(t for t, _ in parsed)
        for t, r in parsed:
            idx = max(0, int((latest - t).total_seconds() // window_sec))
            buckets[idx].append((t, r))
        windows = []
        for idx in sorted(buckets, reverse=True):  # idx 越大越旧 -> 降序遍历即时间升序（旧 -> 新）
            items = buckets[idx]
            ts = [t for t, _ in items]
            neg = sum(1 for _, r in items if self.is_negative(r.get("sentiment")))
            windows.append({
                "start": min(ts),
                "end": max(ts),
                "total": len(items),
                "negative": neg,
                "positive": len(items) - neg,
                "reviews": [r for _, r in items],
            })
        return windows

    # ------------------------------------------------------------------
    # 中文文本处理与关键词提取
    # ------------------------------------------------------------------

    @staticmethod
    def _tokenize_text(text):
        """
        简单分词：按标点 / 空白切分；中文片段提取二元词组（bigram），
        过滤停用词与噪声字符后返回去重 token 集合。
        """
        tokens = set()
        if not text:
            return tokens
        for part in PUNCT_RE.split(str(text)):
            part = part.strip()
            if not part:
                continue
            if CJK_RE.search(part):
                # 只保留中文字符后滑动提取二元词组
                chars = re.sub(r"[^\u4e00-\u9fff\u3400-\u4dbf]", "", part)
                if len(chars) >= 2:
                    for i in range(len(chars) - 1):
                        bigram = chars[i:i + 2]
                        if bigram in STOPWORDS:
                            continue
                        if NOISE_CHARS & set(bigram):
                            continue
                        tokens.add(bigram)
            else:
                # 纯英文 / 数字词
                word = part.lower()
                if len(word) >= 2 and word not in STOPWORDS:
                    tokens.add(word)
        return tokens

    def extract_keywords(self, texts, top_n=10):
        """统计文本集合的词频，返回 [(关键词, 次数), ...]，按频次降序。"""
        counter = Counter()
        for text in texts:
            for token in self._tokenize_text(text):
                counter[token] += 1
        return counter.most_common(max(1, top_n))

    # ------------------------------------------------------------------
    # 舆情检测
    # ------------------------------------------------------------------

    def detect_sentiment(self, reviews):
        """舆情检测入口：爆发检测 + 版本级问题检测。"""
        if not reviews:
            return [self._build_alert(
                "notice", "sentiment_no_data", "-", "暂无评论数据",
                [{"message": "输入中不包含任何评论，无法进行舆情检测"}], 0.0)]
        alerts = []
        alerts.extend(self._detect_burst_negative(reviews))
        alerts.extend(self._detect_version_issues(reviews))
        return alerts

    def _detect_burst_negative(self, reviews):
        """
        负向舆情爆发检测：
        - 窗口内负向占比 > 50%
        - 负向数量较前序窗口平均环比增长 >= 1.5 倍
        - 无历史窗口时：占比 >= 70% 且样本 >= 5 视为爆发
        命中后从该窗口负向评论中提取高频关键词。
        """
        windows = self._aggregate_windows(reviews, self.window_hours)
        if not windows:
            return []
        alerts = []
        for i, win in enumerate(windows):
            total, neg = win["total"], win["negative"]
            if total < MIN_WINDOW_REVIEWS:
                continue
            ratio = neg / total
            if ratio <= BURST_NEGATIVE_RATIO:
                continue

            # 环比增长判断：与所有更早窗口的负向均值比较
            prior = windows[:i]
            if prior:
                prev_neg_avg = sum(w["negative"] for w in prior) / len(prior)
                if prev_neg_avg > 0:
                    growth = neg / prev_neg_avg
                    is_burst = growth >= BURST_GROWTH_RATE
                else:
                    # 前序窗口无负向反馈，当前突然集中出现负向 -> 视为从零爆发
                    growth = None
                    is_burst = True
            else:
                prev_neg_avg = None
                growth = None
                # 无历史窗口可比：负向占比极高（>=70%）且样本充足时视为爆发
                is_burst = ratio >= BURST_FALLBACK_RATIO and total >= BURST_FALLBACK_MIN
            if not is_burst:
                continue

            # 提取该窗口负向评论的高频关键词
            neg_texts = [r.get("content", "") for r in win["reviews"]
                         if self.is_negative(r.get("sentiment"))]
            keywords = self.extract_keywords(neg_texts, top_n=self.top_keywords)
            level = "critical" if ratio >= 0.7 else "warning"
            item = {
                "window_start": win["start"].strftime("%Y-%m-%d %H:%M"),
                "window_end": win["end"].strftime("%Y-%m-%d %H:%M"),
                "total": total,
                "negative": neg,
                "positive": total - neg,
                "negative_ratio": round(ratio, 4),
                "growth_rate": round(growth, 2) if growth is not None else None,
                "had_prior": bool(prior),
                "keywords": keywords,
            }
            title = "负向舆情爆发" if level == "critical" else "负向舆情显著上升"
            target = "窗口 %s" % item["window_start"]
            alerts.append(self._build_alert(level, "sentiment_burst_negative",
                                            target, title, [item], ratio))
        return alerts

    def _detect_version_issues(self, reviews):
        """
        版本级负向问题检测：按 version 分组，样本 >= 5 且负向率 > 30% 预警，
        > 50% 严重。同级多个版本合并为一条预警。
        """
        by_version = defaultdict(list)
        for r in reviews:
            by_version[str(r.get("version") or "未知版本")].append(r)
        matches = []  # (level, item, rate)
        for version, items in by_version.items():
            if len(items) < VERSION_MIN_REVIEWS:
                continue
            neg = sum(1 for r in items if self.is_negative(r.get("sentiment")))
            rate = neg / len(items)
            if rate <= VERSION_NEGATIVE_RATE:
                continue
            level = "critical" if rate > 0.5 else "warning"
            neg_texts = [r.get("content", "") for r in items
                         if self.is_negative(r.get("sentiment"))]
            keywords = self.extract_keywords(neg_texts, top_n=self.top_keywords)
            matches.append((level, {
                "version": version,
                "total": len(items),
                "negative": neg,
                "positive": len(items) - neg,
                "negative_rate": round(rate, 4),
                "keywords": keywords,
            }, rate))

        alerts = []
        for level in LEVEL_ORDER:
            grouped = [m for m in matches if m[0] == level]
            if not grouped:
                continue
            grouped.sort(key=lambda m: m[2], reverse=True)  # 负向率降序
            items = [m[1] for m in grouped]
            max_rate = grouped[0][2]
            if len(items) == 1:
                title = "版本 %s 负向问题" % items[0]["version"]
                target = items[0]["version"]
            else:
                versions = [it["version"] for it in items]
                title = "多版本负向问题"
                target = ",".join(versions)
            alerts.append(self._build_alert(level, "sentiment_version_issue",
                                            target, title, items, max_rate))
        return alerts

    # ------------------------------------------------------------------
    # 指标检测
    # ------------------------------------------------------------------

    def detect_metrics(self, metrics_data):
        """指标检测入口：逐指标做 Z-score 与趋势检测。"""
        if not metrics_data:
            return [self._build_alert(
                "notice", "metrics_no_data", "-", "暂无指标数据",
                [{"message": "输入中不包含任何指标序列，无法进行指标检测"}], 0.0)]
        alerts = []
        for name, series in metrics_data.items():
            points = self._parse_metric_series(name, series)
            if len(points) == 0:
                continue  # 该指标无有效数据点，跳过
            if len(points) < MIN_METRIC_POINTS:
                alerts.append(self._build_alert(
                    "notice", "metrics_insufficient_data", name,
                    "指标 %s 数据量不足" % name,
                    [{"metric": name, "points": len(points),
                      "required": MIN_METRIC_POINTS}], 0.0))
                continue
            alerts.extend(self._detect_metric_zscores(name, points))
            alerts.extend(self._detect_metric_trend(name, points))
        return alerts

    @staticmethod
    def _parse_metric_series(name, series):
        """
        解析单个指标的序列，返回 [{time, value}]，按时间升序（无时间的排最后）。
        非数值 value 与不可解析时间被跳过。
        """
        if not isinstance(series, list):
            raise DataError("指标 %r 的序列必须是数组" % str(name)[:30])
        points = []
        for item in series:
            if not isinstance(item, dict):
                continue
            value = item.get("value")
            if value is None:
                continue
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue
            raw_time = item.get("date", item.get("timestamp"))
            t = None
            try:
                t = AnomalyDetector.parse_datetime(raw_time)
            except (ValueError, TypeError):
                t = None
            points.append({"time": t, "value": value})
        points.sort(key=lambda p: (p["time"] is None, p["time"] or datetime.min))
        return points

    def _detect_metric_zscores(self, name, points):
        """
        Z-score 离群点检测：|z| >= 3σ 严重，|z| >= max(2, --threshold)σ 预警。
        同指标同级别的异常点合并为一条预警。
        """
        values = [p["value"] for p in points]
        n = len(values)
        mean = sum(values) / n
        std = math.sqrt(sum((v - mean) ** 2 for v in values) / n) if n > 1 else 0.0
        if std == 0:
            return []  # 序列无波动，不做检测

        warn_z = max(ZSCORE_WARNING, min(float(self.threshold), ZSCORE_CRITICAL))
        crit_items, warn_items = [], []
        for p in points:
            z = (p["value"] - mean) / std
            if abs(z) >= ZSCORE_CRITICAL:
                crit_items.append(self._z_item(name, p, z))
            elif abs(z) >= warn_z:
                warn_items.append(self._z_item(name, p, z))

        alerts = []
        if crit_items:
            max_z = max(abs(i["z_score"]) for i in crit_items)
            alerts.append(self._build_alert("critical", "metric_zscore", name,
                                            "指标 %s 出现严重离群点" % name,
                                            crit_items, max_z))
        if warn_items:
            max_z = max(abs(i["z_score"]) for i in warn_items)
            alerts.append(self._build_alert("warning", "metric_zscore", name,
                                            "指标 %s 出现离群点" % name,
                                            warn_items, max_z))
        return alerts

    @staticmethod
    def _z_item(name, point, z):
        """构造单个 Z-score 异常明细项。"""
        t = point["time"]
        time_str = t.strftime("%Y-%m-%d %H:%M") if t else "未知时间"
        return {
            "metric": name,
            "time": time_str,
            "value": round(point["value"], 4),
            "z_score": round(z, 2),
            "direction": "上升" if z > 0 else "下降",
        }

    def _detect_metric_trend(self, name, points):
        """
        趋势恶化检测：序列二等分，后半期均值较前半期均值下滑 > 20% 预警，
        下滑 > 50% 严重。基线（前半期均值）为 0 时无法计算降幅，跳过。
        """
        n = len(points)
        split = n // 2
        if split < 2:
            return []
        prev_vals = [p["value"] for p in points[:split]]
        recent_vals = [p["value"] for p in points[split:]]
        prev_avg = sum(prev_vals) / len(prev_vals)
        recent_avg = sum(recent_vals) / len(recent_vals)
        if prev_avg == 0:
            return []
        change = (recent_avg - prev_avg) / abs(prev_avg)
        decline = -change  # 正值表示下滑幅度
        if decline <= TREND_DECLINE_RATIO:
            return []
        level = "critical" if decline >= 0.5 else "warning"
        item = {
            "metric": name,
            "prev_avg": round(prev_avg, 4),
            "recent_avg": round(recent_avg, 4),
            "decline": round(decline, 4),
            "point_count": n,
        }
        return [self._build_alert(level, "metric_trend_decline", name,
                                  "指标 %s 趋势持续下滑" % name, [item], decline)]

    # ------------------------------------------------------------------
    # 预警构建
    # ------------------------------------------------------------------

    @staticmethod
    def _build_alert(level, alert_type, target, title, items, magnitude):
        """构造一条原始预警（detail 为明细项列表，供后续合并）。"""
        return {
            "level": level,
            "type": alert_type,
            "target": target,
            "title": title,
            "summary": AnomalyDetector._summarize(alert_type, items),
            "detail": items,
            "magnitude": float(magnitude or 0.0),
            "detected_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "occurrences": 1,
        }

    @staticmethod
    def _summarize(alert_type, items):
        """根据预警类型与明细生成中文概述。"""
        if alert_type == "sentiment_burst_negative":
            if len(items) == 1:
                it = items[0]
                pct = it["negative_ratio"] * 100
                s = "%s 窗口内共 %s 条评论，负向 %s 条，占比 %.1f%%" % (
                    it["window_start"], it["total"], it["negative"], pct)
                if it.get("growth_rate") is not None:
                    s += "，较前序窗口平均环比增长 %.1f 倍" % it["growth_rate"]
                elif it.get("had_prior"):
                    s += "，前序窗口无负向反馈"
                return s + "。"
            it = items[-1]  # 最近的窗口
            return ("共 %d 个时间窗口出现负向舆情爆发；最近窗口 %s 负向占比 %.1f%%。"
                    % (len(items), it["window_start"], it["negative_ratio"] * 100))
        if alert_type == "sentiment_version_issue":
            if len(items) == 1:
                it = items[0]
                return ("版本 %s 共 %s 条评论，负向 %s 条，负向率 %.1f%%。"
                        % (it["version"], it["total"], it["negative"],
                           it["negative_rate"] * 100))
            versions = "、".join(it["version"] for it in items)
            return "共 %d 个版本存在负向率偏高问题：%s。" % (len(items), versions)
        if alert_type == "metric_zscore":
            return "共 %d 个数据点偏离均值超过阈值，需重点关注。" % len(items)
        if alert_type == "metric_trend_decline":
            it = items[0]
            return ("后半期均值 %s 较前半期均值 %s 下滑 %.1f%%。"
                    % (it["recent_avg"], it["prev_avg"], it["decline"] * 100))
        if alert_type == "metrics_insufficient_data":
            names = "、".join(sorted(set(it["metric"] for it in items)))
            return ("共 %d 个指标样本量不足（少于 %d 个数据点），无法进行统计检测：%s。"
                    % (len(items), MIN_METRIC_POINTS, names))
        if alert_type in ("sentiment_no_data", "metrics_no_data"):
            if items and isinstance(items[0], dict):
                return str(items[0].get("message", "暂无数据"))
            return str(items[0]) if items else "暂无数据"
        return "检测到 %d 项异常。" % len(items)

    # ------------------------------------------------------------------
    # 预警后处理：合并 / 冷却 / 风险评估 / 建议
    # ------------------------------------------------------------------

    def merge_alerts(self, alerts):
        """
        预警合并：同类型 + 同级别的预警合并为一条，
        明细列表拼接、次数累加、幅度取最大，并重算概述与影响对象。
        """
        buckets = defaultdict(list)
        for a in alerts:
            buckets[(a["type"], a["level"])].append(a)
        merged = []
        for (atype, level), group in buckets.items():
            if len(group) == 1:
                merged.append(group[0])
                continue
            base = dict(group[0])
            items = []
            for a in group:
                items.extend(a.get("detail") or [])
            base["detail"] = items
            base["occurrences"] = len(group)
            base["magnitude"] = max((a.get("magnitude") or 0.0) for a in group)

            if atype == "sentiment_version_issue":
                versions = [it["version"] for it in items]
                base["target"] = ",".join(versions)
                base["title"] = "多版本负向问题"
            elif atype in ("metric_zscore", "metric_trend_decline", "metrics_insufficient_data"):
                metrics = sorted(set(str(it.get("metric")) for it in items if it.get("metric")))
                base["target"] = ",".join(metrics)
            base["summary"] = self._summarize(atype, items)
            merged.append(base)
        return merged

    def _cooldown_key(self, alert):
        """冷却键：预警类型 + 影响对象。"""
        return "%s|%s" % (alert["type"], alert.get("target") or alert.get("title") or "-")

    def load_cooldown_state(self, path):
        """从本地状态文件加载冷却记录（损坏 / 缺失时静默忽略）。"""
        if not path or not os.path.exists(path):
            return
        try:
            with open(path, "r", encoding="utf-8") as fp:
                raw = json.load(fp)
            for key, ts in raw.items():
                try:
                    self._cooldown_log[key] = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError):
                    continue
        except (OSError, ValueError):
            pass

    def save_cooldown_state(self, path):
        """持久化冷却记录到本地状态文件。"""
        if not path:
            return
        try:
            data = {k: v.strftime("%Y-%m-%d %H:%M:%S")
                    for k, v in self._cooldown_log.items()}
            with open(path, "w", encoding="utf-8") as fp:
                json.dump(data, fp, ensure_ascii=False, indent=2)
        except OSError:
            pass  # 状态文件写入失败不影响主流程

    def apply_cooldown(self, alerts):
        """冷却去重：冷却期内不重复告警，命中则抑制并计数。"""
        if self.cooldown_hours <= 0:
            return alerts
        now = datetime.now()
        kept = []
        for a in alerts:
            key = self._cooldown_key(a)
            last = self._cooldown_log.get(key)
            if last is not None and now - last < timedelta(hours=self.cooldown_hours):
                self.suppressed_count += 1
                continue
            self._cooldown_log[key] = now
            kept.append(a)
        return kept

    def assess_risk(self, alerts):
        """风险评估：基础分（级别）+ 对象数量 + 异常幅度，映射到高 / 中 / 低。"""
        for a in alerts:
            base = ALERT_LEVELS[a["level"]]["weight"]
            items = a.get("detail") or []
            item_count = len(items) if isinstance(items, list) else 1
            m = float(a.get("magnitude") or 0.0)
            # 幅度折算：Z-score 用绝对偏差，其余用比率
            if a["type"] == "metric_zscore":
                bonus = min(m, 5.0) * 8
            else:
                bonus = min(m, 1.0) * 25
            score = base + min(55, item_count * 6 + int(bonus))
            if a["level"] == "critical":
                score = max(score, 60)
            if a["level"] == "notice":
                score = min(score, 35)
            score = min(99, max(10, score))
            a["risk_score"] = score
            a["risk_level"] = "高" if score >= 75 else ("中" if score >= 45 else "低")
        return alerts

    def generate_recommendations(self, alert):
        """按预警类型生成可执行处置建议，并附级别通用基调。"""
        recs = list(RECOMMENDATIONS.get(alert["type"], []))
        generic = LEVEL_RECOMMENDATIONS.get(alert["level"])
        if generic and generic not in recs:
            recs.append(generic)
        return recs[:5]

    @staticmethod
    def _build_summary(alerts, suppressed):
        """汇总预警统计信息。"""
        by_level = {lvl: 0 for lvl in LEVEL_ORDER}
        by_risk = {"高": 0, "中": 0, "低": 0}
        for a in alerts:
            by_level[a["level"]] += 1
            by_risk[a["risk_level"]] = by_risk.get(a["risk_level"], 0) + 1
        return {
            "total_alerts": len(alerts),
            "by_level": by_level,
            "by_risk": by_risk,
            "suppressed_by_cooldown": suppressed,
        }

    # ------------------------------------------------------------------
    # 主流程
    # ------------------------------------------------------------------

    def run(self):
        """执行完整检测流程，返回结构化结果。"""
        # 1. 读取并解析输入
        try:
            data = self.load_input()
        except FileNotFoundError:
            raise DataError("输入文件不存在：%s" % self.input_path)
        except ValueError as exc:
            raise DataError("输入文件不是合法的 JSON（%s）：%s" % (exc, self.input_path))

        review_count, metric_count = 0, 0
        alerts = []
        if self.alert_type in ("sentiment", "both"):
            reviews = self._extract_reviews(data)
            review_count = len(reviews)
            alerts.extend(self.detect_sentiment(reviews))
        if self.alert_type in ("metrics", "both"):
            metrics = self._extract_metrics(data)
            metric_count = len(metrics)
            alerts.extend(self.detect_metrics(metrics))

        # 2. 后处理流水线
        alerts = self.merge_alerts(alerts)
        alerts = self.apply_cooldown(alerts)
        alerts = self.assess_risk(alerts)
        for a in alerts:
            a["recommendations"] = self.generate_recommendations(a)

        # 3. 排序：级别高优先，同级风险分高优先
        alerts.sort(key=lambda a: (LEVEL_ORDER.index(a["level"]),
                                   -(a.get("risk_score") or 0)))

        type_name = {"sentiment": "舆情检测", "metrics": "指标检测",
                     "both": "舆情 + 指标综合检测"}.get(self.alert_type, self.alert_type)
        result = {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "meta": {
                "type": self.alert_type,
                "type_name": type_name,
                "input": self.input_path,
                "threshold": self.threshold,
                "window_hours": self.window_hours,
                "cooldown_hours": self.cooldown_hours,
                "top_keywords": self.top_keywords,
                "review_count": review_count,
                "metric_count": metric_count,
                "format": self.output_format,
            },
            "summary": self._build_summary(alerts, self.suppressed_count),
            "alerts": alerts,
        }
        return result

    # ------------------------------------------------------------------
    # 输出格式化
    # ------------------------------------------------------------------

    @staticmethod
    def _fmt_keywords(keywords):
        """格式化关键词列表为「词(次数)」字符串，最多展示 5 个。"""
        if not keywords:
            return "-"
        return "、".join("%s(%s)" % (k, c) for k, c in keywords[:5])

    def _render_detail_markdown(self, alert):
        """按预警类型渲染详情 Markdown 表格。"""
        items = alert.get("detail") or []
        if not items:
            return ""
        atype = alert["type"]
        rows = []
        if atype == "sentiment_burst_negative":
            rows.append("| 窗口开始 | 评论数 | 负向 | 占比 | 环比增长 | 高频关键词 |")
            rows.append("| --- | --- | --- | --- | --- | --- |")
            for it in items:
                growth = it.get("growth_rate")
                if growth is not None:
                    growth_s = "%.1f 倍" % growth
                elif it.get("had_prior"):
                    growth_s = "从零爆发"
                else:
                    growth_s = "无历史对比"
                rows.append("| %s | %s | %s | %.1f%% | %s | %s |" % (
                    it["window_start"], it["total"], it["negative"],
                    it["negative_ratio"] * 100, growth_s,
                    self._fmt_keywords(it.get("keywords"))))
        elif atype == "sentiment_version_issue":
            rows.append("| 版本 | 评论数 | 负向 | 负向率 | 高频关键词 |")
            rows.append("| --- | --- | --- | --- | --- |")
            for it in items:
                rows.append("| %s | %s | %s | %.1f%% | %s |" % (
                    it["version"], it["total"], it["negative"],
                    it["negative_rate"] * 100, self._fmt_keywords(it.get("keywords"))))
        elif atype == "metric_zscore":
            rows.append("| 指标 | 时间 | 数值 | Z-score | 方向 |")
            rows.append("| --- | --- | --- | --- | --- |")
            for it in items:
                rows.append("| %s | %s | %s | %s | %s |" % (
                    it["metric"], it["time"], it["value"], it["z_score"],
                    it["direction"]))
        elif atype == "metric_trend_decline":
            rows.append("| 指标 | 前半期均值 | 后半期均值 | 降幅 | 样本数 |")
            rows.append("| --- | --- | --- | --- | --- |")
            for it in items:
                rows.append("| %s | %s | %s | %.1f%% | %s |" % (
                    it["metric"], it["prev_avg"], it["recent_avg"],
                    it["decline"] * 100, it["point_count"]))
        elif atype == "metrics_insufficient_data":
            rows.append("| 指标 | 现有点数 | 要求点数 |")
            rows.append("| --- | --- | --- |")
            for it in items:
                rows.append("| %s | %s | %s |" % (it["metric"], it["points"], it["required"]))
        elif atype in ("sentiment_no_data", "metrics_no_data"):
            msg = items[0].get("message", "") if isinstance(items[0], dict) else str(items[0])
            rows.append("| 说明 |")
            rows.append("| --- |")
            rows.append("| %s |" % msg)
        else:
            return ""
        return "\n".join(rows)

    def to_markdown(self, result):
        """将结构化结果渲染为 Markdown 报告。"""
        meta = result.get("meta", {})
        summary = result.get("summary", {})
        alerts = result.get("alerts", [])
        by_level = summary.get("by_level", {})

        out = []
        out.append("# 异常检测与预警报告")
        out.append("")
        out.append("> 本报告由 `detect_anomalies.py` v%s 自动生成" % VERSION)
        out.append("")
        out.append("## 元信息")
        out.append("")
        out.append("| 项目 | 值 |")
        out.append("| --- | --- |")
        out.append("| 检测类型 | %s |" % meta.get("type_name", "-"))
        out.append("| 输入数据 | `%s` |" % meta.get("input", "-"))
        out.append("| 生成时间 | %s |" % result.get("generated_at", "-"))
        out.append("| 舆情窗口 | %s 小时 |" % meta.get("window_hours", 1))
        out.append("| Z-score 警告线 | %sσ（严重 3σ） |" % meta.get("threshold", 2.0))
        out.append("| 冷却时间 | %s 小时 |" % meta.get("cooldown_hours", 4))
        out.append("| 评论样本 | %s 条 |" % meta.get("review_count", 0))
        out.append("| 指标数量 | %s 个 |" % meta.get("metric_count", 0))
        out.append("")

        out.append("## 摘要")
        out.append("")
        out.append("| 级别 | 数量 |")
        out.append("| --- | --- |")
        total = 0
        for lvl in LEVEL_ORDER:
            cnt = by_level.get(lvl, 0)
            total += cnt
            out.append("| %s %s | %s |" % (
                ALERT_LEVELS[lvl]["emoji"], ALERT_LEVELS[lvl]["name"], cnt))
        out.append("| **合计** | **%s** |" % total)
        suppressed = summary.get("suppressed_by_cooldown", 0)
        if suppressed:
            out.append("")
            out.append("> 另有 **%s** 条预警因处于冷却期内被抑制（避免重复打扰）。" % suppressed)
        out.append("")

        if alerts:
            out.append("## 风险总览")
            out.append("")
            out.append("| # | 级别 | 风险 | 预警 | 影响对象 |")
            out.append("| --- | --- | --- | --- | --- |")
            for i, a in enumerate(alerts, 1):
                out.append("| %s | %s | %s（%s） | %s | %s |" % (
                    i, ALERT_LEVELS[a["level"]]["emoji"], a.get("risk_level", "-"),
                    a.get("risk_score", "-"), a["title"], a.get("target", "-")))
            out.append("")

        for lvl in LEVEL_ORDER:
            section = [a for a in alerts if a["level"] == lvl]
            if not section:
                continue
            name = ALERT_LEVELS[lvl]["name"]
            emoji = ALERT_LEVELS[lvl]["emoji"]
            out.append("## %s %s预警（%s）" % (emoji, name, len(section)))
            out.append("")
            for a in section:
                out.append("### %s" % a["title"])
                out.append("")
                out.append("- **级别**：%s %s（%s）" % (emoji, name, a["level"]))
                out.append("- **影响对象**：%s" % a.get("target", "-"))
                out.append("- **风险评级**：%s（%s/100）" % (a.get("risk_level", "-"),
                                                          a.get("risk_score", "-")))
                out.append("- **检测时间**：%s" % a.get("detected_at", "-"))
                if a.get("occurrences", 1) > 1:
                    out.append("- **合并说明**：%s 条同类预警合并" % a["occurrences"])
                out.append("- **概述**：%s" % a.get("summary", ""))
                out.append("")
                detail_md = self._render_detail_markdown(a)
                if detail_md:
                    out.append("**详情**")
                    out.append("")
                    out.append(detail_md)
                    out.append("")
                recs = a.get("recommendations") or []
                if recs:
                    out.append("**处置建议**")
                    out.append("")
                    for j, r in enumerate(recs, 1):
                        out.append("%s. %s" % (j, r))
                    out.append("")
            out.append("---")
            out.append("")

        out.append("## 数据说明")
        out.append("")
        out.append("- 负向舆情爆发判定：窗口内负向占比 > 50% 且负向数量较前序窗口平均环比增长 ≥ 1.5 倍；无历史窗口时占比 ≥ 70% 且样本 ≥ 5。")
        out.append("- 版本负向问题：版本评论数 ≥ %s 且负向率 > 30%%（严重 > 50%%）。" % VERSION_MIN_REVIEWS)
        out.append("- Z-score 检测：|z| ≥ 2σ 预警，|z| ≥ 3σ 严重；警告线可经 `--threshold` 调整。")
        out.append("- 趋势恶化：后半期均值较前半期均值下滑 > 20%（严重 > 50%）。")
        out.append("- 关键词提取采用内置中文切分与停用词过滤，无需外部 NLP 依赖。")
        out.append("")
        return "\n".join(out)

    def to_json(self, result):
        """将结构化结果序列化为 JSON 字符串（保留中文）。"""
        return json.dumps(result, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _write_utf8(path, text):
    """以 UTF-8 写文本文件。"""
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(text)


def build_parser():
    """构造命令行参数解析器。"""
    parser = argparse.ArgumentParser(
        description="智能异常检测与预警脚本（舆情爆发 / 版本问题 / 指标离群与趋势恶化）")
    parser.add_argument("--type", required=True,
                        choices=["sentiment", "metrics", "both"],
                        help="检测类型：sentiment=舆情，metrics=指标，both=综合")
    parser.add_argument("--input", required=True,
                        help="输入 JSON 文件路径")
    parser.add_argument("--threshold", type=float, default=2.0,
                        help="Z-score 警告阈值（默认 2，即 2σ；严重线固定 3σ）")
    parser.add_argument("--window", type=int, default=1,
                        help="舆情时间窗口大小，单位小时（默认 1）")
    parser.add_argument("--cooldown-hours", type=int, default=4,
                        help="同类预警冷却时间，单位小时；0 表示关闭（默认 4）")
    parser.add_argument("--top-keywords", type=int, default=10,
                        help="爆发/版本问题提取的高频关键词数量（默认 10）")
    parser.add_argument("--format", dest="output_format",
                        choices=["markdown", "json"], default="markdown",
                        help="输出格式：markdown 报告或 json（默认 markdown）")
    parser.add_argument("--output",
                        help="输出文件路径；缺省输出到标准输出")
    return parser


def main(argv=None):
    """命令行入口。"""
    # 兜底：部分环境下 stdout 编码非 UTF-8，重新配置避免写入失败
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

    args = build_parser().parse_args(argv)

    detector = AnomalyDetector(
        alert_type=args.type,
        input_path=args.input,
        threshold=args.threshold,
        window_hours=args.window,
        cooldown_hours=args.cooldown_hours,
        top_keywords=args.top_keywords,
        output_format=args.output_format,
    )
    # 冷却状态文件：优先与输出文件放在一起，否则跟随输入文件
    state_path = (args.output or args.input) + ".cooldown.json"

    try:
        detector.load_cooldown_state(state_path)
        result = detector.run()
        text = detector.to_markdown(result) if args.output_format == "markdown" \
            else detector.to_json(result)

        if args.output:
            _write_utf8(args.output, text)
            detector.save_cooldown_state(state_path)
            print("报告已写入：%s" % args.output)
            print("冷却状态文件：%s" % state_path)
        else:
            print(text)
        # 简明统计输出到 stderr，避免污染 stdout 上的报告 / JSON 流
        s = result["summary"]
        print("检测完成：共 %s 条预警（严重 %s / 警告 %s / 提示 %s），"
              "因冷却抑制 %s 条。"
              % (s["total_alerts"], s["by_level"]["critical"],
                 s["by_level"]["warning"], s["by_level"]["notice"],
                 s["suppressed_by_cooldown"]), file=sys.stderr)
    except DataError as exc:
        print("[错误] %s" % exc, file=sys.stderr)
        return 2
    except OSError as exc:
        print("[错误] 文件读写失败：%s" % exc, file=sys.stderr)
        return 1
    except Exception as exc:  # 兜底：保证任何异常都以非零码退出而非 traceback 裸奔
        print("[错误] 未预期异常：%s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
