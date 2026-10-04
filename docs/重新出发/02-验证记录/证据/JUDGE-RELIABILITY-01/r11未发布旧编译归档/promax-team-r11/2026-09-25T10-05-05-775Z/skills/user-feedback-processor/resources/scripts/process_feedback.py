#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用户反馈结构化处理脚本
======================
多渠道用户反馈数据的清洗、去重、情感分析、意图识别、主题聚类、
痛点提取与趋势分析。

仅依赖 Python 标准库，支持 JSON / CSV 输入，输出 Markdown 报告或 JSON。

用法示例:
    python process_feedback.py --input feedback.json --output report.md
    python process_feedback.py --input feedback.csv --channel cs --output report.md \
        --extract-pain-points --trend-analysis --period 14
    python process_feedback.py --input feedback.json --output report.json --json
"""

import argparse
import csv
import json
import os
import re
import sys
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple


# ======================================================================
# 关键词词典
# ======================================================================

# --- 情感词典 ---
POSITIVE_WORDS: Set[str] = {
    "好", "很好", "非常好", "不错", "棒", "点赞", "满意", "喜欢", "方便",
    "好用", "优秀", "推荐", "赞", "贴心", "给力", "流畅", "赞一个", "舒适",
    "开心", "惊喜", "完美", "高效", "便捷", "省心", "靠谱", "牛", "厉害",
    "谢谢", "感谢", "辛苦了", "好评", "五星", "5星", "支持", "期待", "进步",
    "提升", "改善", "越来越好", "超出预期", "物超所值", "值得", "信赖",
    "好评如潮", "真香", "良心", "值得信赖", "体验好", "体验不错",
}

NEGATIVE_WORDS: Set[str] = {
    "差", "差评", "很差", "糟糕", "垃圾", "失望", "烦", "讨厌", "难用",
    "卡", "卡顿", "闪退", "崩溃", "报错", "错误", "bug", "问题", "不行",
    "不好", "慢", "太慢", "反应慢", "打不开", "无法", "失败", "坑", "骗人",
    "投诉", "维权", "退款", "赔偿", "吐槽", "无语", "恶心", "坑爹",
    "太差", "极差", "烂", "烂透了", "什么玩意", "狗屁", "辣鸡", "水军",
    "虚假", "欺诈", "霸王条款", "霸王", "割韭菜", "智商税", "不推荐",
    "后悔", "浪费", "浪费时间", "浪费钱", "不值", "亏", "上当", "受骗",
}

ANGRY_WORDS: Set[str] = {
    "气死", "愤怒", "怒", "恶心", "忍无可忍", "无耻", "骗子", "去死",
    "滚", "骂", "操", "靠", "妈的", "他妈", "草", "日", "傻逼", "sb",
    "神经病", "有病", "脑残", "废物", "蠢", "什么垃圾", "举报", "拉黑",
    "投诉到底", "维权到底", "律师", "法院", "起诉", "12315", "消协",
    "工商", "曝光", "媒体", "差评到底", "退款退费", "一分不退",
}

# --- 否定词 ---
NEGATION_WORDS: Set[str] = {
    "不", "没", "没有", "无", "非", "未", "别", "莫", "勿", "否",
    "毫不", "绝不", "从不", "未曾", "并非", "不算", "谈不上",
}

# --- 意图关键词 ---
INTENT_KEYWORDS: Dict[str, Set[str]] = {
    "complaint": {
        "投诉", "差评", "问题", "bug", "崩溃", "闪退", "卡顿", "报错",
        "无法", "失败", "退款", "赔偿", "维权", "垃圾", "骗人", "虚假",
        "欺诈", "坑", "坑爹", "辣鸡", "什么玩意", "失望", "愤怒", "恶心",
        "举报", "律师", "法院", "起诉", "12315", "消协", "曝光", "维权到底",
    },
    "suggestion": {
        "建议", "希望", "能否", "能不能", "可以", "能不能加", "期待",
        "想要", "需要", "如果有", "最好", "应该", "改进", "优化", "完善",
        "增加", "添加", "支持", "希望可以", "建议增加", "建议改进",
        "为什么不", "怎么不", "为啥不", "能否支持", "希望支持", "期待支持",
    },
    "inquiry": {
        "怎么", "如何", "哪里", "为什么", "为啥", "请问", "咨询", "疑问",
        "？", "吗", "是不是", "能不能", "可以吗", "有没有", "什么时候",
        "多久", "怎么用", "怎么操作", "在哪里", "怎么弄", "怎么看",
        "怎么查", "怎么找", "怎么设置", "怎么取消", "怎么修改",
    },
    "praise": {
        "好评", "点赞", "不错", "很好", "非常好", "棒", "满意", "喜欢",
        "感谢", "谢谢", "五星", "5星", "给力", "贴心", "优秀", "推荐",
        "真香", "良心", "靠谱", "牛", "厉害", "支持", "越来越好",
        "超出预期", "物超所值", "值得信赖", "体验好", "好评如潮",
    },
}

# --- 主题/问题分类关键词 ---
TOPIC_KEYWORDS: Dict[str, Set[str]] = {
    "功能缺陷": {
        "bug", "崩溃", "闪退", "报错", "错误", "无法", "打不开", "失败",
        "不能用", "没反应", "白屏", "黑屏", "卡死", "死机", "无响应",
        "异常", "故障", "出错", "不能登录", "登录不了", "加载失败",
        "网络错误", "服务器", "500", "404", "超时", "断线", "掉线",
        "数据丢失", "丢数据", "同步失败", "保存失败", "提交失败",
        "支付失败", "付款失败", "下单失败", "功能不可用", "功能失效",
        "不工作", "不兼容", "冲突", "版本不兼容",
    },
    "体验不佳": {
        "卡", "卡顿", "慢", "太慢", "反应慢", "加载慢", "启动慢",
        "操作复杂", "难用", "不好用", "繁琐", "麻烦", "不方便",
        "界面", "ui", "丑", "设计差", "排版", "字太小", "字太大",
        "按钮", "找不到", "隐藏太深", "层级太深", "交互", "体验差",
        "不流畅", "卡顿严重", "耗电", "发热", "占内存", "占空间",
        "广告多", "弹窗", "打扰", "通知太多", "推送太多", "骚扰",
        "引导不清", "看不懂", "不直观", "反人类", "不符合习惯",
    },
    "价格争议": {
        "贵", "太贵", "价格", "收费", "费用", "扣费", "乱扣费",
        "涨价", "不划算", "不值", "性价比", "优惠", "折扣", "券",
        "活动", "促销", "满减", "红包", "返现", "退款", "退费",
        "续费", "自动续费", "会员", "vip", "订阅", "包月", "包年",
        "免费", "付费", "充值", "余额", "积分", "金币", "花销",
        "隐藏收费", "诱导消费", "强制消费", "价格欺诈", "标价",
    },
    "客服态度": {
        "客服", "服务态度", "态度差", "态度恶劣", "不理人", "不回复",
        "踢皮球", "推诿", "敷衍", "不解决", "不处理", "拖", "拖延",
        "效率低", "回复慢", "沟通困难", "不专业", "不耐烦", "凶",
        "挂电话", "不接", "找不到客服", "人工客服", "在线客服",
        "电话客服", "投诉无门", "没人管", "没人理", "服务差",
        "售后", "售后差", "售后慢", "不理赔", "不售后",
    },
    "竞品对比": {
        "不如", "比不上", "比xx差", "不如xx", "竞品", "同类",
        "其他产品", "别家", "其他平台", "其他app", "换成", "转用",
        "替代", "迁移", "xx更好", "xx更", "还是xx好", "用回xx",
        "微信", "支付宝", "抖音", "淘宝", "京东", "拼多多", "美团",
        "对比", "比较", "差距", "领先", "落后",
    },
    "功能建议": {
        "建议", "希望", "期待", "想要", "需要", "如果有", "最好",
        "应该", "增加", "添加", "支持", "能否", "能不能", "可以加",
        "建议增加", "建议支持", "希望增加", "希望支持", "期待增加",
        "为什么不支持", "怎么没有", "缺失", "缺少", "没有这个功能",
        "建议改进", "建议优化", "建议完善", "何时支持", "计划支持",
    },
}

# --- 停用词 ---
STOP_WORDS: Set[str] = {
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都",
    "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
    "会", "着", "没有", "看", "好", "自己", "这", "那", "它", "他",
    "她", "们", "这个", "那个", "什么", "怎么", "为什么", "可以",
    "能", "能不", "就是", "还是", "或者", "但是", "因为", "所以",
    "如果", "虽然", "不过", "而且", "然后", "现在", "以前", "以后",
    "已经", "正在", "一下", "一些", "这样", "那样", "这么", "那么",
    "的话", "的话", "其实", "感觉", "觉得", "以为", "认为", "发现",
    "使用", "用", "用着", "用来", "之后", "之前", "时候", "时间",
    "今天", "昨天", "明天", "现在", "最近", "一直", "总是", "经常",
    "每次", "每次都", "一下", "等等", "之类的", "什么的", "这种",
    "那种", "这些", "那些", "本来", "原来", "根本", "完全", "真的",
    "确实", "好像", "似乎", "可能", "也许", "应该", "大概",
}

# --- 严重程度关键词映射 (用于痛点评分) ---
SEVERITY_KEYWORDS: Dict[str, int] = {
    # 高严重度
    "崩溃": 5, "闪退": 5, "数据丢失": 5, "无法使用": 5, "无法登录": 5,
    "支付失败": 5, "欺诈": 5, "虚假": 5, "起诉": 5, "维权": 5,
    "退款": 4, "扣费": 4, "乱扣费": 5, "投诉": 4, "举报": 4,
    "愤怒": 4, "气死": 4, "恶心": 4, "骗子": 5, "骗人": 5,
    # 中严重度
    "卡顿": 3, "很慢": 3, "太慢": 3, "报错": 3, "错误": 3,
    "打不开": 4, "失败": 3, "bug": 3, "无法": 3, "不能": 3,
    "难用": 3, "不好用": 3, "失望": 3, "差评": 3,
    # 低严重度
    "建议": 1, "希望": 1, "期待": 1, "卡": 2, "慢": 2,
    "丑": 2, "不方便": 2, "繁琐": 2, "麻烦": 2,
}


# ======================================================================
# 工具函数
# ======================================================================

def jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """计算两个集合的 Jaccard 相似系数"""
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


def tokenize(text: str) -> List[str]:
    """
    简易中文分词：按标点/空格切分后，提取 2~4 字滑动窗口词组。
    纯标准库实现，不依赖 jieba 等第三方库。
    """
    if not text:
        return []
    # 去除标点和特殊符号，保留中文、英文、数字
    cleaned = re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9\s]', ' ', text)
    tokens: List[str] = []

    # 英文/数字 token
    for word in re.findall(r'[a-zA-Z0-9]+', cleaned):
        word_lower = word.lower()
        if len(word_lower) >= 2 and word_lower not in STOP_WORDS:
            tokens.append(word_lower)

    # 中文部分：按空白切分段落，再做 2~3 字滑动窗口
    for segment in cleaned.split():
        cn_chars = re.findall(r'[\u4e00-\u9fa5]+', segment)
        for cn_seg in cn_chars:
            seg_len = len(cn_seg)
            if seg_len == 1:
                if cn_seg not in STOP_WORDS:
                    tokens.append(cn_seg)
            else:
                # 2-gram
                for i in range(seg_len - 1):
                    bi = cn_seg[i:i + 2]
                    if bi not in STOP_WORDS:
                        tokens.append(bi)
                # 3-gram (仅对较长片段)
                if seg_len >= 4:
                    for i in range(seg_len - 2):
                        tri = cn_seg[i:i + 3]
                        if tri not in STOP_WORDS:
                            tokens.append(tri)

    return tokens


def parse_timestamp(ts: Any) -> Optional[datetime]:
    """解析多种格式的时间戳，返回 datetime 对象"""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        try:
            # 毫秒时间戳转秒
            if ts > 1e12:
                ts = ts / 1000
            return datetime.fromtimestamp(ts)
        except (ValueError, OSError):
            return None
    if isinstance(ts, str):
        ts = ts.strip()
        # 常见日期格式
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
            "%Y/%m/%d %H:%M:%S",
            "%Y/%m/%d",
            "%Y年%m月%d日",
            "%Y年%m月%d日 %H:%M",
            "%m/%d/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M:%S",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(ts, fmt)
            except ValueError:
                continue
        # 尝试 ISO 格式
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            pass
    return None


def safe_divide(numerator: int, denominator: int) -> float:
    """安全除法，避免除零"""
    return round(numerator / denominator, 4) if denominator else 0.0


# ======================================================================
# 数据模型
# ======================================================================

class FeedbackItem:
    """单条反馈数据模型"""

    def __init__(self, raw: Dict[str, Any]):
        self.id: str = str(raw.get("id", ""))
        self.channel: str = raw.get("channel", "unknown")
        self.content: str = str(raw.get("content", "")).strip()
        self.user_id: str = str(raw.get("user_id", ""))
        self.timestamp: Optional[datetime] = parse_timestamp(raw.get("timestamp"))
        self.metadata: Dict[str, Any] = raw.get("metadata", {})

        # CSV 输入可能把 version/device/rating 放在顶层
        if not self.metadata:
            self.metadata = {}
        if "version" in raw:
            self.metadata.setdefault("version", raw.get("version"))
        if "device" in raw:
            self.metadata.setdefault("device", raw.get("device"))
        if "rating" in raw:
            self.metadata.setdefault("rating", raw.get("rating"))

        # 分析结果（后续填充）
        self.tokens: Set[str] = set()
        self.sentiment: str = ""       # positive / neutral / negative / angry
        self.sentiment_score: float = 0.0
        self.intent: str = ""          # complaint / suggestion / inquiry / praise
        self.topic: str = ""           # 功能缺陷 / 体验不佳 / ...
        self.is_duplicate: bool = False
        self.duplicate_of: Optional[str] = None  # 被重复的原始反馈 id

    @property
    def rating(self) -> Optional[float]:
        """获取评分"""
        r = self.metadata.get("rating")
        if r is None:
            return None
        try:
            return float(r)
        except (ValueError, TypeError):
            return None

    @property
    def version(self) -> str:
        return str(self.metadata.get("version", ""))

    @property
    def device(self) -> str:
        return str(self.metadata.get("device", ""))

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 输出的字典"""
        return {
            "id": self.id,
            "channel": self.channel,
            "content": self.content,
            "user_id": self.user_id,
            "timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M:%S") if self.timestamp else "",
            "metadata": self.metadata,
            "sentiment": self.sentiment,
            "sentiment_score": self.sentiment_score,
            "intent": self.intent,
            "topic": self.topic,
            "is_duplicate": self.is_duplicate,
            "duplicate_of": self.duplicate_of,
            "rating": self.rating,
            "version": self.version,
            "device": self.device,
        }


