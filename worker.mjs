import { makeHandler } from './api.mjs';
import { embedded } from './assets.mjs';

const handlers = new WeakMap();
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if (url.pathname==='/api/health') {
      try {
        await env.DB.prepare('SELECT id FROM teams LIMIT 1').first();
        return Response.json({ok:true});
      } catch {
        return Response.json({ok:false},{status:503});
      }
    }
    let handler=handlers.get(env.DB);
    if(!handler) {
      handler=makeHandler({db:env.DB,secureCookies:true,sitesIdentity:true,readAsset:async name=>embedded[name]});
      handlers.set(env.DB,handler);
    }
    const headers=new Headers();
    const res={
      setHeader:(key,value)=>headers.set(key,value),
      writeHead(status,fields) {
        this.status=status;
        for(const [key,value] of Object.entries(fields)) headers.set(key,value);
      },
      end(content){this.response=new Response(content,{status:this.status??200,headers});},
    };
    const req={
      url:url.pathname+url.search, method:request.method,
      headers:{...Object.fromEntries(request.headers),host:url.host},
      socket:{encrypted:url.protocol==='https:',remoteAddress:'site'},
      async *[Symbol.asyncIterator](){if(request.body) yield* request.body;},
    };
    await handler(req,res);
    return res.response??new Response('Server error',{status:500});
  }
};
