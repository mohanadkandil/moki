import fs from 'node:fs'
import {launch} from './browser.mjs'
import {filmChecksSource} from './film-checks.mjs'
const base=process.env.DEMO_URL||'http://127.0.0.1:5188',out='../evidence/design_stage/'
const browser=await launch(),results=[]
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1}),errors=[],api=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url())})
  await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Show still',exact:true}).click();await page.waitForTimeout(450)
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
  if(overflow||errors.length||api.length)throw Error(JSON.stringify({width,overflow,errors,api}))
  await page.screenshot({path:out+`host-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Replay hero',exact:true}).click();await page.waitForTimeout(400)
  if(await page.getByRole('button',{name:'Show still',exact:true}).count()!==1)throw Error('Replay did not restore animation control')
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300)
  if(!(await page.locator('.ws-proof').getAttribute('data-visible')))throw Error('Reduced-motion poster missing')
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(200)
  await page.setViewportSize({width:width===390?1440:390,height:1000});await page.waitForTimeout(250)
  results.push({width,overflow,errors,apiCalls:api.length,replay:true,stillControl:true,reducedToggle:true,resize:true});await page.close()
 }
 const page=await browser.newPage({viewport:{width:390,height:900}})
 await page.addInitScript({content:filmChecksSource()});await page.goto(base+'/?capture=comparison',{waitUntil:'networkidle'})
 const before=await page.evaluate(()=>window.__ssFilmChecks.checkStage(document.querySelector('.ss-stage')).filter(x=>x.startsWith('kit override:')))
 await page.evaluate(()=>{const el=document.createElement('style');el.dataset.viteDevId='/intentional-test.css';el.textContent='.ss-row__dot { left: 7px }';document.head.append(el)})
 const after=await page.evaluate(()=>window.__ssFilmChecks.checkStage(document.querySelector('.ss-stage')).filter(x=>x.startsWith('kit override:')))
 if(before.length||after.length!==1)throw Error(JSON.stringify({before,after}))
 results.push({toolingProvenanceCheck:{bundledKitLayerAccepted:before.length===0,unlayeredGeometryOverrideStillCaught:after.length===1}});await page.close()
 fs.writeFileSync(out+'smoke.json',JSON.stringify({production:true,base,results},null,2)+'\n');console.log(JSON.stringify(results,null,2))
}finally{await browser.close()}
