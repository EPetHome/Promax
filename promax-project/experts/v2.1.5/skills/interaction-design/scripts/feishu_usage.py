#!/usr/bin/env python3
"""Independent WorkBuddy skill usage collection. Python standard library only."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import getpass
import http.client
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import urlencode, urlsplit
import uuid
import zlib

HOME = Path.home() / '.config' / 'product-agent-feishu-full'
VERSION = '2.1.5'
# 统计口径固定为东八区，不随安装机器的系统时区变化。
CST = timezone(timedelta(hours=8))

CATALOG = json.loads((Path(__file__).resolve().parent / 'catalog.json').read_text(encoding='utf-8'))
SKILLS = {k: v['name'] for k, v in CATALOG.items()}
DETAIL_NAME = '调研者使用明细（全量版）'
SUMMARY_NAME = '总统计（全量版）'
DETAIL = {'运行编号': 1, '姓名': 1, '部门': 1, '调研者编号': 1,
          '任务名称': 1, '任务编号': 1, '项目名称': 1, '任务类型': 1,
          'Skill名称': 1, 'Skill ID': 1, 'Skill版本': 1, '智能体': 1,
          '开始时间': 5, '结束时间': 5, '耗时秒': 2, '执行状态': 1,
          '产物数量': 2, '产物名称': 1, '产物链接': 1, '失败原因': 1,
          '结果校验': 1, '校验说明': 1,
          '来源': 1, '宿主来源': 1, '宿主版本': 1, '采集方式': 1, '来源判定': 1, '数据类型': 1, '身份来源': 1, '智能体编号': 1, '父运行编号': 1,
          '实际消耗Token': 2, '缓存命中Token': 2, '命中调用Token': 2, 'Token来源': 1}
SUMMARY = {'统计项': 1, 'Skill ID': 1, '数据类型': 1}

INSTALL_FIELDS = {'记录名称':1, '记录类型':1, '安装事件ID':1, '安装包名称':1, '安装包版本':1,
          '安装时间':5, '完成时间':5, '安装人':1, '部门':1, '人员编号':1,
          '安装类型':1, '原版本':1, '安装结果':1, '失败阶段':1, '错误类型':1,
          '宿主来源':1, '宿主版本':1, '采集方式':1, '来源判定':1,
          '操作系统':1, '系统版本':1, 'Python版本':1, '安装实例ID':1, '数据类型':1}
INSTALL_METRICS = ('总安装次数','安装人数','安装实例数','失败安装次数','首装次数','重装次数','升级次数')


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def load_config(path=None):
    """Explicit config is strict; fresh installations use the packaged connection."""
    local = Path(path) if path is not None else HOME / 'config.json'
    if local.is_file():
        config = read(local)
    elif path is not None:
        raise ValueError('指定的配置文件不存在；使用内置连接时请省略 --config')
    else:
        try:
            # ponytail: compression hides casual plaintext only; real secrecy needs a server.
            config = json.loads(zlib.decompress(Path(__file__).with_name('connection.dat').read_bytes()))
        except (OSError, zlib.error, ValueError):
            raise RuntimeError('内置连接配置缺失或损坏，请重新安装完整技能包') from None
    if isinstance(config, dict) and path is None and local.is_file():
        bundled = json.loads(zlib.decompress(Path(__file__).with_name('connection.dat').read_bytes()))
        if all(config.get(k) == bundled.get(k) for k in ('app_id', 'base_token')):
            for key in ('install_table', 'people_table'):
                if bundled.get(key):
                    config.setdefault(key, bundled[key])
            config['protected_table_ids'] = sorted(set(config.get('protected_table_ids', [])) | set(bundled.get('protected_table_ids', [])))
    if not isinstance(config, dict):
        raise ValueError('连接配置格式错误')
    for key in ('app_id', 'base_token'):
        identifier(config.get(key))
    for key in ('detail_table', 'summary_table', 'install_table', 'people_table'):
        if key in config:
            identifier(config[key])
    label(config.get('app_secret'), 'App Secret', 512)
    return config


def label(value, name, limit=120):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(name + '须为非空单行文本，最多' + str(limit) + '字符')
    return value.strip()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('标识符格式错误')
    return value


def request(method, path, body=None, token=None):
    connection = http.client.HTTPSConnection('open.feishu.cn', timeout=20)
    headers = {'Content-Type': 'application/json; charset=utf-8'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        payload = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        connection.request(method, '/open-apis' + path, payload, headers)
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            raise RuntimeError('飞书 HTTP 状态：' + str(response.status))
        result = json.loads(response.read(8_000_000))
        if not isinstance(result, dict) or type(result.get('code')) is not int:
            raise RuntimeError('飞书响应无法确认')
        if result['code'] != 0:
            raise RuntimeError('飞书业务错误码：' + str(result['code']))
        return result
    finally:
        connection.close()


def authenticate(config):
    for key in ('app_id', 'base_token'):
        identifier(config.get(key))
    label(config.get('app_secret'), 'App Secret', 512)
    token = request('POST', '/auth/v3/tenant_access_token/internal',
                    {k: config[k] for k in ('app_id', 'app_secret')}).get('tenant_access_token')
    if not isinstance(token, str) or not token:
        raise RuntimeError('飞书未返回访问凭证')
    return token


def connect(config):
    token = authenticate(config)
    prefix = '/bitable/v1/apps/' + config['base_token']

    def api(method, suffix, body=None):
        return request(method, prefix + suffix, body, token).get('data', {})
    return api


def items(api, path, params=None):
    page, seen, result = '', set(), []
    while True:
        data = api('GET', path + '?' + urlencode(dict(params or {}, page_size=100, page_token=page)))
        if 'items' not in data and data.get('total') == 0 and data.get('has_more') is False:
            return result
        if not isinstance(data.get('items'), list):
            raise RuntimeError('飞书列表响应不完整')
        result.extend(data['items'])
        if not data.get('has_more'):
            return result
        page = data.get('page_token')
        if not page or page in seen:
            raise RuntimeError('飞书分页异常')
        seen.add(page)


def field_spec(name, kind):
    value = {'field_name': name, 'type': kind}
    if kind == 5:
        value['property'] = {'date_formatter': 'yyyy-MM-dd HH:mm', 'auto_fill': False}
    elif kind == 2:
        value['property'] = {'formatter': '0.00' if name == '耗时秒' else '0'}
    return value


def ensure_table(api, name, fields):
    matches = [t for t in items(api, '/tables') if t['name'] == name]
    if len(matches) > 1:
        raise RuntimeError('存在同名数据表，请保留一个目标：' + name)
    if matches:
        table_id = matches[0]['table_id']
    else:
        result = api('POST', '/tables', {'table': {'name': name, 'default_view_name': '表格视图',
                     'fields': [field_spec(n, t) for n, t in fields.items()]}})
        table_id = identifier(result['table_id'])
    existing = {f['field_name']: f for f in items(api, '/tables/' + table_id + '/fields')}
    for name, kind in fields.items():
        if name in existing and existing[name]['type'] != kind:
            raise ValueError('字段类型不匹配：' + name)
        if name not in existing:
            existing[name] = api('POST', '/tables/' + table_id + '/fields', field_spec(name, kind))['field']
    return table_id, existing


def text_of(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ''.join(v.get('text', '') for v in value if isinstance(v, dict))
    return ''


def matches(actual, expected):
    for key, value in expected.items():
        found = actual.get(key)
        if value is None:
            if found is not None:
                return False
            continue
        if isinstance(value, str):
            if text_of(found) != value:
                return False
        else:
            # Feishu may return number fields as numeric strings; blank is never zero.
            if type(found) not in (str, int, float):
                return False
            try:
                number = Decimal(str(found))
                if not number.is_finite() or number != Decimal(str(value)):
                    return False
            except InvalidOperation:
                return False
    return True


def formulas(detail_id, summary_id, detail, summary):
    d = 'bitable::$table[' + detail_id + ']'
    s = 'bitable::$table[' + summary_id + ']'
    def current(name):
        return 'CurrentValue.$field[' + detail[name]['field_id'] + ']'
    def own(name):
        return s + '.$field[' + summary[name]['field_id'] + ']'
    condition = (current('数据类型') + '=' + own('数据类型') + '&&(' + own('Skill ID') +
                 '="全部"||' + current('Skill ID') + '=' + own('Skill ID') + ')')
    def aggregate(field, operation, extra=''):
        return d + '.FILTER(' + condition + extra + ').$field[' + detail[field]['field_id'] + '].' + operation
    result = {name: aggregate(field, 'UNIQUE().COUNTA()') for name, field in
              [('Skill调用次数', '运行编号'), ('任务数', '任务编号'), ('使用人数', '调研者编号')]}
    for name, status in [('成功次数', '成功'), ('失败次数', '失败'), ('取消次数', '取消'),
                         ('未结束次数', '运行中'), ('待核验次数', '待核验')]:
        result[name] = aggregate('运行编号', 'UNIQUE().COUNTA()', '&&' + current('执行状态') + '="' + status + '"')
    result['产物总数'] = aggregate('产物数量', 'SUM()')
    terminal = '&&(' + '||'.join(current('执行状态') + '="' + status + '"'
                               for status in ('成功', '失败', '取消')) + ')'
    result['总耗时秒'] = aggregate('耗时秒', 'SUM()', terminal)
    finished = aggregate('运行编号', 'UNIQUE().COUNTA()', terminal)
    result['平均耗时秒'] = 'IF(' + finished + '=0,0,' + result['总耗时秒'] + '/' + finished + ')'
    result['成功率'] = 'IF(' + finished + '=0,0,' + result['成功次数'] + '/' + finished + ')'
    hit = terminal + '&&' + current('缓存命中Token') + '>0'
    runs = aggregate('运行编号', 'UNIQUE().COUNTA()', hit)
    result['命中运行数'] = runs
    for name, field in [('平均耗时秒（命中）', '耗时秒'), ('平均实际消耗Token', '实际消耗Token'),
                        ('平均缓存命中Token', '缓存命中Token'), ('平均命中调用Token', '命中调用Token')]:
        result[name] = 'IF(' + runs + '=0,0,' + aggregate(field, 'SUM()', hit) + '/' + runs + ')'
    return result


def prepare(api, config, config_path):
    dt, df = ensure_table(api, DETAIL_NAME, DETAIL)
    config['detail_table'] = dt
    save(config_path, config)
    st, sf = ensure_table(api, SUMMARY_NAME, SUMMARY)
    config['summary_table'] = st
    save(config_path, config)
    for name, expression in formulas(dt, st, df, sf).items():
        if name in sf and sf[name]['type'] != 20:
            raise ValueError('统计列必须是公式类型：' + name)
        fmt = '0.00%' if name == '成功率' else '0.00' if '耗时' in name else '0'
        body = {'field_name': name, 'type': 20, 'property': {'formula_expression': expression,
                'type': {'data_type': 2, 'ui_type': 'Number', 'ui_property': {'formatter': fmt}}}}
        path = '/tables/' + st + '/fields'
        if name in sf:
            if sf[name].get('property', {}).get('formula_expression') != expression:
                api('PUT', path + '/' + sf[name]['field_id'], body)
        else:
            api('POST', path, body)
    rows = items(api, '/tables/' + st + '/records')
    missing = []
    for mode in ('正式', '测试'):
        for skill in ('全部', *SKILLS):
            fields = {'统计项': (SKILLS.get(skill, '全部') + ' · ' + mode), 'Skill ID': skill, '数据类型': mode}
            identity = {k: fields[k] for k in ('Skill ID', '数据类型')}
            found = [r for r in rows if matches(r['fields'], identity)]
            if len(found) > 1:
                raise RuntimeError('总统计有重复行：' + fields['统计项'])
            if not found:
                missing.append({'fields': fields})
            elif not matches(found[0]['fields'], fields):
                api('PUT', '/tables/' + st + '/records/' + identifier(found[0]['record_id']), {'fields': fields})
    if missing:
        key = '|'.join(r['fields']['统计项'] for r in missing)
        tokens = config.setdefault('summary_create_tokens', {})
        client_token = tokens.setdefault(key, str(uuid.uuid4()))
        save(config_path, config)
        api('POST', '/tables/' + st + '/records/batch_create?' + urlencode({'client_token': client_token}), {'records': missing})
    return {'status': 'ready', 'detail_table': dt, 'summary_table': st}


@contextmanager
def receipt_lock(path):
    """OS releases the per-receipt lock even after an interrupted process."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(str(path) + '.lock', 'a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.write(b'0'); stream.flush(); stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def verify_record(api, path, fields):
    for attempt in range(3):
        if attempt:
            time.sleep(attempt)
        record = api('GET', path).get('record', {})
        if record.get('record_id') == path.rsplit('/', 1)[-1] and matches(record.get('fields', {}), fields):
            return
    raise RuntimeError('飞书读回字段不一致，未确认回传成功')


