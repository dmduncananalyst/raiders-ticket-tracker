/* Reads ONLY the current public event's already-loaded offer data. No requests,
   cookies, account state, checkout state, hidden endpoints or credentials.
   The browser helper reloads the normal event page before using a snapshot. */
globalThis.JDMarketReader = (() => {
  const allowed=new Set(['1700646CC3A7C3B1','1700646CC3C7C3F4','1700646CC3D4C40E','1700646CC3B3C3BF','1700646CC3A0C3A4']);
  function cents(value){const s=String(value);if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [whole,part='']=s.split('.');const n=Number(whole)*100+Number(part.padEnd(2,'0'));return Number.isSafeInteger(n)&&n>=0&&n<=100000000?n:null;}
  function normalize(raw,eventId){
    if(!raw||raw.inventoryType!=='resale'||raw.currency!=='USD'||raw.protected===true||raw.online===false||String(raw.section)!=='221'||!/^\d+$/.test(String(raw.row))||!Number.isSafeInteger(Number(raw.row))||Number(raw.row)<1)return null;
    const start=Number(raw.seatFrom),end=Number(raw.seatTo);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end-start+1>100||!raw.listingId)return null;
    if(!Array.isArray(raw.sellableQuantities)||!raw.sellableQuantities.some(n=>Number.isInteger(n)&&n>0&&n<=end-start+1))return null;
    const price=cents(raw.listPrice),total=cents(raw.totalPrice);
    if(price===null||price<=0||total===null||cents(raw.noChargesPrice)!==price||cents(raw.faceValue)!==price||!Array.isArray(raw.charges))return null;
    const charges=raw.charges.map(c=>cents(c.amount));
    if(charges.some(c=>c===null)||price+charges.reduce((a,b)=>a+b,0)!==total)return null;
    return {verified:true,listingId:String(raw.listingId),eventId,currency:'USD',basis:'seller-asking',priceCents:price,buyerPriceCents:total,section:221,row:Number(raw.row),seats:Array.from({length:end-start+1},(_,i)=>start+i),resale:true,comparisonEligible:[2,4].includes(end-start+1)&&raw.sellableQuantities.some(n=>[2,4].includes(n)&&n<=end-start+1)};
  }
  function snapshot(offers,eventId,checkedAt){
    const sectionListings=Array.from(offers,o=>normalize(o,eventId)).filter(Boolean);
    // Keep the original payload compatible with the currently published page.
    const listings=sectionListings.filter(o=>o.row<=4&&o.comparisonEligible),ownParts=listings.filter(o=>o.row===1&&o.seats.every(n=>n>=11&&n<=14));
    const seats=ownParts.flatMap(o=>o.seats),prices=new Set(ownParts.map(o=>o.priceCents));
    const exact=seats.length===4&&new Set(seats).size===4&&[11,12,13,14].every(n=>seats.includes(n))&&prices.size===1;
    const own=exact?{...ownParts[0],listingId:ownParts.map(o=>o.listingId).sort().join('|'),listingIds:ownParts.map(o=>o.listingId),seats:[11,12,13,14]}:null;
    // The owner requests a Sold display when a successful full-event read has
    // no public offer overlapping his seats. This is a display rule, not a
    // verified transaction. An unreadable price on a present offer is not sold.
    const ownListed=Array.from(offers).some(o=>o.inventoryType==='resale'&&String(o.section)==='221'&&String(o.row)==='1'&&Number(o.seatFrom)<=14&&Number(o.seatTo)>=11);
    return {source:'ticketmaster',eventId,checkedAt,own,listings,sectionListings,ownListingStatus:ownListed?'listed':'not-listed'};
  }
  function read(doc,location,clock=performance){
    const eventId=location.pathname.match(/(?:^|\/)event\/([A-Za-z0-9]+)\/?$/)?.[1];
    if(location.hostname!=='www.ticketmaster.com'||!allowed.has(eventId))return {status:'unsupported-page'};
    if(/your browsing activity has been paused|let.s get your identity verified|access denied/i.test(doc.title+' '+(doc.body?.innerText||'')))return {status:'blocked',eventId};
    const seeds=[...doc.querySelectorAll('button')].filter(el=>(el.innerText||'').trim()==='Filters').concat([...doc.querySelectorAll('[data-component="svg__seat"]')].slice(0,1));
    for(const node of seeds){
      const fiberKey=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));
      let fiber=fiberKey&&node[fiberKey];
      for(let depth=0;fiber&&depth<60;depth++,fiber=fiber.return){
        const store=fiber.memoizedProps?.value?.store;
        if(typeof store?.getState!=='function')continue;
        // Do not inspect any other store slice, including accounts or checkout.
        const app=store.getState().app;
        if(app?.currentEventId!==eventId)continue;
        const offers=app.events?.[eventId]?.eventOfferJSON;
        if(!Array.isArray(offers)||offers.length===0||app.isLoading===true)continue;
        return {status:'ready',...snapshot(offers,eventId,Math.floor(clock.timeOrigin)),offersLoaded:offers.length};
      }
    }
    return {status:'loading',eventId};
  }
  return {read,normalize,snapshot};
})();
