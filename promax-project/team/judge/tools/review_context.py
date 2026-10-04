#!/usr/bin/env python3
"""Bounded, located review context. Selection is evidence, never a verdict."""
import hashlib
import json
from pathlib import Path
import re

from source_checks import ID_RE, QUOTE_RE, ids


def checklist_for(kind):
    # Small YAML reader for the deliberately restricted rubric structure. Fail closed
    # rather than invent a checklist if that structure changes; no extra dependency.
    path = Path(__file__).resolve().parents[1] / 'rubrics.yml'
    domains, current, rule = {}, None, None
    for line in path.read_text().splitlines():
        domain = re.fullmatch(r'  ([a-z-]+):', line)
        if domain:
            current = domain.group(1)
            domains[current] = []
        if current is None:
            continue
        match = re.fullmatch(r'      - rule_id: (.+)', line)
        if match:
            rule = {'rule_id': match.group(1)}
            domains[current].append(rule)
        field = re.fullmatch(r'        (by|check|program_check): (.+)', line)
        if field and rule is not None:
            rule[field.group(1)] = field.group(2)
    kinds = ['prd', 'diagram', 'prototype'] if kind == 'prd' else [kind]
    result = {}
    for name in kinds:
        rules = domains.get(name, [])
        if not rules or any('by' not in r or 'check' not in r for r in rules):
            raise ValueError('rubrics 清单结构无法解析：' + name)
        result[name] = [r for r in rules if r['by'] == 'judge']
    return result


def snapshot_targets(targets, directory, rnd):
    names = [p.name for p in targets]
    if len(names) != len(set(names)):
        raise ValueError('同组被审文件的原文件名必须不同，避免快照覆盖')
    folder = directory / f'被审-r{rnd}'
    folder.mkdir(parents=True, exist_ok=True)
    result = []
    for target in targets:
        data = target.read_bytes()
        dest = folder / target.name
        dest.write_bytes(data)
        result.append({'file': str(target), 'snapshot': str(dest), 'sha256': hashlib.sha256(data).hexdigest()})
    return result


class Excerpts:
    def __init__(self, targets, index, limit=400):
        self.index = index
        self.lines = {p: t.splitlines() for p, t in index['documents'].items()}
        self.lines.update({str(p): p.read_text().splitlines() for p in targets})
        self.limit = limit
        self.source_ids = set().union(*(ids(t) for t in index['documents'].values()))
        # (file,line) -> best priority and insertion sequence. Dedup BEFORE the cap.
        self.wanted = {}
        self.reasons = {}

    def add(self, file, line, radius, priority, reason):
        file = str(file)
        lines = self.lines.get(file, [])
        for no in range(max(1, int(line) - radius), min(len(lines), int(line) + radius) + 1):
            key = (file, no)
            previous = self.wanted.get(key)
            if previous is None:
                self.wanted[key] = (priority, len(self.wanted))
            elif priority < previous[0]:
                self.wanted[key] = (priority, previous[1])
            self.reasons.setdefault(key, set()).add(reason)

    def source_hits(self, text, priority, reason, labels=(), quote=None):
        labels = set(labels) | ids(text)
        labels |= {label for label in self.index['labels'] if label in text and not ID_RE.fullmatch(label)}
        candidates = {}
        for label in sorted(labels):
            for rec in self.index['labels'].get(label, []):
                candidates.setdefault(rec['file'], []).append((label, rec))
        # Exact quotes without a source tag can also be located, without changing
        # checkable coverage or the original check_quotes result.
        quotes = ([quote] if quote else []) + QUOTE_RE.findall(text)
        for file, lines in self.lines.items():
            if file not in self.index['documents']:
                continue
            hit = {n for n, line in enumerate(lines, 1) if ids(line).intersection(labels)}
            for q in quotes:
                escaped = json.dumps(q, ensure_ascii=False)[1:-1]
                hit.update(n for n, line in enumerate(lines, 1) if q in line or escaped in line)
            for label, rec in candidates.get(file, []):
                # For CSV rows, use the parser's actual row; for JSON IDs (whose
                # legacy index location is 1), locate the serialized ID physically.
                if Path(file).suffix.lower() == '.csv':
                    hit.add(rec['line'])
                else:
                    exact = [n for n, line in enumerate(lines, 1) if label in ids(line)]
                    hit.update(exact)
                    if not exact and not hit:
                        # A document alias denotes a whole document, not every line.
                        # Prefer shared literal phrases; fall back to its title.
                        terms = set(re.findall(r'[\u4e00-\u9fff]{4,}', ID_RE.sub('', text)))
                        ranked = [(sum(term in line for term in terms), n) for n, line in enumerate(lines, 1)]
                        best = max((score for score, _ in ranked), default=0)
                        if best:
                            hit.update(n for score, n in ranked if score == best)
                        else:
                            hit.add(next((n for n, line in enumerate(lines, 1) if line.startswith('# ')), 1))
            for no in sorted(hit):
                self.add(file, no, 2, priority, reason)

    def finish(self):
        selected = sorted(self.wanted, key=lambda k: (*self.wanted[k], k))[:self.limit]
        blocks = []
        # Coalesce overlapping/adjacent lines after priority-based truncation.
        for file, no in sorted(selected):
            if not blocks or blocks[-1]['file'] != file or blocks[-1]['end_line'] + 1 != no:
                blocks.append({'file': file, 'start_line': no, 'end_line': no, 'lines': [], 'reasons': []})
            block = blocks[-1]
            block['end_line'] = no
            block['lines'].append({'line': no, 'text': self.lines[file][no - 1]})
            block['reasons'] = sorted(set(block['reasons']) | self.reasons[(file, no)])
        meta = {'limit': self.limit, 'requested_lines': len(self.wanted), 'included_lines': len(selected),
                'truncated_lines': len(self.wanted) - len(selected),
                'priority': ['flags', 'quotes', 'scope/references/numbers'],
                'note': '只选可定位命中；片段不是全部材料，截断不代表其余内容已核对。'}
        return blocks, meta


