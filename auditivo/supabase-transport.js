/* EMDR Supabase Realtime transport adapter.
   Experimental: use on a dedicated Supabase project for testing only.
   Reuses the PeerJS subset expected by desktop and mobile EMDR applications. */
(() => {
  'use strict';
  class Emitter {
    constructor() { this.listeners = Object.create(null); }
    on(name, handler) { (this.listeners[name] ||= []).push(handler); return this; }
    emit(name, ...args) { for (const fn of this.listeners[name] || []) { try { fn(...args); } catch (e) { console.error('EMDR handler', e); } } }
  }
  class DataConnection extends Emitter {
    constructor(owner) { super(); this.owner = owner; this.open = false; }
    send(data) {
      if (!this.open || !data) return;
      const valid = this.owner._role === 'therapist'
        ? data.type === 'state' && ['fast','slow'].includes(data.mode) && typeof data.elapsed === 'number'
        : data.type === 'audio-ready';
      if (!valid) return;
      this.owner._channel.send({ type: 'broadcast', event: 'command', payload: { role: this.owner._role, data } })
        .then(result => { if (result !== 'ok') this.emit('error', {type:'send-failed',message:String(result)}); })
        .catch(err => this.emit('error', {type:'send-failed',message:err?.message||String(err)}));
    }
    close() { this.owner.destroy(); }
  }
  class SupabasePeer extends Emitter {
    static url = '';
    static key = '';
    constructor(id) {
      super();
      this.id = id || null;
      this.open = false;
      this.destroyed = false;
      this._role = id ? 'therapist' : 'patient';
      this._channel = null;
      this._connection = null;
      this._client = null;
      this._clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      this._session = id ? String(id).replace(/^emdr-audio-/,'').toUpperCase() : '';
      this._announced = false;
      if (!window.supabase?.createClient || !/^https:\/\/[\w.-]+\.supabase\.co$/.test(SupabasePeer.url) ||
          !/^(sb_publishable_[\w-]+|eyJ[\w.-]+)$/.test(SupabasePeer.key)) {
        queueMicrotask(() => this.emit('error',{type:'supabase-config',message:'Configura una URL de proyecto y una clave pública válidas.'}));
        return;
      }
      try {
        this._client = window.supabase.createClient(SupabasePeer.url, SupabasePeer.key, {
          auth: { persistSession:false,autoRefreshToken:false,detectSessionInUrl:false },
          realtime: { params: {eventsPerSecond:10} }
        });
        if (this._role === 'therapist') this._join();
        else queueMicrotask(() => { if (!this.destroyed) { this.open = true; this.emit('open',this._clientId); } });
      } catch(e) { queueMicrotask(()=>this.emit('error',{type:'supabase-init',message:e.message})); }
    }
    connect(id) {
      this._session = String(id).replace(/^emdr-audio-/,'').toUpperCase();
      this._join();
      this._connection = new DataConnection(this);
      return this._connection;
    }
    _join() {
      if (this.destroyed || !this._client || this._channel) return;
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(this._session)) {
        queueMicrotask(()=>this.emit('error',{type:'invalid-session',message:'Código de sesión inválido'}));return;
      }
      const ch = this._client.channel('emdr-audio-v1-' + this._session, {
        config: { broadcast:{self:false,ack:true}, presence:{key:this._clientId} }
      });
      this._channel=ch;
      let otherPresent = false;
      const sync = () => {
        const members = Object.values(ch.presenceState()).flat();
        const hasOther = members.some(x=>x && x.role !== this._role && x.role === (this._role === 'therapist' ? 'patient':'therapist'));
        if (hasOther && !otherPresent) {
          otherPresent=true;
          if (this._role === 'therapist') {
            this._connection = new DataConnection(this);
            this.emit('connection',this._connection);
          }
          if (this._connection) { this._connection.open=true; this._connection.emit('open'); }
        }
        if (!hasOther && otherPresent) {
          otherPresent=false;
          if (this._connection) {this._connection.open=false;this._connection.emit('close');}
          this._connection=null;
        }
      };
      ch.on('presence',{event:'sync'},sync)
        .on('broadcast',{event:'command'},({payload})=>{
          if (!payload || payload.role === this._role || !payload.data) return;
          const valid=this._role==='patient' ? payload.role==='therapist' && payload.data.type==='state' : payload.role==='patient' && payload.data.type==='audio-ready';
          if(valid && this._connection?.open)this._connection.emit('data',payload.data);
        });
      ch.subscribe(async (status,err)=>{
        if(this.destroyed)return;
        if(status==='SUBSCRIBED'){
          this.open=true;
          if (this._role === 'therapist') this.emit('open',this.id);
          try {
            const result=await ch.track({role:this._role});
            if(result!=='ok')throw Error('Presence: '+result);
          }catch(e){this.emit('error',{type:'supabase-presence',message:e.message});}
        } else if (status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
          this.emit('error',{type:'supabase-channel',message:err?.message||status});
        } else if (status==='CLOSED' && !this.destroyed){
          this.open=false;this.emit('disconnected');
        }
      });
    }
    destroy(){
      this.destroyed=true;this.open=false;
      if(this._connection){this._connection.open=false;this._connection=null;}
      if(this._client && this._channel){this._client.removeChannel(this._channel);this._channel=null;}
      if(this._client){this._client.realtime.disconnect();}
    }
  }
  window.EMDRSupabasePeer = SupabasePeer;
})();
