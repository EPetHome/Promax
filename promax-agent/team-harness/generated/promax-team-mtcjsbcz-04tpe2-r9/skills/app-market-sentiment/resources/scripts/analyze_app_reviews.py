#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
应用市场评论分析脚本 (App Review Analyzer)
==========================================

功能概述:
  1. 情感分析 -- 基于加权关键词评分 + 否定词翻转逻辑 (positive/negative/angry/neutral)
  2. 问题聚类 -- 基于预定义模式匹配，归类到稳定性/功能/体验等维度
  3. 版本分析 -- 统计各版本的评论数、负面率、平均评分
  4. 版本对比 -- 当指定 --compare-version 时，对比两个版本的关键指标变化
  5. 典型原声提取 -- 每个问题类别提取 Top 3 代表性用户评论
  6. 预警级别判定 -- critical / warning / normal
  7. 时间过滤 -- 按天数过滤最近 N 天的评论

用法:
  python analyze_app_reviews.py --input reviews.json --days 7 --output report.md
  python analyze_app_reviews.py --input reviews.json --version 3.2.0 --compare-version 3.1.0 --json
  python analyze_app_reviews.py --input reviews.json --days 30 --json

数据格式:
  输入 JSON 为评论对象列表，每个对象包含以下字段:
    id        - 评论ID
    source    - 来源 (App Store / 应用宝 / 华为应用市场 等)
    app_id    - 应用ID
    version   - 应用版本号
    rating    - 评分 (1-5)
    title     - 评论标题
    content   - 评论正文
    date      - 评论日期 (ISO 8601 格式)
    device    - 设备信息
    language  - 语言

依赖:
  纯 Python 标准库，无外部依赖 (Python 3.7+)
