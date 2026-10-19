import {renderReport} from '../frontend/daily-board/v1/render.js';
const fixture=new URLSearchParams(location.search).get('fixture')==='two'?'two':'one';
try {const response=await fetch(`fixtures/${fixture}.json`);if(!response.ok)throw Error();renderReport(await response.json(),document.querySelector('#report'));}
catch {document.querySelector('#report').textContent='The review fixture could not be loaded.';}