# ======================================================================
# 核心处理器
# ======================================================================

class FeedbackProcessor:
    """用户反馈结构化处理器"""

    # Jaccard 相似度阈值
    SIMILARITY_THRESHOLD: float = 0.8
    # 同用户去重时间窗口（小时）
    DEDUP_TIME_WINDOW_HOURS: int = 24

    def __init__(self, channel: Optional[str] = None, period: int = 30):
        """
        初始化处理器

        Args:
            channel: 指定渠道（可选，用于覆盖数据中的渠道字段）
            period: 趋势分析的时间周期（天）
        """
        self.channel_override = channel
        self.period = period
        self.feedbacks: List[FeedbackItem] = []
        self.deduped_feedbacks: List[FeedbackItem] = []
        self.stats: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 数据加载
    # ------------------------------------------------------------------

    def load_data(self, file_path: str) -> None:
        """从 JSON 或 CSV 文件加载反馈数据"""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"输入文件不存在: {file_path}")

        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".json":
            self._load_json(file_path)
        elif ext == ".csv":
            self._load_csv(file_path)
        else:
            # 尝试根据文件内容判断
            try:
                self._load_json(file_path)
            except (json.JSONDecodeError, ValueError):
                self._load_csv(file_path)

    def _load_json(self, file_path: str) -> None:
        """加载 JSON 格式数据"""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, dict):
            # 如果是包含列表的字典，尝试常见键名
            for key in ("feedbacks", "data", "items", "list", "records"):
                if key in data and isinstance(data[key], list):
                    data = data[key]
                    break
            else:
                raise ValueError("JSON 数据应为列表格式或包含列表的字典")

        if not isinstance(data, list):
            raise ValueError("JSON 数据应为列表格式")

        for raw in data:
            if not isinstance(raw, dict):
                continue
            item = self._create_feedback_item(raw)
            if item.content:
                self.feedbacks.append(item)

    def _load_csv(self, file_path: str) -> None:
        """加载 CSV 格式数据"""
        with open(file_path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # 将 CSV 行转换为标准格式
                raw: Dict[str, Any] = {
                    "id": row.get("id", ""),
                    "channel": row.get("channel", ""),
                    "content": row.get("content", ""),
                    "user_id": row.get("user_id", ""),
                    "timestamp": row.get("timestamp", ""),
                    "metadata": {},
                }
                # CSV 中的扩展字段
                for field in ("version", "device", "rating"):
                    if field in row and row[field]:
                        raw["metadata"][field] = row[field]

                item = self._create_feedback_item(raw)
                if item.content:
                    self.feedbacks.append(item)

    def _create_feedback_item(self, raw: Dict[str, Any]) -> FeedbackItem:
        """创建 FeedbackItem，应用渠道覆盖"""
        item = FeedbackItem(raw)
        # 渠道覆盖
        if self.channel_override:
            item.channel = self.channel_override
        # 分词
        item.tokens = set(tokenize(item.content))
        return item

    # ------------------------------------------------------------------
    # 去重
    # ------------------------------------------------------------------

    def deduplicate(self) -> None:
        """
        去重策略：
        1. 文本 Jaccard 相似度 > 0.8 且同一用户、24 小时内 → 重复
        2. 完全相同内容且同一用户 → 重复
        """
        if not self.feedbacks:
            self.deduped_feedbacks = []
            return

        # 按用户分组
        user_groups: Dict[str, List[FeedbackItem]] = defaultdict(list)
        for fb in self.feedbacks:
            user_groups[fb.user_id].append(fb)

        duplicates: Set[int] = set()  # 标记已处理的 feedback 在 self.feedbacks 中的索引

        for user_id, items in user_groups.items():
            # 按时间排序（无时间的排最后）
            items.sort(key=lambda x: x.timestamp or datetime.min)

            for i in range(len(items)):
                if id(items[i]) in duplicates:
                    continue
                for j in range(i + 1, len(items)):
                    if id(items[j]) in duplicates:
                        continue

                    # 时间窗口检查（若时间信息存在）
                    time_ok = True
                    if items[i].timestamp and items[j].timestamp:
                        delta = abs((items[j].timestamp - items[i].timestamp).total_seconds())
                        if delta > self.DEDUP_TIME_WINDOW_HOURS * 3600:
                            time_ok = False

                    if not time_ok:
                        continue

                    # 文本相似度检查
                    if items[i].content == items[j].content:
                        # 完全相同
                        items[j].is_duplicate = True
                        items[j].duplicate_of = items[i].id
                        duplicates.add(id(items[j]))
                    else:
                        sim = jaccard_similarity(items[i].tokens, items[j].tokens)
                        if sim > self.SIMILARITY_THRESHOLD:
                            items[j].is_duplicate = True
                            items[j].duplicate_of = items[i].id
                            duplicates.add(id(items[j]))

        # 保留非重复项
        self.deduped_feedbacks = [fb for fb in self.feedbacks if not fb.is_duplicate]

    # ------------------------------------------------------------------
    # 情感分析
    # ------------------------------------------------------------------

    def analyze_sentiment(self, fb: FeedbackItem) -> None:
        """
        情感分析：positive / neutral / negative / angry
        支持否定词翻转
        """
        text = fb.content.lower()
        tokens = tokenize(fb.content)

        angry_score = 0
        positive_score = 0
        negative_score = 0

        # 检查愤怒词
        for word in ANGRY_WORDS:
            if word in text or word in fb.content:
                angry_score += 2

        # 检查积极/消极词，考虑否定词
        all_words = list(POSITIVE_WORDS | NEGATIVE_WORDS)
        for word in all_words:
            if word not in fb.content:
                continue
            # 检查前缀否定词（向前查找 1~3 个字符）
            idx = fb.content.find(word)
            is_negated = False
            while idx != -1:
                prefix = fb.content[max(0, idx - 3):idx]
                for neg in NEGATION_WORDS:
                    if neg in prefix:
                        is_negated = True
                        break
                if is_negated:
                    break
                idx = fb.content.find(word, idx + 1)

            if word in POSITIVE_WORDS:
                if is_negated:
                    negative_score += 1  # 否定积极词 → 消极
                else:
                    positive_score += 1
            elif word in NEGATIVE_WORDS:
                if is_negated:
                    positive_score += 1  # 否定消极词 → 积极
                else:
                    negative_score += 1

        # 评分计算
        fb.sentiment_score = positive_score - negative_score - angry_score

        # 评级判定
        if angry_score > 0 and angry_score >= negative_score:
            fb.sentiment = "angry"
        elif negative_score > positive_score and negative_score > 0:
            fb.sentiment = "negative"
        elif positive_score > negative_score and positive_score > 0:
            fb.sentiment = "positive"
        else:
            fb.sentiment = "neutral"

        # 评分作为补充信号
        if fb.rating is not None:
            if fb.rating <= 2 and fb.sentiment == "neutral":
                fb.sentiment = "negative"
            elif fb.rating >= 4 and fb.sentiment == "neutral":
                fb.sentiment = "positive"

    # ------------------------------------------------------------------
    # 意图识别
    # ------------------------------------------------------------------

    def recognize_intent(self, fb: FeedbackItem) -> None:
        """意图识别：complaint / suggestion / inquiry / praise"""
        text = fb.content
        scores: Dict[str, int] = {}

        for intent, keywords in INTENT_KEYWORDS.items():
            score = 0
            for kw in keywords:
                if kw in text:
                    score += 1
            scores[intent] = score

        # 结合情感分析结果调整
        if fb.sentiment in ("negative", "angry") and scores.get("complaint", 0) > 0:
            scores["complaint"] = scores["complaint"] + 1
        if fb.sentiment == "positive" and scores.get("praise", 0) > 0:
            scores["praise"] = scores["praise"] + 1

        # 选取最高分意图
        best_intent = max(scores, key=scores.get) if scores else "inquiry"
        if scores.get(best_intent, 0) == 0:
            # 无关键词命中时，基于情感默认分类
            if fb.sentiment in ("negative", "angry"):
                best_intent = "complaint"
            elif fb.sentiment == "positive":
                best_intent = "praise"
            else:
                best_intent = "inquiry"

        fb.intent = best_intent

    # ------------------------------------------------------------------
    # 主题聚类
    # ------------------------------------------------------------------

    def classify_topic(self, fb: FeedbackItem) -> None:
        """基于关键词模式进行主题分类"""
        text = fb.content
        scores: Dict[str, int] = {}

        for topic, keywords in TOPIC_KEYWORDS.items():
            score = 0
            for kw in keywords:
                if kw in text:
                    score += 1
            scores[topic] = score

        best_topic = max(scores, key=scores.get) if scores else "其他"
        if scores.get(best_topic, 0) == 0:
            best_topic = "其他"

        fb.topic = best_topic

    # ------------------------------------------------------------------
    # 痛点提取
    # ------------------------------------------------------------------

    def extract_pain_points(self) -> List[Dict[str, Any]]:
        """
        痛点提取：基于频率 × 严重程度评分
        返回按分数排序的痛点列表
        """
        pain_points: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {"count": 0, "severity_sum": 0, "quotes": [], "topics": Counter()}
        )

        for fb in self.deduped_feedbacks:
            if fb.sentiment not in ("negative", "angry"):
                continue

            # 提取严重度关键词
            max_severity = 1  # 默认严重度
            matched_keywords: List[str] = []

            for kw, severity in SEVERITY_KEYWORDS.items():
                if kw in fb.content:
                    matched_keywords.append(kw)
                    if severity > max_severity:
                        max_severity = severity

            # 按主题分组痛点
            topic_key = fb.topic
            pp = pain_points[topic_key]
            pp["count"] += 1
            pp["severity_sum"] += max_severity
            pp["topics"][topic_key] += 1

            # 收集典型引用（最多 5 条）
            if len(pp["quotes"]) < 5:
                quote = fb.content[:200] + ("..." if len(fb.content) > 200 else "")
                pp["quotes"].append({
                    "id": fb.id,
                    "content": quote,
                    "channel": fb.channel,
                    "sentiment": fb.sentiment,
                    "user_id": fb.user_id,
                })

        # 计算痛点分数 = 频率 × 平均严重度
        result: List[Dict[str, Any]] = []
        for topic, data in pain_points.items():
            avg_severity = safe_divide(data["severity_sum"], data["count"])
            # 频率归一化：出现次数 / 总负面反馈数
            total_negative = max(1, len([f for f in self.deduped_feedbacks if f.sentiment in ("negative", "angry")]))
            frequency = safe_divide(data["count"], total_negative)
            score = round(frequency * avg_severity * 100, 2)

            result.append({
                "topic": topic,
                "count": data["count"],
                "frequency": frequency,
                "avg_severity": round(avg_severity, 2),
                "score": score,
                "quotes": data["quotes"],
            })

        # 按分数降序排列
        result.sort(key=lambda x: x["score"], reverse=True)
        return result

    # ------------------------------------------------------------------
    # 趋势分析
    # ------------------------------------------------------------------

    def analyze_trends(self) -> Dict[str, Any]:
        """
        趋势分析：反馈量和情感变化随时间变化
        基于指定周期（period 天）进行分析
        """
        if not self.deduped_feedbacks:
            return {"daily": [], "summary": {}}

        # 确定时间范围
        timestamps = [fb.timestamp for fb in self.deduped_feedbacks if fb.timestamp]
        if not timestamps:
            return {"daily": [], "summary": {"message": "无有效时间数据"}}

        latest = max(timestamps)
        earliest = min(timestamps)
        # 限定分析周期
        period_start = latest - timedelta(days=self.period)
        analysis_start = max(earliest, period_start)

        # 按天聚合
        daily_data: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {
                "total": 0,
                "positive": 0,
                "neutral": 0,
                "negative": 0,
                "angry": 0,
                "complaint": 0,
                "suggestion": 0,
                "inquiry": 0,
                "praise": 0,
            }
        )

        for fb in self.deduped_feedbacks:
            if not fb.timestamp or fb.timestamp < analysis_start:
                continue
            day_key = fb.timestamp.strftime("%Y-%m-%d")
            daily_data[day_key]["total"] += 1
            if fb.sentiment in ("positive", "neutral", "negative", "angry"):
                daily_data[day_key][fb.sentiment] += 1
            if fb.intent in ("complaint", "suggestion", "inquiry", "praise"):
                daily_data[day_key][fb.intent] += 1

        # 构建每日趋势列表
        daily_list: List[Dict[str, Any]] = []
        current = analysis_start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = latest.replace(hour=0, minute=0, second=0, microsecond=0)

        while current <= end:
            day_key = current.strftime("%Y-%m-%d")
            data = daily_data.get(day_key, {})
            total = data.get("total", 0)
            negative_count = data.get("negative", 0) + data.get("angry", 0)
            sentiment_ratio = safe_divide(negative_count, total) if total > 0 else 0.0

            daily_list.append({
                "date": day_key,
                "total": total,
                "positive": data.get("positive", 0),
                "neutral": data.get("neutral", 0),
                "negative": data.get("negative", 0),
                "angry": data.get("angry", 0),
                "complaint": data.get("complaint", 0),
                "suggestion": data.get("suggestion", 0),
                "inquiry": data.get("inquiry", 0),
                "praise": data.get("praise", 0),
                "negative_sentiment_ratio": sentiment_ratio,
            })
            current += timedelta(days=1)

        # 趋势摘要
        total_feedback = sum(d["total"] for d in daily_list)
        total_negative = sum(d["negative"] + d["angry"] for d in daily_list)
        total_positive = sum(d["positive"] for d in daily_list)
        avg_daily = safe_divide(total_feedback, len(daily_list)) if daily_list else 0.0

        # 计算趋势方向（后半段 vs 前半段）
        if len(daily_list) >= 4:
            mid = len(daily_list) // 2
            first_half_avg = safe_divide(
                sum(d["total"] for d in daily_list[:mid]), max(mid, 1)
            )
            second_half_avg = safe_divide(
                sum(d["total"] for d in daily_list[mid:]), max(len(daily_list) - mid, 1)
            )
            volume_trend = "上升" if second_half_avg > first_half_avg else ("下降" if second_half_avg < first_half_avg else "持平")

            first_neg = safe_divide(
                sum(d["negative"] + d["angry"] for d in daily_list[:mid]),
                max(sum(d["total"] for d in daily_list[:mid]), 1)
            )
            second_neg = safe_divide(
                sum(d["negative"] + d["angry"] for d in daily_list[mid:]),
                max(sum(d["total"] for d in daily_list[mid:]), 1)
            )
            sentiment_trend = "恶化" if second_neg > first_neg else ("改善" if second_neg < first_neg else "持平")
        else:
            volume_trend = "数据不足"
            sentiment_trend = "数据不足"

        # 找峰值日
        peak_day = max(daily_list, key=lambda x: x["total"]) if daily_list else None

        summary = {
            "period_days": self.period,
            "analysis_start": analysis_start.strftime("%Y-%m-%d"),
            "analysis_end": end.strftime("%Y-%m-%d"),
            "total_feedback": total_feedback,
            "total_negative": total_negative,
            "total_positive": total_positive,
            "avg_daily_feedback": avg_daily,
            "volume_trend": volume_trend,
            "sentiment_trend": sentiment_trend,
            "peak_day": peak_day["date"] if peak_day else "",
            "peak_day_count": peak_day["total"] if peak_day else 0,
        }

        return {"daily": daily_list, "summary": summary}

    # ------------------------------------------------------------------
    # 关键词提取
    # ------------------------------------------------------------------

    def extract_keywords(self, top_n: int = 20) -> List[Dict[str, int]]:
        """提取高频关键词"""
        word_counter: Counter = Counter()
        for fb in self.deduped_feedbacks:
            for token in fb.tokens:
                if token not in STOP_WORDS and len(token) >= 1:
                    word_counter[token] += 1

        return [{"word": w, "count": c} for w, c in word_counter.most_common(top_n)]

    # ------------------------------------------------------------------
    # 统计汇总
    # ------------------------------------------------------------------

    def compute_stats(self) -> Dict[str, Any]:
        """计算汇总统计"""
        total = len(self.deduped_feedbacks)
        if total == 0:
            return {"total": 0, "message": "无有效反馈数据"}

        # 情感分布
        sentiment_dist = Counter(fb.sentiment for fb in self.deduped_feedbacks)
        # 意图分布
        intent_dist = Counter(fb.intent for fb in self.deduped_feedbacks)
        # 主题分布
        topic_dist = Counter(fb.topic for fb in self.deduped_feedbacks)
        # 渠道分布
        channel_dist = Counter(fb.channel for fb in self.deduped_feedbacks)
        # 版本分布
        version_dist = Counter(fb.version for fb in self.deduped_feedbacks if fb.version)
        # 设备分布
        device_dist = Counter(fb.device for fb in self.deduped_feedbacks if fb.device)

        # 评分统计
        ratings = [fb.rating for fb in self.deduped_feedbacks if fb.rating is not None]
        avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else None

        # 去重统计
        total_raw = len(self.feedbacks)
        duplicates = total_raw - total

        return {
            "total_raw": total_raw,
            "total": total,
            "duplicates_removed": duplicates,
            "dedup_rate": safe_divide(duplicates, total_raw),
            "sentiment_distribution": {
                k: {"count": v, "ratio": safe_divide(v, total)}
                for k, v in sentiment_dist.most_common()
            },
            "intent_distribution": {
                k: {"count": v, "ratio": safe_divide(v, total)}
                for k, v in intent_dist.most_common()
            },
            "topic_distribution": {
                k: {"count": v, "ratio": safe_divide(v, total)}
                for k, v in topic_dist.most_common()
            },
            "channel_distribution": {
                k: {"count": v, "ratio": safe_divide(v, total)}
                for k, v in channel_dist.most_common()
            },
            "version_distribution": dict(version_dist.most_common()),
            "device_distribution": dict(device_dist.most_common(10)),
            "avg_rating": avg_rating,
            "rating_count": len(ratings),
        }

    # ------------------------------------------------------------------
    # 典型引用
    # ------------------------------------------------------------------

    def get_typical_quotes(self, max_per_category: int = 3) -> Dict[str, List[Dict[str, Any]]]:
        """获取各情感类别的典型引用"""
        quotes: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

        for fb in self.deduped_feedbacks:
            if len(quotes[fb.sentiment]) >= max_per_category:
                continue
            # 优先选择较短、有代表性的引用
            if not fb.content:
                continue
            quote = fb.content[:300] + ("..." if len(fb.content) > 300 else "")
            quotes[fb.sentiment].append({
                "id": fb.id,
                "content": quote,
                "channel": fb.channel,
                "user_id": fb.user_id,
                "topic": fb.topic,
                "intent": fb.intent,
            })

        return dict(quotes)

    # ------------------------------------------------------------------
    # 执行全流程
    # ------------------------------------------------------------------

    def process(
        self,
        extract_pain_points: bool = False,
        trend_analysis: bool = False,
    ) -> Dict[str, Any]:
        """执行完整的处理流程"""
        # 1. 去重
        self.deduplicate()

        # 2. 逐条分析
        for fb in self.deduped_feedbacks:
            self.analyze_sentiment(fb)
            self.recognize_intent(fb)
            self.classify_topic(fb)

        # 3. 汇总统计
        self.stats = self.compute_stats()

        result: Dict[str, Any] = {
            "stats": self.stats,
        }

        # 4. 关键词
        result["keywords"] = self.extract_keywords()

        # 5. 典型引用
        result["typical_quotes"] = self.get_typical_quotes()

        # 6. 痛点提取
        if extract_pain_points:
            result["pain_points"] = self.extract_pain_points()

        # 7. 趋势分析
        if trend_analysis:
            result["trend_analysis"] = self.analyze_trends()

        return result


