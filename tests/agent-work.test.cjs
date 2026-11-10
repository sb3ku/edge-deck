'use strict';
// Step lists and background work in Agent chats, from Claude Code and Codex logs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseActivity, parseClaudeActivity, createTaskBridge } = require('../lib/tasks.cjs');

const line = value => JSON.stringify(value) + '\n';
const at = n => `2026-11-05T18:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}Z`;
const now = Date.parse('2026-11-05T18:10:00Z');
const prompt = (text, time, promptId) => line({ type: 'user', timestamp: time, promptId, cwd: 'C:\\work\\edge-deck', message: { role: 'user', content: text } });
const toolUse = (id, name, input, time) => line({ type: 'assistant', timestamp: time, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, time, extra = {}) => line({ type: 'user', timestamp: time, ...(extra.details ? { toolUseResult: extra.details } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(extra.error ? { is_error: true } : {}) }] } });
const text = value => [{ type: 'text', text: value }];
const endTurn = time => line({ type: 'assistant', timestamp: time, message: { role: 'assistant', stop_reason: 'end_turn', content: text('Done for now.') } });
const statuses = activity => activity.steps.map(step => [step.text, step.status]);
const notice = (ids, status, summary) => `<task-notification>\n${ids.map(id => `<task-id>${id}</task-id>`).join('\n')}\n${status ? `<status>${status}</status>\n` : ''}<summary>${summary}</summary>\n</task-notification>`;

test('the step list follows update_plan, advance, done and start, wrap-up and new turns like the Claude app', () => {
  let log = prompt('Fix the build', at(0), 'p1')
    + toolUse('t1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'Read the code', status: 'in_progress' }, { content: 'Fix it', status: 'pending' }, { content: 'Run tests', status: 'pending' }, { content: '  ', status: 'pending' }], scope: 'first_task' }, at(1))
    + toolResult('t1', text('Plan shown (3 steps).'), at(2));
  assert.deepEqual(statuses(parseClaudeActivity(log, now)), [['Read the code', 'in_progress'], ['Fix it', 'pending'], ['Run tests', 'pending']], 'Blank steps are dropped');
  log += toolUse('t2', 'mcp__ccd_turn__update_plan', { advance: true }, at(3)) + toolResult('t2', text('Plan updated: step 2 of 3 is in progress.'), at(4));
  assert.deepEqual(statuses(parseClaudeActivity(log, now)).map(([, status]) => status), ['completed', 'in_progress', 'pending']);
  log += toolUse('t3', 'mcp__ccd_turn__update_plan', { done: [2], start: 3 }, at(5)) + toolResult('t3', text('Plan updated: step 3 of 3 is in progress.'), at(6));
  assert.deepEqual(statuses(parseClaudeActivity(log, now)).map(([, status]) => status), ['completed', 'completed', 'in_progress']);
  log += toolUse('t4', 'mcp__ccd_turn__update_plan', { advance: false }, at(7)) + toolResult('t4', 'Pass {items: [...]}', at(8), { error: true });
  assert.deepEqual(statuses(parseClaudeActivity(log, now)).map(([, status]) => status), ['completed', 'completed', 'in_progress'], 'A rejected call changes nothing');
  log += toolUse('t5', 'mcp__ccd_turn__wrap_up', { recap: 'All done.' }, at(9)) + toolResult('t5', text('Shown in the next-step box.'), at(10));
  const wrapped = parseClaudeActivity(log, now);
  assert.equal(wrapped.stepsWrapped, true, 'Wrap-up shows every step as done');
  assert.equal(wrapped.stepsTurn, true);
  assert.equal(parseClaudeActivity(log + prompt('Something else', at(30), 'p2'), now).stepsTurn, false, 'A new turn keeps the list but hides it');
});

test('a turn that ends with only its last step in progress ticks it, as the app does', () => {
  const log = prompt('Go', at(0), 'p1')
    + toolUse('t1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'One', status: 'completed' }, { content: 'Two', status: 'in_progress' }], scope: 'first_task' }, at(1))
    + toolResult('t1', text('Plan shown (2 steps).'), at(2)) + endTurn(at(3)) + line({ type: 'system', subtype: 'stop_hook_summary', timestamp: at(4) });
  assert.equal(parseClaudeActivity(log, now).stepsAutoTick, true, 'Shown as done once no agent from the turn is running');
});

test('Claude Code terminal sessions use TodoWrite and the task tools', () => {
  const todo = prompt('Go', at(0), 'p1') + toolUse('t1', 'TodoWrite', { todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }] }, at(1))
    + toolResult('t1', 'Todos have been modified successfully.', at(2));
  assert.deepEqual(statuses(parseClaudeActivity(todo, now)), [['Plan', 'completed'], ['Build', 'in_progress']]);
  const tasks = prompt('Go', at(0), 'p1')
    + toolUse('c1', 'TaskCreate', { subject: 'Write tests', description: 'PRIVATE DETAIL' }, at(1)) + toolResult('c1', 'Task #1 created successfully: Write tests', at(2), { details: { task: { id: '1' } } })
    + toolUse('c2', 'TaskCreate', { subject: 'Ship it' }, at(3)) + toolResult('c2', 'Task #2 created successfully: Ship it', at(4))
    + toolUse('u1', 'TaskUpdate', { taskId: '1', status: 'completed' }, at(5)) + toolResult('u1', 'Updated', at(6))
    + toolUse('u2', 'TaskUpdate', { taskId: '2', status: 'in_progress', subject: 'Ship the release' }, at(7)) + toolResult('u2', 'Updated', at(8));
  const activity = parseClaudeActivity(tasks, now);
  assert.deepEqual(statuses(activity), [['Write tests', 'completed'], ['Ship the release', 'in_progress']]);
  assert.doesNotMatch(JSON.stringify(activity), /PRIVATE/);
});

