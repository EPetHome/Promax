#!/usr/bin/env python3
"""Typed group ledger submission; no cross-group state or report overwrites."""
import datetime
import json
import re
from pathlib import Path

from group_checks import append_flow, dump, flow_counts, flow_rows, group_dir, sha, since_save_rows
from source_checks import KINDS


def targets_of(draft):
    value = draft.get('target')
    if isinstance(value, str) and value:
        return [value]
    if isinstance(value, list) and value and all(isinstance(x, str) and x for x in value):
        return value
    raise ValueError('target 必须是非空字符串或非空字符串数组')


def render(ledger, legacy):
    text = legacy.render(ledger)
    last = ledger['rounds'][-1]
    lines = ['\n## 检查组文件 SHA256\n']
    lines.extend(f'- `{path}`：`{digest}`' for path, digest in last.get('files_sha256', {}).items())
    return text + '\n'.join(lines) + '\n'


LIMIT = '已达上限：本轮未完成独立检查，按团队规则第 4 节写'


def draft_context(path):
    """已知组草稿路径优先：JSON 损坏、target 被改也不能重置拒收次数。"""
    path = Path(path)
    match = re.fullmatch(r'draft-r(\d+)\.json', path.name)
    if match and path.parent.parent.resolve() == Path('交付/检查').resolve():
        return path.parent, int(match[1])
    return None


def submit_path(path, legacy):
    context = draft_context(path)
    if context:
        return submit(None, legacy, context=context, path=path)
    # 不在组内的合法 typed 草稿也兼容；旧单文件分流仍在 issues.py。
    draft = json.loads(Path(path).read_text(encoding='utf-8'))
    return submit(draft, legacy)


def submit(draft, legacy, context=None, path=None):
    if context is None:
        try:
            directory = group_dir(targets_of(draft))
            ledger_path = directory / 'ledger.json'
            ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'rounds': []}
            context = directory, len(ledger['rounds']) + 1
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            return {'accepted': False, 'errors': [str(exc)]}
    directory, rnd = context
    rows = flow_rows()
    pc = next((r for r in reversed(rows) if r.get('group') == directory.name
               and r.get('round') == rnd and r.get('event') == 'precheck'), {})
    previous = pc.get('previous', [])
    prior = [r for r in since_save_rows(rows, directory.name) if r.get('round') == rnd]
    rejected = sum(r.get('event') == 'submit' and r.get('accepted') is False for r in prior)
    if rejected >= 2:
        result = {'accepted': False, 'errors': [LIMIT]}
    else:
        try:
            if path is not None:
                draft = json.loads(Path(path).read_text(encoding='utf-8'))
            if not isinstance(draft, dict):
                raise ValueError('草稿必须是 JSON 对象')
            if group_dir(targets_of(draft)).resolve() != directory.resolve():
                raise ValueError('草稿 target 与本轮检查组不一致')
            ledger_path = directory / 'ledger.json'
            ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'rounds': []}
            if len(ledger['rounds']) + 1 != rnd:
                raise ValueError('草稿不是本组当前待提交轮')
            result = validated_submit(draft, legacy, flow_counts(rows, directory.name, previous), previous)
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
            result = {'accepted': False, 'errors': [f'草稿无法提交：{type(exc).__name__}: {exc}']}
        if not result['accepted']:
            result['errors'].append('可交回 Judge 修改 1 次' if rejected == 0 else LIMIT)
    append_flow(directory.name, rnd, 'submit', (draft or {}).get('verdict') if isinstance(draft, dict) else None,
                previous, pc.get('files_sha256', {}), accepted=result['accepted'], errors=result.get('errors', []))
    result.update(flow_counts(flow_rows(), directory.name, previous))
    return result


