import {readFileSync} from 'node:fs';
import {checkServerIdentity} from 'node:tls';
import pg from 'pg';

const caFile=process.env.PG_TLS_CA_FILE;
const servername=process.env.PG_TLS_SERVER_NAME;
const pin=process.env.PG_TLS_CERT_SHA256?.replaceAll(':','').toLowerCase();
if(!caFile || !servername) throw new Error('Configure PostgreSQL CA and certificate server name');
if(pin && !/^[a-f0-9]{64}$/.test(pin)) throw new Error('Invalid PostgreSQL certificate pin');
for(const key of ['DATABASE_URL','PREFLIGHT_DATABASE_URL','MIGRATION_DATABASE_URL']) {
  if(!process.env[key])continue;
  const url=new URL(process.env[key]);
  if([...url.searchParams.keys()].some(name=>name.startsWith('ssl')))
    throw new Error('Remove SSL URL parameters: use the verified deployment TLS configuration');
}
pg.defaults.ssl={ca:readFileSync(caFile,'utf8'),servername,rejectUnauthorized:true,
  checkServerIdentity:(host,cert)=>{
    if(!pin)return checkServerIdentity(servername,cert);
    if(cert.fingerprint256?.replaceAll(':','').toLowerCase()!==pin)
      return new Error('PostgreSQL server certificate pin mismatch');
  }};