def deliver(api, config, receipt, path, *, kind='usage'):
    table_key, id_field, state_field = {'usage': ('detail_table', '运行编号', '执行状态'),
        'install': ('install_table', '安装事件ID', '安装结果')}[kind]
    if any(receipt[k] != config[k] for k in ('base_token', table_key)):
        raise ValueError('回执目标与配置不一致')
    records_path = '/tables/' + identifier(receipt[table_key]) + '/records'
    rid = receipt.get('record_id')
    if not rid:
        if receipt.get('create_attempted'):
            # ponytail: uncertain creates are reconciled by ID; never blindly create twice.
            rows = items(api, records_path, {'filter': 'CurrentValue.[' + id_field + ']="' + identifier(receipt['run_id']) + '"'})
            rows = [r for r in rows if text_of(r['fields'].get(id_field)) == receipt['run_id']]
            if len(rows) != 1:
                raise RuntimeError('创建结果待核对：按运行编号查飞书；保留回执，不重复创建')
            rid = rows[0]['record_id']
        else:
            # Feishu requires a UUID v4 client token; the host call ID may be UUID v5.
            receipt.setdefault('client_token', receipt['run_id'] if uuid.UUID(receipt['run_id']).version == 4 else str(uuid.uuid4()))
            receipt['create_attempted'] = True
            save(path, receipt)
            created = api('POST', records_path + '?' + urlencode({'client_token': receipt['client_token']}),
                          {'fields': receipt['initial_fields']})
            rid = created.get('record', {}).get('record_id')
        receipt['record_id'] = identifier(rid)
        save(path, receipt)
    target = records_path + '/' + identifier(rid)
    # Updates are retried on the same record; a repeated finish never increments a counter.
    if receipt['fields'] != receipt['initial_fields']:
        api('PUT', target, {'fields': receipt['fields']})
    verify_record(api, target, receipt['fields'])
    receipt.update(delivery='verified', verified_at=datetime.now(CST).isoformat())
    save(path, receipt)
    return {'status': 'verified', 'run_id': receipt['run_id'], 'record_id': rid,
            'execution_status': receipt['fields'][state_field], 'receipt': str(path)}


