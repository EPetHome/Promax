#!/usr/bin/env python3
"""Group paths, source snapshots and typed precheck. Legacy CLI stays separate."""
import argparse
import datetime
import hashlib
import json
import re
import subprocess
from pathlib import Path

from mechanical import check, scope_for
from review_context import checklist_for, excerpts_for, snapshot_targets
from source_checks import KINDS, check_quotes, index_sources


def group_dir(targets):
    return Path('交付/检查') / Path(artifact_name(targets[0])).stem


def artifact_name(path):
    """正式版本与工作文件属于同一成果；其他位置不剥版本前缀。"""
    path = Path(path)
    try:
        path.resolve().relative_to(Path('交付/版本').resolve())
    except ValueError:
        return path.name
    return re.sub(r'^v\d+-', '', path.name)


def validate_previous(previous, targets):
    names = {artifact_name(p) for p in targets}
    for path in previous:
        try:
            path.resolve().relative_to(Path('交付/版本').resolve())
        except ValueError:
            return False
        match = re.fullmatch(r'v\d+-(.+)', path.name)
        if not path.is_file() or not match or match[1] not in names:
            return False
    return True


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


FLOW = Path('交付/检查流水.jsonl')


def flow_rows():
    if not FLOW.exists():
        return []
    return [json.loads(line) for line in FLOW.read_text(encoding='utf-8').splitlines() if line.strip()]


def previous_key(previous):
    return sorted(str(Path(p).resolve()) for p in (previous or []))


def since_save_rows(rows, group):
    """同组上次成功保存后的流水；待提交轮身份不随 previous 改变。"""
    local = [r for r in rows if r.get('group') == group]
    boundary = next((i for i in range(len(local) - 1, -1, -1)
                     if local[i].get('event') == 'save' and local[i].get('status') == 'saved'), -1)
    return local[boundary + 1:]


def cycle_rows(rows, group, previous):
    """按组、previous 和成功保存边界分周期，其他组的事件不影响本组。"""
    return [r for r in since_save_rows(rows, group) if r.get('previous_key', []) == previous_key(previous)]


def flow_counts(rows, group, previous):
    cycle = cycle_rows(rows, group, previous)
    rounds = [r for r in cycle if r.get('event') == 'precheck']
    pending_rounds = {r.get('round') for r in cycle if r.get('event') in {'precheck', 'submit'}}
    # 同一待提交轮即使覆盖预检/切换 previous，其拒收仍属于这个草稿身份。
    rejected = [r for r in since_save_rows(rows, group) if r.get('event') == 'submit'
                and r.get('accepted') is False and r.get('round') in pending_rounds]
    return {'business_revisions': max(0, len(rounds) - 1), 'draft_rejections': len(rejected)}


def append_flow(group, rnd, event, verdict=None, previous=None, hashes=None, **extra):
    row = {'group': group, 'round': rnd, 'event': event, 'verdict': verdict,
           'previous': list(previous or []), 'previous_key': previous_key(previous),
           'files_sha256': hashes or {}, 'at': datetime.datetime.now().isoformat(timespec='seconds'),
           'ledger_exists': bool(group and (Path('交付/检查') / group / 'ledger.json').is_file()), **extra}
    FLOW.parent.mkdir(parents=True, exist_ok=True)
    with FLOW.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    return row


def same_artifact(left, right):
    return (Path(left).resolve() == Path(right).resolve()
            or (artifact_name(left) == artifact_name(right)
                and (artifact_name(left) != Path(left).name or artifact_name(right) != Path(right).name)))


def flow_for_file(src):
    return next((r for r in reversed(flow_rows()) if r.get('event') == 'precheck'
                 and any(same_artifact(src, p) for p in r.get('targets', []))), {})


def accepted_check(src):
    """按被审路径找最后接受轮；正式版本别名可接回同一检查组。"""
    candidates = []
    for path in Path('交付/检查').glob('*/ledger.json'):
        try:
            ledger = json.loads(path.read_text(encoding='utf-8'))
            if not ledger.get('rounds'):
                continue
            last = ledger['rounds'][-1]
            for target in last.get('files_sha256', {}):
                if same_artifact(target, src):
                    candidates.append((last.get('at', ''), path, ledger, last))
                    break
        except (OSError, ValueError, KeyError, TypeError):
            continue
    if not candidates:
        return None
    _, path, ledger, last = max(candidates, key=lambda x: (x[0], x[1].as_posix()))
    return path.parent, ledger, last


def save_check(src, digest):
    found = accepted_check(src)
    if not found:
        return None
    directory, ledger, last = found
    pending = flow_for_file(src)
    previous = pending.get('previous', last.get('previous', []))
    rows = flow_rows()
    current = cycle_rows(rows, directory.name, previous)
    if current:
        counts = flow_counts(rows, directory.name, previous)
    else:
        saved = next((r for r in reversed(rows) if r.get('group') == directory.name
                      and r.get('event') == 'save' and r.get('status') == 'saved'
                      and r.get('round') == last['round']), last)
        counts = {key: saved.get(key, last.get(key, 0)) for key in ('business_revisions', 'draft_rejections')}
    expected = next((value for path, value in last['files_sha256'].items() if same_artifact(path, src)), None)
    return {'group': directory.name, 'round': last['round'], 'verdict': last['verdict'],
            'blocking': [iid for iid, issue in ledger['issues'].items()
                         if issue['status'] not in {'fixed', 'withdrawn'} and issue['kind'] != 'suggestion'
                         and issue['severity'] in {'high', 'medium'}],
            **counts, 'sha_matches': expected == digest}


