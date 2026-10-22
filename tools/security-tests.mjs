import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {JDRelay} from '../relay/worker.js';
const exec=promisify(execFile),results=[];
async function test(name,fn){try{const evidence=await fn();results.push({name,status:'PASS',evidence});}catch(e){results.push({name,status:'FAIL',evidence:e.message});}}
function assert(value,message){if(!value)throw Error(message);}
const view='v'.repeat(43),publish='p'.repeat(43),id='audit-check-000000000001';
function fixture(){const env={VIEW_KEY:view,PUBLISH_KEY:publish},map=new Map();const ctx={storage:{async get(k){return structuredClone(map.get(k));},async put(k,v){map.set(k,structuredClone(v));}},blockConcurrencyWhile(fn){return fn();}};const relay=new JDRelay(ctx,env);const call=(path,key=view,method='GET',body)=>relay.fetch(new Request('https://audit.invalid'+path,{method,headers:{...(key?{Authorization:'Bearer '+key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {env,relay,call};}
await test('Missing and incorrect codes cannot queue work',async()=>{const {relay,call}=fixture();for(const key of [null,'wrong',publish])assert((await call('/api/prices/chargers?check='+id,key)).status===401,'Unauthorized accepted');assert(relay.jobs.length===0,'Unauthorized job queued');return '3 rejected, zero jobs';});
await test('Phone code cannot poll collector jobs or upload fabricated results',async()=>{const {relay,call}=fixture();assert((await call('/publisher/jobs')).status===401,'Publisher polling accepted');assert((await call('/publisher/results/'+id,view,'POST',{quote:{status:'ready',listings:[]}})).status===401,'False upload accepted');assert(relay.jobs.length===0,'Work queued');return 'Both 401; zero jobs';});
await test('A replaced viewing code is rejected before new work is queued',async()=>{const {env,relay,call}=fixture();env.VIEW_KEY='n'.repeat(43);assert((await call('/api/prices/chargers?check='+id,view)).status===401,'Old key accepted');assert(relay.jobs.length===0,'Old key queued work');return 'Mock secret replacement: old code 401, zero jobs';});
await test('Unknown IDs, URLs, paths, scripts and methods cannot become jobs',async()=>{const {relay,call}=fixture();await call('/publisher/jobs',publish);for(const game of ['unknown','http:%2F%2F127.0.0.1','file:%2F%2FC:%2FWindows','powershell.exe','chargers%3Bwhoami','%2E%2E%2Ftitans'])assert((await call('/api/prices/'+game+'?check='+id)).status===404,'Invalid game accepted');assert((await call('/api/prices/chargers?check='+id,view,'POST',{url:'file:///C:/Windows'})).status===404,'POST accepted');assert(relay.jobs.length===0,'Invalid job queued');return '7 requests rejected, zero jobs';});
await test('Extra URL and command parameters cannot expand a valid game job',async()=>{const {call}=fixture();await call('/publisher/jobs',publish);assert((await call('/api/prices/chargers?check='+id+'&url=http://127.0.0.1:1/&command=whoami')).status===202,'Normal job not accepted');const {job}=await (await call('/publisher/jobs',publish)).json();assert(job.game==='chargers'&&Object.keys(job).sort().join(',')==='createdAt,game,id','Job schema expanded');return 'Only fixed game, request ID and timestamp sent';});
await test('Queue is bounded under concurrent mock requests',async()=>{const {relay,call}=fixture();await call('/publisher/jobs',publish);const responses=await Promise.all(Array.from({length:100},(_,i)=>call('/api/prices/chargers?check=audit-'+String(i).padStart(20,'0'))));assert(relay.jobs.length===20,'Queue unbounded');assert(responses.filter(r=>r.status===429).length===80,'Queue limit wrong');return '20 queued; 80 rejected with 429; no real browser';});
await test('An accepted job survives secret replacement (revocation limitation)',async()=>{const {env,call}=fixture();await call('/publisher/jobs',publish);await call('/api/prices/chargers?check='+id);env.VIEW_KEY='n'.repeat(43);assert((await call('/api/prices/chargers?check='+id,view)).status===401,'Old key still valid');const {job}=await (await call('/publisher/jobs',publish)).json();assert(job?.id===id,'Expected previously authorized job');return 'Existing authorized work is not cancelled by viewing-key rotation';});
const pricingSource=await readFile('pricing-source.js','utf8');
await test('Frontend timeout stops underlying polling',async()=>{
  let calls=0;
  const element={classList:{remove(){},add(){}},querySelector(){return this;}};
  const context={URLSearchParams,URL,DOMException,AbortController,crypto,location:{search:'?test',hash:'#key='+view,protocol:'https:',hostname:'audit.workers.dev',origin:'https://audit.workers.dev'},setTimeout:(fn,ms)=>setTimeout(fn,ms===2000?2:ms),clearTimeout,fetch:async()=>{calls++;return {status:202,ok:true};},JD:{games:[{id:'chargers',event:'x'}]},document:{addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}}};
  vm.createContext(context);vm.runInContext(pricingSource,context);vm.runInContext(await readFile('app.js','utf8'),context);
  const tracker=context.JDTracker.createTracker({querySelector(){return element;}},context.JDPricingSource,{timeoutMs:15});
  await new Promise(r=>setTimeout(r,30));const before=calls;await new Promise(r=>setTimeout(r,30));assert(calls===before,'Polling continued after display timeout');tracker.dispose();return 'Actual tracker timeout aborts per-game request and polling';
});
await test('Publisher HTTP client refuses cross-origin redirects',async()=>{
  let destinationHits=0,sourceHits=0,authForwarded=false;
  const destination=http.createServer((req,res)=>{destinationHits++;authForwarded=!!req.headers.authorization;res.setHeader('Content-Type','application/json');res.end('{"job":null}');});
  const source=http.createServer((req,res)=>{sourceHits++;res.writeHead(302,{Location:'http://127.0.0.1:'+destination.address().port+'/sentinel'});res.end();});
  await new Promise(r=>destination.listen(0,'127.0.0.1',r));await new Promise(r=>source.listen(0,'127.0.0.1',r));
  try{
    const script=`$ErrorActionPreference='Stop'; . './tools/Relay-Request.ps1'; $transport=Get-Command Invoke-RestMethod -CommandType Cmdlet; function Invoke-RestMethod { param($Uri,$Headers,$Method,$TimeoutSec,$MaximumRedirection,$ErrorAction) & $transport -Uri 'http://127.0.0.1:${source.address().port}/publisher/jobs' -Headers $Headers -TimeoutSec $TimeoutSec -MaximumRedirection $MaximumRedirection -ErrorAction Stop }; try { Invoke-RelayRequest -Uri 'https://audit.workers.dev/publisher/jobs' -Headers @{Authorization='Bearer synthetic-audit-code'} | Out-Null } catch { }; exit 0;`;
    await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-Command',script],{timeout:25000});assert(sourceHits===1&&destinationHits===0,'Redirect transport did not reject safely: source='+sourceHits+' destination='+destinationHits);return 'Production wrapper refuses redirects; localhost sentinel untouched';}

  finally{source.close();destination.close();}
});
const core=await readFile('core.js','utf8');const ctx={Intl};vm.createContext(ctx);vm.runInContext(core,ctx);
await test('Scraped price and row payloads fail validation without executing',async()=>{const game=ctx.JD.games.find(g=>g.id==='chargers');const now=Date.now();const quote={source:'ticketmaster',eventId:game.event,checkedAt:now,own:{verified:true,listingId:'<script>throw Error(1)</script>',eventId:game.event,currency:'USD',basis:'seller-asking',priceCents:'<img src=x onerror=alert(1)>',section:221,row:1,seats:[11,12,13,14]},listings:[]};const result=ctx.JD.verifiedView(quote,game,now,now);assert(result.own===null&&result.decision===null,'Untrusted price accepted');assert(!/\.innerHTML\s*=|insertAdjacentHTML|eval\(/.test(await readFile('app.js','utf8')),'Unsafe rendering found');return 'Malicious price rejected; renderer uses textContent';});
await writeFile('.preview/security-repair-results.json',JSON.stringify({time:new Date().toISOString(),results},null,2));
for(const result of results)console.log(JSON.stringify(result));

if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
