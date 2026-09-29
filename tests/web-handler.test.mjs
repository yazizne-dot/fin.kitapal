import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebHandler} from '../server/http/web-handler.mjs';

test('Web adapter preserves query, method, headers, streamed body and cookie',async()=>{
 const handle=createWebHandler(async(req,res)=>{
  assert.equal(req.url,'/api/finance/entries?mode=test');assert.equal(req.method,'PATCH');
  assert.equal(req.headers.cookie,'session=secret');assert.equal(req.headers.origin,'http://localhost');
  let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),{amount_cents:125050});
  res.setHeader('Set-Cookie','session=new; HttpOnly; SameSite=Strict; Path=/');
  res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true}));
 });
 const response=await handle(new Request('http://localhost/api/finance/entries?mode=test',{method:'PATCH',headers:{cookie:'session=secret',origin:'http://localhost'},body:JSON.stringify({amount_cents:125050})}));
 assert.equal(response.status,201);assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(await response.json(),{ok:true});
});
test('Web adapter preserves binary exports and strips the body for HEAD',async()=>{
 const handle=createWebHandler(async(req,res)=>{res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});res.end(Buffer.from([0x50,0x4b,0,255]));});
 assert.deepEqual([...new Uint8Array(await (await handle(new Request('http://localhost/api/export'))).arrayBuffer())],[80,75,0,255]);
 assert.equal(await (await handle(new Request('http://localhost/api/export',{method:'HEAD'}))).text(),'');
});
test('Web adapter provides host for same-origin checks and does not trust forwarded client IP',async()=>{
 const handle=createWebHandler(async(req,res)=>{assert.equal(req.headers.host,'localhost:3000');assert.equal(req.socket.remoteAddress,'local');res.writeHead(204);res.end();});
 assert.equal((await handle(new Request('http://localhost:3000/api/logout',{headers:{'x-forwarded-for':'attacker-controlled'}}))).status,204);
});