"""

import argparse
import json
import re
import sys
from collections import defaultdict, Counter
from datetime import datetime, timedelta


class AppReviewAnalyzer:
    """应用市场评论分析器"""

    # ================================================================
    # 情感词典
    # ================================================================

    # 否定词 -- 出现在关键词前 N 个字符内时翻转情感极性
    # "不卡" -> 卡(负面) 被"不"否定 -> 翻转为正面
    # "不好用" -> 好用(正面) 被"不"否定 -> 翻转为负面
    NEGATION_WORDS = [
        '不', '没', '没有', '无', '非', '未', '别', '莫', '勿',
        '不是', '不太', '不怎么', '并不', '不算', '不光',
        '不再', '从不', '毫无', '压根', '根本', '一点也不',
        '一点都不', '完全没有', '并没有', '并不是', '并不怎么',
    ]

    # 愤怒/强烈负面关键词 {词: 权重} -- 权重越高，情感越强烈
    ANGRY_KEYWORDS = {
        '垃圾': 3, '垃圾应用': 3, '垃圾软件': 3, '垃圾东西': 3,
        '废物': 3, '辣鸡': 3, '恶心': 3, '什么破': 3,
        '什么垃圾': 3, '什么鬼': 2, '坑': 2, '坑钱': 3, '坑人': 3,
        '骗钱': 3, '骗子': 3, '诈骗': 3, '去死': 3, '脑残': 3,
        '卸载': 2, '已卸载': 3, '果断卸载': 3, '删除': 2,
        '已删除': 3, '退款': 2, '投诉': 2, '差评': 2,
        '一星': 2, '给一星': 2, '太烂了': 3, '烂透了': 3,
        '什么烂': 3, '气死': 3, '气死我了': 3, '受够了': 3,
        '忍无可忍': 3, '无语': 2, '醉了': 2, '简直了': 2,
        '什么玩意': 3, '什么破玩意': 3, '恶心人': 3, '恶心死了': 3,
        '失望透顶': 3, '太失望了': 3, '大失所望': 3, '心寒': 3,
        '不要脸': 3, '不要脸的': 3, '无耻': 3, '可耻': 3,
        '滚蛋': 3, '关门': 2, '倒闭': 3, '赶紧倒闭': 3,
    }

    # 普通负面关键词 {词: 权重}
    NEGATIVE_KEYWORDS = {
        # 卡顿/性能
        '卡': 2, '卡顿': 2, '卡死': 3, '卡住': 2, '卡爆': 3,
        '卡成狗': 3, '卡成翔': 3, '卡成皮': 3, '卡得不行': 3,
        '卡到爆': 3, '卡得要死': 3, '卡的不行': 3,
        # 闪退/崩溃
        '闪退': 2, '崩溃': 2, '崩了': 2, '崩溃了': 2,
        '频繁闪退': 3, '一直闪退': 3, '老闪退': 3, '动不动闪退': 3,
        '频繁崩溃': 3, '一直崩溃': 3, '动不动崩溃': 3,
        # 速度
        '慢': 1, '太慢': 2, '慢死了': 2, '慢成狗': 3,
        '慢到爆': 3, '慢得要死': 3, '蜗牛': 2, '蜗牛一样': 2,
        # 打不开/用不了
        '打不开': 2, '用不了': 2, '进不去': 2, '开不了': 2,
        '无法使用': 2, '不能用了': 2, '用不了了': 2,
        '没法用': 2, '没法用了': 2, '不好使': 2, '不好使了': 2,
        # 屏幕/响应
        '黑屏': 2, '白屏': 2, '无响应': 2, '未响应': 2,
        '死机': 2, '没响应': 2, '没反应': 2, '卡住了': 2,
        # 网络
        '掉线': 2, '掉线了': 2, '断线': 2, '断了': 1,
        '频繁掉线': 3, '老掉线': 2, '一直掉线': 3,
        # 错误/异常
        '报错': 2, '错误': 1, '出错': 2, '失败了': 2, '失败': 1,
        '异常': 1, '异常退出': 2, '强制关闭': 2, '闪退退出': 2,
        # 评价
        '不行': 2, '不好用': 2, '难用': 2, '太难用': 3,
        '差': 1, '太差': 2, '太差了': 2, '差劲': 2,
        '烂': 2, '太烂': 2, '一般般': 1, '不太行': 2,
        # 广告
        '广告多': 2, '全是广告': 3, '弹广告': 2, '广告满天飞': 3,
        '广告太多': 2, '广告烦人': 2, '广告关不掉': 2,
        # 电量/发热
        '耗电': 2, '耗电快': 2, '费电': 2, '很耗电': 2, '太耗电': 3,
        '发热': 2, '发烫': 2, '手机发烫': 2, '很烫': 2, '烫手': 2,
        # 内存/存储
        '占内存': 2, '内存大': 2, '内存占用': 2, '吃内存': 2,
        '占空间': 2, '占存储': 2, '占用大': 2,
        # 功能问题
        '上传不了': 2, '下载不了': 2, '登录不了': 2, '登不上': 2,
        '收不到': 2, '发不出': 2, '传不上去': 2, '下不下来': 2,
        # 失望
        '失望': 2, '很失望': 2, '太失望': 3, '不太满意': 2,
        # 不行类
        '不行了': 2, '不好': 2, '不好啊': 2,
    }

    # 正面关键词 {词: 权重}
    POSITIVE_KEYWORDS = {
        # 好用类
        '好用': 2, '很好用': 3, '挺好用': 2, '超级好用': 3,
        '特别好用': 3, '非常好用': 3, '蛮好用': 2,
        # 不错类
        '不错': 2, '挺不错': 2, '很不错': 2, '相当不错': 2,
        '不错不错': 2, '蛮不错': 2, '蛮不错的': 2,
        # 好类
        '很好': 2, '挺好的': 2, '蛮好': 2, '蛮好的': 2,
        '挺好的呀': 2, '蛮不错': 2, '比较不错': 2,
        # 流畅类
        '流畅': 2, '很流畅': 3, '超流畅': 3, '特别流畅': 3,
        '丝滑': 2, '很丝滑': 3, '超丝滑': 3, '顺滑': 2,
        # 稳定类
        '稳定': 2, '很稳定': 3, '稳定可靠': 3, '比较稳定': 2,
        # 满意类
        '满意': 2, '很满意': 3, '非常满意': 3, '比较满意': 2,
        # 方便类
        '方便': 1, '很方便': 2, '超方便': 2, '便捷': 1,
        '很便捷': 2, '省心': 2, '省事': 1, '省力': 1,
        # 界面类
        '简洁': 2, '清爽': 2, '干净': 2, '清新': 2, '清晰': 1,
        # 速度类
        '快速': 1, '快捷': 1, '迅速': 1, '很快': 2, '很快的': 2,
        # 赞类
        '赞': 2, '点赞': 2, '好赞': 3, '超赞': 3, '大赞': 3,
        # 推荐类
        '推荐': 2, '强烈推荐': 3, '力荐': 3, '极力推荐': 3,
        # 棒类
        '棒': 2, '棒棒哒': 3, '太棒了': 3, '超棒': 3, '很棒': 2,
        # 优秀类
        '优秀': 2, '完美': 2, '很完美': 3, '完美的': 3, '出色': 2,
        # 否定翻转后的正面 ("不卡" 等)
        '不卡': 2, '不卡顿': 2, '不闪退': 2, '不崩溃': 2,
        '不慢': 2, '不掉线': 2, '不卡了': 2,
        # 其他正面
        '舒服': 1, '舒适': 1, '贴心': 2, '给力': 2, '很给力': 3,
        '良心': 2, '良心应用': 3, '良心软件': 3, '良心产品': 3,
        '喜欢': 2, '很喜欢': 2, '超喜欢': 3, '爱上了': 2, '爱了': 2,
        '好评': 2, '五星': 2, '五星好评': 3, '满分': 2, '给满分': 3,
        '值得': 2, '值得推荐': 3, '值得拥有': 3, '值得用': 2,
        '效率高': 2, '高效': 2, '高效率': 2,
        '体验好': 2, '体验不错': 2, '体验很棒': 3, '体验很好': 3,
        # 基础正面 (低权重，容易被否定词翻转)
        '好': 1,
    }

    # ================================================================
    # 问题模式 (按类别) -- 每个类别为一组关键词/短语，匹配到即归入该类
    # 一条评论可归入多个类别 (反映多维度问题)
    # ================================================================

    PROBLEM_PATTERNS = {
        # --- 稳定性 ---
        '稳定性-启动异常': [
            '打不开', '打不开了', '无法打开', '打开不了', '开不了',
            '启动不了', '启动失败', '无法启动', '启动不成功',
            '进不去', '进不了', '登不进去', '登不进去',
            '黑屏', '白屏', '一片黑', '一片白', '全黑', '全白',
            '一开就退', '一开就闪退', '打开就闪退', '打开就退',
            '启动就闪退', '启动就退', '一启动就', '一打开就',
            '闪退', '闪退了', '打不开啊', '进不去啊',
        ],
        '稳定性-运行异常': [
            '崩溃', '崩溃了', '频繁崩溃', '一直崩溃', '动不动崩溃',
            '运行闪退', '使用闪退', '操作闪退', '玩着玩就闪退',
            '卡死', '卡住', '卡住了', '卡住不动', '卡住不动了',
            '死机', '死机了', '卡死了', '卡死机',
            '无响应', '未响应', '没响应', '没反应', '不响应',
            '掉线', '掉线了', '断线', '断了', '掉线频繁',
            '频繁掉线', '老掉线', '一直掉线', '动不动掉线',
            '闪退退出', '异常退出', '异常关闭', '强制关闭',
            '崩溃退出', '频繁闪退', '一直闪退', '老闪退',
            '动不动闪退', '闪退闪退', '闪退了', '又闪退',
            '假死', '死机了', '卡死了', '僵死',
        ],
        # --- 功能 ---
        '功能-上传问题': [
            '上传不了', '上传失败', '无法上传', '传不上去', '传不上',
            '上传不成功', '上传出错', '上传报错', '上传有问题',
            '传不上来', '上传卡住', '上传很慢', '上传转圈',
            '上传一直失败', '上传没反应', '上传没反应了',
            '照片传不上去', '视频传不上去', '文件传不上去',
            '上传一直转', '上传不动', '上传不动了', '上传卡死了',
            '图片传不上', '传不上去了', '上传不出来',
        ],
        '功能-下载问题': [
            '下载不了', '下载失败', '无法下载', '下不了', '下不下来',
            '下载不成功', '下载出错', '下载报错', '下载有问题',
            '下载卡住', '下载很慢', '下载转圈', '下载一直转',
            '下载一直失败', '下载没反应', '下载没反应了',
            '视频下不了', '文件下不了', '图片下不了',
            '下载不动', '下载不动了', '下载停滞', '下载卡死了',
            '下不下来了', '下载不出来', '下载不了了',
        ],
        '功能-登录问题': [
            '登录不了', '登陆不了', '登不上', '登不上去', '登录失败',
            '无法登录', '无法登陆', '登录不上', '登陆不上',
            '登录出错', '登录报错', '登录有问题', '登录异常',
            '登不了', '登不上去了', '登不上去',
            '验证码', '收不到验证码', '验证码错误', '验证码发不出去',
            '验证码不来', '验证码收不到', '没有验证码', '验证码迟迟',
            '密码错误', '密码不对', '忘记密码', '找回密码', '改密码',
            '登录闪退', '一登录就退', '登录就闪退',
            '账号异常', '账号被锁', '账号被封', '账号锁定',
            '登录不上去', '登不进去', '登不上去了',
            '登不上', '登不了', '登不上去了', '二维码', '扫一扫',
        ],
        # --- 体验 ---
        '体验-界面问题': [
            '界面丑', '界面难看', '界面不好看', '界面太丑',
            '界面设计', '界面太乱', '界面复杂', '界面繁琐',
            '界面不好', '界面很差', '界面丑陋', '界面简陋',
            '布局', '排版', '布局乱', '排版乱', '排版问题',
            '按钮', '按钮找不到', '找不到按钮', '按钮太小',
            '按钮不好点', '按钮点不到', '误触', '误点',
            '找不到', '找不到功能', '找不到入口', '找不到在哪',
            '找不到设置', '找不到选项', '找半天',
            '界面卡', '界面卡顿', '界面不流畅',
            '字体', '字太小', '字看不清', '字体太小', '字看不清',
            '颜色', '颜色太暗', '颜色太亮', '配色', '配色差',
            '图标', '图标找不到', '图标不清晰', '图标太小',
            '导航', '导航不清晰', '找不到导航', '导航乱',
            'UI丑', 'UI不好看', 'UI太乱', 'UI设计',
        ],
        '体验-性能问题': [
            '卡', '卡顿', '卡死', '卡住', '卡的不行', '卡得不行',
            '卡成狗', '卡成翔', '卡成皮', '卡爆', '卡到爆',
            '卡得要死', '慢得要死', '卡的不行了',
            '慢', '太慢', '很慢', '慢死了', '慢成狗', '慢到爆',
            '蜗牛', '慢得要死', '慢到不行',
            '耗电', '耗电快', '费电', '很耗电', '太耗电', '耗电严重',
            '发热', '发烫', '手机发烫', '很烫', '烫手', '发烫严重',
            '内存', '占内存', '内存大', '内存占用', '吃内存', '内存占用高',
            '占空间', '占存储', '占用大', '体积大', '存储占用',
            '不流畅', '掉帧', '帧率低', '帧率',
            '延迟', '延迟高', '高延迟', '网络延迟', '延迟严重',
            '加载慢', '加载时间长', '加载不出来', '加载卡', '加载慢',
            '响应慢', '反应慢', '反应慢', '响应慢',
        ],
        # --- 功能-其他 ---
        '功能-其他': [
            '功能缺失', '没有这个功能', '缺少功能', '少功能',
            '功能不全', '功能不够', '没有这功能', '怎么没有',
            '不能用', '用不了', '用不了了', '没法用', '没法用了',
            '不能用了', '不好使', '不好使了', '功能用不了',
            '找不到功能', '功能找不到', '功能不见了', '功能没了',
            '不能分享', '分享不了', '无法分享', '分享不出',
            '不能搜索', '搜不了', '搜索不了', '无法搜索',
            '不能编辑', '编辑不了', '无法编辑',
            '不支持', '不支持这个', '不支持', '不支持格式',
            '功能失效', '功能坏了', '功能出问题', '功能异常',
            '不能截图', '截图不了', '无法截图',
            '收不到消息', '消息延迟', '消息不提醒', '消息收不到',
            '收不到通知', '通知不提醒', '没有通知', '通知收不到',
            '收不到推送', '推送不了', '没有推送', '推送收不到',
            '不能评论', '评论不了', '无法评论',
            '不能转发', '转发不了', '无法转发',
            '不能复制', '复制不了', '无法复制',
            '不能保存', '保存不了', '无法保存', '存不了',
            '功能没了', '功能不能用了', '功能用不了了',
        ],
        # --- 体验-其他 ---
        '体验-其他': [
            '广告', '广告多', '全是广告', '弹广告', '广告满天飞',
            '广告太多', '广告烦人', '广告烦', '烦人的广告',
            '广告关不掉', '广告关不了', '误点广告', '广告误触',
            '广告满天飞', '满屏广告', '广告满天', '广告弹窗',
            '收费', '收费贵', '太贵', '乱收费', '强制收费',
            '要钱', '坑钱', '收费不合理', '收费太贵',
            '隐私', '隐私问题', '泄露隐私', '窃取隐私', '隐私泄露',
            '权限', '要权限', '乱要权限', '权限太多', '不合理权限',
            '扣费', '乱扣费', '偷偷扣费', '扣钱', '乱扣',
            '更新后', '更新完', '更新之后', '更新后变卡',
            '更新后闪退', '更新后用不了', '更新后崩了', '更新后',
            '版本', '版本问题', '新版本', '新版不好用', '越更新',
            '要登录', '强制登录', '必须登录', '要注册', '强制注册',
            '必须注册', '要账号', '强制注册账号',
            '要信息', '要手机号', '要身份信息', '要身份',
            '骚扰', '骚扰电话', '骚扰短信', '打扰',
            '烦人', '烦死了', '太烦了', '烦',
        ],
    }

    # ================================================================
    # 预警阈值
    # ================================================================
    ALERT_CRITICAL_NEGATIVE_RATE = 0.40      # 负面率 >= 40% -> critical
    ALERT_WARNING_NEGATIVE_RATE = 0.20       # 负面率 >= 20% -> warning
    ALERT_CRITICAL_PROBLEM_RATIO = 0.30      # 单一问题占比 >= 30% -> critical
    ALERT_WARNING_PROBLEM_RATIO = 0.15       # 单一问题占比 >= 15% -> warning
    ALERT_CRITICAL_ANGRY_COUNT = 10          # 愤怒评论数 >= 10 -> critical
    ALERT_WARNING_ANGRY_COUNT = 5            # 愤怒评论数 >= 5 -> warning
    ALERT_CRITICAL_AVG_RATING = 2.0          # 平均评分 < 2.0 -> critical
    ALERT_WARNING_AVG_RATING = 3.0           # 平均评分 < 3.0 -> warning

    def __init__(self, reviews, days=7, version=None, compare_version=None):
        """
        初始化分析器

        Args:
            reviews:         评论列表 (list[dict])
            days:            分析最近 N 天的评论
            version:         指定分析的版本号 (可选)
            compare_version: 对比版本号 (可选，需配合 version 使用)
        """
        self.raw_reviews = reviews or []
        self.days = days
        self.version = version
        self.compare_version = compare_version

        # 编译问题模式正则 (去重 + 按长度降序优先匹配长词)
        self._compiled_patterns = {}
        for category, patterns in self.PROBLEM_PATTERNS.items():
            unique_patterns = sorted(set(patterns), key=len, reverse=True)
            self._compiled_patterns[category] = re.compile(
                '|'.join(re.escape(p) for p in unique_patterns)
            )

        # 合并情感关键词 {word: (sentiment_type, weight)}
        self._all_sentiment_keywords = {}
        for word, weight in self.POSITIVE_KEYWORDS.items():
            self._all_sentiment_keywords[word] = ('positive', weight)
        for word, weight in self.NEGATIVE_KEYWORDS.items():
            self._all_sentiment_keywords[word] = ('negative', weight)
        for word, weight in self.ANGRY_KEYWORDS.items():
            self._all_sentiment_keywords[word] = ('angry', weight)

        # 按长度降序排列，优先匹配长词 (避免 "好" 抢占 "好用" 的位置)
        self._sorted_keywords = sorted(
            self._all_sentiment_keywords.items(),
            key=lambda x: -len(x[0])
        )

        # 编译否定词正则 (用于快速查找)
        self._negation_pattern = re.compile(
            '|'.join(re.escape(w) for w in self.NEGATION_WORDS)
        )

        # 分析结果 (在 run() 中填充)
        self.filtered_reviews = []
        self._date_filtered_reviews = []
        self.results = {}

    # ================================================================
    # 数据加载与过滤
    # ================================================================

    def _parse_date(self, date_str):
        """解析 ISO 日期字符串，返回 naive datetime 对象"""
        try:
            if not date_str or not isinstance(date_str, str):
                return None
            date_str = date_str.strip()
            # 处理空格分隔的日期时间 "2024-01-15 10:30:00"
            if ' ' in date_str and 'T' not in date_str:
                date_str = date_str.replace(' ', 'T', 1)
            # 处理 Z 后缀
            if date_str.endswith('Z'):
                date_str = date_str[:-1] + '+00:00'
            dt = datetime.fromisoformat(date_str)
            # 去掉时区信息，统一为 naive datetime
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None

    def _filter_by_days(self):
        """按天数过滤评论，返回过滤后的列表"""
        if not self.raw_reviews:
            return []

        # 以数据中最新的日期作为参考点 (而非系统当前时间)
        max_date = None
        for review in self.raw_reviews:
            dt = self._parse_date(review.get('date', ''))
            if dt and (max_date is None or dt > max_date):
                max_date = dt

        if max_date is None:
            # 无法解析任何日期，保留全部数据
            return list(self.raw_reviews)

        cutoff = max_date - timedelta(days=self.days)

        result = []
        for review in self.raw_reviews:
            dt = self._parse_date(review.get('date', ''))
            if dt is None:
                continue
            if dt >= cutoff:
                result.append(review)
        return result

    def _filter_by_version(self, reviews, version):
        """按版本号过滤评论"""
        if version is None:
            return list(reviews)
        return [r for r in reviews if str(r.get('version', '')) == str(version)]

    # ================================================================
    # 情感分析
    # ================================================================

    def _check_negation(self, text, keyword_idx, window=4):
        """
        检查关键词前 window 个字符内是否有否定词
        返回 True 如果检测到否定词
        """
        start = max(0, keyword_idx - window)
        prefix = text[start:keyword_idx]
        return bool(self._negation_pattern.search(prefix))

    def analyze_sentiment(self, text):
        """
        分析文本情感，基于加权关键词评分 + 否定词翻转

        算法:
          1. 按关键词长度降序逐一匹配 (长词优先，避免短词抢占)
          2. 记录已匹配的字符位置，避免重叠
          3. 对每个匹配，检查前方是否有否定词
          4. 否定词翻转逻辑:
             - 否定 + 正面 -> 负面 ("不好用" -> negative)
             - 否定 + 负面 -> 正面 ("不卡" -> positive)
             - 否定 + 愤怒 -> 负面降级 ("不算垃圾" -> negative)

        Returns:
            dict: {
                'sentiment':         'positive'|'negative'|'angry'|'neutral',
                'scores':            {'positive': x, 'negative': y, 'angry': z},
                'matched_keywords':  [{'word', 'type', 'weight', 'negated'}, ...]
            }
        """
        scores = {'positive': 0, 'negative': 0, 'angry': 0}
        matched = []
        occupied = set()  # 已匹配的字符位置集合

        for word, (stype, weight) in self._sorted_keywords:
            start = 0
            while True:
                idx = text.find(word, start)
                if idx == -1:
                    break
                word_positions = set(range(idx, idx + len(word)))
                if word_positions & occupied:
                    # 位置已被占用，跳过
                    start = idx + 1
                    continue
                occupied |= word_positions

                # 检查否定词
                negated = self._check_negation(text, idx)

                if negated:
                    # 否定翻转
                    if stype == 'positive':
                        # "不好用" -> negative
                        scores['negative'] += weight
                    elif stype == 'negative':
                        # "不卡" -> positive (权重略降)
                        scores['positive'] += max(1, weight - 1)
                    elif stype == 'angry':
                        # "不算垃圾" -> negative (降级)
                        scores['negative'] += max(1, weight - 1)
                else:
                    scores[stype] += weight

                matched.append({
                    'word': word,
                    'type': stype,
                    'weight': weight,
                    'negated': negated,
                })
                start = idx + len(word)

        # 确定最终情感类型
        if scores['angry'] >= 2 and scores['angry'] >= scores['negative']:
            sentiment = 'angry'
        elif scores['negative'] > 0 and scores['negative'] >= scores['positive']:
            sentiment = 'negative'
        elif scores['positive'] > 0 and scores['positive'] > scores['negative']:
            sentiment = 'positive'
        else:
            sentiment = 'neutral'

        return {
            'sentiment': sentiment,
            'scores': scores,
            'matched_keywords': matched,
        }

    # ================================================================
    # 问题聚类
    # ================================================================

    def cluster_problems(self, text):
        """
        将文本归类到预定义的问题类别

        Returns:
            list[str]: 匹配到的问题类别列表
        """
        matched_categories = []
        for category, pattern in self._compiled_patterns.items():
            if pattern.search(text):
                matched_categories.append(category)
        return matched_categories

    # ================================================================
    # 典型原声提取
    # ================================================================

    def _quote_score(self, review, sentiment_result):
        """
        计算评论作为"典型原声"的代表性得分
        得分越高越适合作为引用

        因素:
        - 情感强烈 (angry/negative 高分优先)
        - 评分低 (1-2 星更有代表性)
        - 文本长度适中 (20-200 字最佳)
        - 匹配到更多情感关键词
        """
        score = 0

        # 情感强度
        score += sentiment_result['scores']['angry'] * 3
        score += sentiment_result['scores']['negative'] * 2
        score += sentiment_result['scores']['positive'] * 1

        # 评分影响 (低评分更有代表性)
        rating = review.get('rating')
        if rating is not None:
            try:
                rating = int(float(rating))
                if rating <= 1:
                    score += 5
                elif rating == 2:
                    score += 3
                elif rating == 3:
                    score += 1
            except (ValueError, TypeError):
                pass

        # 文本长度 (太短不够说明问题，太长不适合引用)
        text = (review.get('title', '') + review.get('content', '')).strip()
        text_len = len(text)
        if 20 <= text_len <= 200:
            score += 3
        elif 10 <= text_len < 20:
            score += 1
        elif text_len > 200:
            score += 1

        # 关键词数量
        score += len(sentiment_result['matched_keywords'])

        return score

    # ================================================================
    # 预警级别判定
    # ================================================================

    def _determine_alert_level(self, stats):
        """
        判定预警级别

        规则:
          - 任一 critical 条件触发 -> critical
          - 无 critical 但有 warning 条件触发 -> warning
          - 均未触发 -> normal

        Returns:
            tuple: (level, reasons)
        """
        reasons = []
        critical_count = 0
        warning_count = 0

        total = stats.get('total', 0)
        if total == 0:
            return 'normal', ['无评论数据']

        negative_rate = stats.get('negative_rate', 0)
        angry_count = stats.get('angry_count', 0)
        avg_rating = stats.get('avg_rating', 5)

        # 负面率
        if negative_rate >= self.ALERT_CRITICAL_NEGATIVE_RATE:
            critical_count += 1
            reasons.append(
                f'负面率 {negative_rate:.1%} >= {self.ALERT_CRITICAL_NEGATIVE_RATE:.0%} (critical)'
            )
        elif negative_rate >= self.ALERT_WARNING_NEGATIVE_RATE:
            warning_count += 1
            reasons.append(
                f'负面率 {negative_rate:.1%} >= {self.ALERT_WARNING_NEGATIVE_RATE:.0%} (warning)'
            )

        # 愤怒评论数
        if angry_count >= self.ALERT_CRITICAL_ANGRY_COUNT:
            critical_count += 1
            reasons.append(
                f'愤怒评论 {angry_count} 条 >= {self.ALERT_CRITICAL_ANGRY_COUNT} (critical)'
            )
        elif angry_count >= self.ALERT_WARNING_ANGRY_COUNT:
            warning_count += 1
            reasons.append(
                f'愤怒评论 {angry_count} 条 >= {self.ALERT_WARNING_ANGRY_COUNT} (warning)'
            )

        # 平均评分
        if avg_rating < self.ALERT_CRITICAL_AVG_RATING:
            critical_count += 1
            reasons.append(
                f'平均评分 {avg_rating:.2f} < {self.ALERT_CRITICAL_AVG_RATING} (critical)'
            )
        elif avg_rating < self.ALERT_WARNING_AVG_RATING:
            warning_count += 1
            reasons.append(
                f'平均评分 {avg_rating:.2f} < {self.ALERT_WARNING_AVG_RATING} (warning)'
            )

        # 问题集中度
        for cat, cat_stats in stats.get('problem_categories', {}).items():
            ratio = cat_stats['ratio']
            if ratio >= self.ALERT_CRITICAL_PROBLEM_RATIO:
                critical_count += 1
                reasons.append(
                    f'问题"{cat}"占比 {ratio:.1%} >= '
                    f'{self.ALERT_CRITICAL_PROBLEM_RATIO:.0%} (critical)'
                )
            elif ratio >= self.ALERT_WARNING_PROBLEM_RATIO:
                warning_count += 1
                reasons.append(
                    f'问题"{cat}"占比 {ratio:.1%} >= '
                    f'{self.ALERT_WARNING_PROBLEM_RATIO:.0%} (warning)'
                )

        if critical_count > 0:
            level = 'critical'
        elif warning_count > 0:
            level = 'warning'
        else:
            level = 'normal'
            reasons.append('各项指标正常')

        return level, reasons

    # ================================================================
    # 主分析流程
    # ================================================================

    def run(self):
        """执行完整分析流程，返回结果字典"""
        # 1. 按时间过滤
        self._date_filtered_reviews = self._filter_by_days()

        # 2. 按版本过滤 (如果指定了版本)
        if self.version:
            self.filtered_reviews = self._filter_by_version(
                self._date_filtered_reviews, self.version
            )
        else:
            self.filtered_reviews = list(self._date_filtered_reviews)

        reviews = self.filtered_reviews

        # 3. 逐条分析
        analyzed = []
        for review in reviews:
            text = (
                str(review.get('title', '')) + ' ' + str(review.get('content', ''))
            ).strip()
            sentiment = self.analyze_sentiment(text)
            problems = self.cluster_problems(text)

            analyzed.append({
                'review': review,
                'sentiment': sentiment,
                'problems': problems,
                'text': text,
                'quote_score': self._quote_score(review, sentiment),
            })

        # 4. 汇总统计
        total = len(analyzed)
        sentiment_counts = Counter(a['sentiment']['sentiment'] for a in analyzed)
        negative_count = sentiment_counts.get('negative', 0) + sentiment_counts.get('angry', 0)
        angry_count = sentiment_counts.get('angry', 0)

        ratings = []
        for a in analyzed:
            r = a['review'].get('rating')
            if r is not None:
                try:
                    ratings.append(float(r))
                except (ValueError, TypeError):
                    pass
        avg_rating = sum(ratings) / len(ratings) if ratings else 0

        # 问题分类统计
        problem_categories = defaultdict(lambda: {'count': 0, 'quotes': []})
        for a in analyzed:
            for cat in a['problems']:
                problem_categories[cat]['count'] += 1
                problem_categories[cat]['quotes'].append(a)

        # 计算问题占比 & 提取 Top 3 原声
        problem_stats = []
        for cat, data in problem_categories.items():
            ratio = data['count'] / total if total > 0 else 0
            # 按 quote_score 降序，取 Top 3
            sorted_quotes = sorted(data['quotes'], key=lambda x: -x['quote_score'])
            top_quotes = sorted_quotes[:3]
            problem_stats.append({
                'category': cat,
                'count': data['count'],
                'ratio': ratio,
                'quotes': [
                    {
                        'content': q['text'],
                        'rating': q['review'].get('rating'),
                        'version': q['review'].get('version'),
                        'source': q['review'].get('source'),
                        'sentiment': q['sentiment']['sentiment'],
                    }
                    for q in top_quotes
                ],
            })

        # 按问题数量降序排列
        problem_stats.sort(key=lambda x: -x['count'])

        # 5. 版本分析
        version_stats = self._compute_version_stats(analyzed)

        # 6. 预警级别
        stats = {
            'total': total,
            'sentiment_counts': dict(sentiment_counts),
            'negative_count': negative_count,
            'negative_rate': negative_count / total if total > 0 else 0,
            'angry_count': angry_count,
            'avg_rating': avg_rating,
            'problem_categories': {
                ps['category']: {'ratio': ps['ratio'], 'count': ps['count']}
                for ps in problem_stats
            },
        }
        alert_level, alert_reasons = self._determine_alert_level(stats)

        # 7. 版本对比 (如果指定了对比版本)
        version_comparison = None
        if self.compare_version:
            version_comparison = self._compute_version_comparison(
                analyzed, self.compare_version
            )

        self.results = {
            'summary': {
                'total_reviews': total,
                'days': self.days,
                'version': self.version,
                'sentiment_distribution': dict(sentiment_counts),
                'negative_rate': stats['negative_rate'],
                'angry_count': angry_count,
                'avg_rating': round(avg_rating, 2),
                'alert_level': alert_level,
                'alert_reasons': alert_reasons,
            },
            'problem_ranking': problem_stats,
            'version_analysis': version_stats,
            'version_comparison': version_comparison,
        }

        return self.results

    def _compute_version_stats(self, analyzed):
        """计算各版本统计数据"""
        version_data = defaultdict(list)
        for a in analyzed:
            ver = a['review'].get('version', '未知')
            version_data[ver].append(a)

        stats = []
        for ver, items in sorted(version_data.items()):
            total = len(items)
            sentiment_counts = Counter(a['sentiment']['sentiment'] for a in items)
            neg_count = (
                sentiment_counts.get('negative', 0) + sentiment_counts.get('angry', 0)
            )
            angry_count = sentiment_counts.get('angry', 0)
            ratings = []
            for a in items:
                r = a['review'].get('rating')
                if r is not None:
                    try:
                        ratings.append(float(r))
                    except (ValueError, TypeError):
                        pass
            avg_r = sum(ratings) / len(ratings) if ratings else 0

            stats.append({
                'version': ver,
                'total': total,
                'negative_count': neg_count,
                'negative_rate': neg_count / total if total > 0 else 0,
                'angry_count': angry_count,
                'avg_rating': round(avg_r, 2),
            })

        return stats

    def _compute_version_comparison(self, analyzed, compare_version):
        """
        计算版本对比

        analyzed 参数已包含当前版本的分析结果
        对比版本从日期过滤后的数据中重新提取并分析
        """
        # 当前版本数据 (已分析)
        current_items = analyzed

        # 对比版本数据 (从日期过滤后的数据中提取)
        compare_reviews = self._filter_by_version(
            self._date_filtered_reviews, compare_version
        )

        # 分析对比版本
        compare_analyzed = []
        for review in compare_reviews:
            text = (
                str(review.get('title', '')) + ' ' + str(review.get('content', ''))
            ).strip()
            sentiment = self.analyze_sentiment(text)
            problems = self.cluster_problems(text)
            compare_analyzed.append({
                'review': review,
                'sentiment': sentiment,
                'problems': problems,
                'text': text,
                'quote_score': self._quote_score(review, sentiment),
            })

        def summarize(items):
            total = len(items)
            if total == 0:
                return {
                    'total': 0, 'negative_rate': 0,
                    'avg_rating': 0, 'angry_count': 0,
                }
            sentiment_counts = Counter(a['sentiment']['sentiment'] for a in items)
            neg_count = (
                sentiment_counts.get('negative', 0)
                + sentiment_counts.get('angry', 0)
            )
            angry_count = sentiment_counts.get('angry', 0)
            ratings = []
            for a in items:
                r = a['review'].get('rating')
                if r is not None:
                    try:
                        ratings.append(float(r))
                    except (ValueError, TypeError):
                        pass
            avg_r = sum(ratings) / len(ratings) if ratings else 0
            return {
                'total': total,
                'negative_rate': neg_count / total,
                'avg_rating': round(avg_r, 2),
                'angry_count': angry_count,
            }

        current_summary = summarize(current_items)
        compare_summary = summarize(compare_analyzed)

        # 计算变化值
        neg_rate_change = (
            current_summary['negative_rate'] - compare_summary['negative_rate']
        )
        rating_change = (
            current_summary['avg_rating'] - compare_summary['avg_rating']
        )

        # 判断趋势
        if neg_rate_change > 0.05:
            trend = '恶化'
        elif neg_rate_change < -0.05:
            trend = '改善'
        else:
            trend = '持平'

        return {
            'current_version': self.version or '全部',
            'compare_version': compare_version,
            'current': current_summary,
            'compare': compare_summary,
            'negative_rate_change': round(neg_rate_change, 4),
            'avg_rating_change': round(rating_change, 2),
            'trend': trend,
        }

    # ================================================================
    # 输出格式化
    # ================================================================

    def to_markdown(self):
        """生成 Markdown 格式报告"""
        if not self.results:
            self.run()

        r = self.results
        s = r['summary']
        lines = []

        # --- 标题 ---
        lines.append('# 应用市场评论分析报告')
        lines.append('')
        lines.append(f'> 生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
        version_str = f'，版本 {s["version"]}' if s['version'] else ''
        lines.append(f'> 分析范围: 最近 {s["days"]} 天{version_str}')
        lines.append('')

        # --- 预警级别 ---
        lines.append(f'## 预警级别: {s["alert_level"].upper()}')
        lines.append('')
        for reason in s['alert_reasons']:
            lines.append(f'- {reason}')
        lines.append('')

        # --- 总览 ---
        lines.append('## 总览')
        lines.append('')
        lines.append('| 指标 | 数值 |')
        lines.append('|------|------|')
        lines.append(f'| 评论总数 | {s["total_reviews"]} |')
        lines.append(f'| 平均评分 | {s["avg_rating"]:.2f} |')
        lines.append(f'| 负面率 | {s["negative_rate"]:.1%} |')
        lines.append(f'| 愤怒评论 | {s["angry_count"]} 条 |')
        lines.append('')

        # --- 情感分布 ---
        lines.append('### 情感分布')
        lines.append('')
        sd = s['sentiment_distribution']
        total = s['total_reviews'] or 1
        lines.append('| 情感类型 | 数量 | 占比 |')
        lines.append('|----------|------|------|')
        for stype in ['positive', 'negative', 'angry', 'neutral']:
            count = sd.get(stype, 0)
            lines.append(f'| {stype} | {count} | {count / total:.1%} |')
        lines.append('')

        # --- 问题排行 ---
        if r['problem_ranking']:
            lines.append('## TOP 问题排行')
            lines.append('')
            lines.append('| 排名 | 问题类别 | 评论数 | 占比 |')
            lines.append('|------|----------|--------|------|')
            for i, p in enumerate(r['problem_ranking'], 1):
                lines.append(
                    f'| {i} | {p["category"]} | {p["count"]} | {p["ratio"]:.1%} |'
                )
            lines.append('')

            # --- 典型用户原声 ---
            lines.append('## 典型用户原声')
            lines.append('')
            for p in r['problem_ranking']:
                if not p['quotes']:
                    continue
                lines.append(f'### {p["category"]} ({p["count"]} 条)')
                lines.append('')
                for j, q in enumerate(p['quotes'], 1):
                    rating = q.get('rating', 'N/A')
                    ver = q.get('version', 'N/A')
                    src = q.get('source', 'N/A')
                    lines.append(f'> **{j}.** [{src} | v{ver} | {rating} 星]')
                    content = q['content']
                    if len(content) > 300:
                        content = content[:300] + '...'
                    lines.append(f'> {content}')
                    lines.append('>')
                lines.append('')
        else:
            lines.append('## TOP 问题排行')
            lines.append('')
            lines.append('未检测到明显问题。')
            lines.append('')

        # --- 版本分析 ---
        if r['version_analysis']:
            lines.append('## 版本分析')
            lines.append('')
            lines.append('| 版本 | 评论数 | 负面数 | 负面率 | 愤怒数 | 平均评分 |')
            lines.append('|------|--------|--------|--------|--------|----------|')
            for v in r['version_analysis']:
                lines.append(
                    f'| {v["version"]} | {v["total"]} | {v["negative_count"]} | '
                    f'{v["negative_rate"]:.1%} | {v["angry_count"]} | '
                    f'{v["avg_rating"]:.2f} |'
                )
            lines.append('')

        # --- 版本对比 ---
        if r['version_comparison']:
            vc = r['version_comparison']
            lines.append('## 版本对比')
            lines.append('')
            lines.append(
                f'| 指标 | {vc["compare_version"]} (对比) | '
                f'{vc["current_version"]} (当前) | 变化 |'
            )
            lines.append('|------|------------------|------------------|------|')
            lines.append(
                f'| 评论数 | {vc["compare"]["total"]} | '
                f'{vc["current"]["total"]} | '
                f'{vc["current"]["total"] - vc["compare"]["total"]:+d} |'
            )
            lines.append(
                f'| 负面率 | {vc["compare"]["negative_rate"]:.1%} | '
                f'{vc["current"]["negative_rate"]:.1%} | '
                f'{vc["negative_rate_change"]:+.1%} |'
            )
            lines.append(
                f'| 平均评分 | {vc["compare"]["avg_rating"]:.2f} | '
                f'{vc["current"]["avg_rating"]:.2f} | '
                f'{vc["avg_rating_change"]:+.2f} |'
            )
            lines.append(
                f'| 愤怒评论 | {vc["compare"]["angry_count"]} | '
                f'{vc["current"]["angry_count"]} | '
                f'{vc["current"]["angry_count"] - vc["compare"]["angry_count"]:+d} |'
            )
            lines.append('')
            lines.append(f'**趋势判断**: {vc["trend"]}')
            lines.append('')

        lines.append('---')
        lines.append('*本报告由应用市场评论分析脚本自动生成*')
        lines.append('')

        return '\n'.join(lines)

    def to_json(self):
        """生成 JSON 格式报告"""
        if not self.results:
            self.run()
        return json.dumps(self.results, ensure_ascii=False, indent=2)


# ================================================================
# CLI 入口
# ================================================================

def load_reviews(input_path):
    """从 JSON 文件加载评论数据"""
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 兼容多种 JSON 结构
        if isinstance(data, dict):
            if 'reviews' in data:
                data = data['reviews']
            elif 'data' in data:
                data = data['data']
            elif 'list' in data:
                data = data['list']
            else:
                data = [data]

        if not isinstance(data, list):
            raise ValueError('评论数据应为 JSON 数组格式')

        return data
    except FileNotFoundError:
        print(f'错误: 文件不存在: {input_path}', file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f'错误: JSON 解析失败: {e}', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'错误: 加载评论数据失败: {e}', file=sys.stderr)
        sys.exit(1)


def main():
    """CLI 入口函数"""
    parser = argparse.ArgumentParser(
        description='应用市场评论分析工具 -- 情感分析、问题聚类、版本对比、预警',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 分析最近 7 天评论，输出 Markdown 报告
  python %(prog)s --input reviews.json --output report.md

  # 分析指定版本，输出 JSON
  python %(prog)s --input reviews.json --version 3.2.0 --json

  # 版本对比分析
  python %(prog)s --input reviews.json --version 3.2.0 --compare-version 3.1.0

  # 分析最近 30 天
  python %(prog)s --input reviews.json --days 30 --output report.md
        """,
    )
    parser.add_argument(
        '--input', '-i',
        required=True,
        help='输入 JSON 文件路径 (评论数据)',
    )
    parser.add_argument(
        '--days', '-d',
        type=int,
        default=7,
        help='分析最近 N 天的评论 (默认: 7)',
    )
    parser.add_argument(
        '--output', '-o',
        default=None,
        help='输出文件路径 (不指定则输出到 stdout)',
    )
    parser.add_argument(
        '--version', '-v',
        default=None,
        help='指定分析的版本号 (可选)',
    )
    parser.add_argument(
        '--compare-version', '-c',
        default=None,
        help='对比版本号 (可选，需配合 --version 使用)',
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='输出 JSON 格式 (默认输出 Markdown)',
    )

    args = parser.parse_args()

    # 参数校验
    if args.compare_version and not args.version:
        print('错误: 使用 --compare-version 时需要同时指定 --version', file=sys.stderr)
        sys.exit(1)

    if args.days <= 0:
        print('错误: --days 必须大于 0', file=sys.stderr)
        sys.exit(1)

    # 加载数据
    reviews = load_reviews(args.input)

    if not reviews:
        print('警告: 没有评论数据可分析', file=sys.stderr)
        sys.exit(0)

    # 创建分析器并运行
    analyzer = AppReviewAnalyzer(
        reviews=reviews,
        days=args.days,
        version=args.version,
        compare_version=args.compare_version,
    )

    # 生成报告
    if args.json:
        report = analyzer.to_json()
    else:
        report = analyzer.to_markdown()

    # 输出
    if args.output:
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(report)
            print(f'报告已生成: {args.output}', file=sys.stderr)
        except IOError as e:
            print(f'错误: 写入输出文件失败: {e}', file=sys.stderr)
            sys.exit(1)
    else:
        print(report)


if __name__ == '__main__':
    main()
