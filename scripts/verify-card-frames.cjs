'use strict';
const assert=require('node:assert/strict');

// Called only from the isolated verification profile; every site reply is local.
async function verifyCardFrames(page){
  const initial=(await page.evaluate(()=>window.edge.getState())).config;
  const address='https://edge-deck-frame.example/';
  let loads=0;
  const route=async request=>{loads++;await request.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated website fixture</title><p>Website preview</p>'});};
  await page.route(address,route);
  try{
    const cfg=structuredClone(initial);
    cfg.layout={mode:'overview'};
    cfg.launchers.push({id:'frame-fixture-site',name:'Fixture site',target:address});
    cfg.widgets=[
      {id:'frame-fixture',type:'website',title:'Website card',size:'wide',enabled:true,items:[{id:'site',type:'website',launcherId:'frame-fixture-site'},{id:'time',type:'clock',label:'Time'}],activeItemId:'site'},
      {id:'frame-clock',type:'clock',title:'Other card',size:'medium',enabled:true,items:[{id:'clock',type:'clock'}],activeItemId:'clock'},
    ];
    await page.evaluate(value=>window.edge.saveConfig(value),cfg);
    await page.locator('.website-preview').waitFor();
    const handle=await page.locator('.website-preview').elementHandle();
    const frame=await handle.contentFrame();await frame.waitForLoadState();
    await frame.evaluate(()=>{window.edgeDeckTestMarker='preserved';});
    const expectedLoads=loads;
    assert.equal(expectedLoads,1);
    const policies=await page.locator('.website-preview').evaluate(node=>({referrer:node.referrerPolicy,sandbox:node.getAttribute('sandbox')}));
    assert.equal(policies.referrer,'no-referrer');
    assert.ok(!policies.sandbox.includes('allow-top-navigation'));
    await page.evaluate(()=>{window.__frameNode=document.querySelector('.website-preview');});

    cfg.launchers.push({id:'unrelated-fixture',name:'Unrelated app',target:'https://example.com/'});
    await page.evaluate(value=>window.edge.saveConfig(value),cfg);
    await page.waitForFunction(()=>document.querySelector('.website-preview')===window.__frameNode);
    await page.waitForFunction(async()=>(await window.edge.getState()).config.launchers.some(app=>app.id==='unrelated-fixture'));
    await page.waitForTimeout(2200);
    assert.equal(loads,expectedLoads,'Unrelated app edits do not reload the website');
    assert.equal(await frame.evaluate(()=>window.edgeDeckTestMarker),'preserved');

    const card=page.locator('[data-card-id="frame-fixture"]');
    await card.getByRole('tab',{name:'Time',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-card-id="frame-fixture"]').dataset.widget==='clock');
    await card.getByRole('tab',{name:'Fixture site',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-card-id="frame-fixture"]').dataset.widget==='website');
    assert.equal(loads,expectedLoads,'Switching views retains the hidden website document');
    assert.equal(await frame.evaluate(()=>window.edgeDeckTestMarker),'preserved');

    const current=(await page.evaluate(()=>window.edge.getState())).config;
    current.widgets.reverse();await page.evaluate(value=>window.edge.saveConfig(value),current);
    await page.waitForFunction(()=>document.querySelector('#widgets .page-grid > .container-card')?.dataset.id==='frame-clock');
    assert.equal(await page.evaluate(()=>typeof document.querySelector('#widgets').moveBefore),'function');
    assert.equal(await frame.evaluate(()=>window.edgeDeckTestMarker),'preserved','State-preserving reordering retains the website browsing context');
    assert.equal(loads,expectedLoads);
    return['Saved HTTPS website previews use sandbox/no-referrer; unrelated app changes, tab switches and card reordering retain the same website document without extra requests'];
  }catch(error){console.error('Card frame check failed before cleanup:',error);throw error;
  }finally{
    await page.evaluate(config=>window.edge.saveConfig(config),initial);
    await page.waitForFunction(()=>!document.querySelector('.website-preview'));
    await page.evaluate(()=>{delete window.__frameNode;});await page.unroute(address,route);
  }
}
module.exports={verifyCardFrames};
