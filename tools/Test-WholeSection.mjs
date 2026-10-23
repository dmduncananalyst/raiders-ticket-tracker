import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({console,Intl,Date,setTimeout,clearTimeout,AbortController,URLSearchParams,location:{protocol:'https:',search:'?test'},document:{addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}}});
for(const file of ['core.js','tools/market-reader.js','app.js'])vm.runInContext(await fs.readFile(file,'utf8'),context);
const result={textContent:''};
context.document.querySelector=()=>result;
const html=await fs.readFile('tools/market-tests.html','utf8');
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
assert.match(context.document.title,/^PASS/);console.log(result.textContent);
const normalized=context.JDMarketReader.snapshot([
 {listingId:'outside',inventoryType:'resale',currency:'USD',section:'221',row:'12',seatFrom:'1',seatTo:'1',listPrice:50,faceValue:50,noChargesPrice:50,totalPrice:60,charges:[{amount:10}],sellableQuantities:[1]},
 {listingId:'existing',inventoryType:'resale',currency:'USD',section:'221',row:'3',seatFrom:'1',seatTo:'2',listPrice:100,faceValue:100,noChargesPrice:100,totalPrice:110,charges:[{amount:10}],sellableQuantities:[2]}
],'event',1);
assert.equal(normalized.listings.length,1);assert.equal(normalized.sectionListings.length,2);
console.log('PASS expanded payload preserves the published page\'s original comparison listings');
const payloadGame=context.JD.games[0];
const payload={...normalized,eventId:payloadGame.event,ownListingStatus:'listed',listings:normalized.listings.map(p=>({...p,eventId:payloadGame.event})),sectionListings:normalized.sectionListings.map(p=>({...p,eventId:payloadGame.event}))};
const expanded=context.JD.verifiedView(payload,payloadGame,1,1);
assert.equal(expanded.otherQuotes.length,2);assert.equal(expanded.others.join(','),'10000');
assert.equal(context.JD.verifiedView({...payload,sectionListings:Array(101).fill(payload.sectionListings[0])},payloadGame,1,1).others,null);
console.log('PASS expanded payload renders the whole section and retains the 100-listing limit');
const suite=await fs.readFile('tests.js','utf8');
// Run the existing core cases, including the expanded-section regressions.
vm.runInContext(suite.slice(0,suite.indexOf('  const load='))+'\nif(failed)throw Error(results.join("\\n"));console.log(results.join("\\n"));})();',context);
const game=context.JD.games.find(g=>g.id==='chargers'),now=Date.now();
context.JD.games=[game];
const fields=new Map(),card={classList:{add(){},remove(){}},querySelector(s){if(!fields.has(s))fields.set(s,{textContent:'',hidden:false});return fields.get(s);}};
const listing=(id,row,price,seats)=>({verified:true,listingId:id,eventId:game.event,currency:'USD',basis:'seller-asking',section:221,row,priceCents:price,seats,resale:true});
const tracker=context.JDTracker.createTracker({querySelector(){return card;}},{async getCurrentPrices(){return {source:'ticketmaster',eventId:game.event,checkedAt:Date.now(),own:listing('own',1,37500,[11,12,13,14]),listings:[listing('outside-old-range',12,15000,[1]),listing('other-row',7,17000,[1,2,3])]};}});
try{
 await new Promise(r=>setTimeout(r,20));
 assert.equal(fields.get('[data-others]').textContent,'$150.00 each · Row 12\n$170.00 each · Row 7');
 assert.equal(fields.get('[data-decision]').hidden,true);
 console.log('PASS real renderer shows all-section listings without recommendation-eligible offers');
}finally{tracker.dispose();}
