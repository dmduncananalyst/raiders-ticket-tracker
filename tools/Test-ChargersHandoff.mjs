import fs from 'node:fs/promises';
import vm from 'node:vm';
import {JDRelay} from '../relay/worker.js';
const baseline=process.argv.includes('--baseline'),results=[];
const source=await fs.readFile('pricing-source.js','utf8'),app=await fs.readFile('app.js','utf8'),core=await fs.readFile('core.js','utf8');
const view='v'.repeat(43),publish='p'.repeat(43),event='1700646CC3D4C40E';
const assert=(v,m)=>{if(!v)throw Error(m);};
function fixture(){
 const values=new Map(),ctx={storage:{get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v))},blockConcurrencyWhile:fn=>fn()};
 const relay=new JDRelay(ctx,{VIEW_KEY:view,PUBLISH_KEY:publish});
 const call=(url,key=view,method='GET',body)=>relay.fetch(new Request(new URL(url,'https://handoff.workers.dev'),{method,headers:{Authorization:'Bearer '+key},...(body?{body:JSON.stringify(body)}:{})}));
 return {relay,call};
}
function quote(checkedAt,eventId=event){const listing=(id,price,row,seats)=>({verified:true,listingId:id,eventId,currency:'USD',basis:'seller-asking',priceCents:price,section:221,row,seats,resale:true});return {status:'ready',source:'ticketmaster',eventId,checkedAt,collectionStartedAt:checkedAt,own:listing('synthetic-own',37500,1,[11,12,13,14]),listings:[listing('synthetic-own',37500,1,[11,12,13,14]),listing('synthetic-other',30000,3,[1,2])]};}
async function test(name,fn){try{const evidence=await fn();results.push({name,passed:true,evidence});}catch(e){results.push({name,passed:false,error:e.message});}}
async function scenario(skew,{stale=false,wrongId=false,expired=false,gameId='chargers',collectorSkew=0}={}){
 const {relay,call}=fixture();await call('/publisher/jobs',publish);
 const fields=new Map(),card={classList:{add(){},remove(){}},querySelector(selector){if(!fields.has(selector))fields.set(selector,{textContent:'',hidden:false,className:''});return fields.get(selector);}};
 const statuses=[],ids=new Set();let uploaded=false,servedQuote,mappedQuote,requestStarted;
 class PhoneDate extends Date{static now(){return Date.now()+skew;}}
 const context={Date:PhoneDate,URL,URLSearchParams,DOMException,AbortController,crypto,performance,location:{protocol:'https:',hostname:'handoff.workers.dev',origin:'https://handoff.workers.dev',hash:'#key='+view,search:'?test'},setTimeout:(fn,ms)=>setTimeout(fn,ms===2000?1:ms),clearTimeout,document:{addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},fetch:async(url,options)=>{
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  ids.add(new URL(url).searchParams.get('check'));
  let response=await call(url);statuses.push(response.status);
  if(response.status===202&&!uploaded){
   uploaded=true;const {job}=await (await call('/publisher/jobs',publish)).json();
   const eventIds={chargers:event,broncos:'1700646CC3B3C3BF',titans:'1700646CC3A0C3A4'};
   const q=quote(job.createdAt+collectorSkew+(stale?-1:0),eventIds[gameId]);q.collectionStartedAt=job.createdAt+collectorSkew;await call('/publisher/results/'+job.id,publish,'POST',{quote:q});
  }
  if(response.status===200){servedQuote=await response.json();if(wrongId)servedQuote.checkId='different-check-id0001';if(expired)servedQuote.responseAt=servedQuote.collectionNotBefore+7200001;response=new Response(JSON.stringify(servedQuote));}
  return response;
 }};
 vm.createContext(context);vm.runInContext(core,context);context.JD.games=context.JD.games.filter(g=>g.id===gameId);
 vm.runInContext(source,context);vm.runInContext(app,context);
 const transport=context.JDPricingSource;
 const tracker=context.JDTracker.createTracker({querySelector(){return card;}},{timeoutMs:transport.timeoutMs,async getCurrentPrices(game,options){requestStarted=options.started;mappedQuote=await transport.getCurrentPrices(game,options);return mappedQuote;}});
 try{
  for(let i=0;i<100&&(!fields.get('[data-own]')||fields.get('[data-own]').textContent.includes('Checking'));i++)await new Promise(r=>setTimeout(r,2));
  const before=statuses.length;await new Promise(r=>setTimeout(r,8));
  return {own:fields.get('[data-own]').textContent,decision:fields.get('[data-decision]').textContent,statuses,ids:ids.size,pollingStopped:before===statuses.length,state:relay.jobs[0]?.state,servedQuote,mappedQuote,requestStarted};
 }finally{tracker.dispose();}
}
await test('Same-clock Chargers handoff renders current prices and stops polling',async()=>{const s=await scenario(0);assert(s.own==='$375.00 each'&&s.decision==='LOWER TO $299.00 EACH','Same-clock render failed');assert(s.ids===1&&s.pollingStopped&&s.state==='done','Job lifecycle failed');return s;});
for(const skew of [15000,-15000,300000])await test('Cross-device clock '+skew+'ms preserves request-bound freshness',async()=>{
 const s=await scenario(skew);
 assert(s.state==='done'&&s.statuses.join(',')==='202,200'&&s.ids===1&&s.pollingStopped,'Request/upload/storage/polling did not complete');
 if(baseline)assert(s.own==='Price unavailable','Expected original cross-clock rejection was not reproduced');
 else assert(s.own==='$375.00 each'&&s.decision==='LOWER TO $299.00 EACH','Fresh authenticated response was rejected because of phone clock');
 return s;
});
if(!baseline){
 for(const collectorSkew of [-1000,1000])await test('Independent collector clock '+collectorSkew+'ms still uses proven fresh navigation',async()=>{const s=await scenario(15000,{collectorSkew});assert(s.own==='$375.00 each'&&s.state==='done','Collector/server clock offset rejected');return s;});
 await test('Pre-request observation remains rejected',async()=>{const s=await scenario(15000,{stale:true});assert(s.own==='Price unavailable','Pre-request data accepted');return s;});
 await test('Wrong request ID remains rejected',async()=>{const s=await scenario(15000,{wrongId:true});assert(s.own==='Price unavailable','Mismatched job accepted');return s;});
 await test('Expired observations remain rejected',async()=>{const s=await scenario(15000,{expired:true});assert(s.own==='Price unavailable','Expired quote accepted');return s;});
 await test('Clock translation preserves collector timestamp and observation age',async()=>{const s=await scenario(15000);assert(s.mappedQuote.collectorCheckedAt===s.servedQuote.checkedAt,'Collector timestamp lost');assert(s.mappedQuote.checkedAt===s.requestStarted+s.servedQuote.collectionNotBefore-s.servedQuote.requestCreatedAt,'Observation was retimestamped instead of translated');return s;});
 for(const gameId of ['broncos','titans'])await test(gameId+' rendering and recommendation remain unchanged',async()=>{const s=await scenario(0,{gameId});assert(s.own==='$375.00 each'&&s.decision==='LOWER TO $299.00 EACH'&&s.state==='done','Other game regressed');return s;});
 await test('Publisher cannot overwrite request-bound Worker timing metadata',async()=>{
  const {call}=fixture();await call('/publisher/jobs',publish);const id='handoff-metadata00001';await call('/api/prices/chargers?check='+id);const {job}=await (await call('/publisher/jobs',publish)).json();
  const q={...quote(job.createdAt),requestCreatedAt:0,responseAt:0,checkId:'forged-check-id00001'};await call('/publisher/results/'+id,publish,'POST',{quote:q});
  const response=await (await call('/api/prices/chargers?check='+id)).json();assert(response.requestCreatedAt===job.createdAt&&response.responseAt>=job.createdAt&&response.checkId===id,'Publisher timing metadata was trusted');
  return {state:'done',statuses:[200]};
 });
 await test('One request ID survives failure then success without duplicate storage or stale failure',async()=>{
  const {relay,call}=fixture();await call('/publisher/jobs',publish);const id='handoff-retry-check0001';
  await call('/api/prices/chargers?check='+id);await call('/api/prices/chargers?check='+id);
  const {job}=await (await call('/publisher/jobs',publish)).json();assert(job.id===id&&relay.jobs.length===1,'Pickup/duplicate ID mismatch');
  await call('/publisher/results/'+id,publish,'POST',{quote:{status:'unavailable'}});assert((await call('/api/prices/chargers?check='+id)).status===503,'Failure state not visible');
  await call('/publisher/results/'+id,publish,'POST',{quote:quote(job.createdAt)});
  const response=await call('/api/prices/chargers?check='+id);const data=await response.json();
  assert(response.status===200&&data.checkId===id&&relay.jobs[0].state==='done'&&relay.jobs.length===1,'Earlier failure won over later success');
  assert(!(await (await call('/publisher/jobs',publish)).json()).job,'Completed job re-leased');
  return {state:'done',statuses:[202,503,200]};
 });
}
await fs.writeFile('.preview/chargers-handoff-'+(baseline?'baseline':'results')+'.json',JSON.stringify(results,null,2));
for(const r of results)console.log(JSON.stringify({name:r.name,passed:r.passed,error:r.error,...(r.evidence?{own:r.evidence.own,state:r.evidence.state,statuses:r.evidence.statuses}: {})}));
if(results.some(r=>!r.passed))process.exitCode=1;
