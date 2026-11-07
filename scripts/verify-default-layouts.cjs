'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
async function verifyDefaultLayouts(page,directory){
  const baseline=(await page.evaluate(()=>window.edge.getState())).config,viewport=page.viewportSize();
  const cfg=structuredClone(baseline);cfg.layout={mode:'overview'};
  cfg.widgets=cfg.widgets.map(card=>card.type==='launchers'?card:{...card,size:'medium',enabled:true});
  try{
    await page.setViewportSize({width:2560,height:720});
    await page.evaluate(config=>window.edge.saveConfig(config),cfg);await page.reload();
    await page.locator('.container-card.clock').waitFor();
    await page.locator('#customize').click();
    const settings=page.locator('#settings-content');
    await settings.getByRole('button',{name:'Bento layout',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#widgets').dataset.layout==='bento' && document.querySelector('#settings-content .edge-layout-ui')?.getAttribute('aria-busy')==='false');
    const current=(await page.evaluate(()=>window.edge.getState())).config;
    assert.deepEqual(current.widgets.filter(card=>card.type!=='launchers').map(card=>card.size),['medium','medium','wide','wide','wide']);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    for(const mode of ['bento','focus']){
      if(mode==='focus'){await page.locator('#customize').click();await settings.getByRole('button',{name:'Focus layout',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#widgets').dataset.layout==='focus'&&document.querySelector('#settings-content .edge-layout-ui')?.getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close settings',exact:true}).click();}
      const geometry=await page.locator('.container-card').evaluateAll(cards=>cards.map(card=>{const b=card.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
      for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){const a=geometry[i],b=geometry[j];assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'Cards do not overlap in '+mode);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
      await page.locator('#toast').evaluate(node=>{node.hidden=true;});
      await page.screenshot({path:path.join(directory,`layout-${mode}-default.png`)});
    }
    await page.locator('#customize').click();await page.locator('#settings').getByRole('button',{name:'Apps',exact:true}).click();
    const dockSwitch=settings.getByRole('switch',{name:'Show app dock',exact:true});
    const initiallyShown=await dockSwitch.getAttribute('aria-checked')==='true';
    await dockSwitch.click();await page.waitForFunction(shown=>document.querySelector('#launchers').style.display===(shown?'none':''),initiallyShown);
    await dockSwitch.click();await page.waitForFunction(shown=>document.querySelector('#launchers').style.display===(shown?'':'none'),initiallyShown);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    return['The app dock remains independently showable/hideable in Apps settings','The original five cards receive a balanced editable Bento preset; native Bento and Focus show five non-overlapping cards without page overflow'];
  }finally{await page.evaluate(()=>document.querySelector('#settings').close());await page.evaluate(config=>window.edge.saveConfig(config),baseline);await page.reload();if(viewport)await page.setViewportSize(viewport);}
}
module.exports={verifyDefaultLayouts};
