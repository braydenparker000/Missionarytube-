import {DatabaseSync} from 'node:sqlite';
import worker, {Hub} from '../backend/worker.js';
import {COMMENTS_URL} from '../backend/publications.js';

// Real SQLite + worker/Hub routing, with only the Durable Object host emulated.
export function createRelayFixture({env: overrides = {}, publicationFetcher = async (input,init={}) => {
  const url=new URL(typeof input==='string'||input instanceof URL ? input : input.url);
  if(url.origin+url.pathname!==COMMENTS_URL||(init.method||'GET')!=='GET')throw Error('Unexpected fictional publication request');
  return Response.json([]);
}} = {}) {
  const objects = new Map();
  const env = {
    RELAY_MCP_ENABLED: 'true',
    RELAY_MCP_ORIGIN: 'https://relay.example.test',
    RELAY_GITHUB_CLIENT_ID: 'fixture-github-client',
    RELAY_GITHUB_CLIENT_SECRET: 'fixture-github-secret',
    ...overrides,
  };
  function object(name) {
    if (objects.has(name)) return objects.get(name);
    const db = new DatabaseSync(':memory:'), values = new Map(), alarms = [];
    let transaction = 0, alarm = null;
    const storage = {
      // Cloudflare SQL binds ArrayBuffer BLOBs; node:sqlite binds typed arrays.
      sql: {exec(query, ...parameters) { return db.prepare(query).all(...parameters.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)); }},
      transactionSync(fn) {
        const savepoint = `fixture_${++transaction}`;
        db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const result = fn();
          if (result?.then) throw new Error('transactionSync must not await');
          db.exec(`RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          throw error;
        }
      },
      async get(key) { return structuredClone(values.get(key)); },
      async put(key, value) { values.set(key, structuredClone(value)); },
      async delete(key) { return values.delete(key); },
      async transaction(fn) { return fn(storage); },
      async setAlarm(value) { alarm = Number(value); alarms.push(alarm); },
      async getAlarm() { return alarm; },
      async deleteAlarm() { alarm = null; },
    };
    const ctx = {storage, blockConcurrencyWhile: fn => fn(), waitUntil() {}};
    const result = {ctx, hub: new Hub(ctx, env, {publicationFetcher}), db, values, alarms};
    objects.set(name, result);
    return result;
  }
  env.HUBS = {idFromName: name => name, get: name => object(name).hub};
  return {
    env, objects, object,
    request: (path, init) => worker.fetch(new Request(new URL(path, env.RELAY_MCP_ORIGIN), init), env),
    close() { for (const {db} of objects.values()) db.close(); },
  };
}
