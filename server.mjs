import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makeHandler } from './api.mjs';

export function makeServer({database=':memory:', ...options}={}) {
  const sqlite = new DatabaseSync(database);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  sqlite.exec(schema);
  const db={
    prepare(sql){
      return {bind(...args){
        const statement=sqlite.prepare(sql);
        return {
          first:()=>statement.get(...args)??null,
          all:()=>({results:statement.all(...args)}),
          run:()=>({meta:statement.run(...args)}),
        };
      }};
    },
    batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const result=statements.map(s=>s.run()); sqlite.exec('COMMIT'); return result; }
      catch(e){sqlite.exec('ROLLBACK');throw e;}
    }
  };
  const readAsset=file=>readFile(new URL('./public/'+file,import.meta.url));
  const server=createServer(makeHandler({...options,db,readAsset}));
  server.on('close',()=>sqlite.close());
  return server;
}

const schema=await readFile(new URL('./drizzle/0000_calendar.sql',import.meta.url),'utf8');

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const database=resolve(process.env.DB_PATH || 'data/tongbu.sqlite');
  await mkdir(dirname(database),{recursive:true});
  const publicOrigin=process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : '';
  const port=Number(process.env.PORT||3000), host=process.env.HOST||'127.0.0.1';
  makeServer({database, publicOrigin, secureCookies:publicOrigin.startsWith('https:'), trustProxy:process.env.TRUST_PROXY==='1'}).listen(port,host,()=>console.log(`同频 · http://${host}:${port}`));
}
