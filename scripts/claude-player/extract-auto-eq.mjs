#!/usr/bin/env node
// Converts the reference APK's AutoEq preset database (assets/auto_eq.db,
// extracted into scratch space) into the player's compact AutoEq data file:
//   node scripts/claude-player/extract-auto-eq.mjs <auto_eq.db> [out.json.gz]
//
// The database (ha / na: the AutoEqDbImporter) has one row per preset:
// name, meta (the measurement source, "Crinacle 711 in-ear"), parametric
// and data_blob. A blob is a 36-byte header ("PaP" 1, record count + 2,
// parametric flag, constant fields) and then records:
// - graphic: 12 bytes each (u32 band kind, f32 gain dB, u32 Hz), 32 bands at
//   frequencies every graphic preset shares;
// - parametric: 20 bytes each (u32 kind: low byte the filter type, 3 peak,
//   4 low shelf, 5 high shelf; f32 gain dB, u32 Hz, f32 Q, u32 ARGB colour,
//   0 = none).
// The output keeps the presets in the importer's order (name, parametric,
// meta) as {v, freqs, metas, colors, presets: [[name, meta index, graphic
// gains (centi-dB) or 0, parametric bands (type, Hz, centi-dB, milli-Q,
// colour index per band) or 0]]}, a name and source in one entry.
// The presets are the AutoEq project's (MIT licence), as the reference ships them.
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

/** The data file's object from a database file; bad rows are counted, not kept. */
export function convertAutoEqDb(dbPath) {
  const db = new DatabaseSync(dbPath, {readOnly: true});
  const rows = db.prepare('SELECT name, meta, parametric, data_blob FROM eq_presets ORDER BY name, parametric, meta').all();
  db.close();
  return convertRows(rows);
}

export function convertRows(rows) {
  const metas = [], metaIndex = new Map(), colors = [0], colorIndex = new Map([[0, 0]]);
  const entries = new Map();
  let freqs = null, bad = 0;
  const indexOf = (list, map, v) => map.get(v) ?? (map.set(v, list.length), list.push(v), list.length - 1);

  for (const r of rows) {
    const blob = Buffer.from(r.data_blob ?? []);
    const name = String(r.name ?? '').trim(), meta = String(r.meta ?? '').trim();
    const parametric = !!r.parametric;
    if (!name || !meta || blob.length < 36 || blob.toString('latin1', 0, 4) !== 'PaP\x01' || !!blob.readUInt16LE(6) !== parametric) { bad++; continue; }
    const size = parametric ? 20 : 12;
    if ((blob.length - 36) % size) { bad++; continue; }
    const key = name + '\n' + meta;
    const e = entries.get(key) ?? [name, indexOf(metas, metaIndex, meta), 0, 0];
    entries.set(key, e);
    if (parametric) {
      const bands = [];
      for (let o = 36; o < blob.length; o += 20) {
        bands.push(blob.readUInt32LE(o) & 0xff, blob.readInt32LE(o + 8), Math.round(blob.readFloatLE(o + 4) * 100),
          Math.round(blob.readFloatLE(o + 12) * 1000), indexOf(colors, colorIndex, blob.readUInt32LE(o + 16)));
      }
      e[3] = bands;
    } else {
      const hz = [], gains = [];
      for (let o = 36; o < blob.length; o += 12) {
        hz.push(blob.readInt32LE(o + 8));
        gains.push(Math.round(blob.readFloatLE(o + 4) * 100));
      }
      freqs ??= hz;
      if (hz.join() !== freqs.join()) { bad++; continue; }
      e[2] = gains;
    }
  }

  return {data: {v: 1, freqs, metas, colors, presets: [...entries.values()]}, bad};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dbPath, out = 'frontend/claude-player/model/auto-eq.json.gz'] = process.argv.slice(2);
  if (!dbPath) {
    console.error('usage: extract-auto-eq.mjs <auto_eq.db> [out.json.gz]');
    process.exit(2);
  }
  const {data, bad} = convertAutoEqDb(dbPath);
  writeFileSync(out, gzipSync(JSON.stringify(data), {level: 9}));
  const n = data.presets.reduce((k, p) => k + !!p[2] + !!p[3], 0);
  console.log(`${n} presets (${data.presets.length} names and sources, ${data.metas.length} sources), ${bad} skipped -> ${out}`);
}
