import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const APP_BEFORE='867bf8f1f92e3811ffcf3336330758adfe36b762006a93eb94454eed853bd62c';
export function dailyBoardNavigation(source){
 assert.equal(createHash('sha256').update(source).digest('hex'),APP_BEFORE,'Shared app source is not the exact retained live variant');
 const anchor="  e.preventDefault();\n  relayMenuHistory.navigate(()=>{";
 assert.equal(source.split(anchor).length,2,'Navigation hook is not unique');
 return source.replace(anchor,"  e.preventDefault();\n  if (link.dataset.route === 'board') { location.assign(paths.board); return; }\n  relayMenuHistory.navigate(()=>{");
}
