/** M1: WorkBuddy names/framing over the public dsh continuable-child seam. */
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const name = 'promax-wb-team';
export const inject = ['tools', 'subagents'];
const SOURCE = { kind: 'plugin:promax-wb-host' };
const str = { type: 'string' };
const output = { schema: str, render: (_args, value) => [{ type: 'text', text: value }] };
const parameters = (properties, required) => ({ type: 'object', properties, required, additionalProperties: true });
const text = value => [{ type: 'text', text: value }];
const envelope = (sender, summary, content) => `<teammate-message teammate_id="${sender}" summary="${summary}">\n${content}\n</teammate-message>`;
const isLead = agent => !agent.session.header.parentSession && agent.session.header.origin !== 'subagent';
const NOT_IN_TEAM = 'Not in a team. SendMessage is only available when you are in a team or have background agents running.';

// R1: ids come from teamInfo; files come from agents[], not a second roster.
function readRoster(packageDir) {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'plugin.json'), 'utf8'));
  const files = new Map(manifest.agents.map(file => [path.basename(file, '.md'), path.resolve(packageDir, file)]));
  const leadId = manifest.teamInfo.leadAgent;
  const leadFile = files.get(leadId);
  if (!leadFile) throw new Error(`Missing Lead definition: ${leadId}`);
  const members = new Map();
  for (const id of manifest.teamInfo.memberAgents) {
    const file = files.get(id);
    if (!file) throw new Error(`Missing member definition: ${id}`);
    const raw = readFileSync(file, 'utf8');
    members.set(id, raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''));
  }
  return { leadId, leadRaw: readFileSync(leadFile, 'utf8'), members };
}