def excerpts_for(targets, index, flags, files, scope, previous, facts=None):
    if facts:
        # Enrich context only; do not change the source index used by mechanical
        # checks or quotations. Facts are program output, not original records.
        index = {**index, 'documents': {**index['documents'], str(facts): Path(facts).read_text()}}
    builder = Excerpts(targets, index)
    for flag in flags:
        if previous and not flag['in_scope']:
            continue
        builder.add(flag['file'], flag['line'], 3, 0, flag['check'])
        builder.source_hits(flag['text'] + '\n' + json.dumps(flag['evidence'], ensure_ascii=False), 0, flag['check'])
    for file in files:
        key = file['file']
        allowed = set(scope[key]['lines'])
        for item in file['quote_check']['items']:
            if previous and item['line'] not in allowed:
                continue
            builder.add(key, item['line'], 3, 1, 'quote:' + item['status'])
            builder.source_hits(item['quote'], 1, 'quote:' + item['status'], item['ids'], item['quote'])
            for source in item.get('sources', []):
                # Do not copy legacy JSON line=1 estimates; source_hits locates IDs
                # and text in the original physical file instead.
                if Path(source['file']).suffix.lower() != '.json':
                    builder.add(source['file'], source['line'], 2, 1, 'quote:' + item['status'])
        for no, line in enumerate(builder.lines[key], 1):
            if previous and no not in allowed:
                continue
            if previous:
                builder.add(key, no, 0, 2, 'scope')
            labels = list(ids(line).intersection(builder.source_ids)) + [label for label in index['labels'] if
                      (label in ids(line) if ID_RE.fullmatch(label) else label in line)]
            if labels:
                builder.source_hits(line, 2, 'reference', labels)
        for group in ('mismatches', 'unknown_refs', 'untagged'):
            for item in (file.get('number_check') or {}).get(group, []):
                if not previous or item['line'] in allowed:
                    builder.add(key, item['line'], 3, 2, 'number:' + group)
                    builder.source_hits(builder.lines[key][item['line'] - 1], 2, 'number:' + group)
        if facts and (file.get('number_check') or {}).get('untagged'):
            # Untagged numbers cannot select a single fact ID. Include bounded
            # facts output as fallback, never the original full records array.
            for no in range(1, len(builder.lines[str(facts)]) + 1):
                builder.add(str(facts), no, 0, 2, 'untagged:facts')
    return builder.finish()
