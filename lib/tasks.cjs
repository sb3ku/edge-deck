const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createReadStream}=require('node:fs');
const {createInterface}=require('node:readline');
const {execFile}=require('node:child_process');
// The last complete lines of a log, and the byte offset just after them, so
// later reads can continue from there with only the appended lines.
async function readTailRange(file, maxBytes) {
  const handle=await fs.open(file,'r');
  try {
    const {size}=await handle.stat();
    const offset=Math.max(0,size-maxBytes), buffer=Buffer.alloc(Math.min(size,maxBytes));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
    const data=buffer.subarray(0,bytesRead), last=data.lastIndexOf(10);
    if(last<0)return {content:'',end:offset};
    const start=offset?data.indexOf(10)+1:0;
    return {content:start>last?'':data.subarray(start,last+1).toString('utf8'),end:offset+last+1};
  } finally {await handle.close();}
}
async function readTail(file, maxBytes=262144) {
  const handle=await fs.open(file,'r');
  try {
    const {size}=await handle.stat();
    const offset=Math.max(0,size-maxBytes), buffer=Buffer.alloc(Math.min(size,maxBytes));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
    let content=buffer.subarray(0,bytesRead).toString('utf8');
    if(offset) content=content.slice(content.indexOf('\n')+1);
    // Only consume complete JSONL records: a writer may still be appending.
    return content.slice(0,content.lastIndexOf('\n')+1);
  } finally {await handle.close();}
}

// ---- Step lists and background work -------------------------------------
// Shown as the agent apps show them. Only step wording and model-written task
// descriptions are read; commands, prompts, outputs and results never are.
function cleanText(value,limit=120){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);}
const stepStatus=value=>value==='completed'||value==='in_progress'?value:'pending';
const BACKGROUND_MAX_AGE=12*3600000;
function setSteps(activity,items){
  activity.steps=(Array.isArray(items)?items:[]).filter(item=>item&&typeof item==='object'&&typeof item.content==='string'&&item.content.trim()).slice(0,12)
    .map(item=>({...(item.id!==undefined?{id:String(item.id).slice(0,40)}:{}),text:cleanText(item.content),...(typeof item.activeForm==='string'&&item.activeForm.trim()?{active:cleanText(item.activeForm)}:{}),status:stepStatus(item.status)}));
  activity.stepsWrapped=false;activity.stepsAutoTick=false;activity.stepsTurn=true;
}
// Open background tasks by id, plus recently finished ones so a resumed agent keeps its name.
function addBackground(activity,task){
  const open={...activity.background};delete open[task.id];open[task.id]=task;
  const ids=Object.keys(open);for(const id of ids.slice(0,Math.max(0,ids.length-20)))delete open[id];
  activity.background=open;
}
function endBackground(activity,id){
  const task=activity.background[id];if(!task)return;
  const open={...activity.background};delete open[id];activity.background=open;
  const done={...activity.finishedBackground,[id]:{kind:task.kind,label:task.label,...(task.runId?{runId:task.runId}:{})}};
  const ids=Object.keys(done);for(const old of ids.slice(0,Math.max(0,ids.length-30)))delete done[old];
  activity.finishedBackground=done;
}
function openBackground(activity,now){
  return Object.values(activity.background||{}).filter(task=>{const started=Date.parse(task.startedAt);return !Number.isFinite(started)||now-started<BACKGROUND_MAX_AGE;})
    .sort((a,b)=>(Date.parse(a.startedAt)||0)-(Date.parse(b.startedAt)||0)).map(({id,kind,label,startedAt})=>({id,kind,label,startedAt}));
}
// The list the app shows: only one set or updated in the current (or last) turn.
function visibleSteps(activity){
  if(!activity.stepsTurn||!activity.steps?.length)return [];
  const agents=Object.values(activity.background||{}).filter(task=>task.kind==='agent'||task.kind==='workflow');
  const wrapped=activity.stepsWrapped&&!agents.some(task=>!activity.wrapAt||Date.parse(task.startedAt)<=Date.parse(activity.wrapAt));
  const last=activity.steps.length-1,tick=activity.stepsAutoTick&&!agents.length;
  return activity.steps.map(({text,active,status},index)=>({text,...(active?{active}:{}),status:wrapped||(tick&&index===last)?'completed':status}));
}

