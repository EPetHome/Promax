#!/usr/bin/env python3
"""Resident dsh SDK-protocol runner; no model-facing adaptation or rescue messages.

The source Python SDK cannot start a private process group or bound group teardown.
This standard-library client implements its documented newline JSON-RPC protocol.
Only initialize, session/prompt (original files), and shutdown are sent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'promax-project'
EVAL = ROOT / 'promax-eval/12-2b-常驻运行器'
QUIET_SECONDS = 30.0
LIFECYCLE = {'session.status', 'subagent.started', 'subagent.finished'}


def utc():
    return datetime.now(timezone.utc).isoformat()


def text(blocks):
    return ''.join(b.get('text', '') for b in blocks or [] if b.get('type') == 'text')


class Activity:
    """State is accessed only under the client's condition lock (or in unit tests)."""
    def __init__(self, session_id, emit):
        self.session_id = session_id
        self.emit = emit
        self.root_status = None
        self.members = {}
        self.active = set()
        self.statuses = {}
        self.receipts = set()
        self.last_lifecycle = None
        self.last_lifecycle_index = None
        self.last_root_seq = None
        self.final_response = ''
        self.final_response_seq = None
        self.root_endings = []
        self.phase = None
        self.message_id = None
        self.saw_running = False

    def begin(self, phase, now):
        self.phase = phase
        self.message_id = None
        self.saw_running = False
        # Prior idle must not terminate a new prompt before its own activity.
        self.root_status = None
        self.last_lifecycle = now
        self.last_lifecycle_index = None

    def accept(self, frame, index, now):
        method, p = frame['method'], frame.get('params', {})
        if method in LIFECYCLE:
            self.last_lifecycle, self.last_lifecycle_index = now, index
        if method == 'session.status':
            sid, status = p['sessionId'], p['status']
            self.statuses[sid] = status
            if sid == self.session_id:
                self.root_status = status
                self.saw_running |= status == 'running'
            elif status == 'running':
                # A cold-resumed child can run again without session/created,
                # hence without a second subagent.started notification.
                self.active.add(sid)
            self.emit('status', notification_index=index, session_id=sid, status=status,
                      root_status=self.root_status, active_members=sorted(self.active))
        elif method == 'subagent.started':
            sid = p['childSessionId']
            member = self.members.setdefault(sid, {'session_id': sid, 'parent_session_id': p['parentSessionId'],
                                                   'started_indices': [], 'finishes': []})
            member['started_indices'].append(index)
            self.active.add(sid)
            self.emit('member_started', notification_index=index, **p, active_members=sorted(self.active))
        elif method == 'subagent.finished':
            sid = p['childSessionId']
            member = self.members.setdefault(sid, {'session_id': sid, 'parent_session_id': p['parentSessionId'],
                                                   'started_indices': [], 'finishes': []})
            member['finishes'].append({'notification_index': index, 'received_at': utc(), **p})
            self.active.discard(sid)
            self.emit('member_finished', notification_index=index, **p, active_members=sorted(self.active))
        elif method == 'session.event' and p.get('sessionId') == self.session_id:
            event = p['event']
            self.last_root_seq = event.get('seq', self.last_root_seq)
            data = event.get('data', {})
            if event.get('type') == 'agent/inbox/spliced':
                self.receipts.update(m['id'] for m in data.get('inserted', []) if isinstance(m, dict) and 'id' in m)
            elif event.get('type') == 'assistant/message':
                content = data.get('message', data).get('content', [])
                value = text(content)
                if value.strip():
                    self.final_response, self.final_response_seq = value, event.get('seq')
            elif event.get('type') == 'turn/end':
                self.root_endings.append({'seq': event.get('seq'), 'time': event.get('time'), **data})

    def completion(self, now):
        known_finished = all(m['finishes'] for m in self.members.values() if m['started_indices'])
        quiet = None if self.last_lifecycle is None else now - self.last_lifecycle
        if (self.message_id not in self.receipts or not self.saw_running or self.root_status != 'idle'
                or self.active or not known_finished or quiet is None or quiet < QUIET_SECONDS):
            return None
        return {'phase': self.phase, 'message_id': self.message_id, 'inbox_receipt_seen': True,
                'root_status': self.root_status, 'root_ran': self.saw_running,
                'active_members': [], 'all_started_members_finished': known_finished,
                'last_lifecycle_index': self.last_lifecycle_index,
                'last_lifecycle_monotonic': self.last_lifecycle, 'quiet_seconds': quiet,
                'required_quiet_seconds': QUIET_SECONDS, 'root_seq': self.last_root_seq,
                'final_response': self.final_response, 'final_response_seq': self.final_response_seq,
                'member_finish_counts': {sid: len(m['finishes']) for sid, m in self.members.items()}}