def build_start(config, args, run_id=None):
    profile_path = args.config.parent / 'profile.json'
    if not profile_path.is_file():
        raise ValueError('首次使用请运行 profile 填写本人的姓名、部门；应用连接已内置')
    profile = read(profile_path)
    name = label(profile.get('name'), '姓名', 64)
    department = label(profile.get('department'), '部门', 100)
    researcher = label(profile.get('researcher_id'), '调研者编号', 160)
    skill = next((k for k, v in CATALOG.items() if v['install_name'] == args.skill), args.skill)
    task_type = label(args.task_type or 'single', '任务类型', 64)
    agent = args.agent or CATALOG[skill]['agent']
    agent_name = next(v['agent_name'] for v in CATALOG.values() if v['agent'] == agent)
    task_id = str(uuid.UUID(args.task_id)) if args.task_id else str(uuid.uuid4())
    run_id = str(uuid.UUID(run_id)) if run_id else str(uuid.uuid4())
    fields = {'运行编号': run_id, '姓名': name, '部门': department, '调研者编号': researcher,
              '任务名称': label(args.task, '任务名称'), '任务编号': task_id,
              '项目名称': label(args.project, '项目名称'), '任务类型': task_type,
              'Skill名称': SKILLS[skill], 'Skill ID': skill, 'Skill版本': VERSION,
              '智能体': agent_name, '智能体编号': agent,
              '父运行编号': str(uuid.UUID(args.parent_run_id)) if args.parent_run_id else '', '开始时间': int(time.time() * 1000),
              '执行状态': '运行中', '产物数量': 0, '结果校验': '待返回', '校验说明': '',
              '来源': label(args.source, '来源', 64),
              '宿主来源': label(getattr(args, 'host_source', '未知'), '宿主来源', 64),
              '宿主版本': label(getattr(args, 'host_version', '未知'), '宿主版本', 64),
              '采集方式': label(getattr(args, 'collection_method', '脚本调用'), '采集方式', 64),
              '来源判定': label(getattr(args, 'source_evidence', '未识别'), '来源判定', 64), '数据类型': '测试' if args.test else '正式',
              '身份来源': '使用者填写', '实际消耗Token': None, '缓存命中Token': None,
              '命中调用Token': None, 'Token来源': ''}
    for k in ('base_token', 'detail_table', 'summary_table'):
        identifier(config.get(k))
    receipt = {'run_id': run_id, 'base_token': config['base_token'], 'detail_table': config['detail_table'],
               'initial_fields': fields.copy(), 'fields': fields.copy(), 'delivery': 'pending'}
    return receipt


