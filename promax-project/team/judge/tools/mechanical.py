#!/usr/bin/env python3
"""Input-derived mechanical checks K1--K10 (semantic confirmation stays with Judge)."""
import difflib
from decimal import Decimal
import hashlib
import html
import re
from pathlib import Path

from source_checks import ID_RE, ids, prefix

NUMBER = re.compile(r'(?<![A-Za-z\d_.])\d+(?:\.\d+)?(?![\d.])')
NOISE = re.compile(r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:\s*(?:至|—|~)\s*\d{1,2}[-/]\d{1,2})?|'
                   r'(?:^|(?<=\s))v\d+(?:\.\d+)*|\d{4}\s*年|#[0-9a-fA-F]{3,8}\b|'
                   r'^\s*(?:#+\s*)?\d+(?:\.\d+)*[.、\s]|(?:第)?\d+(?:\.\d+)*[章节]|'
                   r'(?:§|条目|步骤|图|表|第)\s*\d+(?:[.、—-]\d+)*(?:\s*[行条点级节])?|'
                   r'(?:见|同|依据)\s*\d+(?:\.\d+)+|'
                   r'\d+\s*[—–~～至到-]\s*\d+\s*星|\d+\s*星|'
                   r'[A-Za-z]+\d*(?:[-_]\d+)+|[A-Za-z]+\d+|^\|\s*\d+\s*(?=\|)')
UNIT = re.compile(r'(?<![A-Za-z\d_.])(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|毫秒|小时|分钟|秒|天|周|个月|个|人|次|条|%)(?![A-Za-z])', re.I)


def visible(text):
    # Preserve physical line numbers for findings. JS/CSS numbers are not prose.
    text = re.sub(r'<(script|style)\b[^>]*>.*?</\1\s*>', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S | re.I)
    return html.unescape(re.sub(r'<[^>]+>', '', text))


def numeric_tokens(text):
    cleaned = NOISE.sub(' ', ID_RE.sub(' ', re.sub(r'[*`]', '', text)))
    return {format(Decimal(x).normalize(), 'f') for x in NUMBER.findall(cleaned)}


def states(text):
    """Named-state enumerations on a '...状态...：a、b' line; no fixed state vocabulary."""
    out = {}
    for no, line in enumerate(visible(text).splitlines(), 1):
        plain = re.sub(r'[*`]', '', line)
        match = re.search(r'([\u4e00-\u9fffA-Za-z]{0,12}状态)(?:[（(][^）)]*[）)])?\s*[:：]\s*(.+)', plain)
        if not match:
            continue
        values = [x.strip(' 。；;“”「」\"\'') for x in re.split(r'[、,，/]', match.group(2))]
        if len(values) >= 2 and all(0 < len(x) <= 12 and not re.search(r'[：:=<>\d|]', x) for x in values):
            out[match.group(1)] = {'values': sorted(set(values)), 'line': no}
    return out


def rule_ids(text):
    """IDs defined in business/rule sections; derived namespaces, not ID prefixes."""
    result = set()
    in_rules = False
    for line in text.splitlines():
        if re.match(r'^#{1,6}\s', line):
            in_rules = bool(re.search(r'业务规则|规则清单|规则定义', line))
        if in_rules:
            match = re.match(r'^\s*(?:[-*]\s+|\|\s*)?\**([A-Za-z]+[-_]\d+)\b', line)
            if match:
                result.add(match.group(1))
    return result


def paragraph_ranges(lines):
    start = None
    out = []
    for i, line in enumerate(lines + [''], 1):
        if not line.strip() or line.startswith('#'):
            if start is not None:
                out.append((start, i - 1))
                start = None
            if line.startswith('#'):
                out.append((i, i))
        elif line.lstrip().startswith('|'):
            if start is not None:
                out.append((start, i - 1))
                start = None
            out.append((i, i))
        elif start is None:
            start = i
    return out


