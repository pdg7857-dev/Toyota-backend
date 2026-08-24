import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT='screenshots/look';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
function fc(){const root='/opt/pw-browsers';for(const d of readdirSync(root).filter(d=>d.startsWith('chromium-')).sort().reverse()){const c=join(root,d,'chrome-linux','chrome');if(existsSync(c))return c;}}
mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({executablePath:fc(),args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1440,height:810}});
const errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://127.0.0.1:4173/?fresh',{waitUntil:'networkidle'});
await p.evaluate(()=>document.querySelector('.cs-card').click());
await wait(2500);
await p.screenshot({path:join(OUT,'map-0-minimap.png')});
await p.keyboard.press('m');
await wait(1200);
await p.screenshot({path:join(OUT,'map-1-full.png')});
await p.keyboard.press('Escape');
await wait(400);
// And a later zone, to check the relief rebuild on travel.
await p.evaluate(()=>{const g=window.__game;g.world.player.level=70;g.world.travelTo('reach');});
await wait(2500);
await p.keyboard.press('m');
await wait(1500);
await p.screenshot({path:join(OUT,'map-2-reach.png')});
console.log(errs.length?('ERRORS '+errs.join('\n')):'no page errors');
await b.close();