def start(config, args, api_factory=connect):
    receipt = build_start(config, args)
    run_id = receipt['run_id']
    task_id = receipt['fields']['任务编号']
    path = args.config.parent / 'receipts' / (run_id + '.json')
    with receipt_lock(path):
        save(path, receipt)
        print(json.dumps({'run_id': run_id, 'task_id': task_id, 'receipt': str(path)}, ensure_ascii=False), flush=True)
        return deliver(api_factory(config), config, receipt, path)


def finish_fields(receipt, args, *, allow_pending=False):
    states = ('运行中', '待核验') if allow_pending else ('运行中',)
    if (not allow_pending and receipt.get('delivery') != 'verified') or receipt['fields']['执行状态'] not in states:
        raise ValueError('请先 sync 核验开始登记；已结束的运行使用 sync，不重复 finish')
    if args.status not in ('成功', '失败', '取消'):
        raise ValueError('执行结果必须为成功、失败或取消')
    files = list(dict.fromkeys(str(p.resolve()) for p in (args.artifact or [])))
    for name in files:
        p = Path(name)
        if not p.is_file() or p.stat().st_size == 0:
            raise ValueError('产物不存在或为空：' + p.name)
    if args.status == '成功' and not files:
        raise ValueError('成功必须至少有一个实际存在的非空产物')
    links = []
    for url in args.link or []:
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('产物链接须为不含账号密码的 HTTP(S) 地址')
        links.append(label(url, '产物链接', 2000))
    end = int(time.time() * 1000)
    fields = dict(receipt['fields'], **{'执行状态': args.status, '结束时间': end,
            '耗时秒': round(max(0, end - receipt['fields']['开始时间']) / 1000, 2),
            '产物数量': len(files), '产物名称': '\n'.join(Path(p).name for p in files),
            '产物链接': '\n'.join(links), '失败原因': args.reason or '',
            '结果校验': '通过', '校验说明': ''})
    if args.status == '成功' and args.reason:
        raise ValueError('成功状态不能附失败原因')
    if args.status != '成功' and not args.reason:
        raise ValueError('失败或取消请选填 --reason 分类')
    return fields