test('background shells, agents, workflows and monitors are followed by task id, never by command', () => {
  let log = prompt('Go', at(0), 'p1')
    + toolUse('b1', 'Bash', { command: 'SECRET-COMMAND --token=abc', description: 'Run the full test suite', run_in_background: true }, at(1))
    + toolResult('b1', 'Command running in background with ID: bk12345ab. Output is being written to: C:\\SECRET\\out', at(2), { details: { backgroundTaskId: 'bk12345ab' } })
    + toolUse('a1', 'Agent', { description: 'Refresh e2e tests', prompt: 'SECRET PROMPT' }, at(3))
    + toolResult('a1', text('Async agent launched successfully.\nagentId: ad0749c45fa9b5386 (internal ID x)\nThe agent is working in the background.'), at(4))
    + toolUse('w1', 'Workflow', { script: 'export const meta = { name: "SECRET" }' }, at(5))
    + toolResult('w1', text('Workflow launched in background. Task ID: ws8xo3eo6\nSummary: Review the batch\nRun ID: wf_6f9bd6ef-6b9'), at(6), { details: { status: 'async_launched', taskId: 'ws8xo3eo6', runId: 'wf_6f9bd6ef-6b9', workflowName: 'review', summary: 'Review the batch' } })
    + toolUse('m1', 'Monitor', { description: 'Watch the server log', command: 'SECRET tail' }, at(7)) + toolResult('m1', 'Monitor started (task mon12345, timeout 300000ms).', at(8))
    + toolUse('b2', 'PowerShell', { command: 'SECRET build', description: 'Long build' }, at(9))
    + toolResult('b2', 'Command did not complete within its 180s timeout and was moved to the background (ID: b98765432).', at(10))
    + toolUse('b3', 'Bash', { command: 'ls', description: 'List files' }, at(11)) + toolResult('b3', 'a.txt', at(12))
    + endTurn(at(13));
  let activity = parseClaudeActivity(log, now);
  assert.deepEqual(Object.values(activity.background).map(task => [task.id, task.kind, task.label]), [
    ['bk12345ab', 'command', 'Run the full test suite'], ['ad0749c45fa9b5386', 'agent', 'Refresh e2e tests'], ['ws8xo3eo6', 'workflow', 'Review the batch'],
    ['mon12345', 'monitor', 'Watch the server log'], ['b98765432', 'command', 'Long build']]);
  assert.equal(activity.background.ws8xo3eo6.runId, 'wf_6f9bd6ef-6b9');
  assert.doesNotMatch(JSON.stringify(activity), /SECRET/);

  log += line({ type: 'queue-operation', operation: 'enqueue', timestamp: at(20), content: notice(['bk12345ab'], 'completed', 'Background command "Run the full test suite" completed (exit code 0)') })
    + line({ type: 'attachment', timestamp: at(21), attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: notice(['mon12345'], null, 'Monitor event: "Watch the server log"') } })
    + line({ type: 'user', timestamp: at(22), promptId: 'p2', origin: { kind: 'task-notification' }, message: { role: 'user', content: notice(['ad0749c45fa9b5386'], 'completed', 'Agent "Refresh e2e tests" is waiting on its own background work') } })
    + toolUse('s1', 'TaskStop', { task_id: 'b98765432' }, at(23)) + toolResult('s1', '{"message":"Successfully stopped task: b98765432 (SECRET)"}', at(24))
    + line({ type: 'user', timestamp: at(25), promptId: 'p3', message: { role: 'user', content: notice(['ws8xo3eo6', 'ad0749c45fa9b5386'], 'stopped', '2 background tasks didn\'t finish before the previous session ended') } });
  activity = parseClaudeActivity(log, now);
  assert.deepEqual(Object.keys(activity.background), ['mon12345'], 'Completions, stops and restart notices end tasks; progress events and interim agent notices do not');
  assert.equal(activity.firstPrompt, 'Go', 'A task notification is not the chat\'s title');

  log += toolUse('r1', 'SendMessage', { to: 'ad0749c45fa9b5386', message: 'continue' }, at(30))
    + toolResult('r1', 'Resuming agent', at(31), { details: { success: true, resumedAgentId: 'ad0749c45fa9b5386' } });
  assert.equal(parseClaudeActivity(log, now).background.ad0749c45fa9b5386.label, 'Refresh e2e tests', 'A resumed agent runs again under its name');
});

