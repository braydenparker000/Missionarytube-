import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedIssue,destinationBindings,DESTINATION} from './daily-board-reader-cutover.mjs';

test('destination reader adds only the exact owner-approved issue bindings',()=>{
  const prior=[{type:'plain_text',name:'PUBLIC_FLAG',text:'keep'},
    {type:'secret_text',name:'TOKEN'},
    {type:'plain_text',name:DESTINATION.issueVariable,text:'77'},
    {type:'plain_text',name:DESTINATION.enableVariable,text:'false'}];
  assert.deepEqual(destinationBindings(prior,true),[
    {type:'plain_text',name:'PUBLIC_FLAG',text:'keep'},
    {type:'plain_text',name:DESTINATION.issueVariable,text:'250'},
    {type:'plain_text',name:DESTINATION.enableVariable,text:'true'}]);
});

test('rollback removes destination variables and preserves other plain-text bindings',()=>{
  const prior=[{type:'plain_text',name:'PUBLIC_FLAG',text:'keep'},
    {type:'plain_text',name:DESTINATION.issueVariable,text:'250'},
    {type:'plain_text',name:DESTINATION.enableVariable,text:'true'}];
  assert.deepEqual(destinationBindings(prior,false),[{type:'plain_text',name:'PUBLIC_FLAG',text:'keep'}]);
});

test('only the open, owner-created dedicated issue is accepted',()=>{
  const issue={number:250,title:DESTINATION.title,state:'open',user:{id:183016859}};
  assert.equal(checkedIssue(issue),issue);
  for(const change of [{number:2},{title:'Other issue'},{state:'closed'},{user:{id:12}},{pull_request:{url:'x'}}]){
    assert.throws(()=>checkedIssue({...issue,...change}));
  }
});