export function apply(ctx, config) {
  const packageDir = path.resolve(config.packageDir);
  if (!config.memberModel?.provider || !config.memberModel?.model) throw new Error('memberModel is required');
  let roster = readRoster(packageDir);
  const teams = new Map(); // Lead session id -> team; renaming does not discard children.
  const memberships = new Map(); // Stable child id -> immutable member identity, including cold children.
  const leadInjected = new Set();

  const role = agent => isLead(agent) ? 'lead' : memberships.get(agent.id)?.name ?? 'fork';
  const log = (agent, event, fields = {}) => {
    const cwd = agent?.session?.header?.cwd;
    if (!cwd) throw new Error('Cannot locate session cwd');
    const file = path.join(cwd, 'product-agent-output', 'wb-host.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ...fields, ts: new Date().toISOString(), event,
      session_id: agent.id, role: role(agent) }) + '\n', 'utf8');
  };
  const teamOf = agent => teams.get(isLead(agent) ? agent.id : memberships.get(agent.id)?.leadId);
  const getTeam = agent => {
    let team = teamOf(agent);
    if (!team) {
      if (!isLead(agent)) throw new Error(NOT_IN_TEAM);
      team = { leadId: agent.id, name: `_auto_${randomUUID()}`, members: new Map(), pending: new Map() };
      teams.set(agent.id, team);
    }
    return team;
  };
  const send = (agent, targetId, content, signal) => ctx.subagents.sendMessage(agent, targetId, text(content), { signal });

  // R2: mark only a committed user/message, not a potentially rejected pre-step.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message' && event.data.source?.kind === SOURCE.kind
      && event.data.content?.some(block => block.type === 'text' && block.text === roster.leadRaw)) {
      leadInjected.add(session.id);
    }
  });
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    roster = readRoster(packageDir); // R3, also refreshed on members' requests.
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    // dsh preserves agent-message attribution and adds its own first text block.
    // The public pre-step waterfall replaces ONLY that framing for our adjacent
    // team messages; identity, source and inbox/wake semantics remain dsh-owned.
    const messages = decision.messages.map(message => {
      const source = message.source;
      const sender = source?.senderSessionId;
      const member = memberships.get(sender);
      const receiver = memberships.get(agent.id);
      const adjacent = member?.leadId === agent.id || (receiver && receiver.leadId === sender);
      const blocks = message.content;
      if (source?.kind !== 'agent-message' || !adjacent || blocks?.[0]?.type !== 'text'
        || blocks[0].text !== `Agent ${sender} sent a message: ` || blocks[1]?.type !== 'text'
        || !/^(?:<teammate-message |\[shutdown_request )/.test(blocks[1].text)) return message;
      return { ...message, content: blocks.slice(1) };
    });
    // A resumed Lead already has a durable request/header: its first request
    // happened before this activation, even if this plugin's in-memory set is new.
    if (!isLead(agent) || leadInjected.has(agent.id) || agent.session.requestHeader() !== undefined) return { ...decision, messages };
    return { ...decision, messages: [{ id: randomUUID(), role: 'user', content: text(roster.leadRaw), source: SOURCE }, ...messages] };
  });

  const register = (tool, properties, required, description, execute) => ctx.tools.register({
    name: tool, description, parameters: parameters(properties, required), output,
    async execute(args, exec) {
      // Keep caller-supplied extras in a non-colliding field, including failures.
      log(exec.agent, 'tool-call', { tool, arguments: args });
      return execute(args, exec);
    },
  });

  register('TeamCreate', { team_name: str, description: str }, ['team_name'],
    'Register the team name; existing members are unchanged.', (args, exec) => {
      const team = getTeam(exec.agent);
      team.name = args.team_name;
      log(exec.agent, 'team-created', { team_name: team.name });
      return `Team "${team.name}" created.`;
    });

  const spawnResult = (member, team) => `Spawned successfully.\nagent_id: ${member.type}@${team.name}\nname: ${member.name}\nteam_name: ${team.name}\ntask_id: ${member.taskId}\nThe agent is now running and will receive instructions via mailbox.`;
  register('Agent', { description: str, name: str, prompt: str, subagent_type: str,
    run_in_background: { type: 'boolean' }, max_turns: { type: 'integer' } },
  ['description', 'prompt', 'subagent_type'], 'Start or wake a named background team member.', async (args, exec) => {
    const agent = exec.agent;
    if (!isLead(agent)) throw new Error('Agent is only available to team-lead');
    roster = readRoster(packageDir);
    const persona = roster.members.get(args.subagent_type);
    if (persona === undefined) throw new Error(`Unknown subagent_type: ${args.subagent_type}`);
    const team = getTeam(agent);
    const memberName = args.name ?? args.subagent_type;
    // Parallel calls for one name must wait for the same materialization.
    if (team.pending.has(memberName)) await team.pending.get(memberName);
    const current = team.members.get(memberName);
    if (current && !current.closed) {
      await send(agent, current.id, envelope('team-lead', `Initial task assignment for ${memberName}`, args.prompt), exec.signal);
      log(agent, 'member-continued', { child_session_id: current.id, name: memberName, task_id: current.taskId });
      return spawnResult(current, team);
    }
    // The public childId option allows membership to exist before the child can
    // run its first tool; no race against agent/created or the initial request.
    const member = { id: randomUUID(), leadId: agent.id, name: memberName,
      type: args.subagent_type, taskId: `agent-${randomBytes(8).toString('hex')}`, closed: false };
    memberships.set(member.id, member);
    const pending = ctx.subagents.startContinuable({ provider: 'spawn', label: args.description,
      childId: member.id, signal: exec.signal, request: { parent: agent,
        prompt: text(envelope('team-lead', `Initial task assignment for ${memberName}`, args.prompt)),
        persona, agentOptions: config.memberModel, maxDepth: ctx.subagents.resolveMaxDepth() } });
    team.pending.set(memberName, pending);
    try {
      await pending;
      team.members.set(memberName, member);
      log(agent, 'member-started', { child_session_id: member.id, name: memberName,
        subagent_type: member.type, team_name: team.name, task_id: member.taskId });
      return spawnResult(member, team);
    } catch (error) {
      memberships.delete(member.id);
      throw error;
    } finally {
      team.pending.delete(memberName);
    }
  });

  register('SendMessage', { type: { type: 'string', enum: ['message', 'shutdown_request', 'shutdown_response'] },
    recipient: str, content: str, summary: str, request_id: str, approve: { type: 'boolean' } }, ['type'],
  'Send a team mailbox message or a shutdown request/response.', async (args, exec) => {
    const agent = exec.agent;
    const team = teamOf(agent);
    if (!team) throw new Error(NOT_IN_TEAM);
    const member = memberships.get(agent.id);
    const sender = isLead(agent) ? 'team-lead' : member?.name;
    const aliases = new Set(['team-lead', roster.leadId, 'main']);
    if (args.type === 'shutdown_response') {
      if (!member) throw new Error('shutdown_response is only available to members');
      const content = JSON.stringify({ type: 'shutdown_response', request_id: args.request_id ?? null,
        approve: args.approve ?? false, reason: Object.hasOwn(args, 'content') ? args.content : null });
      const summary = `Shutdown ${args.approve === false ? 'rejected' : 'accepted'} by ${member.name}`;
      await send(agent, team.leadId, envelope(sender, summary, content), exec.signal);
      member.closed = true; // S4: rejected responses close too; no forced dsh teardown.
      log(agent, 'member-closed', { request_id: args.request_id ?? null, approve: args.approve ?? false });
      return JSON.stringify({ success: true });
    }
    const target = aliases.has(args.recipient) ? { id: team.leadId } : team.members.get(args.recipient);
    if (!target) throw new Error(`Unknown recipient: ${args.recipient}`);
    if (member && target.id !== team.leadId) throw new Error('Members can only message team-lead');
    if (args.type === 'shutdown_request') {
      if (!isLead(agent) || target.id === team.leadId) throw new Error('shutdown_request is only available from team-lead to members');
      const requestId = `shutdown-${args.recipient}-${Date.now()}-${randomBytes(4).toString('hex')}`;
      await send(agent, target.id, `[shutdown_request ${requestId}]\n${args.content ?? ''}`, exec.signal);
      return `Shutdown request sent to "${args.recipient}" (request_id: ${requestId}). Wait for their shutdown_response.`;
    }
    const content = args.content ?? '';
    const summary = args.summary ?? Array.from(content).slice(0, 30).join('');
    await send(agent, target.id, envelope(sender, summary, content), exec.signal);
    return JSON.stringify({ success: true, message: `Message sent to ${args.recipient}'s inbox`,
      routing: { sender, target: `@${args.recipient}`, summary, content } });
  });

  register('present_files', { files: { type: 'array', items: str }, explanation: str, cwd: str }, ['files'],
    'Present existing files and append their absolute paths to the delivery log.', (args, exec) => {
      const cwd = path.resolve(exec.agent.session.header.cwd, args.cwd ?? '.');
      const files = args.files.map(file => path.resolve(cwd, file));
      const missing = files.filter(file => !existsSync(file));
      if (missing.length) throw new Error(`Files not found: ${missing.join(', ')}`);
      const explanation = args.explanation ?? '';
      log(exec.agent, 'present', { files, explanation });
      return JSON.stringify({ type: 'present_files_result', files, previewed: [], explanation });
    });
}
