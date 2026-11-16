/* Browser-compatible Peer-like adapter for EMDR command relay.
   API intentionally parallels the tiny subset of PeerJS used by /auditivo/ and /auditivo/movil/.
   Audio stays exclusively in the browser. Server receives commands only. */
(() => {
  'use strict';
  class Events {
    constructor(){this._listeners=new Map();}
    on(type,fn){if(!this._listeners.has(type))this._listeners.set(type,[]);this._listeners.get(type).push(fn);return this;}
    emit(type,...args){for(const fn of this._listeners.get(type)||[]){try{fn(...args);}catch(e){console.error('EMDR transport listener',e);}}}
  }
  class RelayConnection extends Events{
    constructor(owner){super();this.owner=owner;this.open=false;}
    send(data){if(!this.open)return;this.owner._send({type:'data',payload:data});}
    close(){if(this.owner&&this.owner._ws)this.owner._ws.close(1000,'Client closed');this.open=false;this.emit('close');}
  }
  class RelayPeer extends Events{
    constructor(id,options={}){
      super();
      this.id=id||null;this.open=false;this.destroyed=false;
      this._ws=null;this._conn=null;
      const endpoint=RelayPeer.endpoint;
      if(!/^wss:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^?#]*)?$/i.test(endpoint||'')){
        queueMicrotask(()=>this.emit('error',{type:'invalid-relay',message:'Falta una dirección segura wss:// válida para el servidor.'}));
        return;
      }
      this._ws=new WebSocket(endpoint);
      this._ws.onopen=()=>{
        if(this.destroyed)return;
        if(this.id){
          const code=String(this.id).replace(/^emdr-audio-/,'').toUpperCase();
          this._register('therapist',code);
        }else{
          this.open=true;
          this.emit('open', 'relay-client');
        }
      };
      this._ws.onmessage=event=>{
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        if(msg.type==='ready'){
          this.open=true;
          if(msg.role==='therapist')this.emit('open',this.id);
          else if(msg.role==='patient'){
            if(!this._conn)this._conn=new RelayConnection(this);
            this._conn.open=true;
            this._conn.emit('open');
          }
        }else if(msg.type==='patient-joined'){
          if(this._conn&&this._conn.open)this._conn.close();
          this._conn=new RelayConnection(this);
          this.emit('connection',this._conn);
          queueMicrotask(()=>{
            if(!this.destroyed&&this._conn){this._conn.open=true;this._conn.emit('open');}
          });
        }else if(msg.type==='data'){
          if(this._conn)this._conn.emit('data',msg.payload);
        }else if(msg.type==='peer-left'){
          if(this._conn){this._conn.open=false;this._conn.emit('close');this._conn=null;}
        }else if(msg.type==='error'){
          this.emit('error',{type:msg.error||'relay-error',message:msg.error||'Relay error'});
          if(this._conn)this._conn.emit('error',{type:msg.error||'relay-error'});
        }
      };
      this._ws.onerror=()=>this.emit('error',{type:'relay-network',message:'Error de conexión al servidor WebSocket.'});
      this._ws.onclose=e=>{
        this.open=false;
        if(this._conn){this._conn.open=false;this._conn.emit('close');this._conn=null;}
        if(!this.destroyed)this.emit('disconnected',{code:e.code});
      };
    }
    _register(role,code){this._send({type:'register',role,code});}
    _send(msg){if(this._ws&&this._ws.readyState===WebSocket.OPEN)this._ws.send(JSON.stringify(msg));}
    connect(id){
      const code=String(id).replace(/^emdr-audio-/,'').toUpperCase();
      const conn=new RelayConnection(this);
      this._conn=conn;
      this._register('patient',code);
      return conn;
    }
    destroy(){this.destroyed=true;this.open=false;if(this._ws)this._ws.close();if(this._conn){this._conn.open=false;this._conn=null;}}
  }
  RelayPeer.endpoint='';
  window.EMDRRelayPeer=RelayPeer;
})();