# ======================================================================
# 报告生成
# ======================================================================

class ReportGenerator:
    """Markdown 报告生成器"""

    INTENT_LABELS = {
        "complaint": "投诉",
        "suggestion": "建议",
        "inquiry": "咨询",
        "praise": "表扬",
    }

    SENTIMENT_LABELS = {
        "positive": "积极",
        "neutral": "中性",
        "negative": "消极",
        "angry": "愤怒",
    }

    SENTIMENT_EMOJI = {
        "positive": "[+]",
        "neutral": "[=]",
        "negative": "[-]",
        "angry": "[!]",
    }

    @classmethod
    def generate_markdown(cls, result: Dict[str, Any]) -> str:
        """生成 Markdown 格式报告"""
        lines: List[str] = []
        stats = result.get("stats", {})

        # --- 标题 ---
        lines.append("# 用户反馈分析报告\n")
        lines.append(f"> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

        if stats.get("total", 0) == 0:
            lines.append("## 概述\n")
            lines.append("无有效反馈数据，请检查输入文件。\n")
            return "\n".join(lines)

        # --- 概述 ---
        lines.append("## 1. 概述\n")
        lines.append(f"| 指标 | 数值 |")
        lines.append(f"|------|------|")
        lines.append(f"| 原始反馈数 | {stats.get('total_raw', 0)} |")
        lines.append(f"| 去重后反馈数 | {stats.get('total', 0)} |")
        lines.append(f"| 去重数量 | {stats.get('duplicates_removed', 0)} |")
        lines.append(f"| 去重率 | {stats.get('dedup_rate', 0) * 100:.1f}% |")
        if stats.get("avg_rating") is not None:
            lines.append(f"| 平均评分 | {stats['avg_rating']} (共 {stats.get('rating_count', 0)} 条评分) |")
        lines.append("")

        # --- 情感分布 ---
        lines.append("## 2. 情感分布\n")
        sentiment_dist = stats.get("sentiment_distribution", {})
        if sentiment_dist:
            lines.append("| 情感 | 数量 | 占比 |")
            lines.append("|------|------|------|")
            for sentiment, data in sentiment_dist.items():
                label = cls.SENTIMENT_LABELS.get(sentiment, sentiment)
                lines.append(
                    f"| {label} | {data['count']} | {data['ratio'] * 100:.1f}% |"
                )
            lines.append("")

            # 情感分布柱状图（文本形式）
            lines.append("```")
            max_count = max(d["count"] for d in sentiment_dist.values()) if sentiment_dist else 1
            for sentiment, data in sentiment_dist.items():
                label = cls.SENTIMENT_LABELS.get(sentiment, sentiment)
                bar_len = int((data["count"] / max_count) * 40) if max_count > 0 else 0
                bar = "█" * bar_len
                lines.append(f"  {label:>4} | {bar} {data['count']}")
            lines.append("```\n")

        # --- 意图分布 ---
        lines.append("## 3. 意图分布\n")
        intent_dist = stats.get("intent_distribution", {})
        if intent_dist:
            lines.append("| 意图 | 数量 | 占比 |")
            lines.append("|------|------|------|")
            for intent, data in intent_dist.items():
                label = cls.INTENT_LABELS.get(intent, intent)
                lines.append(f"| {label} | {data['count']} | {data['ratio'] * 100:.1f}% |")
            lines.append("")

        # --- 主题分布 ---
        lines.append("## 4. 主题分布\n")
        topic_dist = stats.get("topic_distribution", {})
        if topic_dist:
            lines.append("| 主题 | 数量 | 占比 |")
            lines.append("|------|------|------|")
            for topic, data in topic_dist.items():
                lines.append(f"| {topic} | {data['count']} | {data['ratio'] * 100:.1f}% |")
            lines.append("")

        # --- 渠道分布 ---
        lines.append("## 5. 渠道分布\n")
        channel_dist = stats.get("channel_distribution", {})
        if channel_dist:
            lines.append("| 渠道 | 数量 | 占比 |")
            lines.append("|------|------|------|")
            for channel, data in channel_dist.items():
                lines.append(f"| {channel} | {data['count']} | {data['ratio'] * 100:.1f}% |")
            lines.append("")

        # --- 版本分布 ---
        version_dist = stats.get("version_distribution", {})
        if version_dist:
            lines.append("### 版本分布\n")
            lines.append("| 版本 | 数量 |")
            lines.append("|------|------|")
            for ver, count in list(version_dist.items())[:10]:
                lines.append(f"| {ver} | {count} |")
            lines.append("")

        # --- 高频关键词 ---
        lines.append("## 6. 高频关键词\n")
        keywords = result.get("keywords", [])
        if keywords:
            lines.append("| 关键词 | 出现次数 |")
            lines.append("|--------|----------|")
            for kw in keywords[:20]:
                lines.append(f"| {kw['word']} | {kw['count']} |")
            lines.append("")

            # 词云（文本形式）
            lines.append("```")
            for kw in keywords[:15]:
                size = min(40, max(8, kw["count"]))
                lines.append(f"  {kw['word']}({kw['count']})  ", )
            lines.append("```\n")

        # --- 痛点排行 ---
        if "pain_points" in result:
            lines.append("## 7. 痛点排行榜\n")
            pain_points = result.get("pain_points", [])
            if pain_points:
                lines.append("| 排名 | 主题 | 出现次数 | 频率 | 平均严重度 | 痛点分数 |")
                lines.append("|------|------|----------|------|------------|----------|")
                for rank, pp in enumerate(pain_points, 1):
                    lines.append(
                        f"| {rank} | {pp['topic']} | {pp['count']} | "
                        f"{pp['frequency'] * 100:.1f}% | {pp['avg_severity']} | "
                        f"**{pp['score']}** |"
                    )
                lines.append("")

                # 痛点详细引用
                lines.append("### 痛点典型引用\n")
                for pp in pain_points[:5]:
                    lines.append(f"#### {pp['topic']} (分数: {pp['score']})\n")
                    for quote in pp["quotes"][:3]:
                        lines.append(f"- [{quote['channel']}] {quote['content']}")
                        lines.append(f"  - 用户: {quote['user_id']} | 情感: {cls.SENTIMENT_LABELS.get(quote.get('sentiment', ''), '')}")
                    lines.append("")
            else:
                lines.append("未检测到明显痛点。\n")

        # --- 典型引用 ---
        lines.append("## 8. 典型反馈引用\n")
        quotes = result.get("typical_quotes", {})
        for sentiment, quote_list in quotes.items():
            label = cls.SENTIMENT_LABELS.get(sentiment, sentiment)
            emoji = cls.SENTIMENT_EMOJI.get(sentiment, "")
            lines.append(f"### {emoji} {label}\n")
            for q in quote_list:
                lines.append(f"- **[{q.get('channel', '')}]** {q['content']}")
                intent_label = cls.INTENT_LABELS.get(q.get("intent", ""), q.get("intent", ""))
                lines.append(f"  - 用户: {q.get('user_id', '')} | 主题: {q.get('topic', '')} | 意图: {intent_label}")
            lines.append("")

        # --- 趋势分析 ---
        if "trend_analysis" in result:
            lines.append("## 9. 趋势分析\n")
            trend = result.get("trend_analysis", {})
            summary = trend.get("summary", {})
            daily = trend.get("daily", [])

            if summary:
                lines.append("### 趋势摘要\n")
                lines.append("| 指标 | 数值 |")
                lines.append("|------|------|")
                lines.append(f"| 分析周期 | {summary.get('period_days', 0)} 天 |")
                lines.append(f"| 分析区间 | {summary.get('analysis_start', '')} ~ {summary.get('analysis_end', '')} |")
                lines.append(f"| 总反馈数 | {summary.get('total_feedback', 0)} |")
                lines.append(f"| 负面反馈数 | {summary.get('total_negative', 0)} |")
                lines.append(f"| 正面反馈数 | {summary.get('total_positive', 0)} |")
                lines.append(f"| 日均反馈数 | {summary.get('avg_daily_feedback', 0)} |")
                lines.append(f"| 反馈量趋势 | {summary.get('volume_trend', '')} |")
                lines.append(f"| 情感趋势 | {summary.get('sentiment_trend', '')} |")
                if summary.get("peak_day"):
                    lines.append(f"| 峰值日 | {summary['peak_day']} ({summary['peak_day_count']} 条) |")
                lines.append("")

            if daily:
                lines.append("### 每日趋势\n")
                lines.append("| 日期 | 总量 | 积极 | 中性 | 消极 | 愤怒 | 负面占比 |")
                lines.append("|------|------|------|------|------|------|----------|")
                for d in daily:
                    lines.append(
                        f"| {d['date']} | {d['total']} | {d['positive']} | "
                        f"{d['neutral']} | {d['negative']} | {d['angry']} | "
                        f"{d['negative_sentiment_ratio'] * 100:.1f}% |"
                    )
                lines.append("")

                # 趋势图（文本形式）
                lines.append("### 反馈量趋势图\n")
                lines.append("```")
                max_total = max((d["total"] for d in daily), default=1) or 1
                for d in daily:
                    bar_len = int((d["total"] / max_total) * 50) if max_total > 0 else 0
                    bar = "█" * bar_len
                    lines.append(f"  {d['date']} | {bar} {d['total']}")
                lines.append("```\n")

        # --- 页脚 ---
        lines.append("---")
        lines.append(f"*本报告由 process_feedback.py 自动生成*")

        return "\n".join(lines)


# ======================================================================
# 主入口
# ======================================================================

def main() -> int:
    """命令行入口"""
    parser = argparse.ArgumentParser(
        description="用户反馈结构化处理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s --input feedback.json --output report.md
  %(prog)s --input feedback.csv --channel cs --output report.md --extract-pain-points
  %(prog)s --input feedback.json --output report.json --json --trend-analysis --period 14
        """,
    )
    parser.add_argument(
        "--input",
        required=True,
        help="输入文件路径（JSON 或 CSV）",
    )
    parser.add_argument(
        "--channel",
        default=None,
        help="指定渠道（可选，如 cs/wechat_group/survey_nps）",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="输出文件路径",
    )
    parser.add_argument(
        "--extract-pain-points",
        action="store_true",
        default=False,
        help="启用痛点提取",
    )
    parser.add_argument(
        "--trend-analysis",
        action="store_true",
        default=False,
        help="启用趋势分析",
    )
    parser.add_argument(
        "--period",
        type=int,
        default=30,
        help="趋势分析周期（天，默认 30）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        default=False,
        help="输出 JSON 格式（默认 Markdown）",
    )

    args = parser.parse_args()

    # --- 参数校验 ---
    if args.period < 1:
        print("错误: --period 必须 >= 1", file=sys.stderr)
        return 1

    if not os.path.exists(args.input):
        print(f"错误: 输入文件不存在: {args.input}", file=sys.stderr)
        return 1

    # --- 处理 ---
    try:
        processor = FeedbackProcessor(
            channel=args.channel,
            period=args.period,
        )
        processor.load_data(args.input)

        if not processor.feedbacks:
            print("警告: 输入文件中未找到有效反馈数据", file=sys.stderr)

        result = processor.process(
            extract_pain_points=args.extract_pain_points,
            trend_analysis=args.trend_analysis,
        )

        # --- 输出 ---
        if args.json:
            output_content = json.dumps(result, ensure_ascii=False, indent=2)
        else:
            output_content = ReportGenerator.generate_markdown(result)

        # 确保输出目录存在
        output_dir = os.path.dirname(os.path.abspath(args.output))
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_content)

        # 控制台摘要
        stats = result.get("stats", {})
        print(f"处理完成!", file=sys.stderr)
        print(f"  原始反馈: {stats.get('total_raw', 0)} 条", file=sys.stderr)
        print(f"  去重后: {stats.get('total', 0)} 条", file=sys.stderr)
        print(f"  去重数: {stats.get('duplicates_removed', 0)} 条", file=sys.stderr)
        print(f"  输出文件: {args.output}", file=sys.stderr)

        return 0

    except FileNotFoundError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f"JSON 解析错误: {e}", file=sys.stderr)
        return 1
    except csv.Error as e:
        print(f"CSV 解析错误: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"数据格式错误: {e}", file=sys.stderr)
        return 1
    except PermissionError as e:
        print(f"文件权限错误: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"未知错误: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
