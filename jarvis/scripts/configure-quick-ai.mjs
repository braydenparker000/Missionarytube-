import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const directory=process.argv[2];
if(!directory)throw Error('Expected output directory.');
const path=join(directory,'assets/quick-ai-config.json');
const config=JSON.parse(await readFile(path,'utf8'));
if(config.version!==3)throw Error('Quick AI public configuration has the wrong version.');
const values={geminiKey:process.env.QUICK_AI_GEMINI_KEY,groqKey:process.env.GROQ_API_KEY,tavilyKey:process.env.QUICK_AI_TAVILY_KEY};
if(!Object.values(values).every(value=>typeof value==='string'&&value.trim()))
  throw Error('Quick AI deployment requires Gemini, Groq, and Tavily Actions secrets.');
await writeFile(path,JSON.stringify({version:3,...values})+'\n');
console.log('Quick AI public configuration prepared from deployment secrets.');
