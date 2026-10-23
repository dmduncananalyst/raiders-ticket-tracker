(async()=>{
  const frame=document.querySelector('iframe'),out=document.querySelector('#results'),params=new URLSearchParams(location.search);
  if(params.has('visual')){document.querySelector('h1').hidden=true;out.hidden=true;document.body.style.cssText='margin:0;background:#101112';frame.style.cssText='width:390px;height:2000px;border:0';frame.src='index.html';return;}
  if(params.has('liveprobe')){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('https://www.ticketmaster.com/event/1700646CC3A7C3B1',{mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});out.textContent='HTTP '+response.status+'; accessible response length '+(await response.text()).length;}
    catch(e){out.textContent='Ticketmaster browser fetch failed: '+e.name+': '+e.message;}
    finally{clearTimeout(timer);}return;
  }
  const results=[];let passed=0,failed=0;
  const assert=(v,m='Assertion failed')=>{if(!v)throw Error(m);},eq=(a,b)=>assert(a===b,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  const test=(name,fn)=>{try{fn();passed++;results.push('PASS '+name);}catch(e){failed++;results.push('FAIL '+name+': '+e.message);}out.textContent=results.join('\n');};
  const wait=(ms=0)=>new Promise(r=>setTimeout(r,ms));
  function quote(game,priceCents,{id='other',row=2,seats=[1,2],...rest}={}){return {verified:true,listingId:id,eventId:game.event,currency:'USD',basis:'seller-asking',priceCents,section:221,row,seats,resale:true,...rest};}
  function snapshot(game,own=12000,other=10000,checkedAt=Date.now()){return {source:'ticketmaster',eventId:game.event,checkedAt,own:quote(game,own,{id:'own',row:1,seats:[11,12,13,14]}),listings:[quote(game,other)]};}
  const game=JD.games[0],now=Date.now();
  test('Inclusive boundaries keep the price; a cent outside triggers the correct decision',()=>{eq(JD.recommend(10500,[10000]).kind,'keep');eq(JD.recommend(9000,[10000]).kind,'keep');eq(JD.recommend(10501,[10000]).text,'LOWER TO $99.00 EACH');eq(JD.recommend(8999,[10000]).text,'RAISE TO $100.00 EACH');});
  test('All three rules use the lowest eligible price',()=>{eq(JD.recommend(12000,[10000,50000,60000]).target,9900);eq(JD.recommend(9000,[10000,50000]).kind,'keep');eq(JD.recommend(8000,[10000,50000]).target,10000);});
  test('Suggestions are positive and do not immediately trigger the opposite warning',()=>{for(const low of [1,50,100,101,500,999,1000,10000])for(const own of [1,low*2]){const d=JD.recommend(own,[low]);if(d.target){assert(d.target>0);eq(JD.recommend(d.target,[low]).kind,'keep');}}});
  test('Missing, invalid and non-cent prices produce no decision',()=>{for(const own of [null,0,-1,Infinity,1.5])eq(JD.recommend(own,[10000]),null);eq(JD.recommend(10000,[]),null);eq(JD.recommend(10000,[0]),null);});
  test('Own listing requires the exact four seats, not just section and row',()=>{const s=snapshot(game,12000,10000,now);s.own.seats=[21,22,23,24];eq(JD.verifiedView(s,game,now,now).own,null);eq(JD.verifiedView(s,game,now,now).decision,null);});
  test('Competitors are filtered by event, section, row, resale and consecutive seat quantity',()=>{const s=snapshot(game,12000,10000,now);s.listings.push(quote(game,100,{id:'bad-section',section:222}),quote(game,100,{id:'bad-row',row:5}),quote(game,100,{id:'bad-quantity',seats:[1,2,3]}),quote(game,100,{id:'bad-contiguity',seats:[1,3]}),quote(game,100,{id:'primary',resale:false}),quote(game,100,{id:'wrong-event',eventId:'different'}));const v=JD.verifiedView(s,game,now,now);eq(v.others.length,1);eq(v.decision.target,9900);});
  test('Own listing and partial own seats are excluded; each listing counts once',()=>{const s=snapshot(game,12000,10000,now);s.listings.push(s.own,quote(game,50,{id:'own-pair',row:1,seats:[11,12]}),s.listings[0]);eq(JD.verifiedView(s,game,now,now).others.length,1);});
  test('The whole section is displayed while recommendation eligibility is unchanged',()=>{const s=snapshot(game,12000,10000,now);s.listings.push(quote(game,5000,{id:'row12',row:12}),quote(game,6000,{id:'triple',row:3,seats:[1,2,3]}),quote(game,11000,{id:'same-row',row:2}));const v=JD.verifiedView(s,game,now,now);eq(v.otherQuotes.length,4);eq(v.otherQuotes[0].row,12);eq(v.otherQuotes.filter(p=>p.row===2).length,2);eq(v.others.join(','),'10000,11000');eq(v.decision.target,9900);});
  test('Section listings remain visible even without recommendation-eligible rows',()=>{const s=snapshot(game,12000,10000,now);s.listings=[quote(game,7000,{id:'row10',row:10})];const v=JD.verifiedView(s,game,now,now);eq(v.otherQuotes.length,1);eq(v.others,null);eq(v.decision,null);});
  test('Buyer prices and unverified prices cannot become seller-price recommendations',()=>{const s=snapshot(game,12000,10000,now);s.listings[0].basis='buyer-all-in';eq(JD.verifiedView(s,game,now,now).decision,null);s.listings[0].basis='seller-asking';s.own.verified=false;eq(JD.verifiedView(s,game,now,now).decision,null);});
  test('Old snapshots, wrong events and non-Ticketmaster sources are rejected',()=>{const s=snapshot(game,12000,10000,now-1);eq(JD.verifiedView(s,game,now,now).own,null);s.checkedAt=now;s.eventId='wrong';eq(JD.verifiedView(s,game,now,now).own,null);s.eventId=game.event;s.source='manual';eq(JD.verifiedView(s,game,now,now).own,null);});
  const load=()=>new Promise((resolve,reject)=>{frame.onload=()=>resolve();frame.src='index.html?test=1&visit='+Math.random();setTimeout(()=>reject(Error('Page load timeout')),8000);});
  const doc=()=>frame.contentDocument,q=s=>doc().querySelector(s),win=()=>frame.contentWindow;let tracker;
  try{
    await load();await wait();
    test('Initial page shows all five games and waits for fresh prices',()=>{eq(doc().querySelectorAll('.game').length,5);eq(doc().querySelectorAll('[data-own]').length,5);for(const card of doc().querySelectorAll('.game')){eq(card.querySelector('[data-own]').textContent,'Checking…');eq(card.querySelector('[data-others]').textContent,'Checking…');assert(card.querySelector('[data-decision]').hidden);}});
    test('Production source uses the browser helper, without embedded credentials',()=>{eq(win().JDPricingSource.kind,'browser-helper');});
    test('Page contains only compact header and the four requested card fields',()=>{eq(doc().querySelectorAll('form,input,button,select,details,footer,a').length,0);eq(doc().querySelectorAll('header p,main>p,section').length,0);eq(q('main').firstElementChild.id,'rams');eq(q('h1').textContent,'JD Ticket Tracker');eq(doc().title,'JD Ticket Tracker');});
    test('Phone layout fits 390px and 320px; text is large and zoom remains enabled',()=>{for(const width of [390,320]){frame.style.width=width+'px';eq(doc().documentElement.scrollWidth,doc().documentElement.clientWidth);}for(const el of doc().querySelectorAll('h1,h2,p,dt,dd'))assert(parseFloat(win().getComputedStyle(el).fontSize)>=22);assert(!q('meta[name=viewport]').content.includes('user-scalable=no'));frame.style.width='390px';});
    await load();await wait();
    test('Reopening the actual page keeps all five games and does not reuse saved prices',()=>{eq(doc().querySelectorAll('.game').length,5);eq(q('#chargers [data-own]').textContent,'Checking…');assert(q('#chargers [data-decision]').hidden);});
    await load(true);
    const root=q('main'),empty={own:null,others:null,decision:null};let calls=0,rejectNext=false,staleNext=false;
    const source={async getCurrentPrices(g){calls++;if(rejectNext)throw Error('Offline');return snapshot(g,12000,10000,Date.now()-(staleNext?7200001:0));}};
    tracker=win().JDTracker.createTracker(root,source);await wait();
    test('Synthetic source exercises the real display and decision path',()=>{eq(q('#chargers [data-own]').textContent,'$120.00 each');eq(q('#chargers [data-others]').textContent,'$100.00 each · Row 2');assert(q('#chargers [data-others]').previousElementSibling.textContent.includes('Section 221'));eq(q('#chargers [data-decision]').textContent,'LOWER TO $99.00 EACH');eq(calls,3);});
    let pending;const deferred={getCurrentPrices(g){return new Promise(resolve=>{pending=()=>resolve(snapshot(g));});}};
    tracker.dispose();tracker=win().JDTracker.createTracker(root,deferred);
    test('During a new request, all games remain and Checking replaces old values immediately',()=>{eq(doc().querySelectorAll('.game').length,5);for(const p of doc().querySelectorAll('.game:not(.sold) [data-own],.game:not(.sold) [data-others]'))eq(p.textContent,'Checking…');for(const d of doc().querySelectorAll('.game:not(.sold) [data-decision]'))assert(d.hidden);});
    tracker.dispose();tracker=win().JDTracker.createTracker(root,source);await wait();rejectNext=true;
    await tracker.refresh();
    test('A failed new check clears old prices and old advice',()=>{eq(q('#chargers [data-own]').textContent,'Price unavailable');eq(q('#chargers [data-others]').textContent,'Price unavailable');assert(q('#chargers [data-decision]').hidden);});
    rejectNext=false;staleNext=true;await tracker.refresh();
    test('Old source observations never appear as current',()=>{eq(q('#chargers [data-own]').textContent,'Price unavailable');assert(q('#chargers [data-decision]').hidden);});
    staleNext=false;const before=calls;doc().dispatchEvent(new Event('visibilitychange'));await wait();
    test('Returning to a visible tab automatically requests all three unsold games again',()=>{eq(calls,before+3);});
    const prior=calls;win().dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));await wait();
    test('Returning through browser history automatically requests a new observation',()=>{eq(calls,prior+3);});
    tracker.dispose();tracker=win().JDTracker.createTracker(root,{getCurrentPrices(){return new Promise(()=>{});}},{timeoutMs:5});await wait(15);
    test('A stalled source has a bounded timeout and leaves every game visible',()=>{eq(doc().querySelectorAll('.game').length,5);eq(q('#chargers [data-own]').textContent,'Price unavailable');});
    tracker.dispose();tracker=win().JDTracker.createTracker(root,{async getCurrentPrices(g){if(g.id==='chargers')throw Error();return snapshot(g);}});await wait();
    test('One game failure does not hide other games or stop their independent requests',()=>{eq(q('#chargers [data-own]').textContent,'Price unavailable');eq(q('#titans [data-own]').textContent,'$120.00 each');});
    tracker.dispose();tracker=win().JDTracker.createTracker(root,{async getCurrentPrices(g){const s=snapshot(g);s.listings=null;return s;}});await wait();
    test('A verified own price may display when competitors are unavailable, with no decision',()=>{eq(q('#chargers [data-own]').textContent,'$120.00 each');eq(q('#chargers [data-others]').textContent,'Price unavailable');assert(q('#chargers [data-decision]').hidden);});

    test('Confirmed sold games remain visible and makes no price request',()=>{eq(q('#rams [data-decision]').textContent,'TICKETS SOLD');eq(q('#rams dl').hidden,true);eq(q('#seahawks [data-decision]').textContent,'TICKETS SOLD');});
    test('Only fresh successful absence uses the owner requested Sold rule',()=>{const s=snapshot(game,12000,10000,now);s.own=null;s.ownListingStatus='not-listed';eq(JD.verifiedView(s,game,now,now).sold,true);eq(JD.verifiedView(s,game,now+1,now+1).sold,undefined);s.ownListingStatus='listed';eq(JD.verifiedView(s,game,now,now).sold,undefined);});
    test('Different verified prices for the two own pairs stay visible without competitors',()=>{const s=snapshot(game,12000,10000,now);s.own=null;s.listings=[quote(game,42500,{id:'pair1',row:1,seats:[11,12]}),quote(game,38300,{id:'pair2',row:1,seats:[13,14]})];const v=JD.verifiedView(s,game,now,now);eq(v.ownPrices.join(','),'38300,42500');eq(v.decision,null);});
    tracker.dispose();await load();await wait();
  }catch(e){failed++;results.push('FAIL browser workflow: '+e.stack);}
  out.textContent=`${passed} passed, ${failed} failed\n`+results.join('\n');document.title=failed?'FAIL — JD tests':'PASS — JD tests';
})();
