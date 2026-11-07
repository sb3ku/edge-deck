const test=require('node:test');
const assert=require('node:assert/strict');
const {parseActivity}=require('../lib/tasks.cjs');
const row=(type,time='2026-11-05T18:00:00Z')=>JSON.stringify({type:'event_msg',timestamp:time,payload:{type}})+'\n';
const now=Date.parse('2026-11-05T18:00:10Z');
test('only completion events mark a task finished',()=>{
  assert.equal(parseActivity(row('task_started'),now).status,'working');
  assert.equal(parseActivity(row('task_started')+row('task_complete'),now).status,'finished');
  assert.equal(parseActivity(row('task_complete')+row('task_started'),now).status,'working');
  const activity=JSON.stringify({type:'response_item',timestamp:'2026-11-05T18:00:01Z',payload:{type:'function_call'}})+'\n';
  assert.equal(parseActivity(row('task_complete')+activity,now).status,'working');
});
test('aborted work is interrupted, stale work becomes unknown',()=>{
  assert.equal(parseActivity(row('task_started')+row('turn_aborted'),now).status,'interrupted');
  assert.equal(parseActivity(row('task_started'),now+360000).status,'unknown');
});
test('partial records do not invent a completed state',()=>{
  assert.equal(parseActivity(row('task_started')+'{"type":"event_msg"',now).status,'working');
  assert.equal(parseActivity('',now).status,'unknown');
});
test('working duration starts at the task start rather than the last tool event',()=>{
  const tool=JSON.stringify({type:'response_item',timestamp:'2026-11-05T18:05:00Z',payload:{type:'function_call'}})+'\n';
  const activity=parseActivity(row('task_started')+tool,Date.parse('2026-11-05T18:05:10Z'));
  assert.equal(activity.startedAt,'2026-11-05T18:00:00Z');assert.equal(activity.startedAtEstimated,false);
  const next=parseActivity(row('task_started')+row('task_complete')+row('task_started','2026-11-05T18:05:00Z'),Date.parse('2026-11-05T18:05:10Z'));
  assert.equal(next.startedAt,'2026-11-05T18:05:00Z');
});
test('shows visible progress without exposing reasoning or tool arguments',()=>{
  const message=JSON.stringify({type:'response_item',timestamp:'2026-11-05T18:00:01Z',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'Checking printer connections.'}]}})+'\n';
  const hidden=JSON.stringify({type:'response_item',timestamp:'2026-11-05T18:00:02Z',payload:{type:'reasoning',text:'PRIVATE REASONING'}})+'\n';
  const tool=JSON.stringify({type:'response_item',timestamp:'2026-11-05T18:00:03Z',payload:{type:'function_call',name:'apply_patch',arguments:'PRIVATE ARGUMENTS'}})+'\n';
  const activity=parseActivity(row('task_started')+message+hidden+tool,now);
  assert.equal(activity.progressText,'Checking printer connections.');assert.equal(activity.activityLabel,'Editing files');
  assert.doesNotMatch(JSON.stringify(activity),/PRIVATE/);
});
test('Codex shows thinking between tool calls', () => {
  const call = JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:01Z', payload: { type: 'function_call', name: 'shell' } }) + '\n';
  const output = JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:02Z', payload: { type: 'function_call_output' } }) + '\n';
  const reasoning = JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:03Z', payload: { type: 'reasoning' } }) + '\n';
  assert.equal(parseActivity(row('task_started') + call, now).activityLabel, 'Running commands');
  assert.equal(parseActivity(row('task_started') + call + output, now).activityLabel, 'Thinking');
  assert.equal(parseActivity(row('task_started') + reasoning, now).activityLabel, 'Thinking');
});
test('Codex approval waits are inferred from the session policy and the pending call', () => {
  const settings = policy => JSON.stringify({ type: 'event_msg', timestamp: '2026-11-05T18:00:00Z', payload: { type: 'thread_settings_applied', thread_settings: { approval_policy: policy } } }) + '\n';
  const call = args => JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:01Z', payload: { type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: JSON.stringify(args) } }) + '\n';
  const output = JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:05Z', payload: { type: 'function_call_output', call_id: 'c1' } }) + '\n';
  const escalated = { cmd: 'npm install -g thing', sandbox_permissions: 'require_escalated', justification: 'Needs network access' };
  assert.equal(parseActivity(settings('never') + row('task_started') + call(escalated), now).approval, null, 'A session that never asks shows no approval');
  const waiting = parseActivity(settings('on-request') + row('task_started') + call(escalated), now);
  assert.equal(waiting.activityLabel, 'Waiting for your approval');
  assert.deepEqual(waiting.approval, { action: 'run a command', detail: 'npm install -g thing', reason: 'Needs network access', certain: true });
  assert.equal(parseActivity(settings('on-request') + row('task_started') + call({ cmd: 'ls' }), now).approval, null, 'Sandboxed commands run without asking');
  assert.equal(parseActivity(settings('untrusted') + row('task_started') + call({ command: ['git', 'status'] }), now).approval.detail, 'git status');
  assert.equal(parseActivity(settings('on-request') + row('task_started') + call(escalated) + output, now).approval, null, 'Output clears the wait');
  assert.equal(parseActivity(settings('on-request') + row('task_started') + call(escalated), now + 600000).status, 'working', 'A blocked chat stays visible');
});
test('Codex Desktop exec calls asking to leave the sandbox are detected', () => {
  const settings = JSON.stringify({ type: 'event_msg', timestamp: '2026-11-05T18:00:00Z', payload: { type: 'thread_settings_applied', thread_settings: { approval_policy: 'on-request' } } }) + '\n';
  const exec = input => JSON.stringify({ type: 'response_item', timestamp: '2026-11-05T18:00:01Z', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c2', input } }) + '\n';
  const waiting = parseActivity(settings + row('task_started') + exec('text(await tools.exec_command({cmd:"Get-CimInstance Win32_Processor","sandbox_permissions":"require_escalated",justification:"Read CPU details"}))'), now);
  assert.equal(waiting.activityLabel, 'Waiting for your approval');
  assert.deepEqual(waiting.approval, { action: 'run a command', detail: 'Get-CimInstance Win32_Processor', reason: 'Read CPU details', certain: true });
  assert.equal(parseActivity(settings + row('task_started') + exec('await tools.exec_command({cmd:"ls"})'), now).approval, null, 'Sandboxed commands run without asking');
  const two = parseActivity(settings + row('task_started') + exec('await tools.exec_command({cmd:"ls"}); await tools.exec_command({cmd:"winget install x",sandbox_permissions:"require_escalated"})'), now);
  assert.equal(two.approval.detail, 'winget install x', 'The escalated command of several is shown');
});