test('Codex background terminals and sub-agents are followed until they end', () => {
  const event = (type, extra, time) => line({ type: 'event_msg', timestamp: time, payload: { type, ...extra } });
  const exec = (id, input, time) => line({ type: 'response_item', timestamp: time, payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input } });
  const output = (id, value, time) => line({ type: 'response_item', timestamp: time, payload: { type: 'custom_tool_call_output', call_id: id, output: value } });
  const call = (id, name, args, time) => line({ type: 'response_item', timestamp: time, payload: { type: 'function_call', namespace: 'collaboration', name, call_id: id, arguments: JSON.stringify(args) } });
  let log = event('task_started', {}, at(0))
    + exec('c1', 'const r = await tools.exec_command({cmd:"npm run dev --port=3000 SECRET"}); text(JSON.stringify(r))', at(1))
    + output('c1', 'Script completed\nWall time 10.0 seconds\nOutput:\n{"chunk_id":"a1b2c3","wall_time_seconds":10.0,"session_id":48213,"original_token_count":12,"output":"ready"}', at(11))
    + output('c9', 'Script completed\nOutput:\n{"session_id": 99, "note": "a program printing JSON is not a terminal"}', at(12))
    + call('s1', 'spawn_agent', { task_name: 'style_review', message: 'SECRET TASK' }, at(13))
    + event('item_completed', { item: { type: 'SubAgentActivity', id: 's1', kind: 'started', agent_thread_id: 'thread-1', agent_path: '/root/style_review' } }, at(14))
    + event('task_complete', {}, at(15));
  let activity = parseActivity(log, now);
  assert.equal(activity.status, 'finished');
  assert.deepEqual(Object.values(activity.background).map(task => [task.id, task.kind, task.label]), [['terminal-48213', 'command', 'npm run dev'], ['agent-thread-1', 'agent', 'Style review']]);
  assert.doesNotMatch(JSON.stringify(activity.background), /SECRET|3000/);
  log += event('item_completed', { item: { type: 'CommandExecution', process_id: '48213', status: 'failed', exit_code: 1 } }, at(20))
    + event('item_completed', { item: { type: 'SubAgentActivity', id: 'subagent-completed-x', kind: 'completed', agent_thread_id: 'thread-1', agent_path: '/root/style_review' } }, at(21));
  activity = parseActivity(log, now);
  assert.deepEqual(Object.keys(activity.background), []);
  log += call('f1', 'followup_task', { target: 'style_review', message: 'more' }, at(30))
    + event('item_completed', { item: { type: 'SubAgentActivity', id: 'f1', kind: 'interacted', agent_thread_id: 'thread-1', agent_path: '/root/style_review' } }, at(31))
    + call('m1', 'send_message', { target: 'style_review', message: 'fyi' }, at(32));
  assert.deepEqual(Object.keys(parseActivity(log, now).background), ['agent-thread-1'], 'A follow-up task restarts the agent');
  const plan = event('task_started', {}, at(0)) + line({ type: 'response_item', timestamp: at(1), payload: { type: 'function_call', name: 'update_plan', call_id: 'p1', arguments: JSON.stringify({ plan: [{ step: 'Find the bug', status: 'completed' }, { step: 'Fix it', status: 'in_progress' }] }) } });
  assert.deepEqual(statuses(parseActivity(plan, now)), [['Find the bug', 'completed'], ['Fix it', 'in_progress']]);
});

