/* Optional remote bridge. Prepared locally; not deployed.
   The relay never accesses Ticketmaster or receives account credentials. */
const EVENTS={rams:'1700646CC3A7C3B1',seahawks:'1700646CC3C7C3F4',chargers:'1700646CC3D4C40E',broncos:'1700646CC3B3C3BF',titans:'1700646CC3A0C3A4'};
const TTL=420000;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export class JDRelay {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.ready=ctx.blockConcurrencyWhile(async()=>{this.jobs=await ctx.storage.get('jobs')||[];this.heartbeat=await ctx.storage.get('heartbeat')||0;});}
  async fetch(request){
    await this.ready;
    if(this.env.VIEW_KEY===this.env.PUBLISH_KEY)return json({status:'unavailable'},503);
    const url=new URL(request.url),now=Date.now(),publisher=url.pathname.startsWith('/publisher/');
    const secret=publisher?this.env.PUBLISH_KEY:this.env.VIEW_KEY;
    if(!secret||secret.length<32||request.headers.get('Authorization')!==`Bearer ${secret}`)return json({status:'unavailable'},401);
    this.jobs=this.jobs.filter(job=>now-job.createdAt<TTL&&now-(job.lastPoll||job.createdAt)<15000);
    if(publisher&&url.pathname==='/publisher/jobs'&&request.method==='GET'){
      this.heartbeat=now;await this.ctx.storage.put('heartbeat',now);
      const job=this.jobs.find(j=>(j.attempts||0)<2&&(j.state==='queued'||j.state==='leased'&&now-j.leasedAt>60000));
      if(!job)return json({job:null});
      job.state='leased';job.leasedAt=now;job.firstLeasedAt??=now;job.attempts=(job.attempts||0)+1;await this.ctx.storage.put('jobs',this.jobs);
      return json({job:{id:job.id,game:job.game,createdAt:job.createdAt}});
    }
    if(publisher&&/^\/publisher\/active\/[\w-]{16,80}$/.test(url.pathname)&&request.method==='GET'){
      const job=this.jobs.find(j=>j.id===url.pathname.split('/').pop());
      return json({active:!!job&&job.state==='leased'});
    }
    const resultMatch=url.pathname.match(/^\/publisher\/results\/([\w-]{16,80})$/);
    if(publisher&&resultMatch&&request.method==='POST'){
      const job=this.jobs.find(j=>j.id===resultMatch[1]);
      if(!job)return json({status:'expired'},410);
      if(Number(request.headers.get('Content-Length')||0)>100000)return json({status:'unavailable'},413);
      let payload;try{const text=await request.text();if(text.length>100000)return json({status:'unavailable'},413);payload=JSON.parse(text);}catch{return json({status:'unavailable'},400);}
      const quote=payload.quote;
      if(quote?.status==='ready'&&quote.source==='ticketmaster'&&quote.eventId===EVENTS[job.game]&&Number.isFinite(quote.collectionStartedAt)&&Number.isFinite(quote.checkedAt)&&quote.checkedAt>=quote.collectionStartedAt&&quote.checkedAt>=job.createdAt-60000&&quote.checkedAt<=now+60000&&now-quote.checkedAt<=7200000&&Array.isArray(quote.listings)&&quote.listings.length<=100){job.state='done';job.quote=quote;}else{job.state='failed';delete job.quote;}
      await this.ctx.storage.put('jobs',this.jobs);return json({status:'recorded'});
    }
    const priceMatch=url.pathname.match(/^\/api\/prices\/(rams|seahawks|chargers|broncos|titans)$/);
    if(!publisher&&priceMatch&&request.method==='GET'){
      const id=url.searchParams.get('check');
      if(!/^[\w-]{16,80}$/.test(id||''))return json({status:'unavailable'},400);
      let job=this.jobs.find(j=>j.id===id);
      if(job&&job.game!==priceMatch[1])return json({status:'unavailable'},409);
      if(job?.state==='done')return json({...job.quote,checkId:id,requestCreatedAt:job.createdAt,collectionNotBefore:job.firstLeasedAt??job.leasedAt,responseAt:now});
      if(job?.state==='failed')return json({status:'unavailable'},503);
      // Reading a slow event can occupy the publisher between its polls.
      // Keep an accepted request pending while that read completes.
      const working=this.jobs.some(j=>j.state==='leased'&&now-j.leasedAt<120000);
      if(!job&&!working&&now-this.heartbeat>90000)return json({status:'unavailable'},503);
      if(!job){if(this.jobs.length>=20)return json({status:'unavailable'},429);job={id,game:priceMatch[1],createdAt:now,state:'queued'};this.jobs.push(job);}
      job.lastPoll=now;await this.ctx.storage.put('jobs',this.jobs);
      return json({status:'checking',checkId:id},202);
    }
    return json({status:'unavailable'},404);
  }
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN;
    if(origin&&origin!==allowed)return json({status:'unavailable'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:origin&&origin===allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}:{}});
    const id=env.RELAY.idFromName('jd-private-relay');
    const response=await env.RELAY.get(id).fetch(request),headers=new Headers(response.headers);
    if(origin&&origin===allowed){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
    return new Response(response.body,{status:response.status,headers});
  }
};
