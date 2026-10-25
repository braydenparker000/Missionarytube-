import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateReport,canonical,prepare} from '../frontend/daily-board/v1/schema.js';
export {prepare};
export function verifyReadback(expected,actual) {return canonical(validateReport(expected))===canonical(validateReport(actual));}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,output,review]=process.argv.slice(2);
  if(!input||!output||review!=='--reviewed-public')throw Error('Usage: node scripts/daily-board-report.mjs input.json output.json --reviewed-public');
  await writeFile(output,canonical(prepare(JSON.parse(await readFile(input,'utf8')),{reviewedPublic:true}))+'\n',{flag:'wx'});
  console.log('Prepared locally only. No network publication performed.');
}