def scope_for(targets, previous):
    if previous and len(previous) != len(targets):
        raise ValueError('--previous 必须与被审文件一一对应、数量相等')
    scope = {}
    for i, target in enumerate(targets):
        now = target.read_text().splitlines()
        if not previous:
            scope[str(target)] = {'mode': 'initial', 'lines': list(range(1, len(now) + 1)), 'changed_lines': [], 'deleted': []}
            continue
        old = previous[i].read_text().splitlines()
        changed, tokens, deleted = set(), set(), []
        for tag, a, b, c, d in difflib.SequenceMatcher(a=old, b=now, autojunk=False).get_opcodes():
            if tag == 'equal':
                continue
            changed.update(range(c + 1, d + 1))
            if c == d and now:
                changed.add(min(c + 1, len(now)))
            for line in old[a:b] + now[c:d]:
                tokens.update(ids(line))
                tokens.update(numeric_tokens(line))
            if b > a:
                deleted.append({'previous_lines': [a + 1, b], 'text': old[a:b], 'current_anchor': min(c + 1, len(now))})
        selected = set(changed)
        for start, end in paragraph_ranges(now):
            text = '\n'.join(now[start - 1:end])
            if selected.intersection(range(start, end + 1)) or tokens.intersection(ids(text) | numeric_tokens(text)):
                selected.update(range(start, end + 1))
        scope[str(target)] = {'mode': 'update', 'previous': str(previous[i]), 'lines': sorted(selected),
                              'changed_lines': sorted(changed), 'dependency_tokens': sorted(tokens), 'deleted': deleted}
    return scope


