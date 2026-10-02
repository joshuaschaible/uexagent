import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const source = await readFile(new URL('../src/lib/progression-display.ts', import.meta.url), 'utf8');
const {progressionOptions} = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const row=(path,name,instruction='No prerequisite missions listed')=>[path,name,'Not reported',instruction,'4.10.1'];
test('a single prerequisite chain displays earliest mission first',()=>{
 const rows=[row('Option 1 / group 1','Prerequisite group','Required count: 1; completion tags: Intro'),row('Option 1 / group 1 / choice 1 / group 1','Prerequisite group','Required count: 1'),row('Option 1 / group 1 / choice 1 / group 1 / choice 1','Start'),row('Option 1 / group 1 / choice 1','Middle'),row('Option 1','Reward')];
 const [option]=progressionOptions(rows);
 assert.equal(option.linear,true);
 assert.deepEqual(option.steps.map(s=>s.name),['Start','Middle','Reward']);
 assert.deepEqual(option.rows,rows);
});
test('alternatives, variants, and separate groups never become a sequential checklist',()=>{
 const rows=[row('Option 1 / group 1','Prerequisite group','Required count: 1'),row('Option 1 / group 1 / choice 1','Choice A'),row('Option 1 / group 1 / choice 1 variant 2','Variant A'),row('Option 1 / group 1 / choice 2','Choice B'),row('Option 1','Reward'),row('Option 2','Other reward')];
 const options=progressionOptions(rows);
 assert.equal(options.length,2);
 assert.equal(options[0].linear,false);
 assert.equal(options[0].root.groups[0].choices.length,3);
 assert.equal(options[1].root.name,'Other reward');
 const [multipleGroups]=progressionOptions([...rows.slice(0,4),row('Option 1 / group 2','Prerequisite group','Required count: 1'),row('Option 1 / group 2 / choice 1','Other condition'),rows[4]]);
 assert.equal(multipleGroups.linear,false);
});
test('missing links and truncated paths preserve their limitation details',()=>{
 const missing=row('Option 1 / group 1 / choice 1','Missing','Mission link missing; progression stops here.');
 const rows=[row('Option 1 / group 1','Prerequisite group','Required count: 1'),missing];
 const [partial]=progressionOptions(rows);
 assert.equal(partial.root,undefined);
 assert.equal(partial.linear,false);
 assert.deepEqual(partial.rows,rows);
 const [resolvedRoot]=progressionOptions([...rows,row('Option 1','Reward')]);
 assert.equal(resolvedRoot.steps[0].instruction,missing[3]);
});