def main():
    parser = argparse.ArgumentParser(description='产品全流程 27 个业务 Skill 直连飞书')
    parser.add_argument('--config', type=Path, help='管理员自定义配置；省略时使用本地配置或内置连接')
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('configure', help='交互配置应用；Secret 隐藏输入')
    p = sub.add_parser('profile', help='本地保存使用者信息')
    p.add_argument('--name', required=True); p.add_argument('--department', required=True)
    p.add_argument('--researcher-id', required=True, help='必填工号，CX 开头')
    sub.add_parser('prepare', help='创建或核对本版本的两张表和公式')
    sub.add_parser('check', help='只读检查表、公式和本地身份')
    sub.add_parser('new-task', help='仅生成一个任务编号；本身不计 Skill 次数')
    sub.add_parser('catalog', help='离线列出已接入的业务 Skill')
    sub.add_parser('install-stats', help='只读正式安装汇总与明细，不登记新的安装')
    sub.add_parser('stats', help='只读飞书总统计，不产生自我调用记录')
    p = sub.add_parser('start')
    p.add_argument('--skill', required=True, choices=[v['install_name'] for v in CATALOG.values()])
    p.add_argument('--task', required=True); p.add_argument('--project', default='待填写')
    p.add_argument('--task-type', help='single、all 或本次工作流标签')
    p.add_argument('--agent', choices=sorted({v['agent'] for v in CATALOG.values()}))
    p.add_argument('--parent-run-id', help='业务编排 Skill 的运行编号，主入口不登记')
    p.add_argument('--task-id'); p.add_argument('--source', default='未知'); p.add_argument('--test', action='store_true')
    p = sub.add_parser('finish')
    p.add_argument('--run-id', required=True)
    p.add_argument('--status', required=True, choices=['成功','失败','取消'])
    p.add_argument('--artifact', action='append', type=Path)
    p.add_argument('--link', action='append')
    p.add_argument('--reason', choices=['输入不足','生成失败','工具失败','校验失败','用户取消','上游失败','其他'])
    p = sub.add_parser('sync', help='按同一回执补传/核验；不新建同一次运行')
    p.add_argument('--run-id', required=True)
    args = parser.parse_args()
    config_path = args.config
    args.config = config_path if config_path is not None else HOME / 'config.json'
    try:
        if args.action == 'new-task':
            output = {'task_id': str(uuid.uuid4())}
        elif args.action == 'catalog':
            output = {'skill_count': len(SKILLS), 'skills': {v['install_name']: v for v in CATALOG.values()}}
        elif args.action == 'profile':
            # Standalone skill scripts are installed under <root>/skills/<name>/scripts/;
            # the shared validator and immutable surname list live in the installed runtime.
            runtime = Path(__file__).resolve().parent
            if not (runtime/'install_usage.py').is_file():
                root = Path(__file__).resolve().parents[3]
                runtime = root/'product-agent-runtime'/VERSION
                if not (runtime/'install_usage.py').is_file():
                    runtime = root/'runtime'  # unpacked distribution, before installation
            if not (runtime/'install_usage.py').is_file():
                raise ValueError('安装运行时缺失 install_usage.py，无法校验身份')
            sys.path.insert(0, str(runtime))
            import install_usage
            profile = install_usage.profile(args.name, args.department, args.researcher_id)
            save(args.config.parent / 'profile.json', profile)
            output = {'status': 'profile_saved', **profile}
        elif args.action == 'configure':
            config = read(args.config) if args.config.exists() else load_config() if config_path is None else {}
            for key, name in [('app_id','App ID'), ('app_secret','App Secret'), ('base_token','Base Token')]:
                prompt = name + ('（回车保留）: ' if config.get(key) else ': ')
                value = getpass.getpass(prompt) if key == 'app_secret' else input(prompt)
                if value.strip():
                    config[key] = value.strip()
            connect(config)
            save(args.config, config)
            output = {'status': 'config_saved', 'next': 'prepare'}
        else:
            config = load_config(config_path)
            if args.action == 'start':
                output = start(config, args)
            elif args.action in ('finish', 'sync'):
                run_id = str(uuid.UUID(args.run_id))
                path = args.config.parent / 'receipts' / (run_id + '.json')
                with receipt_lock(path):
                    receipt = read(path)
                    if args.action == 'finish':
                        receipt['fields'] = finish_fields(receipt, args)
                        receipt['delivery'] = 'pending'
                        save(path, receipt)
                    output = deliver(connect(config), config, receipt, path)
            else:
                api = connect(config)
                if args.action == 'stats':
                    output = {'summary': [r['fields'] for r in items(api, '/tables/' + identifier(config['summary_table']) + '/records')]}
                elif args.action == 'install-stats':
                    output = installation_stats(api, config)
                elif args.action == 'prepare':
                    output = prepare(api, config, args.config)
                else:
                    output = check(api, config, args.config)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        message = str(exc) if type(exc) in (ValueError, RuntimeError) else type(exc).__name__
        print(json.dumps({'status': 'not_verified', 'error': message,
              'action': '保留本地回执；有运行编号则使用 sync，勿再次 start 同一执行'}, ensure_ascii=False), file=sys.stderr)
        return 2


