#!/usr/bin/env python3
"""Local inline receipts. Standard library only; no Hook, workers or network."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

STATUSES = {'成功', '失败', '取消'}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def canonical(value) -> str:
    # Object key order is irrelevant; JSON scalar types and array order are not.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def inside(root: Path, file: Path) -> bool:
    return file != root and file.is_relative_to(root)


def file_metadata(files, artifact_dir: Path):
    if not isinstance(files, list):
        raise ValueError('artifacts 必须是绝对路径数组')
    rows = []
    for value in files:
        if not isinstance(value, str) or not value or not Path(value).is_absolute():
            raise ValueError(f'产物必须是绝对路径：{value!r}')
        file = Path(os.path.abspath(value))
        if not inside(artifact_dir, file):
            raise ValueError(f'产物不在本次 artifact_dir：{value}')
        if not file.exists() or not file.is_file():
            raise ValueError(f'产物不存在或不是文件：{value}')
        if not inside(artifact_dir.resolve(), file.resolve()):
            raise ValueError(f'产物真实路径不在本次 artifact_dir：{value}')
        content = file.read_bytes()
        if not content:
            raise ValueError(f'产物为空：{value}')
        rows.append({'path': str(file), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    return rows


def validate_checks(receipt, artifact_dir: Path):
    if 'checks' not in receipt:
        return
    if not isinstance(receipt['checks'], list):
        raise ValueError('checks 必须是数组')
    for check in receipt['checks']:
        if not isinstance(check, dict) or check.get('status') not in {'pass', 'fail', 'not-run'}:
            raise ValueError('检查状态只能是 pass / fail / not-run')
        if check['status'] == 'not-run':
            if not isinstance(check.get('reason'), str) or not check['reason'].strip():
                raise ValueError('not-run 检查必须说明原因')
        else:
            file_metadata([check.get('evidence')], artifact_dir)


def save_checkpoint(file: Path, ts: str, receipt):
    # Full parsed receipt is kept OUTSIDE the fixed-key ledger. Link it to the
    # last committed checkpoint's timestamp, so a stale cache cannot suppress
    # a new stage after a crash between ledger append and this cache update.
    fd, temporary = tempfile.mkstemp(prefix='.checkpoint-', dir=file.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(canonical({'ts': ts, 'receipt': receipt}) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def accept(command: str, receipt):
    if not isinstance(receipt, dict):
        raise ValueError('回执必须是 JSON 对象')
    run_id = receipt.get('run_id')
    if not isinstance(run_id, str) or not run_id:
        raise ValueError('缺少 run_id')
    if receipt.get('status') not in STATUSES:
        raise ValueError('status 只能是 成功 / 失败 / 取消')
    cwd = Path.cwd()
    ledger = cwd / 'product-agent-output' / 'ledger.jsonl'
    if not ledger.is_file():
        raise ValueError(f'run_id 未签发：{run_id}')
    # Serialize concurrent CLI validation, duplicate checks and append against
    # the same ledger inode. dsh/service issuance precedes CLI invocation.
    # O_APPEND also protects against independent Node issue/finish appends;
    # a read/write fd + seek(end) could overwrite a row appended after the seek.
    with ledger.open('a+', encoding='utf-8') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        handle.seek(0)
        rows = [json.loads(line) for line in handle if line.strip()]
        issued = next((row for row in rows if row.get('event') == 'issue' and row.get('run_id') == run_id), None)
        if not issued:
            raise ValueError(f'run_id 未签发：{run_id}')
        if issued.get('mode') != 'inline':
            raise ValueError(f'run_id 不是内联运行：{run_id}')
        history = [row for row in rows if row.get('run_id') == run_id]
        if any(row.get('event') == 'complete' for row in history):
            raise ValueError(f'运行已 complete，不能再 {command}：{run_id}')
        artifact_dir = cwd / 'product-agent-output' / run_id
        artifacts = file_metadata(receipt.get('artifacts'), artifact_dir)
        validate_checks(receipt, artifact_dir)
        checkpoint_file = artifact_dir / '.wb-checkpoint.json'
        if command == 'checkpoint' and checkpoint_file.is_file():
            saved = json.loads(checkpoint_file.read_text(encoding='utf-8'))
            latest = next((row for row in reversed(history) if row.get('event') == 'checkpoint'), None)
            if latest and saved.get('ts') == latest['ts'] and canonical(saved.get('receipt')) == canonical(receipt):
                return '重复 checkpoint，未新增阶段'
        reason = receipt.get('reason')
        row = {
            'ts': now(), 'event': command, 'run_id': run_id, 'task_id': issued['task_id'],
            'skill': issued['skill'], 'mode': 'inline', 'caller_session_id': issued['caller_session_id'],
            'child_session_id': None, 'exec_status': '运行中' if command == 'checkpoint' else receipt['status'],
            'result_check': None if command == 'checkpoint' else '通过',
            'reason': reason if isinstance(reason, str) and reason else None,
            'artifacts': artifacts, 'queue_ms': None,
        }
        # No writes until all C3-C5 validations have succeeded.
        handle.seek(0, os.SEEK_END)
        handle.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
        if command == 'checkpoint':
            save_checkpoint(checkpoint_file, row['ts'], receipt)
        log = {'ts': now(), 'event': f'runtime-{command}', 'session_id': issued['caller_session_id'],
               'role': None, 'run_id': run_id}
        with (ledger.parent / 'wb-host.jsonl').open('a', encoding='utf-8') as log_file:
            log_file.write(json.dumps(log, ensure_ascii=False) + '\n')
        return f'{command} 已登记：{run_id}'


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('checkpoint', 'complete'))
    parser.add_argument('--result-file', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        # Python's permissive NaN/Infinity extensions are not JSON receipts.
        def invalid_constant(value):
            raise ValueError(f'非法 JSON 常量：{value}')
        receipt = json.loads(args.result_file.read_text(encoding='utf-8'), parse_constant=invalid_constant)
        print(accept(args.command, receipt))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f'回执拒绝：{exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
