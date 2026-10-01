import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const source = async name => stripTypeScriptTypes(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'));
const tradeDataUrl = url((await source('trade-data')).replaceAll('"./uex-client"', JSON.stringify(url('export const getCommodityPricesAll = async () => [];'))).replaceAll('"./data/cache"', JSON.stringify(url('export const getReferenceData = async () => ({terminals:[]});'))));
const {findTradeOpportunities} = await import(url((await source('trade-recommendations')).replaceAll('"./trade-data"',JSON.stringify(tradeDataUrl))));
const {parseCrew,formatCrew,compareCrew,cargoHandlingNotes,shipLogistics} = await import(url(await source('vehicle-details')));
const terminals=[{id:1,has_loading_dock:1,max_container_size:32},{id:2,has_loading_dock:1,max_container_size:32},{id:3,has_loading_dock:0,max_container_size:24}];
const buy={id_commodity:47,commodity_name:'Laranite',id_terminal:1,terminal_name:'Origin',price_buy:100,price_sell:0,status_buy:4,scu_buy:60};
const sell={id_commodity:47,commodity_name:'Laranite',id_terminal:2,terminal_name:'Destination',price_buy:0,price_sell:150,status_sell:2,scu_sell:40,scu_sell_stock:9000};

test('sell-only records survive any upstream row order and profit uses demand rather than inventory',()=>{
 const forward=findTradeOpportunities([buy,sell],terminals,696);
 const reversed=findTradeOpportunities([sell,buy],terminals,696);
 assert.deepEqual(forward,reversed);
 assert.equal(forward[0].scu,40);
 assert.equal(forward[0].profit,2000);
 assert.equal(forward[0].profitPerScu,50);
});
test('chooses total achievable profit over the largest headline spread',()=>{
 const costlyDestination={...sell,id_terminal:3,price_sell:1000,scu_sell:1};
 const result=findTradeOpportunities([costlyDestination,sell,buy],terminals,696)[0];
 assert.equal(result.sell.id_terminal,2);
 assert.equal(result.profit,2000);
});
test('supply, budget and cargo capacity each constrain a trade, without rounding over the budget',()=>{
 assert.equal(findTradeOpportunities([buy,sell],terminals,20)[0].scu,20);
 assert.equal(findTradeOpportunities([{...buy,scu_buy:5},sell],terminals,20)[0].scu,5);
 const t=findTradeOpportunities([buy,sell],terminals,20,1234.56)[0];
 assert.equal(t.scu,12.345);assert.ok(t.investment<=1234.56);
 assert.deepEqual(findTradeOpportunities([buy,sell],terminals,20,0),[]);
});
test('zero demand, no-demand status, same-terminal spread and concept ships are excluded',()=>{
 for(const blocked of [{...sell,scu_sell:0},{...sell,status_sell:7},{...sell,id_terminal:1}]) assert.deepEqual(findTradeOpportunities([buy,blocked],terminals,696),[]);
 assert.deepEqual(findTradeOpportunities([buy,sell],[],696,undefined,{is_concept:1}),[]);
 assert.deepEqual(findTradeOpportunities([buy,sell],terminals,0),[]);
});
test('ship dock/container restrictions are checked at both ends; missing quantities remain assumptions',()=>{
 const ship={is_loading_dock:1,container_sizes:'32'};
 assert.deepEqual(findTradeOpportunities([buy,{...sell,id_terminal:3}],terminals,696,undefined,ship),[]);
 assert.deepEqual(findTradeOpportunities([{...buy,id_terminal:3},sell],terminals,696,undefined,ship),[]);
 const result=findTradeOpportunities([{...buy,scu_buy:undefined},{...sell,scu_sell:undefined}],[],20)[0];
 assert.equal(result.scu,20);assert.deepEqual(result.assumptions,['Supply not reported','Demand not reported','Terminal compatibility unknown']);
});
test('a requested origin never returns a different pickup terminal',()=>{
 const other={...buy,id_terminal:3,price_buy:10};
 const result=findTradeOpportunities([buy,other,sell],terminals,20,undefined,undefined,1)[0];
 assert.equal(result.buy.id_terminal,1);
});
test('crew handles API CSV ranges and unknown values without string comparisons or fake zero',()=>{
 assert.deepEqual(parseCrew('1,8'),{min:1,max:8});
 assert.equal(formatCrew('1,2'),'1–2');assert.equal(formatCrew('2'),'2');
 assert.equal(formatCrew(null),'Unknown');assert.equal(formatCrew('1,many'),'Unknown');
 assert.deepEqual(compareCrew('2,4','10,12'),['**2–4**','10–12']);
 assert.deepEqual(compareCrew('1,2',null),['1–2','Unknown']);
 assert.deepEqual(compareCrew('1,8','1,2'),['1–8','1–2']);
});
test('cargo warnings and ship logistics use explicit API flags without inventing durations',()=>{
 assert.equal(cargoHandlingNotes({}).length,0);
 assert.match(cargoHandlingNotes({is_volatile_time:1})[0],/no safe duration/);
 assert.match(cargoHandlingNotes({is_volatile_qt:1})[0],/quantum/);
 assert.match(shipLogistics({is_concept:1})[0],/excluded/);
 assert.match(shipLogistics({container_sizes:'16,32'})[0],/16, 32 SCU/);
});

test('raw detailed prices cannot bypass known unavailable terminal flags',()=>{
 for (const flag of ['is_available','is_available_live','is_visible']) {
  const restricted=terminals.map(t=>t.id===2?{...t,[flag]:0}:t);
  assert.deepEqual(findTradeOpportunities([buy,sell],restricted,20),[]);
 }
});