def check(targets, kind, index, facts=None, original_hashes=None):
    documents = index['documents']
    raw = {str(p): p.read_text() for p in targets}
    source_ids = set().union(*(ids(text) | ids(Path(path).stem) for path, text in documents.items()))
    material_prefixes = {prefix(x) for x in source_ids}
    source_numbers = numeric_tokens(index['corpus'] + ('\n' + facts.read_text() if facts else ''))
    from number_hints import NumberHints
    number_hints = NumberHints(index)
    flags = []

    def flag(code, level, file, no, text, evidence):
        flags.append({'check': code, 'level': level, 'file': file, 'line': no, 'text': text, 'evidence': evidence})

    for file, text in raw.items():
        lines = text.splitlines()
        prose = visible(text).splitlines() if Path(file).suffix.lower() in {'.html', '.htm'} else lines
        section = ''
        for no, line in enumerate(prose, 1):
            if re.match(r'^#{1,6}\s', line):
                section = line
            if re.search(r'已保存|草稿|保存失败|正式版本已存', line):
                flag('K1', 'defect', file, no, lines[no - 1], '成果正文含保存状态字样；团队规则要求由 Lead 按回执说明。')
            if kind != 'user-analysis-report':
                unknown = number_hints.candidates(line, section, numeric_tokens(line) - source_numbers, numeric_tokens)
                if unknown:
                    flag('K2', 'hint', file, no, lines[no - 1], {'numbers_absent_from_sources_and_facts': sorted(unknown)})
            for clause in re.split(r'[。；;\n]', line):
                if re.search(r'(?:已|成功).{0,8}(?:写入|同步|注册|发布|创建).{0,16}(?:飞书|看板|数据库|定时任务|外部系统)|'
                             r'(?:飞书|看板|数据库|定时任务|外部系统).{0,12}(?:已|成功).{0,8}(?:写入|同步|注册|创建)', clause):
                    if not re.search(r'未|没有|不得|不能|不声称|不代表|模拟|假设|示例', clause):
                        flag('K3', 'defect', file, no, lines[no - 1], {'external_completion_claim': clause.strip()})
            unknown_ids = {x for x in ids(line) if prefix(x) in material_prefixes and x not in source_ids}
            if unknown_ids:
                flag('K4', 'defect', file, no, lines[no - 1], {'material_ids_not_found': sorted(unknown_ids), 'sources': list(documents)})
        if kind == 'requirement-management-report':
            csv_ids = {rid for rid, locations in index['records'].items()
                       if any(Path(x['file']).suffix.lower() == '.csv' for x in locations)}
            missing = (csv_ids or set(index['records'])) - ids(text)
            if missing:
                flag('K5', 'hint', file, 1, lines[0] if lines else '', {'record_ids_not_mentioned': sorted(missing)})
        subtype = ('prototype' if Path(file).suffix.lower() in {'.html', '.htm'} else
                   'diagram' if '```mermaid' in text else kind)
        if subtype == 'prototype':
            for no, line in enumerate(lines, 1):
                # Includes relative external resources as well as absolute/network URLs.
                css_urls = re.findall(r'url\(\s*["\']?([^\s\)"\']+)', line, re.I)
                css_imports = re.findall(r'@import\s+["\']([^"\']+)["\']', line, re.I)
                external_css = any(not value.lower().startswith(('data:', '#')) for value in css_urls + css_imports)
                if external_css or re.search(r'https?://|(?:["\'(=]|^)//[^\s/]|<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=\s*["\'](?!#|data:)[^"\']+', line, re.I):
                    flag('K7', 'defect', file, no, line, '单文件原型包含 URL 或外链运行时资源。')
        if kind == 'requirement-review-report':
            from source_checks import QUOTE_RE, reviewed_documents
            reviewed = reviewed_documents(index)
            reviewed_corpus = '\n'.join(reviewed.values())
            in_evidence = False
            for no, line in enumerate(lines, 1):
                # Only explicit source-evidence fields, not reasoning or proposed rewrites.
                plain = re.sub(r'[*`]', '', line)
                explicit = re.match(r'^\s*(?:-\s*)?(?:依据|原文(?:引用)?(?:（逐字）)?|引用原句|位置)[:：]', plain)
                if explicit:
                    in_evidence = True
                elif re.match(r'^\s*(?:-\s*)?(?:判断依据|影响|可执行建议|建议|修改建议)[:：]|^#', plain) or not line.strip():
                    in_evidence = False
                if not in_evidence:
                    continue
                for match in QUOTE_RE.finditer(line):
                    if reviewed and match.group(1) not in index['corpus']:
                        flag('K8', 'defect', file, no, line, {'quoted_text_not_in_reviewed_source': match.group(1)})
                for position in re.findall(r'\bL(\d+)\b', line):
                    if reviewed and not any(1 <= int(position) <= len(s.splitlines()) for s in reviewed.values()):
                        flag('K8', 'defect', file, no, line, {'line_position_not_in_source': position})
                for position, quote in re.findall(r'\bL(\d+)\s*[「“\"]([^」”\"\n]+)[」”\"]', line):
                    if reviewed and not any(1 <= int(position) <= len(s.splitlines()) and quote in s.splitlines()[int(position) - 1] for s in reviewed.values()):
                        flag('K8', 'defect', file, no, line, {'quote_not_at_claimed_line': position, 'quote': quote})
                if '位置' in line:
                    absent = {x for x in ids(line) if prefix(x) in material_prefixes and x not in source_ids}
                    if absent:
                        flag('K8', 'defect', file, no, line, {'position_ids_not_in_source': sorted(absent)})
            for source, digest in (original_hashes or {}).items():
                current = hashlib.sha256(Path(source).read_bytes()).hexdigest() if Path(source).is_file() else None
                if digest != current:
                    flag('K8', 'defect', file, 1, lines[0] if lines else '', {'source_modified': source, 'original_sha256': digest, 'current_sha256': current})

    if kind == 'prd':
        # Compare source-defined rules only. Locally introduced acceptance IDs are not missing sources.
        required_rules = set().union(*(rule_ids(s) for s in documents.values()))
        if not required_rules and len(targets) > 1:
            required_rules = rule_ids(raw[str(targets[0])])
        namespaces = {prefix(x) for x in required_rules}
        required_states = {}
        for source, text in documents.items():
            required_states.update({k: {**v, 'source': source} for k, v in states(text).items()})
        if not required_states and len(targets) > 1:
            required_states = {k: {**v, 'source': str(targets[0])} for k, v in states(raw[str(targets[0])]).items()}
        # Units in normative source rule lines / status lists, not arbitrary mock/example values.
        required_units = set()
        for source_text in documents.values():
            for line in source_text.splitlines():
                if ids(line).intersection(required_rules) or re.match(r'^\s*-', line) and re.search(r'上限|最多|保留', line):
                    required_units.update((n, u.lower()) for n, u in UNIT.findall(line))
        for file, text in raw.items():
            lines = text.splitlines()
            observed = {x for x in ids(text) if prefix(x) in namespaces}
            if required_rules and observed != required_rules:
                flag('K6', 'defect', file, 1, lines[0] if lines else '', {'dimension': 'rule_ids', 'missing': sorted(required_rules - observed), 'extra': sorted(observed - required_rules)})
            actual_states = states(text)
            for group, spec in required_states.items():
                wanted = set(spec['values'])
                # When HTML has badges instead of a declaration list, check literal state tokens.
                present = (set(actual_states[group]['values']) if group in actual_states else
                           {s for s in wanted if re.search(r'(?<![\u4e00-\u9fff])' + re.escape(s) + r'(?![\u4e00-\u9fff])', visible(text))})
                if present != wanted:
                    no = actual_states.get(group, {}).get('line', 1)
                    flag('K6', 'defect', file, no, lines[no - 1] if lines else '', {'dimension': 'states', 'group': group, 'source': spec['source'], 'missing': sorted(wanted - present), 'extra': sorted(present - wanted)})
            actual_units = {(n, u.lower()) for n, u in UNIT.findall(visible(text))}
            missing_units = required_units - actual_units
            if missing_units:
                flag('K6', 'defect', file, 1, lines[0] if lines else '', {'dimension': 'unit_values', 'missing': sorted(missing_units), 'observed': sorted(actual_units)})
            # Compare values on lines citing a source rule; numerical examples remain Judge hints K2.
            section = ''
            for no, line in enumerate(lines, 1):
                if re.match(r'^#{1,6}\s', line):
                    section = line
                line_rules = ids(line).intersection(required_rules)
                if not line_rules or re.search(r'假设|示例|模拟|用例|验收|场景', line + ' ' + section):
                    continue
                allowed_units = set()
                for source_text in documents.values():
                    for src_line in source_text.splitlines():
                        if ids(src_line).intersection(line_rules):
                            allowed_units.update((n, u.lower()) for n, u in UNIT.findall(src_line))
                extra = {(n, u.lower()) for n, u in UNIT.findall(visible(line))} - allowed_units
                if allowed_units and extra:
                    flag('K6', 'defect', file, no, line, {'dimension': 'rule_unit_values', 'rules': sorted(line_rules), 'extra': sorted(extra), 'source_values': sorted(allowed_units)})

    # Upstream artifacts are recognized by their content (priority/traceability), never a filename convention.
    upstream = {p: t for p, t in documents.items()
                if re.search(r'^#\s+[^\n]*(?:优先级|痛点|PRD|需求整理)', t, re.M)}
    for file, text in raw.items():
        if not upstream:
            continue
        for no, line in enumerate(text.splitlines(), 1):
            for reference in re.findall(r'(?:附件|交付)/[^\s`，；、）)\"<>]+\.(?:md|html|csv|json)', line):
                if not Path(reference).is_file() and not any(Path(p).name == Path(reference).name for p in documents):
                    flag('K9', 'hint', file, no, line, {'upstream_file_not_found': reference})
            if re.search(r'上游|来源|痛点|依赖', line):
                absent = {x for x in ids(line) if prefix(x) in material_prefixes and x not in source_ids}
                if absent:
                    flag('K9', 'hint', file, no, line, {'upstream_ids_not_found': sorted(absent)})
        if kind != 'prd':
            continue
        for source, upstream_text in upstream.items():
            top = set()
            for line in upstream_text.splitlines():
                if re.search(r'优先级最高|第一优先|优先级\s*1(?!\d)|^\|\s*1\s*\|', line):
                    top.update(ids(line))
            for no, line in enumerate(text.splitlines(), 1):
                if re.search(r'需求编号[:：]', line) and top:
                    selected = ids(line)
                    comparable = {x for x in selected if prefix(x) in {prefix(y) for y in top}}
                    if comparable and not comparable.issubset(top):
                        flag('K9', 'hint', file, no, line, {'priority_source': source, 'top_ids': sorted(top), 'selected_ids': sorted(comparable)})
    return flags
