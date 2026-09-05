import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const output = new URL("../dist/", import.meta.url);
const rootFiles = new Set(["favicon.ico", "manifest.webmanifest", "robots.txt", "sitemap.xml"]);
const assetDirectories = ["assets"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (extname(entry.name) !== ".html" && !rootFiles.has(entry.name)) continue;
  await cp(new URL(entry.name, root), new URL(entry.name, output));
}

for (const directory of assetDirectories) {
  try {
    await cp(new URL(`${directory}/`, root), new URL(`${directory}/`, output), {
      recursive: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

// The interaction layer is compiled locally from exact npm pins. The browser
// never reaches a mutable CDN, and the rest of Astra stays framework-free.
await build({
  entryPoints: [new URL("../src/astra-motion.js", import.meta.url).pathname],
  outfile: new URL("../dist/assets/js/astra-motion.js", import.meta.url).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome120"],
  legalComments: "inline",
  banner: { js: "/*! Astra Motion · GSAP 3.15.0 · https://gsap.com/licensing/ */" }
});

// Load the container/audio compatibility stack only when playback needs it.
await build({
  entryPoints: [new URL("../src/compatibility-player.js", import.meta.url).pathname],
  outfile: new URL("../dist/assets/js/playback/compatibility.js", import.meta.url).pathname,
  bundle: true, minify: true, format: "iife", target: ["chrome120"], legalComments: "inline",
  banner: {js: "/*! Mediabunny + AC3/DTS 1.55.7 · MPL-2.0 · See assets/licenses/mediabunny.txt */"}
});

// The release meta value is Astra's single version source. Source files keep a
// readable placeholder; the production build gives every local asset the same
// cache key and refuses to ship an unresolved or malformed release.
const htmlPath = new URL("../dist/index.html", import.meta.url);
const sourceHtml = await readFile(htmlPath, "utf8");
const release = sourceHtml.match(/<meta name="astra-release" content="([^"]+)">/)?.[1];
if (!release || !/^\d+\.\d+\.\d+$/.test(release)) {
  throw new Error("Build failed: astra-release must be a semantic version.");
}
const builtHtml = sourceHtml.replaceAll("__ASTRA_VERSION__", release);
if (builtHtml.includes("__ASTRA_VERSION__")) {
  throw new Error("Build failed: an Astra release placeholder was not resolved.");
}
await writeFile(htmlPath, builtHtml);

const builtFiles = await readdir(output);
if (!builtFiles.includes("index.html")) {
  throw new Error("Build failed: dist/index.html was not created.");
}

console.log(`Built ${join("dist")} with ${builtFiles.length} top-level entr${builtFiles.length === 1 ? "y" : "ies"}.`);

// Small generated fixtures make device playback checks reproducible.
const checksDir=new URL('../dist/assets/playback-check/',import.meta.url);
await mkdir(checksDir,{recursive:true});
for(const name of ['avc-aac','avc-ac3','avc-eac3','avc-dts','vp8-vorbis']) {
  const encoded=await readFile(new URL(`../tests/fixtures/media/${name}.mkv.base64`,import.meta.url),'utf8');
  await writeFile(new URL(`${name}.mkv`,checksDir),Buffer.from(encoded,'base64'));
}
await writeFile(new URL('avc-ac3.mp4',checksDir),Buffer.from(await readFile(new URL('../tests/fixtures/media/avc-ac3.mp4.base64',import.meta.url),'utf8'),'base64'));
// A tiny diagnostic add-on exercises the same picker and Player V3 as real
// providers. It is never installed automatically and contains generated clips.
const checkAddon=new URL('addon/',checksDir);
await mkdir(checkAddon,{recursive:true});
await writeFile(new URL('manifest.json',checkAddon),JSON.stringify({id:'org.astra.playback-check',version:'1.0.0',name:'Astra Playback Checks',description:'Generated four-second clips for browser compatibility checks.',types:['video'],resources:['catalog','meta','stream'],idPrefixes:['astra-check-'],catalogs:[{type:'video',id:'checks',name:'Playback Checks'}]}));
const checkItems=[];
for(const codec of ['aac','ac3','eac3','dts']) {
  const id='astra-check-'+codec,meta={id,type:'video',name:'Playback '+codec.toUpperCase(),description:'Generated test pattern and audio tone. Four seconds.'};checkItems.push(meta);
  for(const resource of ['meta','stream']) {
    const dir=new URL(`${resource}/video/`,checkAddon);await mkdir(dir,{recursive:true});
    await writeFile(new URL(id+'.json',dir),JSON.stringify(resource==='meta'?{meta}:{streams:[{name:'MKV '+codec.toUpperCase(),title:'Generated AVC + '+codec.toUpperCase(),url:'https://missionarytube.z13.web.core.windows.net/assets/playback-check/avc-'+codec+'.mkv',behaviorHints:{filename:codec+'.mkv'}}]}));
  }
}
// An intentionally missing first-party file exercises real browser failure
// recovery. The second source proves Choose source can recover successfully.
const recoveryId='astra-check-recovery',recoveryMeta={id:recoveryId,type:'video',name:'Playback recovery',description:'The first source intentionally fails. Retry, close, or choose the working test clip.'};
checkItems.push(recoveryMeta);
await writeFile(new URL(`meta/video/${recoveryId}.json`,checkAddon),JSON.stringify({meta:recoveryMeta}));
await writeFile(new URL(`stream/video/${recoveryId}.json`,checkAddon),JSON.stringify({streams:[
  {name:'Failure check',title:'Unavailable test source',url:'https://missionarytube.z13.web.core.windows.net/assets/playback-check/unavailable.mkv'},
  {name:'Working check',title:'Working AAC test clip',url:'https://missionarytube.z13.web.core.windows.net/assets/playback-check/avc-aac.mkv'}
]}));
const checkCatalog=new URL('catalog/video/',checkAddon);await mkdir(checkCatalog,{recursive:true});
// Deliberately omit audio codec hints so this starts natively; the viewer can
// exercise manual repair of real AC3 audio inside an MP4, matching field reports.
const manualId='astra-check-manual-audio',manualMeta={id:manualId,type:'video',name:'Manual audio repair',description:'Generated MP4 with AC3 audio. Rewind, then use Options → Fix picture or sound.'};
checkItems.push(manualMeta);
await writeFile(new URL(`meta/video/${manualId}.json`,checkAddon),JSON.stringify({meta:manualMeta}));
await writeFile(new URL(`stream/video/${manualId}.json`,checkAddon),JSON.stringify({streams:[{name:'Manual repair check',title:'Generated MP4 test clip',url:'https://missionarytube.z13.web.core.windows.net/assets/playback-check/avc-ac3.mp4',behaviorHints:{filename:'repair-check.mp4'}}]}));
for(const check of [
  {id:'astra-check-webm',name:'Playback WebM',file:'vp8-vorbis',title:'Generated VP8 + Vorbis',headers:true,description:'Forty-second generated clip. Tests WebM repair and seeking.'},
  {id:'astra-check-headers',name:'Playback request headers',file:'avc-aac',title:'Generated AVC + AAC with request headers',headers:true,description:'Generated clip fetched with a harmless test request header.'}
]){
  const meta={id:check.id,type:'video',name:check.name,description:check.description};checkItems.push(meta);
  await writeFile(new URL(`meta/video/${check.id}.json`,checkAddon),JSON.stringify({meta}));
  await writeFile(new URL(`stream/video/${check.id}.json`,checkAddon),JSON.stringify({streams:[{name:check.name,title:check.title,url:`https://missionarytube.z13.web.core.windows.net/assets/playback-check/${check.file}.mkv`,behaviorHints:{filename:check.file+'.mkv',proxyHeaders:check.headers?{request:{'X-Astra-Playback-Check':'enabled'}}:undefined}}]}));
}
await writeFile(new URL('checks.json',checkCatalog),JSON.stringify({metas:checkItems}));
