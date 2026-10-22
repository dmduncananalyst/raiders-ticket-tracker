/* Local helper by default. A preconfigured bookmark may select the optional
   remote relay. Tokens are never embedded in website files. */
globalThis.JDPricingSource = (() => {
  const settings=new URLSearchParams(location.hash.slice(1));
  const viewKey=settings.get('key');
  const relay=settings.get('relay')||(location.protocol==='https:'&&location.hostname.endsWith('.workers.dev')?location.origin+'/':null);
  let relayOrigin=null;
  if(relay){try{const u=new URL(relay);if(u.protocol==='https:'&&u.hostname.endsWith('.workers.dev')&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&/^[A-Za-z0-9_-]{32,128}$/.test(viewKey||''))relayOrigin=u.origin;}catch{}}
  function delay(signal){return new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},2000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});}
  return Object.freeze({
    kind:'browser-helper',timeoutMs:360000,
    async getCurrentPrices(game,{signal,started}={}) {
      if(relay&&!relayOrigin)throw new Error('REMOTE_SETUP_INVALID');
      const requestStarted=Number.isFinite(started)?started:Date.now();
      const checkId=relayOrigin?crypto.randomUUID():String(started);
      const url=`${relayOrigin||'.'}/api/prices/${encodeURIComponent(game.id)}?check=${encodeURIComponent(checkId)}`;
      const options={signal,redirect:'error',cache:'no-store',credentials:relayOrigin?'omit':'same-origin'};
      if(relayOrigin)options.headers={Authorization:`Bearer ${viewKey}`};
      for(let poll=0;poll<180;poll++){
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        const response=await fetch(url,options);
        if(response.status===202&&relayOrigin){await delay(signal);continue;}
        if(!response.ok)throw new Error('CURRENT_PRICE_UNAVAILABLE');
        const quote=await response.json();
        if(quote.status!=='ready'||quote.eventId!==game.event||(relayOrigin&&quote.checkId!==checkId))throw new Error('CURRENT_PRICE_UNAVAILABLE');
        if(relayOrigin){
          // The phone and Windows collector have independent wall clocks. The
          // relay binds its queue/lease timestamps to this check ID. The reader
          // separately proves freshness against its own navigation clock. Use
          // the first lease as a conservative age bound, never receipt time.
          if(!Number.isFinite(quote.requestCreatedAt)||!Number.isFinite(quote.collectionNotBefore)||!Number.isFinite(quote.responseAt)||quote.collectionNotBefore<quote.requestCreatedAt||quote.collectionNotBefore>quote.responseAt||quote.responseAt-quote.collectionNotBefore>7200000||!Number.isFinite(quote.checkedAt)||!Number.isFinite(quote.collectionStartedAt)||quote.checkedAt<quote.collectionStartedAt)throw new Error('CURRENT_PRICE_UNAVAILABLE');
          return {...quote,collectorCheckedAt:quote.checkedAt,checkedAt:requestStarted+(quote.collectionNotBefore-quote.requestCreatedAt)};
        }
        return quote;
      }
      throw new Error('CURRENT_PRICE_UNAVAILABLE');
    }
  });
})();