def validate_summary(rows):
    keys = [(text_of(r['fields'].get('Skill ID')), text_of(r['fields'].get('数据类型'))) for r in rows]
    modes = {'正式'} | {mode for _, mode in keys}
    expected = {(skill, mode) for mode in modes for skill in ('全部', *SKILLS)}
    if not modes <= {'正式', '测试'} or len(keys) != len(set(keys)) or set(keys) != expected:
        raise RuntimeError('总统计存在缺项、重复或未知统计项，请由管理员核对；正式组必需，测试组可整组省略')
    return sorted(modes)


def installation_stats(api, config):
    tid = identifier(config.get('install_table'))
    fields = {f['field_name']: f for f in items(api, '/tables/' + tid + '/fields')}
    if any(fields.get(n, {}).get('type') != k for n, k in dict(INSTALL_FIELDS, **{n:20 for n in INSTALL_METRICS}).items()):
        raise RuntimeError('安装统计表字段不完整，请联系发布者；不要自行新增统计表')
    rows = items(api, '/tables/' + tid + '/records')
    summaries = [r['fields'] for r in rows if text_of(r['fields'].get('记录类型')) == '汇总']
    if len(summaries) != 1:
        raise RuntimeError('安装总览应恰好有一行，未确认统计有效')
    if not all(n in summaries[0] for n in INSTALL_METRICS):
        raise RuntimeError('安装公式结果缺失，未确认统计有效')
    result = {'summary': summaries, 'records': [r for r in rows if matches(r['fields'], {'记录类型':'安装明细','数据类型':'正式'})]}
    if config.get('people_table'):
        result['people'] = items(api, '/tables/' + identifier(config['people_table']) + '/records')
    return result