// A temporary Claude home with one session log (and, optionally, its workflow journal).
function claudeHome(t, rows, { journal } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-claude-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const session = '11111111-2222-3333-4444-555555555555', project = path.join(home, 'projects', 'C--work-edge-deck');
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, `${session}.jsonl`); fs.writeFileSync(file, rows);
  if (journal) {
    const folder = path.join(project, session, 'subagents', 'workflows', 'wf_1234abcd-abc'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'journal.jsonl'), journal);
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-codex-')); t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  return { home, file, session, codex: empty };
}
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const backgroundSession = () => prompt('Review the batch', ago(9), 'p1')
  + toolUse('t1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'Launch the review', status: 'completed' }, { content: 'Fix findings', status: 'in_progress' }, { content: 'Write docs', status: 'pending' }], scope: 'first_task' }, ago(8.9))
  + toolResult('t1', text('Plan shown (3 steps).'), ago(8.9))
  + toolUse('w1', 'Workflow', { script: 'export const meta = {}' }, ago(8.8))
  + toolResult('w1', text('Workflow launched in background. Task ID: ws1234567\nSummary: Review the batch\nRun ID: wf_1234abcd-abc'), ago(8.8), { details: { status: 'async_launched', taskId: 'ws1234567', runId: 'wf_1234abcd-abc', summary: 'Review the batch' } })
  + endTurn(ago(8.7)) + line({ type: 'system', subtype: 'stop_hook_summary', timestamp: ago(8.7) });

test('a chat whose turn ended stays listed while its background work runs, with its steps and workflow progress', async t => {
  const journal = [{ type: 'launched' }, { type: 'started', key: 'v2:a', agentId: 'x1', label: 'review:a' }, { type: 'started', key: 'v2:b', agentId: 'x2' }, { type: 'started', key: 'v2:c', agentId: 'x3' },
    { type: 'result', key: 'v2:a', agentId: 'x1', result: { findings: ['SECRET RESULT'] } }].map(line).join('');
  const { home, session, codex } = claudeHome(t, backgroundSession(), { journal });
  const state = await createTaskBridge({ claudeHome: home, codexHome: codex }).getState();
  const item = state.items.find(entry => entry.id === `claude-${session}`);
  assert.ok(item, JSON.stringify(state));
  assert.equal(item.status, 'background');
  assert.deepEqual(item.background.map(task => [task.kind, task.label, task.progress]), [['workflow', 'Review the batch', { done: 1, total: 3 }]]);
  assert.deepEqual(item.steps.map(step => step.status), ['completed', 'in_progress', 'pending'], 'The last turn\'s list stays while its work continues');
  assert.equal(item.startedAt, item.background[0].startedAt);
  assert.doesNotMatch(JSON.stringify(state), /SECRET|pendingTools|finishedBackground|cellCommands/);
});

test('background work of a session whose Claude Code process has exited is not shown', async t => {
  const { home, file, session, codex } = claudeHome(t, backgroundSession());
  const old = new Date(Date.now() - 3600000); fs.utimesSync(file, old, old);
  fs.mkdirSync(path.join(home, 'sessions'));
  const exited = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(path.join(home, 'sessions', `${exited}.json`), JSON.stringify({ pid: exited, sessionId: session }));
  assert.equal((await createTaskBridge({ claudeHome: home, codexHome: codex }).getState()).items.length, 0);
  fs.writeFileSync(path.join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: session }));
  const live = await createTaskBridge({ claudeHome: home, codexHome: codex }).getState();
  assert.equal(live.items[0]?.status, 'background', 'A running process keeps it listed');
});

