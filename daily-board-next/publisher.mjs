import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateReport,canonical,legacyBody} from './schema.js';
export function prepare(report,{reviewedPublic=false}={}) {
  validateReport(report);
  if(!reviewedPublic)throw Error('Explicit public-content review required');
  if(report.synthetic)throw Error('Synthetic fixtures cannot be published');
  const publication = {schema:'jarvis-publication-v1',type:'briefing',id:report.id,date:report.date,title:report.title,body:legacyBody(report),report,reviewedPublic:true};
  if(JSON.stringify(publication).length>30000)throw Error('Publication envelope exceeds importer limit');
  return publication;
}
export function verifyReadback(expected,actual) {return canonical(validateReport(expected))===canonical(validateReport(actual));}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,output,review]=process.argv.slice(2);
  if(!input||!output||review!=='--reviewed-public')throw Error('Usage: publisher.mjs input.json output.json --reviewed-public');
  await writeFile(output,canonical(prepare(JSON.parse(await readFile(input,'utf8')),{reviewedPublic:true}))+'\n',{flag:'wx'});
  console.log('Prepared locally only. No network publication performed.');
}
