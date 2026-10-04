/** K1—K4：按需重扫 frontmatter，正文只在实际调用时读取。 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const discoveryEvents = new Set(); // K2：进程级 event + name/path 去重。
export const CATALOG_HEADER = '以下技能用 `Skill` 工具调用：参数 `skill` 填名字，`args` 填纯文本';

function parseFrontmatter(text) {
  const data = parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.name !== 'string' || !data.name.trim()
    || typeof data.description !== 'string'
    || (data.context !== undefined && data.context !== 'fork')) {
    throw new Error('Invalid skill frontmatter: name/description/context');
  }
  return { name: data.name, description: data.description, context: data.context ?? null };
}

/** 有界缓冲读取文件前缀，遇到 frontmatter 结束线即停止，不加载正文。 */
function readFrontmatter(file) {
  const fd = openSync(file, 'r');
  const chunk = Buffer.alloc(256);
  const lines = [];
  let pending = Buffer.alloc(0);
  let opened = false;
  try {
    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) {
        if (opened && pending.toString('utf8').replace(/\r$/, '') === '---') {
          return parseFrontmatter(lines.join('\n'));
        }
        throw new Error('Missing or unterminated skill frontmatter');
      }
      pending = Buffer.concat([pending, chunk.subarray(0, count)]);
      let end;
      while ((end = pending.indexOf(10)) !== -1) {
        let line = pending.subarray(0, end).toString('utf8').replace(/\r$/, '');
        pending = pending.subarray(end + 1);
        if (!opened) {
          line = line.replace(/^\uFEFF/, '');
          if (line !== '---') throw new Error('Missing skill frontmatter');
          opened = true;
        } else if (line === '---') {
          return parseFrontmatter(lines.join('\n'));
        } else {
          lines.push(line);
        }
      }
    }
  } finally {
    closeSync(fd);
  }
}

function logOnce(log, event, key, fields) {
  const identity = JSON.stringify([event, key]);
  if (discoveryEvents.has(identity)) return;
  log(event, fields);
  discoveryEvents.add(identity);
}

export function discover(packageDir, log) {
  const root = path.join(packageDir, 'skills');
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  const groups = new Map();
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const file = path.join(directory, 'SKILL.md');
    let skill;
    try {
      skill = { ...readFrontmatter(file), directory, file };
    } catch (error) {
      logOnce(log, 'skill-skip', file, { path: file, reason: String(error.message ?? error) });
      continue;
    }
    const group = groups.get(skill.name) ?? [];
    group.push(skill);
    groups.set(skill.name, group);
  }
  const skills = new Map();
  for (const [name, group] of groups) {
    if (group.length > 1) {
      logOnce(log, 'skill-duplicate', name, { name, paths: group.map(skill => skill.file) });
    } else {
      skills.set(name, group[0]);
    }
  }
  return skills;
}

export function catalog(skills) {
  const rows = [...skills.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // 摘要用未截断的三个字段；context-only 或第 501 字之后变化仍触发完整替换。
  const digest = createHash('sha256').update(JSON.stringify(rows.map(
    ({ name, description, context }) => [name, description, context],
  ))).digest('hex');
  const text = [CATALOG_HEADER, ...(rows.length ? rows.map(
    skill => `- \`${skill.name}\`: ${Array.from(skill.description).slice(0, 500).join('')}`,
  ) : ['当前没有可用技能。'])].join('\n');
  return { digest, text };
}

export function readBody(skill) {
  const raw = readFileSync(skill.file, 'utf8');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Invalid skill frontmatter: ${skill.file}`);
  return match[2]; // 正文与末尾空白原样保留。
}