test('a Codex chat between turns stays listed while a background terminal runs', async t => {
  const codex = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-codex-')); t.after(() => fs.rmSync(codex, { recursive: true, force: true }));
  const day = path.join(codex, 'sessions', '2026', '11', '07'); fs.mkdirSync(day, { recursive: true });
  const event = (type, extra, time) => line({ type: 'event_msg', timestamp: time, payload: { type, ...extra } });
  fs.writeFileSync(path.join(day, 'rollout-2026-11-07T10-00-00-thread.jsonl'), line({ type: 'session_meta', payload: { id: 'thread-main', source: 'vscode' } })
    + event('task_started', {}, ago(20))
    + line({ type: 'response_item', timestamp: ago(19), payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: 'await tools.exec_command({cmd:"pnpm dev"})' } })
    + line({ type: 'response_item', timestamp: ago(19), payload: { type: 'custom_tool_call_output', call_id: 'c1', output: '{"chunk_id":"0a0b0c","wall_time_seconds":10.0,"session_id":7,"output":""}' } })
    + event('task_complete', {}, ago(18)));
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-claude-')); t.after(() => fs.rmSync(claude, { recursive: true, force: true }));
  fs.mkdirSync(path.join(claude, 'projects'));
  const state = await createTaskBridge({ claudeHome: claude, codexHome: codex }).getState();
  assert.deepEqual(state.items.map(item => [item.agent, item.status, item.background.map(task => task.label)]), [['Codex', 'background', ['pnpm dev']]]);
});

test('notices written only to the transcript start no turn, and queued rows do not keep a turn alive', () => {
  const base = prompt('Go', at(0), 'p1') + endTurn(at(5)) + line({ type: 'system', subtype: 'stop_hook_summary', timestamp: at(5) });
  const restart = line({ type: 'user', timestamp: at(60), queueTranscriptOnly: true, origin: { kind: 'task-notification' }, message: { role: 'user', content: notice(['x1'], 'stopped', 'A task did not finish before the previous session ended') } });
  const activity = parseClaudeActivity(base + restart + line({ type: 'queue-operation', operation: 'enqueue', timestamp: at(120), content: 'x' }), now);
  assert.equal(activity.status, 'finished', 'No phantom Thinking turn');
  const real = parseClaudeActivity(base + restart + prompt('Next', at(400), 'p2'), Date.parse(at(410)));
  assert.equal(real.startedAt, at(400), 'The next real turn starts on time');
});

