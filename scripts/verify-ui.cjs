const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verifyUI(win) {
  const directory=path.join(__dirname,'..','artifacts');await fs.mkdir(directory,{recursive:true});
  const evaluate=code=>win.webContents.executeJavaScript(code,true);
  const report={sizes:[],checks:[]};
  const initial=await evaluate('window.edge.getState()');
  assert.equal(initial.config.widgets.length,5);
  const displayState=await evaluate('window.edge.getDisplays()');
  report.displays=displayState;
  for(const [width,height] of [[2560,720],[2048,576],[1600,450],[900,700]]) {
    win.setContentSize(width,height);await delay(180);
    const layout=await evaluate(`({width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth>innerWidth,overflowY:document.documentElement.scrollHeight>innerHeight,widgets:document.querySelectorAll('#widgets .widget').length,media:document.querySelector('.widget.media')?.innerText,hasClock:!!document.querySelector('.clock-time')?.textContent})`);
    assert.equal(layout.overflowX,false,`horizontal overflow at ${width}`);
    if(width>=1000)assert.equal(layout.overflowY,false,`vertical page overflow at ${width}`);
    assert.equal(layout.widgets,4);assert.ok(layout.hasClock);
    report.sizes.push({...layout,media:undefined});
    const capture=await win.webContents.capturePage();await fs.writeFile(path.join(directory,`dashboard-${width}x${height}.png`),capture.toPNG());
  }
  win.setContentSize(1600,700);await delay(80);
  await evaluate(`document.querySelector('#customize').click()`);await delay(80);
  assert.equal(await evaluate(`document.querySelector('#settings').open`),true);
  await evaluate(`document.querySelector('#settings-content [role=switch]').click()`);await delay(100);
  assert.equal(await evaluate(`document.querySelectorAll('.widget.clock').length`),0);
  assert.equal((await evaluate('window.edge.getState()')).config.widgets[0].enabled,false);
  await evaluate(`document.querySelector('#close-settings').click()`);
  await win.webContents.reload();await delay(300);
  assert.equal(await evaluate(`document.querySelectorAll('.widget.clock').length`),0);
  report.checks.push('Widget visibility saved and restored after renderer reload');
  await evaluate(`window.edge.saveConfig(${JSON.stringify(initial.config)})`);await delay(80);
  await evaluate(`document.querySelector('#customize').click();[...document.querySelectorAll('.tab')].find(e=>e.textContent==='Printers').click()`);await delay(80);
  assert.equal(await evaluate(`document.querySelectorAll('input[type=password]').length`),2);
  const settings=await win.webContents.capturePage();await fs.writeFile(path.join(directory,'printer-settings.png'),settings.toPNG());
  report.checks.push('Printer configuration renders both H2D and P1S with masked code fields');
  await evaluate(`document.querySelector('#close-settings').click()`);
  const config={...initial.config,launchers:[...initial.config.launchers,{id:'test-link',name:'Verification shortcut',target:'https://example.com/'}]};
  await evaluate(`window.edge.saveConfig(${JSON.stringify(config)})`);await delay(50);
  assert.ok(await evaluate(`document.querySelector('#launchers').textContent.includes('Verification shortcut')`));
  await evaluate(`window.edge.saveConfig(${JSON.stringify(initial.config)})`);
  report.checks.push('Custom website shortcut added and rendered without opening it');
  report.checks.push('No media commands or physical printer connections exercised');
  await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
module.exports={verifyUI};
