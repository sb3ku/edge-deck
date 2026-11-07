const test=require('node:test');
const assert=require('node:assert/strict');
const {parseClaudeActivity}=require('../lib/tasks.cjs');
const line=value=>JSON.stringify(value)+'\n';
const prompt=(text,time='2026-11-05T18:00:00Z')=>line({type:'user',timestamp:time,cwd:'C:\\work\\edge-deck',message:{role:'user',content:text}});
const assistant=(content,stop,time='2026-11-05T18:00:05Z')=>line({type:'assistant',timestamp:time,message:{role:'assistant',stop_reason:stop,content}});
const now=Date.parse('2026-11-05T18:00:10Z');
test('a Claude Code prompt starts work and end_turn finishes it',()=>{
  const working=parseClaudeActivity(prompt('Fix the build')+assistant([{type:'tool_use',name:'Bash',input:{command:'PRIVATE COMMAND'}}],'tool_use'),now);
  assert.equal(working.status,'working');assert.equal(working.startedAt,'2026-11-05T18:00:00Z');assert.equal(working.startedAtEstimated,false);
  assert.equal(working.activityLabel,'Running commands');assert.equal(working.project,'edge-deck');assert.equal(working.firstPrompt,'Fix the build');
  assert.doesNotMatch(JSON.stringify(working),/PRIVATE/);
  const done=parseClaudeActivity(prompt('Fix the build')+assistant([{type:'text',text:'Done.'}],'end_turn','2026-11-05T18:00:08Z'),now);
  assert.equal(done.status,'finished');
});
test('tool results keep work going and interruptions stop it',()=>{
  const result=line({type:'user',timestamp:'2026-11-05T18:00:06Z',message:{role:'user',content:[{type:'tool_result',content:'PRIVATE OUTPUT'}]}});
  const activity=parseClaudeActivity(prompt('Go')+assistant([{type:'tool_use',name:'Edit'}],'tool_use')+result,now);
  assert.equal(activity.status,'working');assert.doesNotMatch(JSON.stringify(activity),/PRIVATE/);
  assert.equal(parseClaudeActivity(prompt('Go')+prompt('[Request interrupted by user]','2026-11-05T18:00:06Z'),now).status,'interrupted');
});
test('shows visible text and titles, never thinking',()=>{
  const title=line({type:'custom-title',customTitle:'Edge Deck redesign'});
  const activity=parseClaudeActivity(title+prompt('Go')+assistant([{type:'thinking',thinking:'PRIVATE THOUGHT'},{type:'text',text:'Checking the media widget.'},{type:'tool_use',name:'Read'}],'tool_use'),now);
  assert.equal(activity.title,'Edge Deck redesign');assert.equal(activity.progressText,'Checking the media widget.');
  assert.equal(activity.activityLabel,'Reading the project');assert.doesNotMatch(JSON.stringify(activity),/PRIVATE/);
});
test('quiet sessions disappear, but a running tool gets longer',()=>{
  assert.equal(parseClaudeActivity(prompt('Go'),now+360000).status,'unknown');
  const running=prompt('Go')+assistant([{type:'tool_use',name:'Bash'}],'tool_use');
  assert.equal(parseClaudeActivity(running,now+180000).status,'working');
  assert.equal(parseClaudeActivity(running,now+700000).status,'unknown');
});
test('subagent sidechains and system prompts do not start work',()=>{
  const side=line({type:'user',timestamp:'2026-11-05T18:00:00Z',isSidechain:true,message:{role:'user',content:'subagent task'}});
  assert.equal(parseClaudeActivity(side,now).status,'unknown');
  assert.equal(parseClaudeActivity(prompt('<system-reminder>x</system-reminder>'),now).status,'unknown');
});
test('a finished tool switches the activity to thinking until the next action', () => {
  const result = line({ type: 'user', timestamp: '2026-11-05T18:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
  const ran = prompt('Go') + assistant([{ type: 'tool_use', name: 'Bash' }], 'tool_use');
  assert.equal(parseClaudeActivity(ran, now).activityLabel, 'Running commands');
  assert.equal(parseClaudeActivity(ran + result, now).activityLabel, 'Thinking');
  const next = ran + result + assistant([{ type: 'tool_use', name: 'Write' }], 'tool_use', '2026-11-05T18:00:08Z');
  assert.equal(parseClaudeActivity(next, now).activityLabel, 'Creating files');
  assert.equal(parseClaudeActivity(prompt('Go') + assistant([{ type: 'tool_use', name: 'Edit' }], 'tool_use'), now).activityLabel, 'Editing files');
  assert.equal(parseClaudeActivity(prompt('Go') + assistant([{ type: 'tool_use', name: 'mcp__ccd_turn__update_plan' }], 'tool_use'), now).activityLabel, 'Planning');
  assert.equal(parseClaudeActivity(prompt('Go') + assistant([{ type: 'tool_use', name: 'mcp__Claude_Browser__navigate' }], 'tool_use'), now).activityLabel, 'Browsing the web');
});
