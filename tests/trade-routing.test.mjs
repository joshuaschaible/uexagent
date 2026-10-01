import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let sequence = 0;
const fixtureKey = '__tradeRouteTests';
async function moduleSource(path, replacements = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
  for (const [specifier, replacement] of Object.entries(replacements)) source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  return `${source}\n// isolated ${sequence++}`;
}
const clientStub = url('export const getCommodityPricesAll = async () => []; export const getOrbitDistances = async () => []; export const getJumpPoints = async () => [];');
const cacheStub = url('export const getReferenceData = async () => ({terminals:[]});');
const tradeUrl = url(await moduleSource('src/lib/trade-data.ts', {'./uex-client':clientStub,'./data/cache':cacheStub}));
const trade = await import(tradeUrl);
const routeUrl = url(await moduleSource('src/lib/route-planner.ts', {'@/lib/uex-client':clientStub,'@/lib/data/cache':cacheStub,'@/lib/trade-data':tradeUrl}));
const route = await import(routeUrl);
function price(terminal, commodity, buy, sell, extra = {}) {
  return {id:terminal*100+commodity,id_terminal:terminal,id_commodity:commodity,commodity_name:`Ore ${commodity}`,terminal_name:`Terminal ${terminal}`,id_star_system:1,id_orbit:terminal,star_system_name:'Stanton',planet_name:null,price_buy:buy,price_sell:sell,status_buy:buy?4:0,status_sell:sell?2:0,...extra};
}
const emptyDistances = { distances:[], jumps:[], warnings:[] };
const distance = (from,to,gm) => ({id_star_system_origin:1,id_star_system_destination:1,id_orbit_origin:from,id_orbit_destination:to,distance:gm});

test('bulk geography joins terminal IDs without inventing report versions or unknown stock', () => {
  const rows = trade.enrichPriceSummaries([price(1,1,10,0),price(2,1,0,20)], [{id:1,name:'Same terminal name',code:'ABC',id_star_system:64,id_planet:243,id_moon:0,id_orbit:12,id_city:0,id_outpost:0,star_system_name:'Pyro',planet_name:'Pyro IV',is_available_live:0,game_version:'old-facility-version'}]);
  assert.equal(rows[0].star_system_name,'Pyro');
  assert.equal(rows[0].id_planet,243);
  assert.equal(rows[0].game_version,undefined);
  assert.equal(rows[0].scu_buy,undefined);
  assert.equal(trade.isBuyable(rows[0]),false);
  assert.equal(rows[1].star_system_name,'Unknown');
});

test('status and quantity checks distinguish no stock/no demand from unreported counts', () => {
  for (const status of [0,1,8]) assert.equal(trade.isBuyable(price(1,1,10,0,{status_buy:status})),false);
  for (const status of [0,7,8]) assert.equal(trade.isSellable(price(2,1,0,20,{status_sell:status})),false);
  assert.equal(trade.isBuyable(price(1,1,10,0,{status_buy:null})),true);
  assert.equal(trade.isSellable(price(2,1,0,20,{status_sell:1,scu_sell_stock:0})),true);
  assert.equal(trade.isSellable(price(2,1,0,20,{scu_sell:0,scu_sell_stock:1000})),false);
  assert.equal(trade.isBuyable(price(1,1,10,0,{scu_buy:0})),false);
  assert.equal(trade.getCommodityStatusLabel(7,'sell'),'No demand');
});

test('quantities respect supply, demand, ship space and budget without treating seller inventory as demand', () => {
  const buy = price(1,1,10,0,{scu_buy:30});
  const sell = price(2,1,0,20,{scu_sell:12,scu_sell_stock:999});
  assert.equal(trade.availableTradeScu(buy,sell,100),12);
  assert.equal(trade.availableTradeScu(buy,sell,100,85),8.5);
  assert.equal(trade.availableTradeScu(buy,sell,7),7);
  assert.equal(trade.availableTradeScu(buy,{...sell,scu_sell:undefined},100),30);
  assert.equal(trade.availableTradeScu(buy,sell,100,0),0);
});

test('cargo constraints reject definite incompatibilities and preserve unknowns', () => {
  assert.match(trade.getCargoConstraint({is_concept:1},undefined),/concept/);
  assert.match(trade.getCargoConstraint({is_loading_dock:1},{has_loading_dock:0}),/loading dock/);
  assert.equal(trade.getCargoConstraint({is_loading_dock:1},{}),undefined);
  assert.match(trade.getCargoConstraint({container_sizes:'32'},{max_container_size:24}),/none/);
  assert.equal(trade.getCargoConstraint({container_sizes:'1,32'},{max_container_size:24}),undefined);
});

