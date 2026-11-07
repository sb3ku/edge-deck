const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {createBrowserHost}=require('../lib/browser-host.cjs');
async function main(){
  const root=path.resolve(__dirname,'..');
  // Printer photos are optional local files (not in the repository).
  const files=[];
  for(const file of ['h2d-photo.png','p1s-photo.png'])try{await fs.access(path.join(root,'src','assets','printers',file));files.push(file);}catch{}
  if(files.length<2){console.log(JSON.stringify({skipped:'Add h2d-photo.png and p1s-photo.png to src/assets/printers to check printer photos.'}));return;}
  const host=await createBrowserHost({root,handle:()=>{throw Error('Only artwork is checked.');}});
  let browser;
  try{
    const origin=new URL(host.url).origin;
    browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,chromiumSandbox:true});
    const page=await browser.newPage({viewport:{width:900,height:340}});page.setDefaultTimeout(10000);
    await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
    for(const file of files){
      const svg=file.endsWith('.svg');
      if(svg)assert.doesNotMatch(await fs.readFile(path.join(root,'src','assets','printers',file),'utf8'),/<(?:script|foreignObject|image)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']https?:/i);
      const response=await fetch(`${origin}/assets/printers/${file}`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),svg?/image\/svg\+xml/:/image\/png/);
    }
    await page.setContent('<html><head><style>body{margin:0;background:#18222e;color:#edf2f8;display:flex;gap:80px;align-items:center;justify-content:center;height:340px;font:18px Segoe UI,sans-serif}.printer{text-align:center}img{width:112px;height:126px;object-fit:contain;display:block}p{margin-top:20px}</style></head><body><div class="printer"><img src="'+origin+'/assets/printers/'+files[0]+'"><p>H2D</p></div><div class="printer"><img src="'+origin+'/assets/printers/'+files[1]+'"><p>P1S</p></div></body></html>');
    await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
    const images=await page.locator('img').evaluateAll(nodes=>nodes.map(image=>({file:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight})));
    assert.ok(images.every(image=>image.width>0&&image.height>0));
    await page.screenshot({path:path.join(root,'artifacts','printer-outline-dashboard-size.png')});
    console.log(JSON.stringify({images,loaded:true,externalContent:false}));
  }finally{await browser?.close();await host.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
