const {chromium}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
async function main(){
  const root=path.resolve(__dirname,'..');
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,chromiumSandbox:true});
  try{
    const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
    for(const name of ['h2d','p1s']){
      const svg=await fs.readFile(path.join(root,'src','assets','printers',name+'.svg'),'utf8');
      await page.setContent('<html><head><style>html,body{margin:0;width:1024px;height:1024px;background:#18222e}body{display:grid;place-items:center}svg{width:880px;height:880px}</style></head><body>'+svg+'</body></html>');
      await page.screenshot({path:path.join(root,'artifacts',name+'-reference.png')});
    }
    const outline=path.join(root,'src','assets','printers','p1s-outline-v2.svg');
    try{
      const h2d=await fs.readFile(path.join(root,'src','assets','printers','h2d.svg'),'utf8');
      const p1s=await fs.readFile(outline,'utf8');
      await page.setViewportSize({width:1280,height:720});
      await page.setContent('<html><head><style>html,body{margin:0;background:#18222e;color:#edf2f8;font:22px Segoe UI,sans-serif}body{display:flex;width:1280px;height:720px;align-items:center;justify-content:center;gap:100px}.printer{text-align:center;width:460px}.printer svg{width:420px;height:510px;display:block;margin:auto}p{margin:26px 0 0}</style></head><body><div class="printer">'+h2d+'<p>H2D</p></div><div class="printer">'+p1s+'<p>P1S</p></div></body></html>');
      await page.screenshot({path:path.join(root,'artifacts','printer-outline-comparison.png')});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