test('multi-hop itinerary explicitly connects independent trades with an empty reposition flight', () => {
  const prices = [price(1,1,10,0,{scu_buy:20}),price(2,1,0,20,{scu_sell:20}),price(3,2,10,0,{scu_buy:20}),price(4,2,0,18,{scu_sell:20})];
  const result = route.buildConnectedRoute(prices,[],{scu:10,maxHops:2},emptyDistances);
  assert.deepEqual(result.stops.map(s=>s.action),['buy','fly','sell','fly','buy','fly','sell']);
  assert.equal(result.stops[3].fromTerminalName,'Terminal 2');
  assert.equal(result.stops[3].terminalName,'Terminal 3');
  assert.equal(result.stops[3].reposition,true);
  assert.equal(result.totalProfit,180);
  assert.equal(result.distanceGm,null);
  assert.deepEqual(route.buildConnectedRoute([...prices].reverse(),[],{scu:10,maxHops:2},emptyDistances),result);
});

test('routes share remaining supply and demand across hops without replenishment', () => {
  const result = route.buildConnectedRoute([price(1,1,10,0,{scu_buy:30}),price(2,1,0,20,{scu_sell:20}),price(3,1,0,19,{scu_sell:30})],[],{scu:20,maxHops:3},emptyDistances);
  assert.deepEqual(result.stops.filter(s=>s.action==='buy').map(s=>s.quantity),[20,10]);
  assert.equal(result.totalProfit,290);
});

test('route ranking uses known orbital distances and respects ship capacity and terminal constraints', () => {
  const prices = [price(1,1,10,0),price(2,1,0,20),price(3,2,10,0),price(4,2,0,18)];
  const data = {distances:[distance(1,2,100),distance(3,4,1)],jumps:[],warnings:[]};
  const result = route.buildConnectedRoute(prices,[],{scu:20,maxHops:1,vehicle:{scu:5}},data);
  assert.equal(result.stops[0].terminalName,'Terminal 3');
  assert.equal(result.stops[0].quantity,5);
  assert.equal(result.distanceGm,1);
  assert.equal(route.buildConnectedRoute(prices,[],{scu:20,vehicle:{scu:20,is_concept:1}},data),null);
  assert.equal(route.buildConnectedRoute(prices,[1,2,3,4].map(id=>({id,has_loading_dock:0})),{scu:20,vehicle:{scu:20,is_loading_dock:1}},data),null);
});

test('cross-system routes require reported jump connectivity without fabricating jump distances', () => {
  const prices=[price(1,1,10,0),price(2,1,0,20,{id_star_system:2,star_system_name:'Pyro'})];
  assert.equal(route.buildConnectedRoute(prices,[],{scu:10},emptyDistances),null);
  const result=route.buildConnectedRoute(prices,[],{scu:10},{distances:[],jumps:[{id_star_system_origin:1,id_star_system_destination:2}],warnings:[]});
  assert.equal(result.distanceGm,null);
  assert.match(result.warnings.join(' '),/unknown/);
  assert.match(result.warnings.join(' '),/unreported/);
  assert.equal(route.buildConnectedRoute(prices.map(p=>({...p,id_star_system:0})),[],{scu:10},emptyDistances),null);
});

test('trade cache coalesces loads, retries failures and ignores stale completion after clearing', async t => {
  const state={requests:[]};globalThis[fixtureKey]=state;t.after(()=>delete globalThis[fixtureKey]);
  const client=url(`export const getCommodityPricesAll=()=>new Promise((resolve,reject)=>globalThis.${fixtureKey}.requests.push({resolve,reject}));`);
  const mod=await import(url(await moduleSource('src/lib/trade-data.ts',{'./uex-client':client,'./data/cache':cacheStub})));
  const stale=mod.getTradePrices();const same=mod.getTradePrices();assert.equal(state.requests.length,1);
  mod.clearTradeDataCache();const fresh=mod.getTradePrices();assert.equal(state.requests.length,2);
  state.requests[0].resolve([price(1,1,10,0)]);await Promise.all([stale,same]);
  const shared=mod.getTradePrices();assert.equal(state.requests.length,2);
  state.requests[1].resolve([price(2,1,10,0)]);const data=await fresh;assert.equal(await shared,data);assert.equal(await mod.getTradePrices(),data);
  mod.clearTradeDataCache();const bad=mod.getTradePrices();state.requests[2].reject(new Error('offline'));await assert.rejects(bad,/offline/);
  const retry=mod.getTradePrices();assert.equal(state.requests.length,4);state.requests[3].resolve([]);await retry;
});