def original_sources(paths):
    """Use tracked input bytes when available; otherwise expose the weaker snapshot basis."""
    hashes, basis = {}, {}
    cwd = Path.cwd().resolve()
    for path in paths:
        key = str(path)
        hashes[key] = sha(path)
        basis[key] = 'first-precheck (原件此前是否修改未知)'
        try:
            relative = path.resolve().relative_to(cwd).as_posix()
        except ValueError:
            continue
        if not (cwd / '.git').is_dir():
            continue
        proc = subprocess.run(['env', '-u', 'DSH_PROFILE', 'git', 'show', 'HEAD:' + relative], capture_output=True)
        if proc.returncode == 0:
            hashes[key] = hashlib.sha256(proc.stdout).hexdigest()
            basis[key] = 'cwd git HEAD tracked input'
    return hashes, basis


def precheck_main(run_tool, quote_issue):
    ap = argparse.ArgumentParser()
    ap.add_argument('target', nargs='+')
    ap.add_argument('--kind', choices=KINDS, required=True)
    ap.add_argument('--facts')
    ap.add_argument('--previous', nargs='+')
    ap.add_argument('--sources', nargs='+', required=True)
    args = ap.parse_args()
    targets = list(map(Path, args.target))
    if len({str(p.resolve()) for p in targets}) != len(targets):
        ap.error('被审文件不得重复')
    previous = list(map(Path, args.previous or []))
    if not validate_previous(previous, targets):
        ap.error('--previous 只能是同一成果的上一正式版本；上游成果请放 --sources')
    directory = group_dir(args.target)
    ledger_path = directory / 'ledger.json'
    rows = flow_rows()
    recorded = [r for r in rows if r.get('group') == directory.name]
    # 首次预检仍不写台账；只有流水证明台账曾存在时，缺失才是删除。
    # 旧流水没有此字段时保守沿用原来的台账存在要求。
    ledger_expected = any(r.get('ledger_exists', True) for r in recorded)
    if recorded and (not directory.is_dir() or (ledger_expected and not ledger_path.is_file())):
        ap.error(f'检查组 {directory.name} 已有记录，不得删除重建')
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'rounds': [], 'issues': {}}
    rnd = len(ledger['rounds']) + 1
    cycle = cycle_rows(rows, directory.name, args.previous)
    rounds = [r for r in cycle if r.get('event') == 'precheck']
    if len(rounds) >= 2:
        ap.error('本版已返修 1 轮：带未关闭问题保存，交付说明列出未关闭问题')
    scope = scope_for(targets, previous)
    sources = list(map(Path, args.sources))
    index = index_sources(sources)
    original_hashes, original_basis = original_sources(sources)
    # A recorded source snapshot cannot silently reset when checking the same group again.
    if ledger['rounds']:
        for path, digest in ledger['rounds'][0].get('source_sha256', {}).items():
            if path in original_hashes:
                original_hashes[path] = digest
                original_basis[path] = 'first accepted group round'
    flags = check(targets, args.kind, index, Path(args.facts) if args.facts else None, original_hashes)
    files, issues, program_checks = [], [], []
    for target in targets:
        key = str(target)
        subtype = ('prototype' if target.suffix.lower() in {'.html', '.htm'} else
                   'diagram' if '```mermaid' in target.read_text() and args.kind == 'prd' else args.kind)
        quotes = check_quotes(target, sources, subtype, index)
        numbers, exit_code = run_tool('check_numbers.py', [key, args.facts]) if args.facts else (None, None)
        files.append({'file': key, 'kind': subtype, 'sha256': sha(target), 'quote_coverage': quotes['coverage'],
                      'quote_check': quotes, 'number_check': numbers, 'number_check_exit': exit_code})
        if quotes['coverage']['applicable']:
            for status in ('missing', 'mismatched'):
                for item in quotes['citations'][status]:
                    if previous and item['line'] not in scope[key]['lines']:
                        continue
                    issues.append(quote_issue(item, status, f'{key}:{item["line"]}', target.read_text().splitlines()))
            program_checks.append({'tool': 'check_quotes', 'result': 'fail' if quotes['citations']['missing'] or quotes['citations']['mismatched'] else 'pass',
                                   'note': f"{key}: checkable/quoted={quotes['coverage']['checkable']}/{quotes['checked']}；{quotes['coverage']['reason']}"})
        if numbers is not None:
            program_checks.append({'tool': 'check_numbers', 'result': 'fail' if numbers['mismatches'] or numbers['unknown_refs'] else 'pass',
                                   'note': f"{key}: mismatches={len(numbers['mismatches'])}; untagged={len(numbers['untagged'])}"})
    open_items = []
    for iid, it in ledger['issues'].items():
        if it['status'] in {'fixed', 'withdrawn'}:
            continue
        locations = []
        for target in targets:
            for no, line in enumerate(target.read_text().splitlines(), 1):
                if it.get('quote') and it['quote'] in line:
                    locations.append({'file': str(target), 'line': no})
                    scope[str(target)]['lines'] = sorted(set(scope[str(target)]['lines']) | {no})
        open_items.append({'id': iid, 'quote': it.get('quote'), 'still_present': bool(locations), 'locations': locations,
                           'rule': it.get('rule'), 'evidence': it.get('evidence'), 'last_status': it['status']})
    for item in flags:
        item['in_scope'] = not previous or item['line'] in scope[item['file']]['lines'] or item['check'] == 'K8'
        if item['level'] == 'defect' and item['in_scope']:
            issues.append({'severity': 'high', 'kind': 'defect', 'basis': 'quoted' if len(item['text']) >= 4 else 'missing_required',
                           'quote': item['text'] if len(item['text']) >= 4 else '', 'location': f"{item['file']}:{item['line']}",
                           'rule': item['check'], 'evidence': json.dumps(item['evidence'], ensure_ascii=False),
                           'fix': '按所列材料依据修正；若为误报，说明语义依据后删除预填项。'})
    program_checks.append({'tool': 'K1-K10', 'result': 'fail' if any(x['level'] == 'defect' and x['in_scope'] for x in flags) else 'pass',
                           'note': f"flags={len(flags)}；scope={'update' if previous else 'initial'}；hint 需语义确认，不自动阻断"})
    target_field = args.target[0] if len(args.target) == 1 else args.target
    checklist = checklist_for(args.kind)
    excerpts, excerpt_stats = excerpts_for(targets, index, flags, files, scope, previous, args.facts)
    snapshots = snapshot_targets(targets, directory, rnd)
    report = {'schema_version': 2, 'kind': args.kind, 'group': directory.name, 'target': target_field, 'round': rnd,
              'files': files, 'flags': flags, 'scope': scope, 'ledger_open_issues': open_items,
              'checklist': checklist, 'excerpts': excerpts, 'excerpt_stats': excerpt_stats, 'snapshots': snapshots,
              'source_sha256': original_hashes, 'source_snapshot_basis': original_basis,
              'source_current_sha256': {str(p): sha(p) for p in sources},
              'sources': [{'file': p, 'lines': len(t.splitlines())} for p, t in index['documents'].items()]}
    draft = {'target': target_field, 'kind': args.kind, 'verdict': '', 'summary': '', 'program_checks': program_checks,
             'issues': issues, 'rechecks': [{'id': x['id'], 'state': '', 'evidence': ''} for x in open_items],
             'decisions': [], 'incomplete_reason': ''}
    directory.mkdir(parents=True, exist_ok=True)
    dump(directory / f'precheck-r{rnd}.json', report)
    dump(directory / f'draft-r{rnd}.json', draft)
    append_flow(directory.name, rnd, 'precheck', previous=args.previous,
                hashes={f['file']: f['sha256'] for f in files}, kind=args.kind,
                targets=args.target)
    out = [f"precheck r{rnd}：检查组 {directory.name} / {args.kind}"]
    for file in files:
        coverage = file['quote_coverage']
        out.append(f"- {file['file']}: coverage={coverage['checkable']}/{coverage['quoted']} ({coverage['reason']})")
        if coverage['applicable'] and coverage['quoted'] and not coverage['checkable']:
            out.append(f"  零覆盖不能 PASS：类型 {file['kind']}、引号数 {coverage['quoted']}、{coverage['reason']}")
    out += [f'- flags {len(flags)}；预填阻断 {len(issues)}；台账待复查 {len(open_items)}',
            '- 更新轮只读 scope.lines 与未关闭问题；不全文重核；程序不能判定的缺口写未验证。',
            f'- 报告：{directory}/precheck-r{rnd}.json', f'- 草稿：{directory}/draft-r{rnd}.json']
    out.append('- checklist（只看以下 judge 项，不读 rubrics.yml）：')
    for kind, rules in checklist.items():
        out.extend(f'  {kind}/{rule["rule_id"]}: {rule["check"]}' for rule in rules)
    out.append(f'- excerpts：{excerpt_stats["included_lines"]}/{excerpt_stats["requested_lines"]} 行；截断 {excerpt_stats["truncated_lines"]} 行；片段内容在预检 JSON。')
    for block in excerpts:
        out.append(f'  {block["file"]}:L{block["start_line"]}—L{block["end_line"]}')
        out.extend(f'    L{line["line"]}: {line["text"]}' for line in block['lines'])
    out.append(f'- 被审快照：{directory}/被审-r{rnd}/（路径与 sha256 见 snapshots）')
    print('\n'.join(out))
