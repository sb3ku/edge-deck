const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createCalendar,parseIcs,normalizeCalendarUrl,resolveZone,STALE_MESSAGE}=require('../lib/calendar.cjs');
const {createConfigStore}=require('../lib/config.cjs');
const {fetchCalendarFixture}=require('../scripts/calendar-fixture.cjs');

const NOW=new Date(2026,10,9,12,0,0).getTime(); // Monday 9 Nov 2026, local
const cal=(...events)=>['BEGIN:VCALENDAR','VERSION:2.0','X-WR-CALNAME:Home','X-APPLE-CALENDAR-COLOR:#FF2968FF',...events.flatMap(e=>['BEGIN:VEVENT',...e,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
const local=(y,m,d,h=0,mi=0)=>new Date(y,m-1,d,h,mi).toISOString();
const starts=(text,now=NOW)=>parseIcs(text,now).events.map(e=>e.start);

test('parses a simple event with folding, escaping, calendar name and colour',()=>{
  const text=cal(['UID:a','DTSTART:20261110T100000','DTEND:20261110T111500','SUMMARY:Plan\\, review\\; part\\nTwo','LOCATION:Room 1\\, Floor 2','DESCRIPTION:x','BEGIN:VALARM','TRIGGER:-PT5M','END:VALARM']).replace('Room 1','Ro\r\n om 1');
  const {events}=parseIcs(text,NOW);
  assert.equal(events.length,1);
  assert.deepEqual(events[0],{id:'a',title:'Plan, review; part Two',start:local(2026,11,10,10),end:local(2026,11,10,11,15),allDay:false,location:'Room 1, Floor 2',calendar:'Home',color:'#ff2968'});
});
test('all-day events, durations and missing end',()=>{
  const {events}=parseIcs(cal(['UID:d','DTSTART;VALUE=DATE:20261112','DTEND;VALUE=DATE:20261114','SUMMARY:Trip'],['UID:e','DTSTART:20261110T090000','DURATION:PT1H30M','SUMMARY:Call'],['UID:f','DTSTART;VALUE=DATE:20261111','SUMMARY:Day']),NOW);
  const by=Object.fromEntries(events.map(e=>[e.id,e]));
  assert.equal(by.d.allDay,true);assert.equal(by.d.start,local(2026,11,12));assert.equal(by.d.end,local(2026,11,14));
  assert.equal(by.e.end,local(2026,11,10,10,30));
  assert.equal(by.f.end,local(2026,11,12));
});
test('UTC, IANA, Windows and unknown time zones',()=>{
  const {events}=parseIcs(cal(['UID:u','DTSTART:20261110T100000Z','DTEND:20261110T110000Z','SUMMARY:U'],
    ['UID:i','DTSTART;TZID=Europe/Warsaw:20261110T100000','DTEND;TZID=Europe/Warsaw:20261110T110000','SUMMARY:I'],
    ['UID:w','DTSTART;TZID=Central European Standard Time:20261110T100000','DTEND;TZID=Central European Standard Time:20261110T110000','SUMMARY:W'],
    ['UID:g','DTSTART;TZID=W. Europe Standard Time:20261110T100000','SUMMARY:G'],
    ['UID:n','DTSTART;TZID=Eastern Standard Time:20261110T100000','SUMMARY:N'],
    ['UID:p','DTSTART;TZID=Pacific Standard Time:20261110T100000','SUMMARY:P'],
    ['UID:k','DTSTART;TZID=Nowhere/Land:20261110T100000','SUMMARY:K'],
    ['UID:l','DTSTART:20261110T100000','SUMMARY:L']),NOW);
  const by=Object.fromEntries(events.map(e=>[e.id,e.start]));
  assert.equal(by.u,'2026-11-10T10:00:00.000Z');
  assert.equal(by.i,'2026-11-10T09:00:00.000Z');assert.equal(by.w,by.i);assert.equal(by.g,by.i);
  assert.equal(by.n,'2026-11-10T15:00:00.000Z');assert.equal(by.p,'2026-11-10T18:00:00.000Z');
  assert.equal(by.k,local(2026,11,10,10));assert.equal(by.l,local(2026,11,10,10));
  assert.equal(resolveZone('Central European Standard Time'),'Europe/Warsaw');assert.equal(resolveZone('Nowhere/Land'),null);
});
test('cancelled events are skipped and broken ones do not hide the rest',()=>{
  const {events}=parseIcs(cal(['UID:c','DTSTART:20261110T100000','STATUS:CANCELLED','SUMMARY:No'],['UID:bad','DTSTART:garbage','SUMMARY:Bad'],['UID:ok','DTSTART:20261110T100000','SUMMARY:Yes']),NOW);
  assert.deepEqual(events.map(e=>e.id),['ok']);
});
test('only the window, sorted, max 200',()=>{
  const items=[['UID:old','DTSTART:20261107T100000','DTEND:20261107T110000','SUMMARY:old'],['UID:yday','DTSTART:20261108T100000','DTEND:20261108T110000','SUMMARY:yday'],['UID:far','DTSTART:20261220T100000','SUMMARY:far'],['UID:edge','DTSTART:20261214T100000','SUMMARY:edge'],['UID:early','DTSTART:20261109T080000','SUMMARY:early']];
  assert.deepEqual(parseIcs(cal(...items),NOW).events.map(e=>e.id),['yday','early','edge']);
  const many=Array.from({length:300},(_,i)=>[`UID:m${i}`,`DTSTART:20261110T${String(i%24).padStart(2,'0')}0000`,'SUMMARY:x']);
  assert.equal(parseIcs(cal(...many),NOW).events.length,200);
});
test('daily and weekly rules with interval, count, until and BYDAY',()=>{
  // 1,3,5,7,9 Nov: only the 9th is in the window
  assert.deepEqual(starts(cal(['UID:r','DTSTART:20261101T090000','RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5','SUMMARY:r'])),[local(2026,11,9,9)]);
  assert.deepEqual(starts(cal(['UID:r','DTSTART:20261109T090000','RRULE:FREQ=DAILY;UNTIL=20261111T235959','SUMMARY:r'])),[local(2026,11,9,9),local(2026,11,10,9),local(2026,11,11,9)]);
  assert.deepEqual(starts(cal(['UID:w','DTSTART:20261102T180000','RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6','SUMMARY:w'])),[local(2026,11,9,18),local(2026,11,11,18),local(2026,11,16,18),local(2026,11,18,18)]);
  assert.deepEqual(starts(cal(['UID:w','DTSTART:20261103T180000','RRULE:FREQ=WEEKLY;INTERVAL=2','SUMMARY:w'])),[local(2026,11,17,18),local(2026,12,1,18),local(2026,12,15,18)].slice(0,2));
});
test('monthly and yearly rules',()=>{
  assert.deepEqual(starts(cal(['UID:m','DTSTART:20260101T100000','RRULE:FREQ=MONTHLY;BYDAY=1MO','SUMMARY:m'])),[local(2026,12,7,10)]);
  assert.deepEqual(starts(cal(['UID:m','DTSTART:20260101T100000','RRULE:FREQ=MONTHLY;BYDAY=-1FR','SUMMARY:m'])),[local(2026,11,27,10)]);
  assert.deepEqual(starts(cal(['UID:m','DTSTART:20260101T100000','RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1','SUMMARY:m'])),[local(2026,11,15,10),local(2026,11,30,10)]);
  assert.deepEqual(starts(cal(['UID:y','DTSTART;VALUE=DATE:20200112','RRULE:FREQ=YEARLY;BYMONTH=11,12','SUMMARY:y'])),[local(2026,11,12),local(2026,12,12)]);
  assert.deepEqual(starts(cal(['UID:y','DTSTART;VALUE=DATE:20100110','RRULE:FREQ=YEARLY;COUNT=3','SUMMARY:y'])),[]);
  assert.deepEqual(starts(cal(['UID:y','DTSTART;VALUE=DATE:20200112','RRULE:FREQ=YEARLY','SUMMARY:y'])),[]);
});
test('EXDATE and RECURRENCE-ID overrides',()=>{
  const text=cal(['UID:s','DTSTART:20261102T090000','DTEND:20261102T100000','RRULE:FREQ=DAILY;COUNT=10','EXDATE:20261110T090000','SUMMARY:Standup'],
    ['UID:s','RECURRENCE-ID:20261111T090000','DTSTART:20261111T140000','DTEND:20261111T150000','SUMMARY:Standup moved'],
    ['UID:s','RECURRENCE-ID:20261112T090000','DTSTART:20261112T090000','STATUS:CANCELLED','SUMMARY:Standup']);
  const all=parseIcs(text,NOW).events;
  const events=all.filter(e=>e.start<local(2026,11,13));
  assert.deepEqual(events.map(e=>[e.title,e.start]),[['Standup',local(2026,11,8,9)],['Standup',local(2026,11,9,9)],['Standup moved',local(2026,11,11,14)]]);
  assert.equal(new Set(all.map(e=>e.id)).size,all.length);
  const allDay=cal(['UID:a','DTSTART;VALUE=DATE:20261109','RRULE:FREQ=DAILY;COUNT=3','EXDATE;VALUE=DATE:20261110','SUMMARY:a']);
  assert.deepEqual(starts(allDay),[local(2026,11,9),local(2026,11,11)]);
});
test('a time-zone rule keeps its wall-clock hour over daylight saving',()=>{
  const text=cal(['UID:z','DTSTART;TZID=America/New_York:20261101T090000','DTEND;TZID=America/New_York:20261101T100000','RRULE:FREQ=DAILY','SUMMARY:z']);
  const s=starts(text,new Date(2026,10,1,12).getTime());
  assert.ok(s.length>30);
  // 09:00 New York is 14:00 UTC in winter; the zone has been on winter time since 1 Nov 2026
  for(const value of s)assert.ok(value.endsWith('T14:00:00.000Z'),value);
  const summer=starts(cal(['UID:z','DTSTART;TZID=America/New_York:20261025T090000','RRULE:FREQ=DAILY','SUMMARY:z']),new Date(2026,9,25,12).getTime());
  assert.ok(summer.some(value=>value.endsWith('T13:00:00.000Z'))&&summer.some(value=>value.endsWith('T14:00:00.000Z')));
});

test('calendar links: https and webcal only, no credentials',()=>{
  assert.equal(normalizeCalendarUrl('webcal://calendar.example.com/a/b.ics?x=1'),'https://calendar.example.com/a/b.ics?x=1');
  assert.equal(normalizeCalendarUrl(' https://calendar.example.com/a.ics '),'https://calendar.example.com/a.ics');
  for(const bad of ['http://calendar.example.com/a.ics','ftp://x/y','file:///c:/a.ics','https://user:pw@calendar.example.com/a.ics','https://','javascript:alert(1)','','nonsense','https://a.example.com/'+'x'.repeat(2100),'https://a.example.com/a b',null,5])assert.throws(()=>normalizeCalendarUrl(bad),Error,String(bad).slice(0,40));
});

const response=(body,init={})=>new Response(body,{status:200,...init});
const secret='https://calendar.example.com/private/SECRET-TOKEN/basic.ics';
const ics=cal(['UID:a','DTSTART:20261110T100000','SUMMARY:One']);
test('fetching: state, error keeps the last good events and never mentions the link',async()=>{
  let fail=false,calls=0,seen=null;const changes=[];
  const c=createCalendar({getUrl:()=>secret,now:()=>NOW,onChange:()=>changes.push(1),fetchImpl:async(url,options)=>{calls++;seen=options;if(fail)throw Error('boom '+url);return response(ics);}});
  assert.equal(c.state().configured,true);assert.deepEqual(c.state().events,[]);
  const first=await c.refresh();
  assert.equal(first.events.length,1);assert.equal(first.error,null);assert.ok(first.updatedAt);assert.equal(seen.redirect,'manual');
  fail=true;const second=await c.refresh();
  assert.equal(second.events.length,1);assert.equal(second.error,STALE_MESSAGE);assert.equal(second.updatedAt,first.updatedAt);
  assert.ok(!JSON.stringify(second).includes('SECRET'));assert.ok(changes.length>=2);
  const parallel=await Promise.all([c.refresh(),c.refresh()]);assert.equal(calls,3);assert.equal(parallel.length,2);
});
test('fetching: unconfigured, non-https, redirects, size and bad content',async()=>{
  assert.deepEqual(await createCalendar({getUrl:()=>'',fetchImpl:async()=>{throw Error('no');}}).refresh(),{configured:false,events:[],updatedAt:null,error:null});
  let called=false;
  const http=await createCalendar({getUrl:()=>'http://x.example.com/a.ics',fetchImpl:async()=>{called=true;return response(ics);}}).refresh();
  assert.equal(called,false);assert.ok(http.error);
  const hops=[];
  const redirect=await createCalendar({now:()=>NOW,getUrl:()=>secret,fetchImpl:async url=>{hops.push(url);return hops.length===1?new Response(null,{status:302,headers:{location:'/other.ics'}}):response(ics);}}).refresh();
  assert.equal(redirect.events.length,1);assert.equal(hops[1],'https://calendar.example.com/other.ics');
  const downgrade=await createCalendar({getUrl:()=>secret,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://evil.example.com/a.ics'}})}).refresh();
  assert.ok(downgrade.error&&downgrade.events.length===0);
  const big=await createCalendar({getUrl:()=>secret,fetchImpl:async()=>response('x'.repeat(5*1024*1024+10))}).refresh();assert.ok(big.error);
  const html=await createCalendar({getUrl:()=>secret,fetchImpl:async()=>response('<html></html>')}).refresh();assert.ok(html.error);
  const status=await createCalendar({getUrl:()=>secret,fetchImpl:async()=>response('no',{status:404})}).refresh();assert.ok(status.error);
});
test('fetching: changing the link drops the old events; start and stop manage the timer',async()=>{
  let url=secret;
  const c=createCalendar({getUrl:()=>url,now:()=>NOW,fetchImpl:async()=>response(ics)});
  await c.refresh();assert.equal(c.state().events.length,1);
  url='';await c.refresh();assert.deepEqual(c.state().events,[]);assert.equal(c.state().configured,false);
  url=secret;c.start();c.start();await c.refresh();assert.equal(c.state().events.length,1);c.stop();c.stop();
});
test('the verification fixture has today, tomorrow, all-day and weekly events',async()=>{
  const c=createCalendar({getUrl:()=>secret,fetchImpl:fetchCalendarFixture});
  const {events,error}=await c.refresh();
  assert.equal(error,null);
  assert.ok(events.some(e=>e.allDay));assert.ok(events.filter(e=>e.title==='Weekly planning').length>=4);
  assert.ok(events.some(e=>e.title==='Design review'));
});

function store(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-cal-'));
  const crypto={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  return {dir,crypto,open:()=>createConfigStore(dir,crypto)};
}
test('config: the calendar link is stored encrypted and only the host is public',()=>{
  const {dir,open}=store();let config=open();
  assert.deepEqual(config.publicConfig().calendar,{configured:false,host:''});assert.equal(config.calendarUrl(),'');
  config.saveCalendarUrl('webcal://calendar.google.com/calendar/ical/me%40example.com/private-TOKEN123/basic.ics');
  assert.deepEqual(config.publicConfig().calendar,{configured:true,host:'calendar.google.com'});
  assert.equal(config.calendarUrl(),'https://calendar.google.com/calendar/ical/me%40example.com/private-TOKEN123/basic.ics');
  const disk=fs.readFileSync(path.join(dir,'settings.json'),'utf8');
  assert.ok(!disk.includes('TOKEN123')&&!disk.includes('calendar.google.com'));assert.ok(JSON.parse(disk).calendar.encryptedUrl);
  assert.ok(!JSON.stringify(config.publicConfig()).includes('TOKEN123'));assert.ok(!JSON.stringify(config.publicConfig()).includes('encryptedUrl'));
  config.save(config.publicConfig());assert.equal(config.calendarUrl().includes('TOKEN123'),true,'saving other settings keeps the link');
  config=open();assert.equal(config.publicConfig().calendar.host,'calendar.google.com');assert.ok(config.calendarUrl().includes('TOKEN123'));
  config.saveCalendarUrl('');assert.deepEqual(config.publicConfig().calendar,{configured:false,host:''});assert.equal(config.calendarUrl(),'');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8')).calendar,undefined);
});
test('config: invalid calendar links are rejected and change nothing',()=>{
  const {open}=store();const config=open();
  config.saveCalendarUrl('https://calendar.example.com/a.ics');
  for(const bad of ['http://calendar.example.com/a.ics','https://u:p@calendar.example.com/a.ics','x','https://a.example.com/'+'x'.repeat(2100)])assert.throws(()=>config.saveCalendarUrl(bad));
  assert.equal(config.calendarUrl(),'https://calendar.example.com/a.ics');
});

// The widget's pure helpers (src/widget-calendar.js is a browser script).
const vm=require('node:vm');
function widgetHelpers(){
  const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src','widget-calendar.js'),'utf8'),{window,document:{},navigator:{language:'en-GB'}});
  return window.EdgeWidgets.calendar.helpers;
}
test('widget: times in 24-hour and 12-hour form, all-day and day labels',()=>{
  const h=widgetHelpers();const now=new Date(2026,10,9,12,0);
  const prepared=h.prepare([
    {id:'1',title:'A',start:new Date(2026,10,9,10,30).toISOString(),end:new Date(2026,10,9,11,15).toISOString()},
    {id:'2',title:'B',start:new Date(2026,10,9,11,30).toISOString(),end:new Date(2026,10,9,13,15).toISOString()},
    {id:'3',title:'C',start:new Date(2026,10,10).toISOString(),end:new Date(2026,10,11).toISOString(),allDay:true,color:'bad'},
    {id:'4',title:'D',start:new Date(2026,10,9,22,0).toISOString(),end:new Date(2026,10,10,1,0).toISOString()}]);
  const [a,b,c,d]=['1','2','3','4'].map(id=>prepared.find(e=>e.id===id));
  assert.equal(h.rangeText(a,true),'10:30–11:15');assert.equal(h.rangeText(a,false),'10:30–11:15 AM');assert.equal(h.rangeText(b,false),'11:30 AM–1:15 PM');
  assert.equal(h.rangeText(c,true),'All day');assert.equal(c.color,'#0a84ff');
  assert.equal(h.dayLabel(new Date(2026,10,9),now),'Today');assert.equal(h.dayLabel(new Date(2026,10,10),now),'Tomorrow');
  assert.match(h.dayLabel(new Date(2026,10,11),now),/11/);
  const entries=h.entriesFor([a,b,c,d],now);
  assert.deepEqual(Array.from(entries,e=>e.event.title+(e.first?'':'*')),['B','D','C','D*'],'ended events are dropped; a night event continues on the next day');
  assert.equal(h.isNow(entries[0],now),true);assert.equal(h.isNow(entries[1],now),false);
  assert.equal(h.timeText(entries[3],true),'Until 01:00');
});
