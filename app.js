(() => {
  'use strict';
  function createTracker(root,source,{timeoutMs=source.timeoutMs||12000}={}) {
    let generation=0,controller=null,disposed=false;
    const timers=new Set();
    function paint(game,view,checking=false){
      const card=root.querySelector(`#${game.id}`);
      card.classList.remove('sold');card.querySelector('dl').hidden=false;
      if(game.sold||view.sold){card.classList.add('sold');card.querySelector('[data-own]').textContent='Sold';card.querySelector('[data-others]').textContent='—';card.querySelector('dl').hidden=true;const badge=card.querySelector('[data-decision]');badge.hidden=false;badge.textContent='TICKETS SOLD';badge.className='decision sold-label';return;}
      card.querySelector('[data-own]').textContent=checking?'Checking…':view.own===null?(view.ownPrices?.length?view.ownPrices.map(JD.money).join(' / ')+' each':'Price unavailable'):`${JD.money(view.own)} each`;
      card.querySelector('[data-others]').textContent=checking?'Checking…':!view.otherQuotes?.length&&!view.others?.length?'Price unavailable':view.otherQuotes?.length?view.otherQuotes.map(p=>`${JD.money(p.priceCents)} each · Row ${p.row}`).join('\n'):view.others.map(JD.money).join(' · ')+' each';
      const decision=card.querySelector('[data-decision]');
      decision.textContent=view.decision?.text||'';
      decision.hidden=!view.decision;
      decision.className='decision '+(view.decision?.kind||'');
    }
    async function refresh(){
      if(disposed)return;
      const run=++generation;
      controller?.abort();
      for(const timer of timers)clearTimeout(timer);
      timers.clear();
      controller=new AbortController();
      const signal=controller.signal,started=Date.now();
      const empty={own:null,others:null,decision:null};
      JD.games.forEach(game=>paint(game,empty,true));
      await Promise.all(JD.games.map(async game=>{
        if(game.sold)return;
        let timer;
        const checkController=new AbortController();
        const cancel=()=>checkController.abort();
        signal.addEventListener('abort',cancel,{once:true});
        if(signal.aborted)cancel();
        try{
          const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{checkController.abort();reject(new Error('Timeout'));},timeoutMs);timers.add(timer);});
          const snapshot=await Promise.race([Promise.resolve().then(()=>source.getCurrentPrices(game,{signal:checkController.signal,started})),timeout]);
          if(!disposed&&run===generation&&!signal.aborted){
            paint(game,JD.verifiedView(snapshot,game,started));
            const expiresIn=snapshot.checkedAt+7200000-Date.now();
            if(expiresIn>0){const expiry=setTimeout(()=>{timers.delete(expiry);if(!disposed&&run===generation)paint(game,empty);},expiresIn);timers.add(expiry);}
          }
        }catch{
          if(!disposed&&run===generation&&!signal.aborted)paint(game,empty);
        }finally{checkController.abort();signal.removeEventListener('abort',cancel);clearTimeout(timer);timers.delete(timer);}
      }));
    }
    // Opening, returning from another tab, and history-cache restoration all
    // invalidate the previous display and request a new observation.
    const visible=()=>{if(!document.hidden)refresh();};
    const pageshow=event=>{if(event.persisted)refresh();};
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('pageshow',pageshow);
    refresh();
    return {refresh,dispose(){disposed=true;generation++;controller?.abort();for(const timer of timers)clearTimeout(timer);timers.clear();document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',pageshow);}};
  }
  globalThis.JDTracker={createTracker};
  if(location.protocol!=='file:'&&!new URLSearchParams(location.search).has('test'))createTracker(document.querySelector('main'),JDPricingSource);
})();