test('a hand-back from a background agent opens a turn, and prompts after reminders still count', () => {
  const peer = line({ type: 'user', timestamp: at(30), isMeta: true, promptId: 'p2', turnOrigin: 'peer', origin: { kind: 'peer' }, message: { role: 'user', content: 'Another Claude session says hi' } });
  const activity = parseClaudeActivity(prompt('Go', at(0), 'p1') + endTurn(at(5)) + peer, Date.parse(at(40)));
  assert.equal(activity.status, 'working'); assert.equal(activity.startedAt, at(30)); assert.equal(activity.firstPrompt, 'Go');
  const reminded = line({ type: 'user', timestamp: at(0), promptId: 'p1', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>context</system-reminder>' }, { type: 'text', text: 'Fix the sky' }] } });
  const typed = parseClaudeActivity(reminded, Date.parse(at(10)));
  assert.equal(typed.status, 'working'); assert.equal(typed.firstPrompt, 'Fix the sky');
});

test('shell output that mentions an ID is not a background task; resumes and interim notices keep agents running', () => {
  const grep = prompt('Go', at(0), 'p1') + toolUse('g1', 'Bash', { command: 'grep', description: 'Search' }, at(1))
    + toolResult('g1', 'Created user with ID: 3f2a9c1e. Done', at(2), { details: { stdout: 'x' } })
    + toolUse('g2', 'Bash', { command: 'cat', description: 'Read a log' }, at(3)) + toolResult('g2', 'job (ID: abcdef12) queued', at(4));
  assert.deepEqual(Object.keys(parseClaudeActivity(grep, now).background), []);
  let log = prompt('Go', at(0), 'p1') + toolUse('a1', 'Agent', { description: 'Refresh tests' }, at(1))
    + toolResult('a1', text('Async agent launched successfully.\nagentId: ad0749c45fa9b5386'), at(2))
    + line({ type: 'queue-operation', timestamp: at(10), content: notice(['ad0749c45fa9b5386'], 'killed', 'Agent "Refresh tests" was stopped by user') })
    + line({ type: 'queue-operation', timestamp: at(20), content: notice(['ad0749c45fa9b5386'], null, 'Agent "Refresh tests" was resumed by the user') });
  assert.equal(parseClaudeActivity(log, now).background.ad0749c45fa9b5386?.label, 'Refresh tests');
  log += line({ type: 'queue-operation', timestamp: at(30), content: notice(['ad0749c45fa9b5386'], 'completed', 'Agent "Refresh tests" finished') + ' The agent is being resumed with them and will notify again.' });
  assert.ok(parseClaudeActivity(log.replace('finished</summary>', 'finished. The agent is being resumed with them and will notify again.</summary>'), now).background.ad0749c45fa9b5386);
});

test('wrap-up waits for an agent from the turn that is still running, as the app does', async t => {
  const rows = prompt('Go', ago(9), 'p1')
    + toolUse('t1', 'mcp__ccd_turn__update_plan', { items: [{ content: 'Launch', status: 'in_progress' }, { content: 'Review', status: 'pending' }], scope: 'first_task' }, ago(8.9)) + toolResult('t1', text('Plan shown (2 steps).'), ago(8.9))
    + toolUse('a1', 'Agent', { description: 'Review it' }, ago(8.8)) + toolResult('a1', text('Async agent launched successfully.\nagentId: ad0749c45fa9b5386'), ago(8.8))
    + toolUse('w1', 'mcp__ccd_turn__wrap_up', { recap: 'x' }, ago(8.7)) + toolResult('w1', text('Shown.'), ago(8.7)) + endTurn(ago(8.6));
  const { home, codex } = claudeHome(t, rows);
  const item = (await createTaskBridge({ claudeHome: home, codexHome: codex }).getState()).items[0];
  assert.deepEqual(item.steps.map(step => step.status), ['in_progress', 'pending']);
});

test('usage: Codex limit windows and Claude Code activity today, each reply counted once', async t => {
  const codex = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-codex-')); t.after(() => fs.rmSync(codex, { recursive: true, force: true }));
  const day = path.join(codex, 'sessions', '2026', '11', '07'); fs.mkdirSync(day, { recursive: true });
  const resets = Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(path.join(day, 'rollout-2026-11-07T10-00-00-thread.jsonl'), line({ type: 'session_meta', payload: { id: 'thread-main', source: 'vscode' } })
    + line({ type: 'event_msg', timestamp: ago(30), payload: { type: 'token_count', rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: resets }, secondary: { used_percent: 69, window_minutes: 10080, resets_at: resets }, plan_type: 'pro' } } }));
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-deck-claude-')); t.after(() => fs.rmSync(claude, { recursive: true, force: true }));
  fs.mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true });
  const reply = (id, output) => line({ type: 'assistant', timestamp: ago(0.2), message: { id, role: 'assistant', content: [], usage: { output_tokens: output } } });
  fs.writeFileSync(path.join(claude, 'projects', 'p', '11111111-2222-3333-4444-555555555555.jsonl'), reply('m1', 100) + reply('m1', 100) + reply('m2', 50)
    + line({ type: 'assistant', timestamp: ago(0.1), isApiErrorMessage: true, apiErrorParams: { rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: resets } }, message: { id: 'e', role: 'assistant', content: [] } }));
  const { usage } = await createTaskBridge({ claudeHome: claude, codexHome: codex }).getState();
  assert.equal(usage.codex.plan, 'pro');
  assert.deepEqual(usage.codex.windows.map(w => [w.label, w.usedPercent]), [['5-hour', 12], ['Weekly', 69]]);
  assert.deepEqual(usage.claude.today, { requests: 2, output: 150 });
  assert.equal(usage.claude.limit.type, 'five_hour');
});

