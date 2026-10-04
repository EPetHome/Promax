#!/usr/bin/env python3
"""Conservative K2 candidate filter. No verdicts or changes to shared number parsing."""
from collections import Counter
from decimal import Decimal
import json
import re
from pathlib import Path

# Units and statistical prose, not every digit in an identifier/section/example.
QUANTITY = re.compile(r'(?<![A-Za-z\d_.])(\d+(?:\.\d+)?)\s*(?:%|％|KB|MB|GB|TB|毫秒|小时|分钟|秒|天|周|个月|月|年|元|人|次|条|份|项|种|类|个|分)(?![A-Za-z])', re.I)
MONEY = re.compile(r'[¥￥$]\s*(\d+(?:\.\d+)?)')
STAT = re.compile(r'计数|数量|样本量|总数|合计|总计|占比|比例|频次|频率|均值|平均|评分|得分|扣分|加权|总分|均分')
EXAMPLE = re.compile(r'示例|举例|例如|模拟|用例|\bmock\b|假设(?:场景|输入|数值|为|[:：])', re.I)
SCORE = re.compile(r'评分|得分|扣分|加权|总分|均分|\d+(?:\.\d+)?\s*/\s*\d+')


def normal(value):
    return format(Decimal(value).normalize(), 'f')


class NumberHints:
    def __init__(self, index):
        from source_checks import csv_records
        self.document_count = len(index['documents'])
        self.categories = []
        self.text_counts = set()
        self.distinct_text_counts = set()
        self.row_counts = set()
        for name, text in index['documents'].items():
            if Path(name).suffix.lower() == '.csv':
                rows = [row for _, row, _ in csv_records(text)]
                if rows:
                    self.row_counts.add(str(len(rows)))
                    for col in zip(*rows):
                        self.categories.extend((value, str(n)) for value, n in Counter(col).items() if n > 1)
            elif Path(name).suffix.lower() == '.json':
                try:
                    value = json.loads(text)
                except ValueError:
                    continue
                if not isinstance(value, list) or not all(isinstance(x, dict) for x in value):
                    continue
                self.row_counts.add(str(len(value)))
                for key in set().union(*(x.keys() for x in value)):
                    # Repeated prose only; never treat IDs, dates or numerical ratings as text frequencies.
                    strings = [x[key] for x in value if isinstance(x.get(key), str) and len(x[key]) >= 8
                               and re.search(r'[\u4e00-\u9fff]', x[key])]
                    if not strings:
                        continue
                    counts = Counter(strings)
                    self.text_counts.update(str(n) for n in counts.values())
                    self.distinct_text_counts.add(str(len(counts)))

    def candidates(self, line, section, unknown, numeric_tokens):
        plain = re.sub(r'[*`]', '', line)
        # Only explicit hypothetical/example contexts are suppressed. Questions and
        # '待验证' alone are NOT exemptions: factual claims there can still be wrong.
        if EXAMPLE.search(plain) or EXAMPLE.search(section) or re.search(r'验收标准|验收场景|用户场景|使用场景', section):
            return set()
        units = {normal(x) for x in QUANTITY.findall(plain) + MONEY.findall(plain)}
        relevant = units | (numeric_tokens(plain) if STAT.search(plain) or SCORE.search(plain) else set())
        relevant &= unknown
        if not SCORE.search(plain) and re.search(r'百分比|进度|百分之百', plain):
            # Scale endpoints and multiplication by 100 are conventions, not
            # observed data. Do not apply this exemption to scoring fractions.
            for value in ('0', '100'):
                if re.search(r'(?<!\d)' + value + r'\s*[%％]|0\s*[—–~-]\s*100|进度为\s*0(?!\d)', plain):
                    relevant.discard(value)
        # Counts directly attributable to input structure; not arbitrary arithmetic
        # closure over source values (which could excuse virtually any fabricated count).
        if re.search(r'材料|访谈|文件', plain):
            for n in re.findall(r'(\d+)\s*份(?:材料|访谈|文件)', plain):
                if int(n) == self.document_count:
                    relevant.discard(normal(n))
        for value, n in self.categories:
            if re.search(re.escape(value) + r'\s*(?:的\s*)?' + re.escape(n) + r'(?!\d)', plain):
                relevant.discard(n)
        if re.search(r'记录|需求', plain):
            for n in self.row_counts:
                if re.search(r'(?<!\d)' + re.escape(n) + r'\s*条', plain):
                    relevant.discard(n)
        if re.search(r'文本|原文', plain):
            for n in self.distinct_text_counts:
                if re.search(r'(?<!\d)' + re.escape(n) + r'\s*种', plain):
                    relevant.discard(n)
        if re.search(r'评分|文本|原文|星|采录|频次', plain):
            relevant -= self.text_counts
        # A similarity coefficient without a unit is not a measured population count.
        # Score tables remain candidates even if an internally consistent formula is
        # shown: that formula may have an unsupported base or deduction.
        return relevant