def validated_submit(draft, legacy, counts, previous):
    try:
        targets = targets_of(draft)
    except ValueError as exc:
        return {'accepted': False, 'errors': [str(exc)]}
    errors = []
    kind = draft.get('kind')
    if kind not in KINDS:
        errors.append('检查组草稿必须有合法 kind（rubrics 节名）')
    if len({str(Path(p).resolve()) for p in targets}) != len(targets):
        errors.append('被审文件不得重复')
    missing = [p for p in targets if not Path(p).is_file()]
    if missing:
        return {'accepted': False, 'errors': [f'被审文件不存在：{missing}']}
    texts = {p: Path(p).read_text() for p in targets}
    hashes = {p: sha(p) for p in targets}
    directory = group_dir(targets)
    ledger_file = directory / 'ledger.json'
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else {'rounds': [], 'issues': {}}
    errors.extend(legacy.validate(draft, ledger, '\n'.join(texts.values())))
    # Exact in a single file: do not allow normalized whitespace or cross-file concatenation.
    for i, item in enumerate(draft.get('issues', []), 1):
        if item.get('basis') == 'quoted' and not any(item.get('quote', '') in text for text in texts.values()):
            errors.append(f'issues[{i}]: 原句在组内任一被审文件中均不逐字存在')
    rnd = len(ledger['rounds']) + 1
    try:
        precheck = json.loads((directory / f'precheck-r{rnd}.json').read_text())
    except (OSError, ValueError):
        precheck = None
    inspected = {entry.get('file'): entry.get('sha256') for entry in (precheck or {}).get('files', [])}
    if (not precheck or precheck.get('round') != rnd or precheck.get('kind') != kind
            or precheck.get('target') != draft['target'] or inspected != hashes):
        errors.append('本轮没有对组内每个当前文件的预检（target / kind / sha 不一致）'
                      + ('，不能 PASS' if draft.get('verdict') == 'PASS' else '，不能接受检查结论'))
        for target, digest in hashes.items():
            if target in inspected and inspected[target] != digest:
                errors.append(f'被审文件在预检后被改动：{target}；须重新预检')
    elif draft.get('verdict') == 'PASS':
        for entry in precheck['files']:
            coverage = entry.get('quote_coverage', {})
            if coverage.get('applicable') and coverage.get('quoted', 0) > 0 and coverage.get('checkable') == 0:
                errors.append(f"类型 {entry['kind']}：{entry['file']} 有 {coverage['quoted']} 处引号，可核对覆盖为 0，不能 PASS；原因：{coverage.get('reason')}")
    if precheck and kind == 'requirement-review-report':
        # A source modified after precheck is not silently accepted even with a non-PASS verdict.
        for source, digest in precheck.get('source_current_sha256', {}).items():
            if not Path(source).is_file() or sha(source) != digest:
                errors.append(f'K8：被评审材料在预检后被改写或删除：{source}；须重新预检并报告')
    if errors:
        return {'accepted': False, 'errors': errors}
    trial = json.loads(json.dumps(ledger))
    at = datetime.datetime.now().isoformat(timespec='seconds')
    legacy.apply(draft, trial, hashes[targets[0]], at)
    trial['rounds'][-1].update({'kind': kind, 'group': directory.name, 'files_sha256': hashes,
                              'source_sha256': (precheck or {}).get('source_sha256', {}),
                              'scope': (precheck or {}).get('scope', {}), 'previous': previous, **counts})
    problem = legacy.consistency(draft, trial)
    if problem:
        return {'accepted': False, 'errors': [problem]}
    directory.mkdir(parents=True, exist_ok=True)
    dump(ledger_file, trial)
    report_file = directory / '检查.md'
    report_file.write_text(render(trial, legacy))
    return {'accepted': True, 'round': rnd, 'verdict': draft['verdict'], 'group': directory.name,
            'blocking': [k for k, v in trial['issues'].items() if legacy.is_blocking(v)],
            'report': str(report_file), 'ledger': str(ledger_file),
            'conclusion_text': render(trial, legacy) + '\n'}


def show(group, legacy):
    root = Path('交付/检查')
    if group is not None:
        if Path(group).name != group or group in {'.', '..'}:
            raise ValueError('检查组只能是一个文件名主体，不能含路径')
        path = root / group / 'ledger.json'
        if not path.is_file():
            print('尚无检查记录：' + group)
            return
        ledger = json.loads(path.read_text())
        if not ledger.get('rounds'):
            print('尚无检查记录：' + group)
            return
        print(render(ledger, legacy))
        return
    paths = sorted(root.glob('*/ledger.json'))
    for path in paths:
        ledger = json.loads(path.read_text())
        if ledger['rounds']:
            last = ledger['rounds'][-1]
            count = sum(legacy.is_blocking(x) for x in ledger['issues'].values())
            print(f"{path.parent.name} | r{last['round']} | {last['verdict']} | 阻断 {count} | {path.parent}/检查.md")
    if not paths:
        legacy.show()
