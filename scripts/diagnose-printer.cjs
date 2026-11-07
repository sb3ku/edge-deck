const {app,safeStorage}=require('electron');
const path=require('node:path');
const mqtt=require('mqtt');
const {createConfigStore}=require('../lib/config.cjs');
const {isPrivateAddress}=require('../lib/printers.cjs');
app.setPath('userData',path.join(app.getPath('appData'),'Edge Deck'));
app.setName('Edge Deck');
app.whenReady().then(()=>{
  const config=createConfigStore(path.join(app.getPath('appData'),'Edge Deck'),safeStorage).privatePrinters().find(p=>p.id===(process.argv[2]||'h2d'));
  if(!config?.accessCode || !config.serial || !isPrivateAddress(config.host))throw Error('A configured printer with a private IP address is required.');
  const client=mqtt.connect({protocol:'mqtts',host:config.host,port:8883,username:'bblp',password:config.accessCode,rejectUnauthorized:config.allowSelfSigned!==true,reconnectPeriod:0,connectTimeout:8000,clientId:'edge_diagnostic_'+Date.now(),clean:true});
  let messages=0,matched=false,repairFlight=null,repairAttempted=false;
  const deadline=setTimeout(finish,18000);
  async function finish(){clearTimeout(deadline);if(repairFlight)await repairFlight;console.log(JSON.stringify({done:true,messages,matchedConfiguredTopic:matched}));client.end(true,()=>app.exit(0));}
  async function repairIdentity(serial){
    const origin=process.env.EDGE_DECK_DIAG_ORIGIN,token=process.env.EDGE_DECK_DIAG_TOKEN;
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||'') || !token)throw Error('The local dashboard connection is required for identity repair.');
    const response=await fetch(origin+'/api',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Edge-Token':token},body:JSON.stringify({operation:'printer:save',args:[{id:config.id,name:config.name,model:config.model,host:config.host,serial,allowSelfSigned:config.allowSelfSigned===true,controlAccess:config.controlAccess===true}]})});
    const result=await response.json();if(!response.ok||!result.ok)throw Error('The dashboard could not save the detected printer identity.');
    config.serial=serial;console.log(JSON.stringify({identityRepaired:true,credentialsRetained:true}));
  }
  client.on('error',error=>{console.log(JSON.stringify({errorCode:String(error.code||'CONNECTION_ERROR')}));finish();});
  client.on('connect',()=>{
    console.log(JSON.stringify({brokerConnected:true}));
    client.subscribe('device/+/report',{qos:0},(error,grants)=>{
      console.log(JSON.stringify({subscribed:!error,granted:grants?.map(g=>g.qos)}));
      if(error)return finish();
      const request={pushing:{sequence_id:String(Date.now()%1000000),command:'pushall',version:1,push_target:1}};
      client.publish(`device/${config.serial}/request`,JSON.stringify(request),{qos:0,retain:false},error=>console.log(JSON.stringify({statusSnapshotRequested:!error})));
    });
  });
  client.on('message',(topic,buffer)=>{
    if(buffer.length>1048576)return;
    messages++;matched ||= topic===`device/${config.serial}/report`;
    let payload;try{payload=JSON.parse(buffer.toString('utf8'));}catch{return;}
    console.log(JSON.stringify({message:messages,configuredTopic:topic===`device/${config.serial}/report`,bytes:buffer.length,topLevelKeys:Object.keys(payload),printFieldCount:Object.keys(payload.print||{}).length,gcodeState:payload.print?.gcode_state||null}));
    if(process.argv.includes('--inspect-controls')&&messages===1){const p=payload.print||{};console.log(JSON.stringify({controlsTelemetry:{home_flag:p.home_flag,fun:p.fun,fun2:p.fun2,nozzle_temper:p.nozzle_temper,nozzle_target_temper:p.nozzle_target_temper,bed_temper:p.bed_temper,bed_target_temper:p.bed_target_temper,stg_cur:p.stg_cur,mc_print_stage:p.mc_print_stage,mc_print_sub_stage:p.mc_print_sub_stage,mc_stage:p.mc_stage,deviceType:p.device?.type,extruderState:p.device?.extruder?.state,extruders:p.device?.extruder?.info?.map(e=>({id:e.id,temp:e.temp,keys:Object.keys(e)}))}}));}
    if(process.argv.includes('--repair-identity') && !repairAttempted && payload.print?.gcode_state && topic!==`device/${config.serial}/report`) {
      const identity=/^device\/([A-Za-z0-9_-]{4,64})\/report$/.exec(topic);
      if(identity){repairAttempted=true;repairFlight=repairIdentity(identity[1]).catch(()=>console.log(JSON.stringify({identityRepaired:false})));}
    }
    if(messages>=3)finish();
  });
}).catch(error=>{console.error(error.code||'Printer diagnostic could not start.');app.exit(1);});