test('ChatGPT app: a chat working in the background appears until its work is done', () => {
  const { parseChatGptLog } = require('../lib/tasks.cjs');
  const row = (time, fields) => `${time} info [electron-message-handler] ${fields} rendererWebContentsId=2\n`;
  const id = '6aef1234-0000-4000-8000-000000000001';
  let chats = parseChatGptLog(row('2026-11-07T17:09:56.692Z', `chatgpt_conversation_async_status_updated asyncStatus=5 conversationId=${id}`)
    + row('2026-11-07T17:09:57.738Z', `chatgpt_conversation_refetch_completed asyncStatus=5 conversationId=${id} reason=explicit_update statusAfter=active-async-thinking statusBefore=idle`));
  assert.equal(chats.get(id).active, true); assert.equal(chats.get(id).startedAt, Date.parse('2026-11-07T17:09:56.692Z'));
  chats = parseChatGptLog(row('2026-11-07T17:10:17.010Z', `chatgpt_conversation_async_status_updated asyncStatus=4 conversationId=${id}`), chats);
  assert.equal(chats.get(id).active, false);
  // Rows without a status, and other events, change nothing.
  chats = parseChatGptLog(row('2026-11-07T17:11:00.000Z', `chatgpt_conversation_refetch_started conversationId=${id} statusBefore=idle`) + row('2026-11-07T17:11:01.000Z', 'chatgpt_pubsub_conversation_update_received'), chats);
  assert.equal(chats.get(id).active, false); assert.equal(chats.size, 1);
});

test('ChatGPT app: an ordinary message lists its chat for two minutes', async () => {
  const { createTaskBridge } = require('../lib/tasks.cjs');
  const os = require('node:os'), fsp = require('node:fs/promises'), path = require('node:path');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edge-deck-chatgpt-'));
  const at = Date.parse('2026-11-08T21:03:30.000Z'); let clock = at;
  const folder = path.join(root, 'OpenAI.Codex_test', 'LocalCache', 'Local', 'Codex', 'Logs', '2026', '11', '08');
  await fsp.mkdir(folder, { recursive: true });
  const open = '6af0e17f-0000-4000-8000-000000000001', elsewhere = '6aedca8f-0000-4000-8000-000000000002';
  const row = (time, fields) => `${time} info [electron-message-handler] ${fields} rendererWebContentsId=2\n`;
  const file = path.join(folder, 'codex-desktop-test.log');
  await fsp.writeFile(file, row('2026-11-08T21:03:09.156Z', `chatgpt_conversation_message_update_applied conversationId=${open} messageId=da4bd9a1`)
    + row('2026-11-08T21:03:12.000Z', `chatgpt_conversation_update_ignored conversationId=${elsewhere} reason=conversation_not_loaded updateType=message`)
    // A refetch of a chat that is not open is not a message.
    + row('2026-11-08T21:03:13.000Z', 'chatgpt_conversation_update_ignored conversationId=6aef2f4d-0000-4000-8000-000000000003 reason=conversation_not_loaded updateType=refetch'));
  await fsp.utimes(file, new Date(at), new Date(at));
  try {
    const bridge = createTaskBridge({ codexHome: path.join(root, 'no-codex'), claudeHome: path.join(root, 'no-claude'), chatgptPackages: root, now: () => clock });
    const chats = (await bridge.getState()).items.filter(item => item.agent === 'ChatGPT');
    assert.deepEqual(chats.map(item => item.id).sort(), [`chatgpt-${open}`, `chatgpt-${elsewhere}`].sort());
    assert.ok(chats.every(item => item.status === 'working' && item.activityLabel === 'Replying'));
    assert.equal(chats.find(item => item.id === `chatgpt-${open}`).startedAt, '2026-11-08T21:03:09.156Z');
    clock = at + 3 * 60000;
    assert.equal((await bridge.getState()).items.filter(item => item.agent === 'ChatGPT').length, 0);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
