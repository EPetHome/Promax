#!/usr/bin/env python3
"""Typed source indexing and exact quotations. No scenario-specific vocabulary."""
import csv
import io
import json
import re
from pathlib import Path

ID_PATTERN = r'(?<![A-Za-z0-9_])([A-Za-z]+(?:[-_]\d+|\d{2,}))(?![A-Za-z0-9_])'
ID_RE = re.compile(ID_PATTERN)
QUOTE_RE = re.compile(r'[“"「『]([^”"」』\n]{1,400})[”"」』]')
NO_COVERAGE = {'prd', 'diagram', 'prototype'}
KINDS = ('prd', 'diagram', 'prototype', 'customer-research-report', 'product-discovery-report',
         'user-analysis-report', 'requirement-management-report', 'requirement-review-report')


def ids(text):
    return set(ID_RE.findall(text))


def prefix(identifier):
    return re.sub(r'\d+$', '', identifier)


def csv_records(text):
    rows = list(csv.reader(io.StringIO(text.lstrip('\ufeff'))))
    for index, row in enumerate(rows):
        columns = [i for i, cell in enumerate(row) if cell.strip().endswith('编号') or cell.strip().lower().endswith('id')]
        if len(row) > 1 and columns:
            return [(index + offset + 2, rec, [rec[i].strip() for i in columns if i < len(rec) and rec[i].strip()])
                    for offset, rec in enumerate(rows[index + 1:]) if rec]
    return []


def index_sources(paths):
    corpus, by_label, records, documents = [], {}, {}, {}

    def add(label, blob, path, line):
        by_label.setdefault(label, []).append({'text': blob, 'file': str(path), 'line': line})

    for path in map(Path, paths):
        text = path.read_text(encoding='utf-8-sig')
        documents[str(path)] = text
        corpus.append(text)
        stem = path.stem
        add(stem, text, path, 1)
        add(path.name, text, path, 1)
        # Generic document category prefixes; never derive aliases from report claims.
        main = re.sub(r'^(?:v\d+[-_])?(?:竞品|访谈|资料|材料|报告)[-_]', '', stem)
        if main != stem:
            add(main, text, path, 1)
            add(main + path.suffix, text, path, 1)
        for label in ids(stem):
            add(label, text, path, 1)
        if path.suffix.lower() == '.csv':
            for no, values, labels in csv_records(text):
                blob = ' '.join(values)
                corpus.append(blob)
                for label in labels:
                    add(label, blob, path, no)
                    records.setdefault(label, []).append({'file': str(path), 'line': no, 'text': blob})
        if path.suffix.lower() == '.json':
            try:
                value = json.loads(text)
            except ValueError:
                continue
            for rec in value if isinstance(value, list) else []:
                if not isinstance(rec, dict):
                    continue
                blob = ' '.join(str(v) for v in rec.values() if isinstance(v, str))
                corpus.append(blob)
                for key, label in rec.items():
                    if key.lower().endswith('id') and isinstance(label, str):
                        add(label, blob, path, 1)
                        records.setdefault(label, []).append({'file': str(path), 'line': 1, 'text': blob})
    return {'corpus': '\n'.join(corpus), 'labels': by_label, 'records': records, 'documents': documents}


def leading_labels(tail, labels):
    bracket = re.match(r'\s*[（(]([^）)\n]*)[）)]', tail)
    if not bracket:
        return []
    tokens = re.split(r'[\s、，,；;]+', bracket.group(1).strip())
    found = []
    for token in tokens:
        if token not in labels:
            break
        found.append(token)
    return found


def reviewed_documents(index):
    docs = index['documents']
    return {p: t for p, t in docs.items() if Path(p).suffix.lower() in {'.md', '.txt', '.html'}
            and (re.search(r'^#.*(?:PRD|需求说明|功能说明)', t, re.M)
                 or sum(bool(re.search(r'^#.*' + heading, t, re.M))
                        for heading in ('功能需求', '业务规则', '验收标准')) >= 2)}


def check_quotes(path, sources, kind, index=None):
    index = index or index_sources(sources)
    review_corpus = '\n'.join(reviewed_documents(index).values())
    result = {'checked': 0, 'ids_available': bool(index['records']),
              'citations': {'checked': 0, 'ok': 0, 'missing': [], 'mismatched': []},
              'unnumbered': {'checked': 0, 'found': 0, 'hints': []}, 'items': []}
    if kind in NO_COVERAGE:
        result['coverage'] = {'kind': kind, 'applicable': False, 'quoted': 0, 'checkable': None,
                              'reason': '界面文案不按引文覆盖，不执行引文核对'}
        return result
    found_count = 0
    for no, line in enumerate(Path(path).read_text().splitlines(), 1):
        for match in QUOTE_RE.finditer(line):
            quote = match.group(1)
            labels = leading_labels(line[match.end():], index['labels'])
            found = quote in index['corpus']
            found_count += int(quote in review_corpus) if kind == 'requirement-review-report' else int(found)
            result['checked'] += 1
            item = {'file': str(path), 'line': no, 'quote': quote, 'ids': labels, 'id': labels[0] if labels else ''}
            if labels:
                result['citations']['checked'] += 1
                status = ('missing' if not found else 'ok' if any(quote in rec['text'] for label in labels
                          for rec in index['labels'][label]) else 'mismatched')
                if status == 'ok':
                    result['citations']['ok'] += 1
                else:
                    result['citations'][status].append(dict(item))
                item['sources'] = [rec for label in labels for rec in index['labels'][label]
                                   if quote in rec['text']]
                # Return located excerpts, not whole source documents.
                item['sources'] = [{'file': rec['file'], 'line': rec['line'] + rec['text'][:rec['text'].find(quote)].count('\n'),
                                    'text': quote} for rec in item['sources']]
            else:
                result['unnumbered']['checked'] += 1
                status = 'found' if found else 'hint'
                if found:
                    result['unnumbered']['found'] += 1
                else:
                    result['unnumbered']['hints'].append({'line': no, 'quote': quote})
            item['status'] = status
            result['items'].append(item)
    covered = found_count if kind == 'requirement-review-report' else result['citations']['checked']
    result['coverage'] = {'kind': kind, 'applicable': kind not in NO_COVERAGE,
                          'quoted': result['checked'], 'checkable': covered if kind not in NO_COVERAGE else None,
                          'reason': ('界面文案不按引文覆盖' if kind in NO_COVERAGE else
                                     ('被评审材料中逐字找到的引文' if review_corpus else '未识别到被评审 PRD/功能说明材料')
                                     if kind == 'requirement-review-report' else '括号首词命中材料来源标签的引文')}
    return result