def check(api, config, config_path):
    for key, expected in [('detail_table', DETAIL), ('summary_table', SUMMARY)]:
        tid = identifier(config.get(key))
        actual = {f['field_name']: f for f in items(api, '/tables/' + tid + '/fields')}
        if any(n not in actual or actual[n]['type'] != k for n, k in expected.items()):
            raise RuntimeError('数据表字段不匹配，请运行 prepare')
        if key == 'detail_table':
            df = actual
        else:
            expected_formulas = formulas(config['detail_table'], tid, df, actual)
            if any(actual.get(n, {}).get('property', {}).get('formula_expression') != e for n, e in expected_formulas.items()):
                raise RuntimeError('总统计公式不匹配，请运行 prepare')
    rows = items(api, '/tables/' + config['summary_table'] + '/records')
    modes = validate_summary(rows)
    installation = installation_stats(api, config) if config.get('install_table') else None
    profile_path = config_path.parent / 'profile.json'
    return {'status': 'ready', 'profile': read(profile_path) if profile_path.exists() else '首次使用请填写姓名、部门',
            'installation_summary': installation['summary'] if installation else '未配置安装统计表',
            'skill_count': len(SKILLS), 'summary_rows': len(rows), 'summary_modes': modes,
            'summary': [r['fields'] for r in rows if text_of(r['fields'].get('Skill ID')) == '全部']}


if __name__ == '__main__':
    raise SystemExit(main())
