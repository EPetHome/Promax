#!/usr/bin/env python3
"""I2 / SPEC 1.2：纯标准库渲染 SDK profile，不启动 dsh、安装器或模型。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys

TEMPLATE = Path(__file__).resolve().parent / 'profile'
FILES = ('cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml')


def absolute(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise argparse.ArgumentTypeError(f'path must be absolute: {value}')
    # 保留调用方的绝对路径（尤其解释器路径），不改成 symlink 的目标路径。
    return path


def render(args: argparse.Namespace) -> Path:
    for directory in (args.package, args.plugin, args.guard):
        if not directory.is_dir():
            raise ValueError(f'directory does not exist: {directory}')
    for file in (args.package / 'plugin.json', args.plugin / 'index.mjs', args.guard / 'index.mjs', args.python):
        if not file.is_file():
            raise ValueError(f'file does not exist: {file}')
    if not os.access(args.python, os.X_OK):
        raise ValueError(f'python is not executable: {args.python}')
    out = args.out
    if out.is_symlink() or out.resolve().is_relative_to(TEMPLATE.resolve()):
        raise ValueError('output must not be a symlink or inside the profile template')
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError(f'output must be absent or an empty directory: {out}')
    for name in FILES:
        if not (TEMPLATE / name).is_file():
            raise ValueError(f'missing template file: {name}')
    patch = (TEMPLATE / 'cordis.patch.yml').read_text(encoding='utf-8')
    replacements = {
        '__PROMAX_PACKAGE_DIR__': str(args.package),
        '__PROMAX_PLUGIN_ENTRY__': str(args.plugin / 'index.mjs'),
        '__PROMAX_GUARD_ENTRY__': str(args.guard / 'index.mjs'),
        '__PROMAX_PYTHON__': str(args.python),
        '__PROMAX_EMPTY_INSTRUCTIONS__': str(out / 'empty-instructions'),
    }
    # 单次替换不再扫描插入的路径，防止路径本身包含另一个占位符时被误改。
    pattern = '|'.join(re.escape(json.dumps(key)) for key in replacements)
    counts = {key: patch.count(json.dumps(key)) for key in replacements}
    if any(count != 1 for count in counts.values()):
        raise ValueError('template path placeholders must each occur exactly once')
    patch = re.sub(pattern, lambda match: json.dumps(replacements[json.loads(match.group())], ensure_ascii=False), patch)
    if args.guard_boot_log is not None:
        patch, count = re.subn(r'^(\s*bootLog:)\s*[^\n]*$',
                              lambda match: match[1] + ' ' + json.dumps(str(args.guard_boot_log), ensure_ascii=False),
                              patch, flags=re.MULTILINE)
        if count != 1:
            raise ValueError('template must contain exactly one guard bootLog')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'empty-instructions').mkdir()
    for name in FILES:
        if name != 'cordis.patch.yml':
            shutil.copyfile(TEMPLATE / name, out / name)
    (out / 'cordis.patch.yml').write_text(patch, encoding='utf-8')
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('package', 'plugin', 'guard', 'python', 'out'):
        parser.add_argument('--' + flag, type=absolute, required=True)
    parser.add_argument('--guard-boot-log', type=absolute)
    args = parser.parse_args()
    try:
        out = render(args)
    except (OSError, ValueError) as error:
        print(f'render_profile: {error}', file=sys.stderr)
        return 1
    print(f'Generated SDK profile: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
