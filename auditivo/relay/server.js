'use strict';
// EMDR command-only WebSocket relay. No audio and no patient/clinical data transmitted.
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT || 8787);
const ALLOWED = new Set((process.env.ALLOWED_ORIGINS || 'https://armandmu.github.io').split(',').map(s=>s.trim()).filter(Boolean));
const rooms = new Map();
const sockets = new WeakMap();
const MAX_MESSAGE = 2048;
const VALID_ROOM = /^[A-HJ-NP-Z2-9]{8}$/;
const srv = http.createServer((req,res)=>{
  if (req.url === '/health') {
    res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ok:true,service:'emdr-command-relay'}));return;
  }
  res.writeHead(404);res.end('Not found');
});
const wss = new WebSocketServer({server:srv,maxPayload:MAX_MESSAGE});
function write(ws,obj){if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));}
function closeSession(ws){
  const st=sockets.get(ws);
  if(!st)return;
  sockets.delete(ws);
  const room=rooms.get(st.code);
  if(!room)return;
  if(room[st.role]===ws)room[st.role]=null;
  const other=room[st.role==='therapist'?'patient':'therapist'];
  write(other,{type:'peer-left'});
  if(!room.therapist && !room.patient) rooms.delete(st.code);
}
wss.on('connection',(ws,req)=>{
  const origin=req.headers.origin;
  if(!origin || !ALLOWED.has(origin)){ws.close(1008,'Origin not permitted');return;}
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true});
  ws.on('message',raw=>{
    let msg;
    try{msg=JSON.parse(raw.toString());}catch{return write(ws,{type:'error',error:'invalid-json'})}
    if(!msg || typeof msg!=='object')return;
    if(msg.type==='register'){
      if(sockets.has(ws))return write(ws,{type:'error',error:'already-registered'});
      const role=msg.role,code=msg.code;
      if(!['therapist','patient'].includes(role)||typeof code!=='string'||!VALID_ROOM.test(code))return write(ws,{type:'error',error:'invalid-session'});
      let room=rooms.get(code);
      if(role==='patient' && (!room||!room.therapist))return write(ws,{type:'error',error:'peer-unavailable'});
      if(!room){room={therapist:null,patient:null};rooms.set(code,room);}
      if(room[role])return write(ws,{type:'error',error:'role-occupied'});
      room[role]=ws;sockets.set(ws,{role,code});
      write(ws,{type:'ready',role});
      if(role==='patient'&&room.therapist)write(room.therapist,{type:'patient-joined'});
    }else if(msg.type==='data'){
      const state=sockets.get(ws);if(!state)return;
      const room=rooms.get(state.code);if(!room)return;
      const to=room[state.role==='therapist'?'patient':'therapist'];
      // Therapist can send commands; patient can send only readiness acknowledgements.
      if(state.role==='therapist'){
        const payload=msg.payload;
        if(!payload||payload.type!=='state'||typeof payload.running!=='boolean'||!['fast','slow'].includes(payload.mode)||typeof payload.elapsed!=='number'||!Number.isFinite(payload.elapsed)||payload.elapsed<0||payload.elapsed>3600000)return;
        write(to,{type:'data',payload:{type:'state',running:payload.running,completed:!!payload.completed,mode:payload.mode,elapsed:payload.elapsed,duration:3600000}});
      }else if(msg.payload && msg.payload.type==='audio-ready'){
        write(to,{type:'data',payload:{type:'audio-ready'}});
      }
    }
  });
  ws.on('close',()=>closeSession(ws));
  ws.on('error',()=>closeSession(ws));
});
const pulse=setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive){ws.terminate();return;}ws.isAlive=false;ws.ping();});},30000);
srv.on('close',()=>clearInterval(pulse));
srv.listen(PORT,'0.0.0.0',()=>process.stdout.write('EMDR relay listening on '+PORT+'\n'));
