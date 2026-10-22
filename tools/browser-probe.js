/* Diagnostic only: reads rendered event-page labels, never cookies, passwords,
   account details, hidden API responses, or ticket barcodes. No network calls.
   Candidates are NOT verified prices and must never feed recommendations. */
globalThis.JDBrowserProbe = (() => {
  const events = new Set(['1700646CC3A7C3B1','1700646CC3C7C3F4','1700646CC3D4C40E','1700646CC3B3C3BF','1700646CC3A0C3A4']);
  function inspect(doc,location,now=Date.now()) {
    const event=location.pathname.match(/(?:^|\/)event\/([A-Za-z0-9]+)\/?$/)?.[1];
    if(location.hostname!=='www.ticketmaster.com'||!events.has(event))return {state:'outside-allowed-event',observedAt:now};
    const text=doc.body?.innerText||'';
    if(/your browsing activity has been paused|let.s get your identity verified|pardon the interruption|access denied|verify (?:that )?you(?:.re| are) (?:a )?human|are you a robot/i.test(text+' '+doc.title))return {state:'blocked',eventId:event,observedAt:now};
    const elements=[...doc.querySelectorAll('[data-testid], [role="listitem"], [role="tooltip"], [class*="Tooltip"], [class*="tooltip"], li, article')].filter(el=>el.getClientRects().length);
    const candidates=[],seen=new Set(),priceControls=[];
    for(const el of elements){
      const value=el.innerText||'';
      // Refuse a page-sized parent: prices from different listings must not mix.
      if(value.length>1800||!/(?:section|sec\.?)\s*:?\s*221\b/i.test(value))continue;
      const row=Number(value.match(/\brow\s*:?\s*([1-4])\b/i)?.[1]);
      if(!row)continue;
      const amounts=[...value.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))?\b/g)].map(m=>Number(m[1].replace(/,/g,''))*100+Number(m[2]||0));
      const seats=value.match(/\bseats?\s*:?\s*(\d+)\s*[-–]\s*(\d+)\b/i);
      const signature=JSON.stringify({row,amounts,range:seats?[Number(seats[1]),Number(seats[2])]:null});
      if(!amounts.length||seen.has(signature))continue;
      seen.add(signature);
      for(const node of el.querySelectorAll('button,a,[role="button"]'))priceControls.push({tag:node.tagName,label:(node.getAttribute('aria-label')||node.innerText||'').trim().slice(0,100)});
      candidates.push({section:221,row,seatRange:seats?[Number(seats[1]),Number(seats[2])]:null,amountsCents:amounts.slice(0,8),resaleLabelVisible:/\bresale\b/i.test(value),feesIncludedLabelVisible:/includes? fees|fees included|all.in pric/i.test(value),ticketPriceLabelVisible:/ticket price|base price/i.test(value)});
      if(candidates.length===40)break;
    }
    return {
      state:candidates.length?'candidates-need-verification':/loading/i.test(text)?'loading-or-no-readable-listings':'no-readable-matching-listings',
      eventId:event,observedAt:now,
      pageReadyState:doc.readyState,
      renderedTextLength:text.length,
      visiblePriceLabelCount:[...text.matchAll(/\$\s*\d/g)].length,
      section221LabelVisible:/(?:section|sec\.?)\s*:?\s*221\b/i.test(text),
      candidateCount:candidates.length,candidates,priceControls,
      ownListingVerified:false,sellerPriceVerified:false,
      signInLabelVisible:/\bsign in\b/i.test(text),
      publicNotices:[...doc.querySelectorAll('[role="dialog"]')].filter(el=>el.getClientRects().length&&/Accept & Continue|important information|cookie/i.test(el.innerText||'')).map(el=>(el.innerText||'').slice(0,1200)),
      relevantControls:[...doc.querySelectorAll('button,[role="button"]')].filter(el=>el.getClientRects().length).map(el=>(el.getAttribute('aria-label')||el.innerText||'').trim()).filter(label=>/ticket|seat|map|list|section|filter|quantity|resale|cookie|accept|agree|sign in/i.test(label)).map(label=>label.slice(0,160)).slice(0,25)
    };
  }
  function describeControls(doc,location){
    if(inspect(doc,location).state==='outside-allowed-event')return {state:'outside-allowed-event'};
    const match=el=>/(?:section|sec\.?)\s*:?\s*221\b/i.test(el.getAttribute('aria-label')||'')||(el.textContent||'').trim()==='221'||el.getAttribute('data-section-name')==='221';
    const targets=[...doc.querySelectorAll('svg text,svg path,svg g,[aria-label],[data-section-id],[data-sectionid]')].filter(match).slice(0,20).map(el=>{
      const rect=el.getBoundingClientRect();
      return {tag:el.tagName,attributes:[...el.attributes].filter(a=>/^(aria-label|role|id|class|data-section.*)$/.test(a.name)).map(a=>[a.name,a.value]),center:{x:rect.x+rect.width/2,y:rect.y+rect.height/2},parentTag:el.parentElement?.tagName,parentAttributes:[...(el.parentElement?.attributes||[])].filter(a=>/^(aria-label|role|id|class|data-section.*)$/.test(a.name)).map(a=>[a.name,a.value])};
    });
    const selects=[...doc.querySelectorAll('select,[role="combobox"],input')].filter(el=>el.getClientRects().length).map(el=>({tag:el.tagName,type:el.getAttribute('type'),role:el.getAttribute('role'),label:el.getAttribute('aria-label'),placeholder:el.getAttribute('placeholder')}));
    const rows=[...doc.querySelectorAll('g.seats [data-section-name="221"] [data-row-name]')];
    const mapRows=rows.map(el=>el.getAttribute('data-row-name'));
    const seatMap=rows.filter(el=>['1','2','3','4'].includes(el.getAttribute('data-row-name'))).flatMap(row=>[...row.querySelectorAll('[data-seat-name]')].map(el=>{const r=el.getBoundingClientRect();return {row:row.getAttribute('data-row-name'),seat:el.getAttribute('data-seat-name'),class:el.getAttribute('class'),center:{x:r.x+r.width/2,y:r.y+r.height/2}};}));
    const filterLabels=[...doc.querySelectorAll('label,legend,[role="dialog"] h2,[role="dialog"] h3')].filter(el=>el.getClientRects().length).map(el=>(el.innerText||'').trim()).filter(Boolean).map(v=>v.slice(0,150)).slice(0,40);
    return {viewport:{width:doc.defaultView.innerWidth,height:doc.defaultView.innerHeight,scale:doc.defaultView.devicePixelRatio},targets,selects,mapRows,seatMap,filterLabels};
  }
  function priceResources(location){
    if(location.hostname!=='www.ticketmaster.com'||!events.has(location.pathname.match(/(?:^|\/)event\/([A-Za-z0-9]+)\/?$/)?.[1]))return [];
    return performance.getEntriesByType('resource').map(r=>new URL(r.name)).filter(u=>(u.hostname==='ticketmaster.com'||u.hostname.endsWith('.ticketmaster.com'))&&/pricing|offer|facets|inventory|availability|quickpick|top.pick/i.test(u.pathname)).map(u=>({host:u.hostname,path:u.pathname}));
  }
  function priceComponentSchema(doc,location){
    if(inspect(doc,location).state==='outside-allowed-event')return [];
    const nodes=[...doc.querySelectorAll('[data-testid],[role="listitem"],[class*="tooltip"],[class*="Tooltip"],[role="tooltip"],li,article')].filter(el=>el.getClientRects().length&&(el.innerText||'').length<1800&&/\$/.test(el.innerText||'')&&/221/.test(el.innerText||''));
    const mapSeat=doc.querySelector('g.seats [data-section-name="221"] [data-row-name="3"] [data-seat-name="1"]');
    if(mapSeat)nodes.push(mapSeat);
    const results=[],seen=new Set();
    for(const el of nodes){
      const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
      let fiber=key&&el[key];
      for(let depth=0;fiber&&depth<35;depth++,fiber=fiber.return){
        if(seen.has(fiber))continue;seen.add(fiber);
        const props=fiber.memoizedProps;
        if(!props||typeof props!=='object')continue;
        const keys=Object.keys(props).filter(k=>k!=='children');
        const marketFields={};
        for(const k of keys.filter(k=>/offer|ticket|price|listing|seat|section|row/i.test(k))){
          const value=props[k];
          marketFields[k]=value&&typeof value==='object'?{keys:Object.keys(value).slice(0,40)}:typeof value;
        }
        if(Object.keys(marketFields).length)results.push({depth,propKeys:keys.slice(0,40),marketFields});
        if(props.value&&typeof props.value==='object'){
          const contextReport={depth,contextKeys:Object.keys(props.value).slice(0,50)};
          if(typeof props.value.store?.getState==='function'){
            const state=props.value.store.getState();
            contextReport.storeKeys=Object.keys(state).slice(0,70);
            contextReport.marketShape={appKeys:Object.keys(state.app||{}),listviewKeys:Object.keys(state.listview||{})};
            const event=state.app?.events?.[state.app.currentEventId];
            contextReport.marketShape.eventId=state.app.currentEventId;
            contextReport.marketShape.eventKeys=Object.keys(event||{});
            contextReport.marketShape.quickPicksKeys=Object.keys(state.listview?.ismdsQuickPicksData||{});
            contextReport.marketShape.resaleKeys=Object.keys(state.listview?.rasUasData||{});
            let eventOffers=event?.eventOfferJSON;
            contextReport.marketShape.eventOfferType=typeof eventOffers;
            contextReport.marketShape.eventOfferIsArray=Array.isArray(eventOffers);
            contextReport.marketShape.eventOfferLength=eventOffers?.length;
            if(typeof eventOffers==='string'){try{eventOffers=JSON.parse(eventOffers);}catch{eventOffers=null;}}
            contextReport.marketShape.eventOfferKeys=Object.keys(eventOffers||{}).slice(0,12);
            contextReport.marketShape.eventOfferEmbeddedKeys=Object.keys(eventOffers?._embedded||{});
            const offerArray=Array.isArray(eventOffers)?eventOffers:eventOffers?._embedded?.offer;
            contextReport.marketShape.eventOfferCount=offerArray?.length;
            contextReport.marketShape.firstOfferKeys=Object.keys(offerArray?.[0]||{});
            contextReport.marketShape.section221Offers=(offerArray||[]).filter(o=>o.inventoryType==='resale'&&String(o.section)==='221'&&['1','2','3','4'].includes(String(o.row))).map(o=>({section:o.section,row:o.row,seatFrom:o.seatFrom,seatTo:o.seatTo,currency:o.currency,listPrice:o.listPrice,faceValue:o.faceValue,noChargesPrice:o.noChargesPrice,totalPrice:o.totalPrice,charges:o.charges,sellableQuantities:o.sellableQuantities,expires:o.meta?.expires}));
          }
          results.push(contextReport);
        }
      }
    }
    if(mapSeat){const bindings={};for(const k of Object.keys(mapSeat)){if(k.startsWith('__')){const value=mapSeat[k];bindings[k.replace(/\$.*/,'$')]=value&&typeof value==='object'?Object.keys(value).slice(0,40):typeof value;}}results.push({mapSeatBindings:bindings});}
    return results;
  }
  return {inspect,describeControls,priceResources,priceComponentSchema};
})();