test('distance cache bounds upstream calls, coalesces requests and retries partial failures', async t => {
  const state={requests:[]};globalThis[fixtureKey]=state;t.after(()=>delete globalThis[fixtureKey]);
  const client=url(`export const getOrbitDistances=id=>new Promise((resolve,reject)=>globalThis.${fixtureKey}.requests.push({id,resolve,reject}));export const getJumpPoints=()=>new Promise((resolve,reject)=>globalThis.${fixtureKey}.requests.push({id:'jumps',resolve,reject}));`);
  const mod=await import(url(await moduleSource('src/lib/route-planner.ts',{'@/lib/uex-client':client,'@/lib/data/cache':cacheStub,'@/lib/trade-data':tradeUrl})));
  const first=mod.getRouteDistanceData([1,2,3,4,5,6]);const shared=mod.getRouteDistanceData([6,5,4,3,2,1]);assert.equal(state.requests.length,5);
  state.requests.slice(0,4).forEach(r=>r.resolve([]));state.requests[4].reject(new Error('offline'));const data=await first;assert.equal(await shared,data);assert.match(data.warnings.join(' '),/cross-system/);
  const next=mod.getRouteDistanceData([1,2,3,4,5,6]);assert.equal(state.requests.length,10);state.requests.slice(5).forEach(r=>r.resolve([]));const good=await next;assert.equal(await mod.getRouteDistanceData([1,2,3,4,5,6]),good);
  mod.clearRouteDistanceCache();const fresh=mod.getRouteDistanceData([1]);assert.equal(state.requests.length,12);state.requests.slice(10).forEach(r=>r.resolve([]));await fresh;
});

test('UEX object envelopes remain separate from arrays and normalize numeric prices without inventing quantities', async t => {
  let data={live:'4.10.1',ptu:null};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);return{ok:true,json:async()=>({status:'ok',data})};});
  const client=await import(url(await moduleSource('src/lib/uex-client.ts')));
  assert.deepEqual(await client.getGameVersions(),data);
  await assert.rejects(client.uexFetch('game_versions'),/invalid response/);
  data=[];await assert.rejects(client.uexFetchObject('game_versions'),/invalid response/);
  data=[{id:1,id_commodity:1,id_terminal:1,price_buy:'10',price_sell:'20',scu_buy:'0',scu_sell:null,status_buy:'4'}];
  const [row]=await client.getCommodityPricesAll();assert.equal(row.price_buy,10);assert.equal(row.scu_buy,0);assert.equal(row.scu_sell,undefined);assert.equal(row.status_buy,4);
  await assert.rejects(client.uexFetch('https://example.com/'),/Invalid UEX endpoint/);
  data={distance:'6'};assert.equal((await client.getTerminalDistance(1,2)).distance,6);
});

test('first-pickup constraints apply to the origin only and budget grows only after a completed sale', () => {
  const prices=[price(1,1,10,0,{scu_buy:100}),price(2,1,0,20,{scu_sell:100}),price(3,2,10,0,{scu_buy:100}),price(4,2,0,25,{scu_sell:100})];
  const terminals=[{id:1,id_planet:7,id_moon:8,id_orbit:9,id_poi:10,id_city:11,id_space_station:12},{id:3,id_planet:99}];
  const result=route.buildConnectedRoute(prices,terminals,{scu:20,maxHops:2,budget:50,originTerminalId:1,originPlanetId:7,originMoonId:8,originOrbitId:9,originPoiId:10,originCityId:11,originStationId:12},emptyDistances);
  const buys=result.stops.filter(s=>s.action==='buy');
  assert.deepEqual(buys.map(s=>s.terminalName),['Terminal 1','Terminal 3']);
  assert.deepEqual(buys.map(s=>s.quantity),[5,10]);
  assert.deepEqual(buys.map(s=>s.totalCost),[50,100]);
  assert.equal(result.totalProfit,200);
  assert.equal(route.buildConnectedRoute(prices,terminals,{scu:20,originTerminalId:999},emptyDistances),null);
  assert.equal(route.buildConnectedRoute(prices,terminals,{scu:20,budget:0},emptyDistances),null);
  assert.equal(route.buildConnectedRoute(prices,terminals,{scu:20,originStationId:999},emptyDistances),null);
});
