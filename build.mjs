import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { assets } from './api.mjs';

const output=new URL('./dist/server/',import.meta.url);
await mkdir(output,{recursive:true});
const entries=await Promise.all([...assets.values()].map(async ([file])=>[file,await readFile(new URL('./public/'+file,import.meta.url),'utf8')]));
await writeFile(new URL('assets.mjs',output),'export const embedded = '+JSON.stringify(Object.fromEntries(entries))+';\n');
await copyFile(new URL('./api.mjs',import.meta.url),new URL('api.mjs',output));
await copyFile(new URL('./worker.mjs',import.meta.url),new URL('index.js',output));
