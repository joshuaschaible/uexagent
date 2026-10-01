import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const url = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const read = name => readFile(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
const clientUrl = url(await read('game-wiki-client'));
const client = await import(clientUrl);
const {buildCraftingAnswer} = await import(url((await read('crafting-answer')).replace('"./game-wiki-client"',JSON.stringify(clientUrl))));
const bpId = 'e55162ea-cd69-4ace-a519-ffd40bfb78a9';
const missionId = '0b400963-0b00-456a-bbc9-c036063cb6d8';
const patch = '4.10.1-LIVE.12660092';
const bp = {uuid:bpId,output_name:'XL-1',game_version:patch,is_available_by_default:false,craft_time_label:'21 minutes',requirement_groups:[{name:'Case',children:[{name:'Borase',quantity_scu:1.24,min_quality:1}]},{name:'Components',required_count:1,children:[{name:'Hadanite',quantity:7},{name:'Dolivine',quantity:7}]}],unlocking_missions:[{title:'Master Rank - Direct Bulk Cargo Haul',web_url:`https://api.star-citizen.wiki/missions/${missionId}`} ]};
const mission = {uuid:missionId,title:'Master Rank - Direct Bulk Cargo Haul',game_version:patch,star_systems:['Stanton'],mission_giver:'Covalex',reputation_prerequisite:{faction:'Covalex',scope:'Hauling',min_standing:{name:'Master',min_reputation:237750}},prerequisite_groups:[{required_count:1,missions:[{title:'Starter A'},{title:'Starter B'}]}],blueprints:[{drop_chance_percent:100,items:[{name:'XL-1',blueprint_link:`https://api.star-citizen.wiki/api/blueprints/${bpId}`},{name:'VK-00'}]}]};
const original = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input,options) => {
 const u = new URL(input); calls.push(u);
 assert.equal(u.origin,'https://api.star-citizen.wiki'); assert.equal(options.headers.Accept,'application/json'); assert.equal(options.redirect,'error');
 if (u.searchParams.get('filter[query]') === 'default') return new Response(JSON.stringify({data:[{...bp,uuid:missionId,output_name:'Default item'}]}));
 if (u.pathname === '/api/blueprints/'+missionId) return new Response(JSON.stringify({data:{...bp,uuid:missionId,output_name:'Default item',is_available_by_default:true}}));
 if (u.searchParams.get('filter[query]') === 'missing') return new Response(JSON.stringify({data:[],meta:{total:0}}));
 if (u.searchParams.get('filter[query]') === 'outage') return new Response('',{status:503});
 if (u.searchParams.get('filter[query]') === 'ambiguous') return new Response(JSON.stringify({data:[bp,{...bp,uuid:missionId,output_name:'XL-1 variant'}],meta:{total:100}}));
 const data = u.pathname === '/api/blueprints' ? [bp] : u.pathname.startsWith('/api/blueprints/') ? bp : u.pathname === '/api/missions' ? [mission] : mission;
 return new Response(JSON.stringify({data,meta:{total:1}}));
};
test.after(()=>globalThis.fetch=original);
const q=(intent,itemName)=>({intent,itemName,raw:itemName,modifiers:[]});
test('recipe keeps SCU, discrete item counts, quality and alternatives separate',async()=>{
 const answer=await buildCraftingAnswer(q('craft_recipe','XL-1'));
 assert.deepEqual(answer.table.rows[0],['Borase','1.24 SCU','1','Case']);
 assert.equal(answer.table.rows[1][1],'7 items');
 assert.match(answer.table.rows[1][3],/choose 1 of 2/);
 assert.match(answer.text,/4\.10\.1-LIVE/);assert.match(answer.text,/wiki:blueprints/);
});
test('unlock includes standing and prerequisite alternatives without promising pool item',async()=>{
 const answer=await buildCraftingAnswer(q('blueprint_unlock','XL-1'));
 assert.match(answer.table.rows[0][2],/Master.*237,750/);
 assert.match(answer.table.rows[0][3],/Complete 1 of: Starter A; Starter B/);
 assert.match(answer.table.rows[0][4],/100% reported pool drop chance; 2 possible blueprints; specific blueprint not guaranteed/);
 assert.match(answer.text,/alternatives, not a chain/);
 assert.ok(calls.some(u=>u.pathname.includes('/missions/')&&u.searchParams.get('version')===patch));
});
test('mission lookup lists reward pools and source patch',async()=>{
 const answer=await buildCraftingAnswer(q('mission_info',mission.title));
 assert.equal(answer.table.rows.length,2);assert.match(answer.text,/Master/);assert.match(answer.text,/Pool chance does not guarantee/);
});
test('no matches, ambiguous matches and outages cannot invent requirements',async()=>{
 assert.match((await buildCraftingAnswer(q('craft_recipe','missing'))).text,/No blueprint matches/);
 const ambiguous=await buildCraftingAnswer(q('craft_recipe','ambiguous'));assert.equal(ambiguous.table.rows.length,2);assert.match(ambiguous.text,/100 blueprints/);
 const failed=await buildCraftingAnswer(q('craft_recipe','outage'));assert.equal(failed.table,undefined);assert.match(failed.text,/Couldn't retrieve/);
});
test('provider URLs cannot turn into arbitrary outbound requests',()=>{
 assert.equal(client.wikiId('https://evil.example/missions/'+missionId,'missions'),undefined);
 assert.equal(client.wikiId('https://api.star-citizen.wiki/missions/../../items/foo','missions'),undefined);
 assert.equal(client.wikiId('https://api.star-citizen.wiki/missions/'+missionId,'missions'),missionId);
});

test('default blueprint does not require a mission or fetch mission details', async()=>{
 const before = calls.filter(u=>u.pathname.startsWith('/api/missions/')).length;
 const answer=await buildCraftingAnswer(q('blueprint_unlock','default'));
 assert.match(answer.text,/available by default/);assert.equal(answer.table,undefined);
 assert.equal(calls.filter(u=>u.pathname.startsWith('/api/missions/')).length,before);
});
