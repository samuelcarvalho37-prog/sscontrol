import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {gzipSync} from 'node:zlib'
const dist=fileURLToPath(new URL('../dist/',import.meta.url))
const manifest=JSON.parse(await fs.readFile(path.join(dist,'.vite/manifest.json'),'utf8'))
const entry=Object.values(manifest).find(item=>item.isEntry)
if(!entry)throw Error('Entrada ausente do manifesto de produção.')
const visited=new Set(),assets=[]
async function visit(item){if(visited.has(item.file))return;visited.add(item.file);const bytes=await fs.readFile(path.join(dist,item.file));assets.push({file:item.file,bytes:bytes.length,gzip:gzipSync(bytes).length});for(const imported of item.imports??[])await visit(manifest[imported])}
await visit(entry)
const bytes=assets.reduce((sum,item)=>sum+item.bytes,0),gzip=assets.reduce((sum,item)=>sum+item.gzip,0)
const result={entry:entry.file,initial_javascript_bytes:bytes,initial_javascript_gzip:gzip,static_assets:assets,limits:{bytes:600000,gzip:180000},passed:bytes<=600000&&gzip<=180000}
console.log(JSON.stringify(result,null,2))
if(!result.passed)process.exitCode=1
