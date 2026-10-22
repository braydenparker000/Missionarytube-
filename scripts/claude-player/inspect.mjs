#!/usr/bin/env node
// Development aid: resolves reference styles/theme attributes with the player's
// own resource engine for a given skin and screen size.
// Usage: node scripts/claude-player/inspect.mjs <model.json[.gz]> [--skin 1] [--w 412 --h 915 --dpr 2.625] attr|style|dimen <names...>
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Resources} from '../../frontend/claude-player/src/res/resources.js';
import {makeConfig} from '../../frontend/claude-player/src/res/qualifiers.js';
import {parseSkins, composeTheme} from '../../frontend/claude-player/src/skin.js';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const skinIndex = +opt('skin', 1), w = +opt('w', 412), h = +opt('h', 915), dpr = +opt('dpr', 2.625);
const prefsJson = opt('prefs', '{}');
const [modelPath, kind, ...names] = args;
const buf = readFileSync(modelPath);
const model = JSON.parse((modelPath.endsWith('.gz') ? gunzipSync(buf) : buf).toString());
const res = new Resources(model, makeConfig({widthDp: w, heightDp: h, density: dpr}), {density: dpr, scaledDensity: dpr, xdpi: 160 * dpr});
const skins = parseSkins(res);
const {theme, applied} = composeTheme(res, skins[skinIndex], JSON.parse(prefsJson));
if (kind === 'skins') {
  console.log(JSON.stringify(skins.map(s => ({name: s.name, style: s.style, options: s.options.map(o => ({key: o.key, kind: o.kind, choices: o.choices.map(c => c.name)}))})), null, 1));
  process.exit(0);
}
console.log('# applied:', applied.join(' > '));
for (const n of names) {
  if (kind === 'attr') {
    const raw = theme.get(n);
    const style = theme.styleName('?' + n);
    console.log(`\n## ?${n} = ${raw}${style ? ' -> ' + style : ''}`);
    if (style) for (const [k, v] of res.style(style)) console.log(`  ${k} = ${v}${v && /^[@?]/.test(v) ? '  =>  ' + JSON.stringify(res.resolveRaw(v, theme).value) : ''}`);
  } else if (kind === 'style') {
    console.log(`\n## @style/${n}`);
    for (const [k, v] of res.style(n)) console.log(`  ${k} = ${v}${v && /^[@?]/.test(v) ? '  =>  ' + JSON.stringify(res.resolveRaw(v, theme).value) : ''}`);
  } else if (kind === 'dimen') {
    const v = res.entry('dimen', n);
    console.log(`${n} = ${v} -> ${res.dimensionPixelSize('@dimen/' + n, theme)}px (${(res.dimensionPixelSize('@dimen/' + n, theme) / dpr).toFixed(2)}dp)`);
  }
}