// Codex does not log approval prompts. It asks only when a session's policy
// allows asking and a call needs it (an explicit request to leave the sandbox,
// or any command under 'untrusted'), so infer the wait from the pending call.
const ESCALATION=/["']?(?:sandbox_permissions["']?\s*:\s*["']require_escalated["']|with_escalated_permissions["']?\s*:\s*true\b)/;
const CMD=/["']?cmd["']?\s*:\s*("(?:[^"\\]|\\.)*")/, WHY=/["']?justification["']?\s*:\s*("(?:[^"\\]|\\.)*")/;
function jsString(source,pattern){const match=pattern.exec(source);if(!match)return '';try{return String(JSON.parse(match[1]));}catch{return match[1].slice(1,-1);}}
function callArguments(payload){
  if(typeof payload.input==='string'){
    // Codex Desktop logs commands as a custom_tool_call 'exec' whose input is
    // JavaScript calling tools.exec_command({cmd, sandbox_permissions, …}).
    const calls=payload.input.split(/\bexec_command\s*\(/).slice(1); // one input can run several commands
    const call=calls.find(source=>ESCALATION.test(source))??calls[0]??'';
    return {shell:calls.length>0,calls:calls.length,args:{cmd:jsString(call,CMD),justification:jsString(call,WHY),...(ESCALATION.test(call)?{sandbox_permissions:'require_escalated'}:{})}};
  }
  let args={};try{args=JSON.parse(payload.arguments||'{}');}catch{}
  return {shell:/shell|exec|command/.test(String(payload.name||'')),calls:1,args:args&&typeof args==='object'?args:{}};
}
function codexApproval(payload,policy) {
  if(!['on-request','untrusted','on-failure'].includes(policy))return null;
  const {shell,args}=callArguments(payload);
  const escalated=args.sandbox_permissions==='require_escalated'||args.with_escalated_permissions===true;
  if(!escalated&&!(policy==='untrusted'&&shell))return null;
  const command=Array.isArray(args.command)?args.command.map(String).join(' '):String(args.cmd??args.command??'');
  return {action:shell?'run a command':'make a change',detail:command.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,4000),reason:String(args.justification||'').slice(0,300),certain:escalated};
}
// A short name for a background terminal: the program and up to two plain
// words after it ("npm run dev"), never paths, flags or values.
function commandLabel(cmd){
  const words=String(cmd||'').trim().split(/\s+/);
  const program=(words[0]||'').replace(/^["'&]+|["']+$/g,'').split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat|ps1)$/i,'');
  if(!/^[\w.+-]{1,40}$/.test(program))return '';
  const rest=[];for(const word of words.slice(1,3)){if(!/^[a-z][\w:.-]{0,23}$/i.test(word)||/token|secret|key|pass|auth/i.test(word))break;rest.push(word);}
  return [program,...rest].join(' ');
}
// "/root/style_review" -> "Style review"
function agentLabel(agentPath){const name=cleanText(String(agentPath||'').split('/').filter(Boolean).pop(),60).replace(/[_-]+/g,' ').trim();return name?name[0].toUpperCase()+name.slice(1):'Sub-agent';}
function outputText(output){
  if(typeof output==='string')return output;
  return Array.isArray(output)?output.filter(part=>typeof part?.text==='string').map(part=>part.text).join('\n'):'';
}
// A still-running background terminal prints a result object with a session id.
const TERMINAL=/"chunk_id"\s*:\s*"[0-9a-f]{4,16}"[^{}]{0,240}?"session_id"\s*:\s*(\d{1,10})/g;
// Codex plan usage: each limit window's used share and when it resets.
function codexLimits(limits){
  const windows=[limits.primary,limits.secondary].filter(window=>window&&Number.isFinite(window.used_percent)).map(window=>{
    const minutes=Number(window.window_minutes)||0;
    return {label:minutes===10080?'Weekly':minutes===300?'5-hour':minutes>=1440?`${Math.round(minutes/1440)}-day`:`${Math.round(minutes/60)}-hour`,
      usedPercent:Math.max(0,Math.min(100,Number(window.used_percent))),resetsAt:Number.isFinite(window.resets_at)?new Date(window.resets_at*1000).toISOString():null};
  });
  return {plan:cleanText(limits.plan_type,20),windows};
}
function applyEvent(activity,line) {
    let row; try {row=JSON.parse(line);} catch {return;}
    const timestamp=row.timestamp && Number.isFinite(Date.parse(row.timestamp))?row.timestamp:null;
    if(timestamp)activity.updatedAt=timestamp;
    const p=row.payload;
    if(row.type==='event_msg' && p) {
      if(p.type==='thread_settings_applied')activity.approvalPolicy=String(p.thread_settings?.approval_policy||'').slice(0,40);
      if(p.type==='token_count'&&p.rate_limits&&typeof p.rate_limits==='object'&&timestamp)activity.limits={at:timestamp,value:codexLimits(p.rate_limits)};
      if(p.type==='task_started') {activity.status='working';activity.startedAt=timestamp;activity.startedAtEstimated=false;activity.activityLabel='Working';activity.progressText='';activity.approval=null;activity.pendingCall=null;activity.stepsTurn=false;}
      if(['task_complete','task_completed','turn_aborted','task_failed'].includes(p.type)) {
        activity.status=['task_complete','task_completed'].includes(p.type)?'finished':'interrupted';
        activity.startedAt=null;activity.startedAtEstimated=false;activity.approval=null;activity.pendingCall=null;
      }
      if(['item_started','item_completed'].includes(p.type)) {
        const labels={WebSearch:'Searching the web',CommandExecution:'Running commands',FileChange:'Editing files',McpToolCall:'Using an app integration',CollabAgentToolCall:'Coordinating tasks',SubAgentActivity:'Coordinating tasks',Reasoning:'Thinking'};
        if(labels[p.item?.type])activity.activityLabel=p.type==='item_completed'&&activity.status==='working'?'Thinking':labels[p.item.type];
      }
      // Background work ends: a terminal's process exits; a sub-agent finishes (or is followed up).
      const item=p.type==='item_completed'?p.item:null;
      if(item?.type==='CommandExecution'&&item.process_id!==undefined&&item.process_id!==null){
        endBackground(activity,`terminal-${item.process_id}`);
        const ended={...activity.endedTerminals,[String(item.process_id)]:timestamp};const keys=Object.keys(ended);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete ended[key];activity.endedTerminals=ended;
      }
      if(item?.type==='SubAgentActivity'&&typeof item.agent_thread_id==='string'){
        const id=`agent-${item.agent_thread_id}`;
        if(item.kind==='started')addBackground(activity,{id,kind:'agent',label:agentLabel(item.agent_path),startedAt:timestamp});
        else if(item.kind==='completed'||item.kind==='interrupted')endBackground(activity,id);
        else if(item.kind==='interacted'&&activity.callNames[item.id]==='followup_task')addBackground(activity,{id,kind:'agent',label:activity.finishedBackground[id]?.label||agentLabel(item.agent_path),startedAt:timestamp});
      }
    }
    if(row.type==='response_item' && ['function_call','custom_tool_call','reasoning'].includes(p?.type)) {
      if(!activity.startedAt) {activity.startedAt=timestamp;activity.startedAtEstimated=true;}
      activity.status='working';
      if(p.type==='reasoning') {activity.activityLabel='Thinking';activity.approval=null;}
      else {
        const name=String(p.name||'');
        activity.pendingCall=typeof p.call_id==='string'?p.call_id:null;
        activity.approval=codexApproval(p,activity.approvalPolicy);
        activity.activityLabel=activity.approval?'Waiting for your approval':/web|search/.test(name)?'Searching the web':/apply_patch/.test(name)?'Editing files':/request_user_input/.test(name)?'Waiting for your reply':/collaboration|spawn_agent|send_message/.test(name)?'Coordinating tasks':/update_plan/.test(name)?'Planning':/^mcp/.test(name)?'Using an app integration':/view_image|read/.test(name)?'Reading the project':/shell|exec|command|terminal/.test(name)?'Running commands':'Working on your request';
        if(typeof p.call_id==='string'){
          // Remember call names (to tell follow-ups from messages) and each cell's command, for terminal names.
          const names={...activity.callNames,[p.call_id]:name};const keys=Object.keys(names);for(const key of keys.slice(0,Math.max(0,keys.length-200)))delete names[key];activity.callNames=names;
          const times={...activity.callTimes,[p.call_id]:timestamp};const stamps=Object.keys(times);for(const key of stamps.slice(0,Math.max(0,stamps.length-200)))delete times[key];activity.callTimes=times;
          const {calls,args}=callArguments(p);
          if(calls===1&&args.cmd){const cells={...activity.cellCommands,[p.call_id]:commandLabel(args.cmd)};const ids=Object.keys(cells);for(const key of ids.slice(0,Math.max(0,ids.length-100)))delete cells[key];activity.cellCommands=cells;}
        }
        // Each update_plan call carries the whole list.
        if(name==='update_plan'){try{const args=JSON.parse(p.arguments||'{}');if(Array.isArray(args.plan))setSteps(activity,args.plan.map(step=>({content:step?.step,status:step?.status})));}catch{}}
      }
    }
    // A finished tool hands control back to the model until its next action.
    if(row.type==='response_item' && ['function_call_output','custom_tool_call_output'].includes(p?.type)) {
      if(!activity.pendingCall||!p.call_id||p.call_id===activity.pendingCall){activity.approval=null;activity.pendingCall=null;}
      if(activity.status==='working')activity.activityLabel='Thinking';
      const text=outputText(p.output);
      if(text.includes('session_id'))for(const [,session] of text.matchAll(TERMINAL)){
        const id=`terminal-${session}`,ended=Date.parse(activity.endedTerminals[session]);
        const since=Date.parse(activity.callTimes[p.call_id])||(Date.parse(timestamp)-300000);
        if(Number.isFinite(ended)&&ended>=since)continue;
        if(!activity.background[id])addBackground(activity,{id,kind:'command',label:activity.cellCommands[p.call_id]||'Background terminal',startedAt:timestamp});
      }
    }
    // Only user-visible assistant progress is displayed. Reasoning, tool
    // results and internal agent messages are never surfaced; a call's command
    // is shown only while Codex is waiting for the user to approve it.
    if(row.type==='response_item' && p?.type==='message' && p.role==='assistant' && p.phase==='commentary' && Array.isArray(p.content)) {
      const text=p.content.filter(part=>part.type==='output_text').map(part=>part.text||'').join(' ').replace(/\s+/g,' ').trim();
      if(text){activity.progressText=text.slice(0,260);activity.activityLabel='In progress';}
    }
}
function freshActivity(){return {status:'unknown',updatedAt:null,startedAt:null,startedAtEstimated:false,activityLabel:'Working',progressText:'',approvalPolicy:'',approval:null,pendingCall:null,
  steps:[],stepsTurn:false,stepsWrapped:false,stepsAutoTick:false,wrapAt:null,background:{},finishedBackground:{},callNames:{},cellCommands:{},callTimes:{},endedTerminals:{}};}
function currentActivity(activity,now) {
  const next={...activity};
  // A chat blocked on the user's approval writes nothing, so keep it longer.
  const limit=next.approval?1800000:300000;
  if(next.status==='working' && (!next.updatedAt || now-Date.parse(next.updatedAt)>limit))next.status='unknown';
  return next;
}
function parseActivity(content, now=Date.now()) {
  const activity=freshActivity();
  for(const line of content.split('\n'))applyEvent(activity,line);
  return currentActivity(activity,now);
}
async function lineStart(file,start){
  if(start<=0)return 0;
  const handle=await fs.open(file,'r');
  try{
    const buffer=Buffer.alloc(65536);
    for(let offset=start-1;;offset+=buffer.length){
      const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
      if(!bytesRead)return offset;
      const newline=buffer.subarray(0,bytesRead).indexOf(10);
      if(newline>=0)return offset+newline+1;
    }
  }finally{await handle.close();}
}
async function readLifecycle(file,start=0,previous=freshActivity(),apply=applyEvent) {
  if(start>0&&!previous.aligned)start=await lineStart(file,start);
  const activity={...previous,aligned:true};let pending='',readOffset=start;
  for await (const chunk of createReadStream(file,{start,encoding:'utf8'})) {
    pending+=chunk;let end;
    while((end=pending.indexOf('\n'))>=0) {
      const line=pending.slice(0,end);pending=pending.slice(end+1);
      readOffset+=Buffer.byteLength(line+'\n','utf8');apply(activity,line);
    }
  }
  return {activity,readOffset};
}
// What the dashboard receives for a chat; internal bookkeeping stays here.
function publicActivity(activity){
  const {approvalPolicy,pendingCall,limits,steps,stepsTurn,stepsWrapped,stepsAutoTick,wrapAt,background,finishedBackground,callNames,cellCommands,callTimes,endedTerminals,pendingTools,promptId,mainAt,aligned,title,firstPrompt,awaitingTool,project,...visible}=activity;
  return visible;
}
function listedItem(activity,background,now){
  const working=activity.status==='working';
  return {...publicActivity(activity),...(working?{}:{approval:null,activityLabel:'Running in the background'}),status:working?'working':'background',steps:visibleSteps(activity),background,
    startedAt:working?activity.startedAt:background[0]?.startedAt||null,startedAtEstimated:working?activity.startedAtEstimated:false,
    elapsedSeconds:working&&activity.startedAt?Math.max(0,Math.floor((now-Date.parse(activity.startedAt))/1000)):null};
}
const QUIET_BACKGROUND=3*3600000;
function createCodexSource({home=process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),now=()=>Date.now()}={}) {
  let files=[],lastScan=0,cache=new Map();
  async function scan() {
    const root=path.join(home,'sessions');
    const years=(await fs.readdir(root,{withFileTypes:true})).filter(d=>d.isDirectory() && /^\d{4}$/.test(d.name)).map(d=>d.name).sort().reverse();
    const days=[];
    for(const year of years) {
      const months=(await fs.readdir(path.join(root,year),{withFileTypes:true})).filter(d=>d.isDirectory() && /^\d{2}$/.test(d.name)).map(d=>d.name).sort().reverse();
      for(const month of months) {
        const ds=(await fs.readdir(path.join(root,year,month),{withFileTypes:true})).filter(d=>d.isDirectory() && /^\d{2}$/.test(d.name)).map(d=>path.join(root,year,month,d.name)).sort().reverse();
        days.push(...ds);
      }
    }
    const found=[];
    for(const day of days) {
      for(const name of await fs.readdir(day)) if(/^rollout-.*\.jsonl$/.test(name)) found.push(path.join(day,name));
    }
    files=found;lastScan=now();
    const keep=new Set(files);for(const key of cache.keys()) if(!keep.has(key)) cache.delete(key);
  }
  return {invalidate(){lastScan=0;},async getState() {
    try {
      if(now()-lastScan>15000 || !lastScan) await scan();
      const childWaits=new Map();
      const names=new Map();
      try {for(const line of (await readTail(path.join(home,'session_index.jsonl'),1048576)).split('\n')) {try {const r=JSON.parse(line);names.set(r.id,String(r.thread_name).slice(0,160));} catch {}}} catch {}
      const stats=(await Promise.all(files.map(async file=>{try{return {file,stat:await fs.stat(file)};}catch{return null;}}))).filter(Boolean).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
      // The most recent rollouts, plus chats whose background work is still running.
      const ranked=stats.filter((entry,index)=>index<60||Object.keys(cache.get(entry.file)?.activity?.background||{}).length);
      const items=[];let limits=null;
      for(const {file,stat} of ranked) {
        let cached=cache.get(file);
        if(cached && cached.readOffset!==undefined && stat.size>=cached.readOffset && cached.size!==stat.size) {
          const latest=await readLifecycle(file,cached.readOffset,cached.activity);
          cached={...cached,...latest,size:stat.size,mtime:stat.mtimeMs};cache.set(file,cached);
        } else if(!cached || cached.size!==stat.size || cached.mtime!==stat.mtimeMs) {
          const h=await fs.open(file,'r');
          let meta;
          try {const b=Buffer.alloc(32768);const {bytesRead}=await h.read(b,0,b.length,0);meta=JSON.parse(b.subarray(0,bytesRead).toString('utf8').split('\n')[0]).payload;} catch {meta={};} finally {await h.close();}
          const skip=Boolean(meta.parent_thread_id || (typeof meta.source==='object' && meta.source?.subagent));
          cached={size:stat.size,mtime:stat.mtimeMs,skip,parent:meta.parent_thread_id||null,id:meta.id||path.basename(file),activity:parseActivity(await readTail(file),now())};
          // Recent chats are replayed further back (up to 16 MB): a turn, a
          // background terminal or a sub-agent can start long before the tail.
          if(cached.activity.status==='working'||now()-stat.mtimeMs<BACKGROUND_MAX_AGE)Object.assign(cached,await readLifecycle(file,Math.max(0,stat.size-16777216)));
          cache.set(file,cached);
        }
        const activity=currentActivity(cached.activity,now());
        if(activity.limits&&(!limits||Date.parse(activity.limits.at)>Date.parse(limits.at)))limits=activity.limits;
        // Sub-agents are not listed, but their approval waits block the parent chat.
        if(cached.skip){if(activity.status==='working'&&activity.approval&&cached.parent)childWaits.set(cached.parent,activity.approval);continue;}
        // Background work counts while the chat keeps writing; a terminal left by a closed app disappears after a few quiet hours.
        const background=now()-stat.mtimeMs<QUIET_BACKGROUND?openBackground(activity,now()):[];
        if(activity.status!=='working'&&!background.length)continue;
        items.push({id:cached.id,agent:'Codex',title:names.get(cached.id)||'Untitled Codex task',...listedItem(activity,background,now())});
      }
      for(const item of items)if(!item.approval&&childWaits.has(item.id)){item.approval=childWaits.get(item.id);item.activityLabel='Waiting for your approval';}
      items.sort((a,b)=>(b.status==='working')-(a.status==='working') || Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0));
      return {connected:true,source:'Codex local activity',items:items.slice(0,8),usage:limits?{...limits.value,updatedAt:limits.at}:null,message:'Working chats only. Activity is inferred locally; quiet chats disappear after 2 minutes.'};
    } catch {
      return {connected:false,source:'Codex local activity',items:[],error:'Local Codex activity could not be read. ChatGPT web chats are not connected.'};
    }
  }};
}

// Claude Code (CLI and the desktop Code tab) writes one JSONL transcript per
// session under ~/.claude/projects/<project>/<session>.jsonl.
const claudeTools={Bash:'Running commands',PowerShell:'Running commands',Monitor:'Running commands',Write:'Creating files',Edit:'Editing files',MultiEdit:'Editing files',NotebookEdit:'Editing files',Read:'Reading the project',Grep:'Reading the project',Glob:'Reading the project',WebSearch:'Searching the web',WebFetch:'Searching the web',Agent:'Coordinating agents',Task:'Coordinating agents',Workflow:'Coordinating agents',SendMessage:'Coordinating agents',AskUserQuestion:'Waiting for your reply',ExitPlanMode:'Waiting for your reply',TodoWrite:'Planning',ToolSearch:'Thinking',Skill:'Thinking'};
function claudeToolLabel(name){
  if(Object.hasOwn(claudeTools,name))return claudeTools[name];
  if(/^mcp__.*(?:update_plan|wrap_up|mark_chapter)$/.test(name))return 'Planning';
  if(/^mcp__(?:Claude_Browser|claude-in-chrome)__/.test(name))return 'Browsing the web';
  return name.startsWith('mcp__')?'Using an app integration':'Working on your request';
}
function claudeText(content){
  if(typeof content==='string')return content;
  return Array.isArray(content)?content.filter(part=>part?.type==='text').map(part=>part.text||'').join(' '):'';
}
function freshClaudeActivity(){return {...freshActivity(),title:'',firstPrompt:'',awaitingTool:false,project:'',promptId:'',pendingTools:{}};}
// The parts of a tool call needed to follow step lists and background work;
// the call is applied when its result arrives without an error.
const BACKGROUND_TOOLS=new Set(['Bash','PowerShell','Agent','Task','Monitor']);
function rememberTool(activity,tool){
  const name=String(tool?.name||''),input=tool?.input&&typeof tool.input==='object'?tool.input:{};
  if(typeof tool?.id!=='string')return;
  let kept=null;
  if(/^mcp__ccd_turn__update_plan$/.test(name))kept={items:input.items,advance:input.advance,done:input.done,start:input.start};
  else if(/^mcp__ccd_turn__wrap_up$/.test(name)||name==='Workflow'||name==='TaskList'||name==='SendMessage')kept={};
  else if(name==='TodoWrite')kept={todos:input.todos};
  else if(name==='TaskCreate')kept={subject:cleanText(input.subject),active:cleanText(input.activeForm)};
  else if(name==='TaskUpdate')kept={taskId:String(input.taskId??''),status:input.status,...(typeof input.subject==='string'?{subject:cleanText(input.subject)}:{}),...(typeof input.activeForm==='string'?{active:cleanText(input.activeForm)}:{})};
  else if(BACKGROUND_TOOLS.has(name))kept={description:cleanText(input.description,100)};
  else if(name==='TaskStop'||name==='KillShell'||name==='KillBash')kept={taskId:String(input.task_id??input.shell_id??'')};
  if(!kept)return;
  const pending={...activity.pendingTools,[tool.id]:{name,...kept}};
  const ids=Object.keys(pending);for(const id of ids.slice(0,Math.max(0,ids.length-200)))delete pending[id];
  activity.pendingTools=pending;
}
function applyPlan(activity,call){
  if(Array.isArray(call.items)){setSteps(activity,call.items);return;}
  // advance completes the step in progress and starts the next pending one;
  // done and start take 1-based step numbers.
  const steps=activity.steps.map(step=>({...step}));
  const valid=n=>Number.isInteger(n)&&n>=1&&n<=steps.length;
  for(const n of Array.isArray(call.done)?call.done:[])if(valid(n))steps[n-1].status='completed';
  if(valid(call.start))steps[call.start-1].status='in_progress';
  if(call.advance===true||call.advance==='true'){
    const current=steps.findIndex(step=>step.status==='in_progress');
    if(current>=0)steps[current].status='completed';
    let next=steps.findIndex((step,index)=>index>current&&step.status==='pending');
    if(next<0)next=steps.findIndex(step=>step.status==='pending');
    if(next>=0)steps[next].status='in_progress';
  }
  activity.steps=steps;activity.stepsWrapped=false;activity.stepsTurn=true;
}
function toolResultText(content){
  if(typeof content==='string')return content;
  return Array.isArray(content)?content.filter(part=>part?.type==='text').map(part=>String(part.text||'')).join('\n'):'';
}
function applyToolResult(activity,row,result,timestamp){
  const id=result?.tool_use_id,call=typeof id==='string'?activity.pendingTools[id]:null;
  if(!call)return;
  const pending={...activity.pendingTools};delete pending[id];activity.pendingTools=pending;
  if(result.is_error)return;
  const text=toolResultText(result.content).slice(0,4000); // only the first lines are read
  const details=row.toolUseResult&&typeof row.toolUseResult==='object'&&!Array.isArray(row.toolUseResult)?row.toolUseResult:{};
  const name=call.name;
  if(/update_plan$/.test(name))applyPlan(activity,call);
  else if(/wrap_up$/.test(name)){activity.stepsWrapped=true;activity.wrapAt=timestamp;}
  else if(name==='TodoWrite')setSteps(activity,(Array.isArray(call.todos)?call.todos:[]).map(todo=>({content:todo?.content,activeForm:todo?.activeForm,status:todo?.status})));
  else if(name==='TaskCreate'){
    const taskId=String(details.task?.id??/^Task #(\S+) created/.exec(text)?.[1]??'');
    if(taskId&&call.subject){activity.steps=[...activity.steps.filter(step=>step.id!==taskId),{id:taskId,text:call.subject,...(call.active?{active:call.active}:{}),status:'pending'}].slice(-20);activity.stepsWrapped=false;activity.stepsTurn=true;}
  } else if(name==='TaskUpdate'&&call.taskId){
    activity.steps=activity.steps.filter(step=>!(step.id===call.taskId&&call.status==='deleted'))
      .map(step=>step.id===call.taskId?{...step,...(call.subject?{text:call.subject}:{}),...(call.active?{active:call.active}:{}),...(call.status?{status:stepStatus(call.status)}:{})}:step);
    activity.stepsWrapped=false;activity.stepsTurn=true;
  } else if(name==='TaskList'&&Array.isArray(details.tasks))setSteps(activity,details.tasks.filter(task=>task?.status!=='deleted').map(task=>({id:task?.id,content:task?.subject,status:task?.status})));
  else if(name==='Bash'||name==='PowerShell'){
    // Also a command moved to the background after a timeout or by the user.
    const object=row.toolUseResult&&typeof row.toolUseResult==='object'&&!Array.isArray(row.toolUseResult);
    const taskId=object?details.backgroundTaskId:/(?:^|\n)Command [^\n]*?(?:with ID: |\(ID: )([a-z0-9]{6,12})/.exec(text)?.[1];
    if(taskId)addBackground(activity,{id:String(taskId),kind:'command',label:call.description||'Background command',startedAt:timestamp});
  } else if(name==='Agent'||name==='Task'){
    if(details.status==='async_launched'||/Async agent launched/.test(text)){
      const taskId=details.agentId||/agentId: ([a-z0-9]{6,40})/.exec(text)?.[1];
      if(taskId)addBackground(activity,{id:String(taskId),kind:'agent',label:cleanText(details.description,100)||call.description||'Background agent',startedAt:timestamp});
    }
  } else if(name==='Workflow'){
    if(details.status==='async_launched'||/Workflow launched in background/.test(text)){
      const taskId=details.taskId||/Task ID: ([A-Za-z0-9_-]{4,40})/.exec(text)?.[1];
      const runId=details.runId||/Run ID: (wf_[A-Za-z0-9_-]{1,40})/.exec(text)?.[1];
      const label=cleanText(details.summary||/Summary: ([^\n]+)/.exec(text)?.[1]||details.workflowName,100)||'Workflow';
      if(taskId)addBackground(activity,{id:String(taskId),kind:'workflow',label,startedAt:timestamp,...(runId?{runId:String(runId)}:{})});
    }
  } else if(name==='Monitor'){
    const taskId=/Monitor started \(task ([A-Za-z0-9_-]{4,40})/.exec(text)?.[1];
    if(taskId)addBackground(activity,{id:taskId,kind:'monitor',label:call.description||'Monitor',startedAt:timestamp});
  } else if(['TaskStop','KillShell','KillBash'].includes(name)&&call.taskId)endBackground(activity,call.taskId);
  else if(name==='SendMessage'){
    // A message to a finished agent resumes it under the same id.
    const again=String(details.resumedAgentId||details.revivedAgentId||''),known=again&&activity.finishedBackground[again];
    if(known)addBackground(activity,{id:again,kind:known.kind,label:known.label,startedAt:timestamp});
  }
}
// <task-notification> blocks (in queue rows, prompts and queued messages) end
// background tasks. A block without a status is a progress event.
function applyNotifications(activity,text,timestamp){
  if(typeof text!=='string'||!text.includes('<task-notification>'))return;
  for(const [,body] of text.matchAll(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g)){
    const status=/<status>([^<]*)<\/status>/.exec(body)?.[1]?.trim();
    const summary=/<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1]||'';
    if(!status){
      if(/" was resumed by the user/.test(summary))for(const [,id] of body.matchAll(/<task-id>\s*([^<\s]{1,80})\s*<\/task-id>/g)){
        const known=activity.finishedBackground[id];
        addBackground(activity,{id,kind:known?.kind||'agent',label:known?.label||cleanText(/"([^"]+)"/.exec(summary)?.[1],100)||'Background agent',startedAt:timestamp,...(known?.runId?{runId:known.runId}:{})});
      }
      continue;
    }
    if(status==='completed'&&/waiting on its own background work|is being resumed with them and will notify again/.test(body))continue;
    for(const [,id] of body.matchAll(/<task-id>\s*([^<\s]{1,80})\s*<\/task-id>/g))endBackground(activity,id);
  }
}
function applyClaudeEvent(activity,line){
  let row;try{row=JSON.parse(line);}catch{return;}
  if(!row||typeof row!=='object')return;
  const timestamp=typeof row.timestamp==='string'&&Number.isFinite(Date.parse(row.timestamp))?row.timestamp:null;
  const previousMain=activity.mainAt;
  if(timestamp&&(!activity.updatedAt||Date.parse(timestamp)>=Date.parse(activity.updatedAt)))activity.updatedAt=timestamp;
  // Only the main thread's own rows keep a turn alive; queued notices from
  // sub-agents and attachments do not.
  if(timestamp&&['user','assistant','system'].includes(row.type)&&!row.isSidechain&&!row.queueTranscriptOnly&&(!activity.mainAt||Date.parse(timestamp)>=Date.parse(activity.mainAt)))activity.mainAt=timestamp;
  if(row.type==='custom-title'&&typeof row.customTitle==='string')activity.title=row.customTitle.slice(0,160);
  if(row.type==='summary'&&typeof row.summary==='string'&&!activity.title)activity.title=row.summary.slice(0,160);
  if(row.type==='queue-operation'){applyNotifications(activity,row.content,timestamp);return;}
  if(row.type==='attachment'){
    const attachment=row.attachment;
    if(attachment?.type==='queued_command')applyNotifications(activity,attachment.prompt,timestamp);
    // A snapshot of background work still running, written after a compaction.
    // A shell started without a description is registered under its command: never shown.
    else if(attachment?.type==='task_status'&&attachment.status==='running'&&typeof attachment.taskId==='string'&&!activity.background[attachment.taskId]){
      const kind=attachment.taskType==='local_agent'?'agent':attachment.taskType==='local_workflow'?'workflow':/monitor/.test(attachment.taskType||'')?'monitor':'command';
      let label=cleanText(attachment.description,100);const command=cleanText(attachment.shell?.command,100);
      if(kind==='command'||kind==='monitor'){if(!label||(command&&(command.startsWith(label)||label.startsWith(command))))label='';}
      addBackground(activity,{id:attachment.taskId,kind,label:label||(kind==='monitor'?'Monitor':kind==='command'?'Background command':'Background task'),startedAt:timestamp});
    }
    return;
  }
  // The end of a turn: the app ticks a last step left in progress.
  if(row.type==='system'){
    const steps=activity.steps;
    if(row.subtype==='stop_hook_summary')activity.stepsAutoTick=!activity.stepsWrapped&&steps.length>0&&steps.slice(0,-1).every(step=>step.status==='completed')&&steps.at(-1).status==='in_progress';
    return;
  }
  // A hand-back from a background agent or a message from another session
  // opens a turn too (the app keeps the step list of the last human turn).
  const opensTurn=row.type==='user'&&!row.queueTranscriptOnly&&!(Array.isArray(row.message?.content)&&row.message.content.some(part=>part?.type==='tool_result'));
  if(opensTurn&&!row.isSidechain&&(row.turnOrigin==='peer'||row.origin?.kind==='peer')){
    const stale=previousMain&&timestamp&&Date.parse(timestamp)-Date.parse(previousMain)>600000;
    if(activity.status!=='working'||!activity.startedAt||stale){activity.startedAt=timestamp;activity.startedAtEstimated=false;}
    if(row.promptId)activity.promptId=String(row.promptId);
    activity.status='working';activity.activityLabel='Thinking';activity.progressText='';activity.awaitingTool=false;
    return;
  }
  if(row.isSidechain||row.isMeta)return;
  if(typeof row.cwd==='string')activity.project=path.basename(row.cwd).slice(0,80);
  const content=row.message?.content;
  if(row.type==='user'){
    const parts=Array.isArray(content)?content:[];
    const results=parts.filter(part=>part?.type==='tool_result');
    // A finished tool hands control back to the model: it is thinking until
    // its next action is logged (thinking itself is only logged afterwards).
    if(results.length){for(const result of results)applyToolResult(activity,row,result,timestamp);activity.awaitingTool=false;if(activity.status==='working')activity.activityLabel='Thinking';return;}
    if(row.isCompactSummary)return;
    // A typed prompt can arrive after reminders the app adds; those are not the prompt.
    const prompt=claudeText(content).replace(/^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>)+/,'').replace(/\s+/g,' ').trim();
    const notice=prompt.startsWith('<task-notification>');
    if(notice)applyNotifications(activity,claudeText(content),timestamp);
    // Notices written only to the transcript (restarts, hand-backs already delivered) start no turn.
    if(row.queueTranscriptOnly===true)return;
    if(!prompt||/^<(?:command-|local-command|system-reminder)/.test(prompt))return;
    if(/^\[Request interrupted by user/.test(prompt)){activity.status='interrupted';activity.startedAt=null;activity.awaitingTool=false;return;}
    if(!notice&&!activity.firstPrompt)activity.firstPrompt=prompt.slice(0,120);
    // A new turn keeps the last list, but it is no longer current.
    if(row.promptId?String(row.promptId)!==activity.promptId:activity.status!=='working')activity.stepsTurn=false;
    if(row.promptId)activity.promptId=String(row.promptId);
    // A chat that went quiet without finishing (a crash or a closed app) starts afresh.
    const stale=previousMain&&timestamp&&Date.parse(timestamp)-Date.parse(previousMain)>600000;
    if(activity.status!=='working'||!activity.startedAt||stale){activity.startedAt=timestamp;activity.startedAtEstimated=false;}
    activity.status='working';activity.activityLabel='Thinking';activity.progressText='';activity.awaitingTool=false;
  }
  if(row.type==='assistant'&&Array.isArray(content)){
    if(!activity.startedAt){activity.startedAt=timestamp;activity.startedAtEstimated=true;}
    const tools=content.filter(part=>part?.type==='tool_use');
    for(const tool of tools)rememberTool(activity,tool);
    // Only text the assistant showed the user is surfaced; thinking and tool
    // inputs are never read into the dashboard.
    const text=claudeText(content).replace(/\s+/g,' ').trim();
    if(text)activity.progressText=text.slice(0,260);
    if(tools.length){
      const name=String(tools.at(-1).name||'');
      activity.activityLabel=claudeToolLabel(name);
      activity.status='working';activity.awaitingTool=true;
    } else if(['end_turn','stop_sequence'].includes(row.message.stop_reason)){
      activity.status='finished';activity.startedAt=null;activity.awaitingTool=false;
    } else if(activity.status==='working'&&!text)activity.activityLabel='Thinking';
  }
}
function currentClaudeActivity(activity,now){
  const next={...activity};
  // A running tool (a build or test command) can be silent for a while, and
  // so can thinking: Claude Code logs it only once it has finished.
  const limit=next.awaitingTool?600000:300000,last=next.mainAt||next.updatedAt;
  if(next.status==='working'&&(!last||now-Date.parse(last)>limit))next.status='unknown';
  return next;
}
function parseClaudeRaw(content,activity=freshClaudeActivity()){
  for(const line of content.split('\n'))applyClaudeEvent(activity,line);
  return activity;
}
function parseClaudeActivity(content,now=Date.now()){
  return currentClaudeActivity(parseClaudeRaw(content),now);
}
// A process ID that still exists (EPERM: it exists but belongs to someone else).
function processAlive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
function createClaudeSource({home=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),now=()=>Date.now()}={}){
  const cache=new Map(),journals=new Map();let files=[],lastScan=0,live={at:0,ids:null};
  async function scan(){
    const root=path.join(home,'projects');const found=[];
    for(const project of await fs.readdir(root,{withFileTypes:true})){
      if(!project.isDirectory())continue;
      let names=[];try{names=await fs.readdir(path.join(root,project.name));}catch{continue;}
      for(const name of names)if(/^[0-9a-f-]{36}\.jsonl$/i.test(name))found.push(path.join(root,project.name,name));
    }
    files=found;lastScan=now();
    const keep=new Set(files);for(const key of cache.keys())if(!keep.has(key))cache.delete(key);
  }
  // Sessions whose Claude Code process is running (~/.claude/sessions/<pid>.json).
  // Background work of a session whose process has exited is no longer running.
  // A registry entry names its process's start time (procStart, a Windows file
  // time); a process ID reused by another program does not match it.
  const starts=new Map();
  async function processStarts(pids){
    const need=pids.filter(pid=>!(starts.has(pid)&&now()-starts.get(pid).at<300000));
    if(need.length&&process.platform==='win32'){
      const output=await new Promise(resolve=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoProfile','-NonInteractive','-Command',`Get-Process -Id ${need.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { '{0} {1}' -f $_.Id, $_.StartTime.ToFileTimeUtc() }`],
        {windowsHide:true,timeout:10000},(error,stdout)=>resolve(error&&!stdout?null:String(stdout||''))));
      if(output!==null){
        for(const pid of need)starts.set(pid,{at:now(),value:null});
        for(const line of output.split(/\r?\n/)){const [pid,value]=line.trim().split(' ');if(/^\d+$/.test(pid)&&/^\d+$/.test(value||''))starts.set(Number(pid),{at:now(),value});}
      }
    }
    return starts;
  }
  async function liveSessions(){
    if(now()-live.at<10000)return live.ids;
    let ids=null;
    try{
      const dir=path.join(home,'sessions');const entries=await fs.readdir(dir);ids=new Set();const found=[];
      for(const name of entries){
        if(!/^\d{1,10}\.json$/.test(name))continue;
        try{const entry=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));if(typeof entry.sessionId==='string'&&Number.isInteger(entry.pid)&&processAlive(entry.pid))found.push(entry);}catch{}
      }
      const known=await processStarts(found.filter(entry=>/^\d+$/.test(String(entry.procStart??''))).map(entry=>entry.pid));
      for(const entry of found){
        const start=known.get(entry.pid);
        if(!/^\d+$/.test(String(entry.procStart??''))||!start||start.value===String(entry.procStart))ids.add(entry.sessionId);
      }
    }catch{ids=null;} // no registry (an older Claude Code): assume sessions are running
    live={at:now(),ids};return ids;
  }
  // Agents finished out of agents started, from a workflow run's journal. Only
  // the leading "type" and "key" fields of each line are read.
  async function workflowProgress(file,runId){
    if(!/^wf_[A-Za-z0-9_-]{1,40}$/.test(runId||''))return null;
    const journal=path.join(path.dirname(file),path.basename(file,'.jsonl'),'subagents','workflows',runId,'journal.jsonl');
    let stat;try{stat=await fs.stat(journal);}catch{return null;}
    const saved=journals.get(journal);if(saved&&saved.size===stat.size)return saved.progress;
    const started=new Set(),finished=new Set();
    try{
      const lines=createInterface({input:createReadStream(journal,{encoding:'utf8'}),crlfDelay:Infinity});
      for await (const line of lines){const head=line.slice(0,400);const type=/"type":"(started|result)"/.exec(head)?.[1],key=/"key":"([^"]{1,200})"/.exec(head)?.[1];if(type&&key)(type==='started'?started:finished).add(key);}
    }catch{return null;}
    const progress={done:[...finished].filter(key=>started.has(key)).length,total:started.size};
    journals.set(journal,{size:stat.size,progress});
    if(journals.size>40)journals.delete(journals.keys().next().value);
    return progress;
  }
  const usageFiles=new Map();
  const localDay=time=>{const date=new Date(time);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
  function applyUsage(usage,line){
    if(!line.includes('"usage"')&&!line.includes('quotaLimits')&&!line.includes('rate_limit_info'))return;
    let row;try{row=JSON.parse(line);}catch{return;}
    if(row?.type!=='assistant'||typeof row.timestamp!=='string')return;
    const quota=row.quotaLimits||row.apiErrorParams?.rate_limit_info;
    if(quota?.status==='rejected'&&Number.isFinite(quota.resetsAt))usage.limit={type:cleanText(quota.rateLimitType,20),resetsAt:new Date(quota.resetsAt*1000).toISOString(),at:row.timestamp};
    const id=row.message?.id,tokens=row.message?.usage;
    // A reply is written once per content block, each carrying the same usage.
    if(!id||!tokens||id===usage.lastId||row.isApiErrorMessage)return;
    usage.lastId=id;const day=localDay(row.timestamp);
    if(!usage.days[day])usage.days={...usage.days,[day]:{requests:0,output:0}};
    usage.days[day].requests++;usage.days[day].output+=Number(tokens.output_tokens)||0;
  }
  async function claudeUsage(stats){
    const today=localDay(now()),total={requests:0,output:0};let limit=null;
    for(const {file,stat} of stats){
      if(localDay(stat.mtimeMs)!==today)continue;
      let saved=usageFiles.get(file);
      if(!saved||stat.size<saved.readOffset)saved={readOffset:0,activity:{days:{},lastId:'',limit:null}};
      if(stat.size!==saved.size){const latest=await readLifecycle(file,saved.readOffset,saved.activity,applyUsage);saved={...latest,size:stat.size};usageFiles.set(file,saved);}
      const day=saved.activity.days[today];if(day){total.requests+=day.requests;total.output+=day.output;}
      const hit=saved.activity.limit;if(hit&&Date.parse(hit.resetsAt)>now()&&(!limit||Date.parse(hit.at)>Date.parse(limit.at)))limit=hit;
    }
    return {today:total,limit:limit&&{type:limit.type,resetsAt:limit.resetsAt}};
  }
  return {invalidate(){lastScan=0;},async getState(){
    try{
      if(now()-lastScan>15000||!lastScan)await scan();
      const running=await liveSessions();
      const stats=(await Promise.all(files.map(async file=>{try{return {file,stat:await fs.stat(file)};}catch{return null;}}))).filter(Boolean);
      const usage=await claudeUsage(stats).catch(()=>null);
      const recent=stats
        // Recently written logs, logs with background work still open, and (after a
        // restart) logs of running sessions whose background work keeps them quiet.
        .filter(entry=>entry&&(now()-entry.stat.mtimeMs<900000||Object.keys(cache.get(entry.file)?.activity?.background||{}).length
          ||(running?.has(path.basename(entry.file,'.jsonl'))&&now()-entry.stat.mtimeMs<BACKGROUND_MAX_AGE))).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs).slice(0,30);
      const items=[];
      for(const {file,stat} of recent){
        let cached=cache.get(file);
        if(cached&&stat.size>=cached.readOffset&&(cached.size!==stat.size||cached.mtime!==stat.mtimeMs)){
          // Apply only the lines appended since the last read.
          const latest=await readLifecycle(file,cached.readOffset,cached.activity,applyClaudeEvent);
          cached={...cached,...latest,size:stat.size,mtime:stat.mtimeMs};cache.set(file,cached);
        } else if(!cached||stat.size<cached.readOffset){
          // First read: replay the log (its last 32 MB at most), so the step
          // list and background work started long ago are known.
          const latest=await readLifecycle(file,Math.max(0,stat.size-33554432),freshClaudeActivity(),applyClaudeEvent);
          cached={size:stat.size,mtime:stat.mtimeMs,...latest};cache.set(file,cached);
        }
        const session=path.basename(file,'.jsonl');
        const activity=currentClaudeActivity(cached.activity,now());
        const alive=!running||running.has(session)||now()-stat.mtimeMs<900000;
        const background=alive?openBackground(activity,now()):[];
        if(activity.status!=='working'&&!background.length)continue;
        for(const task of background){const runId=activity.background[task.id]?.runId;if(task.kind==='workflow'&&runId){const progress=await workflowProgress(file,runId);if(progress?.total)task.progress=progress;}}
        items.push({id:'claude-'+session,agent:'Claude Code',project:activity.project,title:activity.title||activity.firstPrompt||'Claude Code session',...listedItem(activity,background,now())});
      }
      return {connected:true,items,usage};
    }catch(error){
      return {connected:false,items:[]};
    }
  }};
}
// ChatGPT chats in OpenAI's desktop app (the app that also hosts Codex). Its log
// records a chat's background work: "asyncStatus=5" with "statusAfter=active…"
// when a chat starts working on its own (long thinking, research, agent work)
// and "asyncStatus=4" / "statusAfter=idle" when it is done. Quick replies and
// chat titles are not logged, so only background work appears, unnamed.
function parseChatGptLog(text,chats=new Map()){
  for(const line of text.split('\n')){
    if(!line.includes('chatgpt_conversation_'))continue;
    const time=Date.parse(line.slice(0,24));
    const id=/conversationId=([0-9a-f-]{8,64})/i.exec(line)?.[1];
    if(!Number.isFinite(time)||!id)continue;
    const async=/asyncStatus=(\d+)/.exec(line)?.[1], after=/statusAfter=([a-z-]+)/.exec(line)?.[1];
    let active=null;
    if(async==='5'||/^active/.test(after||''))active=true;
    else if(async==='4'||after==='idle')active=false;
    if(active===null)continue;
    const chat=chats.get(id)||{id,startedAt:null,updatedAt:0,active:false};
    if(active&&!chat.active)chat.startedAt=time;
    chat.active=active;chat.updatedAt=Math.max(chat.updatedAt,time);chats.set(id,chat);
  }
  return chats;
}
function createChatGptSource({packages=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Packages'),now=()=>Date.now(),readFile=file=>readTail(file,1048576)}={}){
  async function logFiles(){
    let names=[];try{names=(await fs.readdir(packages)).filter(name=>/^OpenAI\.(Codex|ChatGPT)[^\\/]*_/i.test(name)&&!/Runtime/i.test(name));}catch{return [];}
    const files=[];
    for(const name of names)for(const back of [0,1]){
      const day=new Date(now()-back*86400000);
      const folder=path.join(packages,name,'LocalCache','Local','Codex','Logs',String(day.getFullYear()),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0'));
      let entries=[];try{entries=await fs.readdir(folder);}catch{continue;}
      for(const entry of entries)if(/^codex-desktop-.*\.log$/i.test(entry))files.push(path.join(folder,entry));
    }
    const stats=(await Promise.all(files.map(async file=>{try{return {file,mtime:(await fs.stat(file)).mtimeMs};}catch{return null;}}))).filter(Boolean);
    // Logs written in the last two hours only.
    return stats.filter(item=>now()-item.mtime<7200000).sort((a,b)=>a.mtime-b.mtime).map(item=>item.file);
  }
  return {invalidate(){},async getState(){
    try{
      const chats=new Map();
      for(const file of await logFiles())parseChatGptLog(await readFile(file),chats);
      // Background work with no news for 45 minutes is treated as finished.
      const items=[...chats.values()].filter(chat=>chat.active&&now()-chat.updatedAt<2700000).map(chat=>({
        id:`chatgpt-${chat.id}`,agent:'ChatGPT',title:'ChatGPT chat',project:'',status:'working',activityLabel:'Working in the background',
        startedAt:new Date(chat.startedAt||chat.updatedAt).toISOString(),updatedAt:new Date(chat.updatedAt).toISOString(),steps:[],background:[],approval:null,
      }));
      return {connected:true,items};
    }catch{return {connected:false,items:[]};}
  }};
}
function createTaskBridge({codexHome,claudeHome,chatgptPackages,now=()=>Date.now()}={}){
  const sources=[createCodexSource({...(codexHome?{home:codexHome}:{}),now}),createClaudeSource({...(claudeHome?{home:claudeHome}:{}),now}),createChatGptSource({...(chatgptPackages?{packages:chatgptPackages}:{}),now})];
  let inflight=null;
  // Callers asking at the same time (the poll and a file change) share one read.
  return {
    // A log was created or removed: rescan the folders on the next read.
    invalidate(){for(const source of sources)source.invalidate();},
    getState(){
      if(!inflight)inflight=read().finally(()=>{inflight=null;});
      return inflight;
    },
  };
  async function read(){
    const [codex,claude,chatgpt]=await Promise.all(sources.map(source=>source.getState()));
    const items=[...codex.items,...claude.items,...chatgpt.items].sort((a,b)=>(b.status==='working')-(a.status==='working')||Boolean(b.approval)-Boolean(a.approval)||Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).slice(0,8);
    const connected=codex.connected||claude.connected;
    return {connected,source:'Local agent activity',items,usage:{codex:codex.usage||null,claude:claude.usage||null},
      agents:{codex:codex.connected,claude:claude.connected,chatgpt:chatgpt.connected},
      message:'Working chats only, from Codex, Claude Code and the ChatGPT app on this PC. Quiet chats disappear after 5 minutes.',
      ...(connected?{}:{error:'Local agent activity could not be read. Web chats are not connected.'})};
  }
}
module.exports={createTaskBridge,parseActivity,parseClaudeActivity,parseChatGptLog,readTail,readLifecycle};
