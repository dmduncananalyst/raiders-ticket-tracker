import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {JDRelay} from '../relay/worker.js';
import hosted from '../hosted/worker.js';
const results=[];
function assert(v,m){if(!v)throw Error(m);}
async function test(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',reason:e.message});}}
await test('Prepared hosted headers cover assets and API errors',async()=>{
  const env={ASSETS:{fetch:async()=>new Response('test')},RELAY:{idFromName:()=>'',get:()=>({fetch:async()=>new Response('{}',{status:401})})}};
  for(const path of ['/','/api/prices/rams']){
    const response=await hosted.fetch(new Request('https://test.workers.dev'+path),env);
    for(const h of ['Content-Security-Policy','Strict-Transport-Security','X-Frame-Options','Permissions-Policy','Referrer-Policy','X-Content-Type-Options'])assert(response.headers.has(h),'Missing '+h);
  }
  assert((await readFile('tools/Prepare-FreeSite.ps1','utf8')).includes('run_worker_first=$true'),'Static assets bypass headers');
});
await test('Abandoned jobs expire and cannot be leased or uploaded',async()=>{
  let now=Date.now();const original=Date.now;Date.now=()=>now;
  try{
    const map=new Map(),ctx={storage:{get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)},blockConcurrencyWhile:fn=>fn()};
    const relay=new JDRelay(ctx,{VIEW_KEY:'v'.repeat(43),PUBLISH_KEY:'p'.repeat(43)});
    const call=(path,publisher=false,method='GET')=>relay.fetch(new Request('https://test.workers.dev'+path,{method,headers:{Authorization:'Bearer '+(publisher?'p':'v').repeat(43)}}));
    await call('/publisher/jobs',true);
    await call('/api/prices/rams?check=security-extra-job0001');
    await call('/publisher/jobs',true);
    now+=16000;
    assert(!(await (await call('/publisher/active/security-extra-job0001',true)).json()).active,'Expired lease active');
    assert((await call('/publisher/results/security-extra-job0001',true,'POST')).status===410,'Expired result accepted');
    assert(!(await (await call('/publisher/jobs',true)).json()).job,'Abandoned job re-leased');
  }finally{Date.now=original;}
});
await test('Old saved setup cannot restore revoked credentials',async()=>{
  const script=await readFile('tools/Deploy-FreeTracker.ps1','utf8');
  assert(!script.includes('secret bulk')&&!script.includes('VIEW_KEY')&&!script.includes('hosting-secrets'),'Old setup can update credentials');
});
const get=(port,path,host='localhost:'+port)=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path,headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('timeout')));});
for(const [file,port] of [['serve.ps1',4197],['tools/Serve-Tracker.ps1',4198]])await test(file+' rejects private aliases and foreign Host',async()=>{
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',file,'-Port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let started=false;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start')),5000);child.stdout.on('data',chunk=>{if(String(chunk).includes('http://localhost:')){started=true;clearTimeout(timer);resolve();}});child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);if(!started)reject(Error('Server exited'));});});
    assert(await get(port,'/')===200,'Public page unavailable');
    for(const path of ['/.preview/background-config.json','/PREVIE~1/qa-background.html','/tools/Run-BackgroundTracker.ps1','/.git/config','/%2e%2e/.preview/phone-url.txt'])assert(await get(port,path)!==200,'Private path exposed: '+path);
    assert(await get(port,'/','attacker.invalid')!==200,'Foreign Host accepted');
  }finally{child.kill();await new Promise(r=>child.once('exit',r));}
});
await writeFile('.preview/security-extra-results.json',JSON.stringify(results,null,2));
for(const r of results)console.log(JSON.stringify(r));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