class RpcClient:
    def __init__(self, command, cwd, env, session_id, notifications, timeline, requests, stderr):
        self.cv = threading.Condition()
        self.write_lock = threading.Lock()
        self.notifications, self.timeline, self.requests, self.stderr = notifications, timeline, requests, stderr
        self.start_monotonic = time.monotonic()
        self.index = 0
        self.responses = {}
        self.closed = False
        self.failure = None
        self.activity = Activity(session_id, self.emit)
        self.proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, encoding='utf-8', bufsize=1, start_new_session=True)
        self.pgid = os.getpgid(self.proc.pid)
        if self.pgid != self.proc.pid or self.pgid == os.getpgrp():
            raise RuntimeError('runtime did not obtain its private process group')
        self.emit('process_started', pid=self.proc.pid, pgid=self.pgid, command=command, cwd=str(cwd))
        self.reader = threading.Thread(target=self._read, daemon=True, name='resident-rpc-reader')
        self.err_reader = threading.Thread(target=self._read_stderr, daemon=True, name='resident-stderr-reader')
        self.reader.start()
        self.err_reader.start()

    def emit(self, event, **data):
        self.timeline.write(json.dumps({'time': utc(), 'monotonic': time.monotonic(),
                                        'event': event, **data}, ensure_ascii=False) + '\n')
        self.timeline.flush()

    def _read_stderr(self):
        for line in self.proc.stderr:
            self.stderr.write(line)
            self.stderr.flush()

    def _read(self):
        try:
            for line in self.proc.stdout:
                if not line.strip():
                    continue
                frame = json.loads(line)
                now, received_at = time.monotonic(), utc()
                with self.cv:
                    if 'method' in frame and 'id' not in frame:
                        self.index += 1
                        self.notifications.write(json.dumps({'index': self.index, 'received_at': received_at,
                            'received_monotonic': now, 'notification': frame, 'raw': line.rstrip('\n')}, ensure_ascii=False) + '\n')
                        self.notifications.flush()
                        self.activity.accept(frame, self.index, now)
                    elif 'id' in frame and 'method' not in frame:
                        self.responses[str(frame['id'])] = frame
                    else:
                        raise ValueError('unexpected JSON-RPC server request/frame')
                    self.cv.notify_all()
        except BaseException as error:
            with self.cv:
                self.failure = f'{type(error).__name__}: {error}'
                self.emit('transport_error', error=self.failure)
        finally:
            with self.cv:
                self.closed = True
                self.cv.notify_all()

    def request(self, method, params, deadline):
        if method not in {'initialize', 'session/prompt', 'shutdown'}:
            raise ValueError('unapproved mutating request')
        request_id = uuid.uuid4().hex
        frame = {'jsonrpc': '2.0', 'id': request_id, 'method': method}
        if params is not None:
            frame['params'] = params
        with self.write_lock:
            self.requests.write(json.dumps({'sent_at': utc(), 'request': frame}, ensure_ascii=False) + '\n')
            self.requests.flush()
            self.proc.stdin.write(json.dumps(frame, ensure_ascii=False) + '\n')
            self.proc.stdin.flush()
        with self.cv:
            while request_id not in self.responses:
                if self.failure or self.closed:
                    raise RuntimeError(self.failure or 'runtime stdout closed before response')
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError(f'{method} response timed out')
                self.cv.wait(min(left, 0.25))
            response = self.responses.pop(request_id)
            if 'error' in response:
                raise RuntimeError(f'{method}: {json.dumps(response["error"], ensure_ascii=False)}')
            return response['result']

    def prompt(self, value, phase, deadline):
        with self.cv:
            self.activity.begin(phase, time.monotonic())
            self.emit('prompt_sent', phase=phase, session_id=self.activity.session_id,
                      sha256=hashlib.sha256(value.encode()).hexdigest())
        response = self.request('session/prompt', {'sessionId': self.activity.session_id,
                                'contentBlocks': [{'type': 'text', 'text': value}]}, deadline)
        with self.cv:
            self.activity.message_id = response['messageId']
            self.emit('prompt_accepted', phase=phase, message_id=response['messageId'])

    def wait_done(self, deadline):
        with self.cv:
            while True:
                now = time.monotonic()
                if now >= deadline:
                    raise TimeoutError('scene total timeout (including followup)')
                if self.failure or self.closed:
                    raise RuntimeError(self.failure or 'runtime exited before completion')
                result = self.activity.completion(now)
                if result is not None:
                    self.emit('completed', **result)
                    return result
                self.cv.wait(min(deadline - now, 0.25))

    def group_alive(self):
        try:
            os.killpg(self.pgid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # macOS can transiently return EPERM while a signaled group exits.
            # Treat it as still alive; never claim cleanup from permission denial.
            return True

    def close(self):
        """Request shutdown, give the whole group 10s, then kill only our group."""
        deadline = time.monotonic() + 10.0
        result = {'shutdown_ack': False, 'forced_group_cleanup': False, 'mode': 'shutdown'}
        with self.cv:
            self.emit('shutdown_requested', pid=self.proc.pid, pgid=self.pgid)
        try:
            self.request('shutdown', None, deadline)
            result['shutdown_ack'] = True
        except Exception as error:
            result['shutdown_error'] = f'{type(error).__name__}: {error}'
        try:
            self.proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass
        while time.monotonic() < deadline:
            self.proc.poll()  # reap the root, otherwise killpg can observe its zombie
            if not self.group_alive():
                break
            time.sleep(0.05)
        if self.group_alive():
            result['forced_group_cleanup'] = True
            result['mode'] = 'shutdown_then_process_group'
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(self.pgid, sig)
                except ProcessLookupError:
                    break
                with self.cv:
                    self.emit('group_signal', pgid=self.pgid, signal=sig.name)
                until = time.monotonic() + 2.0
                while time.monotonic() < until and self.group_alive():
                    self.proc.poll()
                    time.sleep(0.05)
                if not self.group_alive():
                    break
        self.proc.wait(timeout=2)
        self.reader.join(timeout=2)
        self.err_reader.join(timeout=2)
        result.update({'returncode': self.proc.returncode, 'process_exited': self.proc.poll() is not None,
                       'process_group_absent': not self.group_alive(),
                       'reader_stopped': not self.reader.is_alive(), 'stderr_reader_stopped': not self.err_reader.is_alive()})
        with self.cv:
            self.emit('process_closed', **result)
        return result


def run_scene(run, prompt_file, followup, timeout, profile='promax-215-sdk', home=EVAL / '隔离HOME'):
    started_at, start = utc(), time.monotonic()
    session_id = f'session-{uuid.uuid4()}'
    env = dict(os.environ)
    env.update({'HOME': str(home), 'DSH_HOME': str(PROJECT / 'dsh-home'),
                'PATH': '/Users/Admin/.hermes/node/bin:' + env.get('PATH', ''),
                'PYTHONDONTWRITEBYTECODE': '1'})
    for key in ('CODEBUDDY_SESSION_ID', 'NEXUSCTL_COMMAND_PATH', 'NEXUSCFG_COMMAND_PATH'):
        env.pop(key, None)
    command = [str(PROJECT / 'dsh-runtime/node_modules/.bin/dsh'), '--profile', profile]
    deadline = start + timeout
    client = None
    phases = []
    status, error, exit_info = 'PASS', None, None
    files = []
    try:
        # Exclusive creation prevents accidental reruns/overwriting of evidence.
        for name in ('notifications.jsonl', 'timeline.jsonl', 'requests.jsonl', 'stderr.log'):
            files.append((run / name).open('x', encoding='utf-8'))
        client = RpcClient(command, run, env, session_id, *files)
        client.request('initialize', {'cwd': str(run), 'provider': 'opencode-go', 'model': 'deepseek-v4.1-flash'},
                       min(deadline, time.monotonic() + 30))
        for phase, source in [('initial', prompt_file)] + ([('followup', followup)] if followup else []):
            client.prompt(source.read_text(encoding='utf-8'), phase, deadline)
            phases.append(client.wait_done(deadline))
    except BaseException as exc:
        status, error = 'RUN_ERROR', f'{type(exc).__name__}: {exc}'
        if client:
            with client.cv:
                client.emit('run_error', error=error)
    finally:
        if client:
            try:
                exit_info = client.close()
                if (exit_info['returncode'] != 0 or exit_info['forced_group_cleanup']
                        or not all(exit_info[k] for k in ('shutdown_ack', 'process_exited', 'process_group_absent',
                                                         'reader_stopped', 'stderr_reader_stopped'))):
                    status = 'RUN_ERROR'
            except BaseException as exc:
                status, error = 'RUN_ERROR', f'close: {type(exc).__name__}: {exc}'
                # Final safety net still targets only the group created here.
                try:
                    os.killpg(client.pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                client.proc.wait(timeout=5)
                client.reader.join(timeout=2)
                client.err_reader.join(timeout=2)
                exit_info = {'mode': 'emergency_group_kill', 'returncode': client.proc.returncode,
                             'process_group_absent': not client.group_alive()}
        for handle in files:
            handle.close()
    elapsed = round(time.monotonic() - start, 3)
    activity = client.activity if client else None
    final = {'runner_status': status, 'business_status': 'NOT_RUN', 'error': error,
             'client': 'stdlib JSON-RPC over stdio / dsh SDK server', 'run': str(run), 'session_id': session_id,
             'pid': client.proc.pid if client else None, 'pgid': client.pgid if client else None,
             'dsh_process_count_started': int(client is not None), 'session_count_prompted': 1 if client else 0,
             'profile': profile, 'HOME': env['HOME'], 'provider': 'opencode-go', 'model': 'deepseek-v4.1-flash',
             'started_at': started_at, 'ended_at': utc(), 'seconds': elapsed, 'timeout_seconds': timeout,
             'timeout': error is not None and error.startswith('TimeoutError:'), 'phases': phases,
             'final_response': activity.final_response if activity else '',
             'final_response_seq': activity.final_response_seq if activity else None,
             'root_turn_endings': activity.root_endings if activity else [],
             'members': list(activity.members.values()) if activity else [],
             'active_members_at_close': sorted(activity.active) if activity else [], 'exit': exit_info}
    (run / 'final.json').write_text(json.dumps(final, ensure_ascii=False, indent=2) + '\n')
    (run / 'timing.json').write_text(json.dumps({k: final[k] for k in ('started_at', 'ended_at', 'seconds', 'timeout', 'runner_status')}, indent=2) + '\n')
    print(json.dumps({'run': run.name, 'runner_status': status, 'seconds': elapsed, 'session_id': session_id,
                      'members': len(final['members']), 'exit': exit_info}, ensure_ascii=False))
    return 0 if status == 'PASS' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('prompt', type=Path)
    parser.add_argument('--followup', type=Path)
    parser.add_argument('--timeout', type=float, default=2400)
    parser.add_argument('--profile', default='promax-215-sdk')
    parser.add_argument('--home', type=Path, default=EVAL / '隔离HOME')
    args = parser.parse_args()
    run = args.run.resolve()
    if run.parent != PROJECT / 'runs' or not run.name.startswith(('135-', '136-', 'S3-', 'S4-', '137-', '138-')):
        parser.error('run must be a round-12-2b authorized directory')
    if not run.is_dir() or not 0 < args.timeout <= 2400:
        parser.error('existing run directory and timeout in (0, 2400] required')
    if any((run / n).exists() for n in ('final.json', 'notifications.jsonl', 'timeline.jsonl', 'requests.jsonl', 'stderr.log', 'timing.json')):
        parser.error('refusing to overwrite existing run evidence')
    for source in (args.prompt, args.followup):
        if source and not source.is_file():
            parser.error(f'missing prompt file: {source}')
    home = args.home.resolve()
    home.mkdir(parents=True, exist_ok=True)
    if (home / '.config/product-agent-feishu-full').exists():
        parser.error('isolated HOME contains Feishu configuration')
    def interrupted(signum, _frame):
        raise InterruptedError(f'runner interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    return run_scene(run, args.prompt.resolve(), args.followup.resolve() if args.followup else None, args.timeout, args.profile, home)


if __name__ == '__main__':
    raise SystemExit(main())
