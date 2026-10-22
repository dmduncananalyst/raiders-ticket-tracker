// Synthetic loopback CDP only: no Chrome, Ticketmaster requests or credentials.
import {WebSocketServer} from '../.preview/cloud-probe/node_modules/ws/wrapper.mjs';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
const exec=promisify(execFile),results=[];
const assert=(v,m)=>{if(!v)throw Error(m);};
for(const mode of ['redirects','timeout','abandoned']){
  const commands=[],intercepts=new Map();
  const blocked=['http://127.0.0.1:1/','http://192.168.1.1/','http://10.0.0.1/','file:///C:/Windows/win.ini','https://unapproved.invalid/','https://www.ticketmaster.com/account','https://www.ticketmaster.com:444/event/1700646CC3A7C3B1'];
  const approved='https://www.ticketmaster.com/event/1700646CC3A7C3B1';
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{type:'page',url:approved,webSocketDebuggerUrl:'ws://127.0.0.1:'+server.address().port+'/devtools/page/audit'}]));});
  const wss=new WebSocketServer({server});
  wss.on('connection',ws=>ws.on('message',raw=>{
    const command=JSON.parse(raw);commands.push(command.method);
    if(command.method==='Fetch.enable'&&mode==='redirects'){
      [...blocked,approved].forEach((url,i)=>ws.send(JSON.stringify({method:'Fetch.requestPaused',params:{requestId:String(i),resourceType:'Document',request:{url}}})));
    }
    if(command.method.startsWith('Fetch.')&&command.params?.requestId)intercepts.set(command.params.requestId,command.method);
    if(command.method==='Runtime.evaluate'&&mode==='timeout')return;
    ws.send(JSON.stringify({id:command.id,result:command.method==='Runtime.evaluate'?{result:{value:{status:'unavailable'}}}:{}}));
  }));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const port=server.address().port,started=Date.now();let failed=false;
    try{
      if(mode==='abandoned')await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-Command',`& './tools/Read-TicketmasterTest.ps1' -Port ${port} -ReadMarket -Game rams -CheckActive {$false}`],{timeout:16000});
      else await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File','tools/Read-TicketmasterTest.ps1','-Port',String(port),'-ReadMarket'],{timeout:16000});
    }catch{failed=true;}
    if(mode==='redirects'){
      assert(!failed,'Reader failed before redirect checks');
      blocked.forEach((url,i)=>assert(intercepts.get(String(i))==='Fetch.failRequest','Unapproved navigation accepted: '+url));
      assert(intercepts.get(String(blocked.length))==='Fetch.continueRequest','Approved event blocked');
    }else{
      assert(failed,'Abandoned/timeout check did not fail');
      assert(commands.includes('Page.stopLoading'),'Browser loading was not stopped');
      if(mode==='abandoned')assert(!commands.includes('Page.navigate'),'Abandoned check navigated');
      assert(Date.now()-started<15000,'Cancellation failed to terminate promptly');
    }
    results.push({name:'Collector '+mode,status:'PASS'});
  }catch(e){results.push({name:'Collector '+mode,status:'FAIL',reason:e.message});}
  finally{for(const client of wss.clients)client.terminate();wss.close();await new Promise(r=>server.close(r));}
}
await writeFile('.preview/security-cdp-results.json',JSON.stringify(results,null,2));
for(const result of results)console.log(JSON.stringify(result));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
