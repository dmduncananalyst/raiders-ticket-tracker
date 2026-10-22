/* Verified seller asking prices only. All amounts are integer US cents. */
globalThis.JD = (() => {
  const seats = Object.freeze({section:221,row:1,numbers:Object.freeze([11,12,13,14])});
  const games = [
    ['rams','Los Angeles Rams','2026-10-25T13:25:00-07:00','1700646CC3A7C3B1'],
    ['seahawks','Seattle Seahawks','2026-11-15T13:05:00-08:00','1700646CC3C7C3F4'],
    ['chargers','Los Angeles Chargers','2026-12-13T13:05:00-08:00','1700646CC3D4C40E'],
    ['broncos','Denver Broncos','2026-12-20T13:25:00-08:00','1700646CC3B3C3BF'],
    ['titans','Tennessee Titans','2026-12-27T13:05:00-08:00','1700646CC3A0C3A4']
  ].map(([id,opponent,date,event])=>Object.freeze({id,opponent,date,event,sold:['rams','seahawks'].includes(id)}));
  const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const amount = n => Number.isInteger(n) && n>0 && n<=100000000;
  function recommend(own,prices) {
    if(!amount(own)||!Array.isArray(prices)||!prices.length||!prices.every(amount))return null;
    const low=Math.min(...prices);
    if(own*100>low*105){let target=low-100;if(target<=0||target*100<low*90)target=low;return {kind:'lower',target,text:`LOWER TO ${money(target)} EACH`};}
    if(own*100<low*90)return {kind:'raise',target:low,text:`RAISE TO ${money(low)} EACH`};
    return {kind:'keep',target:null,text:'KEEP YOUR PRICE'};
  }
  // Only fresh observations from the browser helper are accepted.
  // A new visit needs a new observation, never a previously saved value.
  function verifiedView(snapshot,game,started,now=Date.now()) {
    const missing={own:null,others:null,decision:null};
    if(!snapshot||snapshot.source!=='ticketmaster'||snapshot.eventId!==game.event||!Number.isFinite(snapshot.checkedAt)||snapshot.checkedAt<started||snapshot.checkedAt>now||now-snapshot.checkedAt>7200000)return missing;
    if(snapshot.ownListingStatus==='not-listed'&&Array.isArray(snapshot.listings)&&snapshot.own==null&&!snapshot.listings.some(p=>p?.section===221&&p.row===1&&p.seats?.some(n=>seats.numbers.includes(n))))return {...missing,sold:true};
    const valid=p=>p&&p.verified===true&&typeof p.listingId==='string'&&p.listingId.length>0&&p.eventId===game.event&&p.currency==='USD'&&p.basis==='seller-asking'&&amount(p.priceCents)&&p.section===221&&Number.isInteger(p.row)&&Array.isArray(p.seats)&&p.seats.every(Number.isInteger)&&new Set(p.seats).size===p.seats.length;
    const own=snapshot.own;
    const exact=valid(own)&&own.row===1&&own.seats.length===4&&seats.numbers.every(n=>own.seats.includes(n));
    const ownPrice=exact?own.priceCents:null;
    const ownQuotes=Array.isArray(snapshot.listings)?snapshot.listings.filter(p=>valid(p)&&p.resale===true&&p.row===1&&[2,4].includes(p.seats.length)&&p.seats.every((n,i)=>seats.numbers.includes(n)&&(i===0||n===p.seats[i-1]+1))):[];
    const ownPrices=[...new Set(ownQuotes.map(p=>p.priceCents))].sort((a,b)=>a-b);
    const ownSeats=ownQuotes.flatMap(p=>p.seats);
    const completeOwn=ownSeats.length===4&&new Set(ownSeats).size===4;
    if(!Array.isArray(snapshot.listings))return {own:ownPrice,others:null,decision:null};
    const unique=new Map(),comparisons=new Map();
    for(const p of snapshot.listings){
      if(!valid(p)||p.resale!==true||p.row<1||p.row>4||![2,4].includes(p.seats.length))continue;
      const sorted=p.seats.slice().sort((a,b)=>a-b);
      if(!sorted.every((n,i)=>i===0||n===sorted[i-1]+1))continue;
      if((own&&p.listingId===own.listingId)||(p.row===1&&p.seats.some(n=>seats.numbers.includes(n))))continue;
      if(unique.has(p.listingId)&&unique.get(p.listingId)!==p.priceCents)return {own:ownPrice,ownPrices,others:null,decision:null};
      unique.set(p.listingId,p.priceCents);
      comparisons.set(p.listingId,{priceCents:p.priceCents,row:p.row});
    }
    const prices=[...unique.values()].sort((a,b)=>a-b);
    const otherQuotes=[...comparisons.values()].sort((a,b)=>a.priceCents-b.priceCents||a.row-b.row);
    return {own:ownPrice,ownPrices,others:prices.length?prices:null,otherQuotes,decision:completeOwn&&ownPrices.length>1&&prices.length&&ownPrices.every(p=>recommend(p,prices)?.text===recommend(ownPrices[0],prices)?.text)?recommend(ownPrices[0],prices):recommend(ownPrice,prices)};
  }
  return {games,seats,money,recommend,verifiedView};
})();
