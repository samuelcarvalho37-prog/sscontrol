import {createRequire} from 'node:module'
import path from 'node:path'
import fs from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
const run=promisify(execFile)
const require=createRequire(new URL('../../backend/node-api/package.json',import.meta.url))
const {Pool}=require('pg')
const root=path.resolve(process.argv[2]??'')
const restore=process.argv.includes('--verify-restore')
const connection=new URL(process.env.VORQIX_BACKUP_URL??'')
if(!['127.0.0.1','localhost'].includes(connection.hostname)||!/^\/vorqix_hml_\d{8}_\d{6}$/.test(connection.pathname))throw Error('Somente o banco local de homologação pode ser copiado por este utilitário.')
const database=connection.pathname.slice(1)
const pg=path.join(root,'work/tools/postgresql16/pgsql/bin')
const runtime=path.join(root,'work/homologacao')
const now=new Date();const stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('')+'_'+[now.getHours(),now.getMinutes(),now.getSeconds()].map(v=>String(v).padStart(2,'0')).join('')
const suffix=randomUUID().slice(0,8),folder=path.join(runtime,'backups',`${stamp}_${suffix}`)
const environment={...process.env,PGPASSWORD:decodeURIComponent(connection.password)}
delete environment.VORQIX_BACKUP_URL
const args=['-h',connection.hostname,'-p',connection.port||'5432','-U',decodeURIComponent(connection.username)]
const pool=new Pool({connectionString:connection.href,max:1})
const countsSql=`SELECT json_build_object('users',(SELECT count(*) FROM iam.users),'orders',(SELECT count(*) FROM maintenance.work_orders),'executions',(SELECT count(*) FROM maintenance.executions),'evidence',(SELECT count(*) FROM maintenance.evidence),'occurrences',(SELECT count(*) FROM maintenance.operational_occurrences),'commercial_plans',(SELECT count(*) FROM platform.commercial_plans),'signatures',(SELECT count(*) FROM workflow.technical_signatures),'observations',(SELECT count(*) FROM maintenance.work_order_observations)) AS counts`
const command=(name,extra)=>run(path.join(pg,name+'.exe'),[...args,...extra],{env:environment,windowsHide:true,maxBuffer:4*1024*1024})
async function files(directory,prefix=''){
  const result=[]
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){const relative=path.join(prefix,entry.name);if(entry.isSymbolicLink())throw Error('Link simbólico encontrado no armazenamento; cópia interrompida para revisão.');if(entry.isDirectory())result.push(...await files(path.join(directory,entry.name),relative));else if(entry.isFile())result.push(relative)}return result
}
const hash=async file=>{const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex')}
let client
try{
  await fs.mkdir(path.dirname(folder),{recursive:true});await fs.mkdir(folder)
  client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot
  const counts=(await client.query(countsSql)).rows[0].counts
  // pg_dump and the verification counts share the same database snapshot.
  // Live writes after this point do not cause a false restoration mismatch.
  await command('pg_dump',['-d',database,'-Fc','--snapshot',snapshot,'-f',path.join(folder,'database.dump')])
  await client.query('ROLLBACK');client.release();client=undefined
  const storage=path.join(runtime,'storage');let copied=0
  try{await fs.access(storage);for(const relative of await files(storage)){const source=path.join(storage,relative),target=path.join(folder,'storage',relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);if(await hash(source)!==await hash(target))throw Error('Evidência mudou durante a cópia; repita o backup.');copied++}}catch(error){if(error.code!=='ENOENT')throw error;const exists=await fs.stat(storage).catch(()=>null);if(exists)throw error}
  const metadata={created_at:now.toISOString(),database,counts,storage_files:copied,snapshot_consistent:true}
  await fs.writeFile(path.join(folder,'metadata.json'),JSON.stringify(metadata,null,2))
  const manifest=[];for(const relative of await files(folder))manifest.push({path:relative,sha256:await hash(path.join(folder,relative))})
  await fs.writeFile(path.join(folder,'sha256.json'),JSON.stringify(manifest,null,2))
  let restored=null
  if(restore){
    restored=`vorqix_hml_restore_${stamp}_${suffix}`
    await command('createdb',['--encoding=UTF8',restored])
    await command('pg_restore',['-d',restored,'--exit-on-error',path.join(folder,'database.dump')])
    const restoreConnection=new URL(connection);restoreConnection.pathname='/'+restored
    const restoredPool=new Pool({connectionString:restoreConnection.href,max:1})
    try{const actual=(await restoredPool.query(countsSql)).rows[0].counts;if(JSON.stringify(actual)!==JSON.stringify(counts))throw Error('A restauração não corresponde ao snapshot do backup.')}finally{await restoredPool.end()}
    for(const entry of manifest){if(await hash(path.join(folder,entry.path))!==entry.sha256)throw Error('Arquivo de backup divergente após restauração.')}
  }
  const complete={...metadata,checksums_verified:true,restore_verified:restore,restored_database:restored,completed_at:new Date().toISOString()}
  await fs.writeFile(path.join(folder,'complete.json'),JSON.stringify(complete,null,2))
  console.log(JSON.stringify({ok:true,folder,restore_verified:restore,counts,storage_files:copied}))
}catch(error){console.error('Backup não concluído. A origem foi preservada. '+String(error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[conexão protegida]'));process.exitCode=1}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release()}await pool.end()}
