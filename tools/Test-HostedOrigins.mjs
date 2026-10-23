import worker,{JDRelay} from '../hosted/worker.js';
const view='v'.repeat(43),publish='p'.repeat(43),records=new Map();
const ctx={storage:{get:async k=>structuredClone(records.get(k)),put:async(k,v)=>records.set(k,structuredClone(v))},blockConcurrencyWhile:fn=>fn()};
const env={VIEW_KEY:view,PUBLISH_KEY:publish};
const relay=new JDRelay(ctx,env);env.RELAY={idFromName:()=>'',get:()=>relay};
const call=(origin,path,method='GET',key=view)=>worker.fetch(new Request('https://jd-ticket-tracker.desirae.workers.dev'+path,{method,headers:{Origin:origin,...(key?{Authorization:'Bearer '+key}:{})}}),env);
const assert=(value,message)=>{if(!value)throw Error(message);};
for(const origin of ['https://jd-ticket-tracker.desirae.workers.dev','https://dmduncananalyst.github.io']){
 const options=await call(origin,'/api/prices/chargers','OPTIONS',null);
 assert(options.status===204&&options.headers.get('Access-Control-Allow-Origin')===origin,'Approved preflight rejected');
 assert(options.headers.get('Access-Control-Allow-Headers').includes('Authorization'),'Authorization preflight missing');
 const bad=await call(origin,'/api/prices/chargers?check=origin-test000000001','GET','wrong');assert(bad.status===401,'Bad credential accepted');
 const unknown=await call(origin,'/api/prices/unknown?check=origin-test000000001');assert(unknown.status===404,'Unknown game accepted');
 const publisher=await call(origin,'/publisher/jobs');assert(publisher.status===401,'Viewing credential gained publisher access');
 assert(relay.jobs.length===0,'Preflight or rejected request created work');
 console.log('PASS approved origin with unchanged credential/game/role protections: '+origin);
}
for(const origin of ['https://attacker.invalid','https://dmduncananalyst.github.io.attacker.invalid','http://dmduncananalyst.github.io','https://another-user.github.io']){
 for(const method of ['GET','OPTIONS']){const response=await call(origin,'/api/prices/chargers?check=origin-test000000001',method);assert(response.status===403&&!response.headers.has('Access-Control-Allow-Origin'),'Unapproved origin accepted');}
}
assert(relay.jobs.length===0,'Unapproved origins created work');
console.log('PASS unapproved and lookalike origins remain rejected; no jobs created');
