import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,rmSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Official Google Chrome-for-Testing build matching the previously qualified
// Chrome 154 semantics. The complete archive is verified before extraction or
// execution; an untrusted dependency cache is only a download hint.
export const BROWSER_VERSION='154.0.8037.97';
export const BROWSER_ARCHIVE_SHA256='487c3b0e89f786d9257a6265a29bacf18b893e90f29c0ef6f7be9706ecc8c7a2';
export const BROWSER_IDENTITY='Google Chrome for Testing '+BROWSER_VERSION;
const url='https://storage.googleapis.com/chrome-for-testing-public/'+BROWSER_VERSION+'/linux64/chrome-linux64.zip';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifiedBrowserArchive(bytes){if(hash(bytes)!==BROWSER_ARCHIVE_SHA256)throw Error('Official browser archive integrity mismatch');return true;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=resolve(process.env.RUNNER_TEMP||'.browser-check','jarvis-qualification-browser');
  mkdirSync(root,{recursive:true});const archive=join(root,'chrome.zip'),destination=join(root,'installed');
  let valid=false;if(existsSync(archive)){try{verifiedBrowserArchive(readFileSync(archive));valid=true;}catch{rmSync(archive);}}
  if(!valid)execFileSync('curl',['--fail','--silent','--show-error','--retry','2','--max-time','180',url,'--output',archive],{stdio:'inherit'});
  verifiedBrowserArchive(readFileSync(archive));
  rmSync(destination,{recursive:true,force:true});mkdirSync(destination,{recursive:true});
  execFileSync('unzip',['-q',archive,'-d',destination]);
  const binary=join(destination,'chrome-linux64','chrome');
  if(execFileSync(binary,['--version'],{encoding:'utf8'}).trim()!==BROWSER_IDENTITY)throw Error('Installed browser does not match the qualified version');
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,'JARVIS_CHROME='+binary+'\n');
  console.log(BROWSER_IDENTITY+' selected from verified official archive '+BROWSER_ARCHIVE_SHA256);
}
