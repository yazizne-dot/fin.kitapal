// Test harness. The application is served by Next.js (npm run dev / npm start).
import http from 'node:http';
import {createPortalHandler} from '../../server/http/portal.mjs';
const portal=createPortalHandler();
const server=http.createServer(portal.handle);
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Qarzhy API test harness: '+(process.env.PORT||3000)));
