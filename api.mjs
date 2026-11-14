const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
const token=(n=32)=>hex(crypto.getRandomValues(new Uint8Array(n)));
const utf8=new TextEncoder();
const hash=async value=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(value)));
const derive=async (password,salt)=>{
  const key=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:utf8.encode(salt),iterations:100_000},key,256));
};
function constantEqual(a,b){
  let diff=a.length^b.length;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const day = 86_400_000;
const categories = new Set(['class','exam','activity','meeting','other']);
export const assets = new Map([['/', ['index.html','text/html']], ['/app.mjs',['app.mjs','text/javascript']], ['/calendar.mjs',['calendar.mjs','text/javascript']], ['/timetable.mjs',['timetable.mjs','text/javascript']], ['/import.mjs',['import.mjs','text/javascript']], ['/style.css',['style.css','text/css']], ['/mark.svg',['mark.svg','image/svg+xml']]]);
const error = (status, message) => Object.assign(new Error(message), {status});
assets.set('/cards.mjs',['cards.mjs','text/javascript']);
const text = (value, min, max, label) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw error(400, label);
  return value.trim();
};
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw error(400,'时间格式无效');
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw error(400,'时间格式无效');
  return time;
}

export function makeHandler({ db, readAsset, secureCookies=false, publicOrigin='', trustProxy=false, worker=false }) {
  const one=(sql,...args)=>db.prepare(sql).bind(...args).first();
  const all=async (sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
  const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
  const attempts = new Map();
  const rate = (req) => {
    const now = Date.now();
    for (const [key, value] of attempts) { if (value.reset <= now) attempts.delete(key); }
    const key = worker ? req.headers['cf-connecting-ip'] || req.socket.remoteAddress : trustProxy ? (req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() || req.socket.remoteAddress : req.socket.remoteAddress;
    const value = attempts.get(key) ?? {count:0,reset:now+15*60_000};
    if (value.count++ >= 30) throw error(429,'尝试次数过多，请稍后再试');
    attempts.set(key,value);
  };
  const send = (res, value, status=200) => {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(value));
  };
  const cookie = (res, value, age) => res.setHeader('Set-Cookie',`tongbu=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secureCookies?'; Secure':''}`);
  const session = async req => {
    const key = req.headers.cookie?.match(/(?:^|;\s*)tongbu=([0-9a-f]{64})(?:;|$)/)?.[1];
    return key && await one('SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.uid=u.id WHERE s.token=? AND s.expires>?',await hash(key), Date.now());
  };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw error(415,'请求格式无效');
    let data='', length=0;
    const decoder=new TextDecoder();
    for await (const chunk of req) {
      length+=chunk.byteLength;
      if (length>10_000) throw error(413,'内容过长');
      data+=decoder.decode(chunk,{stream:true});
    }
    let result;
    try { result=JSON.parse(data+decoder.decode()); } catch { throw error(400,'请求格式无效'); }
    if (!result || typeof result!=='object' || Array.isArray(result)) throw error(400,'请求格式无效');
    return result;
  }
  function eventFields(b) {
    const title = text(b.title,1,100,'请填写日程名称，最多 100 字');
    if (!categories.has(b.kind)) throw error(400,'请选择日程类型');
    const start=timestamp(b.start), end=timestamp(b.end);
    if (end<=start || end-start>day || start<Date.UTC(2000,0,1) || end>Date.UTC(2100,0,1)) throw error(400,'日程需在有效日期内，结束晚于开始且不超过 24 小时');
    const until=b.until==null?null:timestamp(b.until);
    if(until!==null && (b.weekly!==true || until<start || until-start>366*day)) throw error(400,'重复截止日期无效');
    const location=b.location==null?'':text(b.location,0,100,'上课地点最多 100 字');
    return [title,b.kind,start,end,Number(b.busy===true),Number(b.weekly===true),until,location];
  }
  const loggedIn = async (res, user) => {
    const key=token();
    await run('DELETE FROM sessions WHERE expires <= ?',Date.now());
    await run('INSERT INTO sessions VALUES (?,?,?)',await hash(key),user.id,Date.now()+30*day);
    cookie(res,key,30*day/1000);
    send(res,{user});
  };
  return async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://local'), method=req.method;
      const path=url.pathname;
      if (assets.has(path) && ['GET','HEAD'].includes(method)) {
        const [file,type]=assets.get(path);
        const bytes=await readAsset(file);
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'});
        return res.end(method==='HEAD'?undefined:bytes);
      }
      if (!path.startsWith('/api/')) throw error(404,'页面不存在');
      if (method!=='GET' && (req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin!==(publicOrigin || `${req.socket.encrypted?'https':'http'}://${req.headers.host}`)))) throw error(403,'请求来源无效');
      if (method==='POST' && (path==='/api/register' || path==='/api/login')) {
        rate(req);
        const b=await body(req);
        const email=text(b.email,3,254,'请填写有效邮箱').toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw error(400,'请填写有效邮箱');
        const password=b.password;
        if (typeof password!=='string' || password.length<8 || password.length>128) throw error(400,'密码需为 8 至 128 个字符');
        if (path.endsWith('/register')) {
          const name=text(b.name,1,28,'请输入 1 至 28 个字符的昵称');
          const salt=token(16), id=token(12);
          const digest=await derive(password,salt);
          const inserted=await run('INSERT INTO users VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING',id,name,email,salt+':'+digest);
          if (!inserted.meta.changes) throw error(409,'这个邮箱已经注册，可以直接登录');
          return loggedIn(res,{id,name,email});
        }
        const user=await one("SELECT * FROM users WHERE email=? AND password<>'sites'",email);
        const [salt,digest]=(user?.password ?? ('0'.repeat(32)+':'+'0'.repeat(64))).split(':');
        const matches=constantEqual(await derive(password,salt),digest);
        if (!user || !matches) throw error(401,'邮箱或密码不正确');
        return loggedIn(res,{id:user.id,name:user.name,email:user.email});
      }
      const user=await session(req);
      if (method==='GET' && path==='/api/me') return send(res,{user:user||null});
      if (!user) throw error(401,'请先登录');
      if (method==='POST' && path==='/api/logout') {
        const key=req.headers.cookie.match(/(?:^|;\s*)tongbu=([0-9a-f]{64})/)?.[1];
        await run('DELETE FROM sessions WHERE token=?',await hash(key));
        cookie(res,'',0);
        return send(res,{ok:true});
      }
      if (method==='GET' && path==='/api/teams') {
        return send(res,{teams:await all('SELECT t.id,t.name,t.owner FROM teams t JOIN members m ON t.id=m.team WHERE m.uid=? ORDER BY t.name,t.id',user.id)});
      }
      if (method==='POST' && path==='/api/teams') {
        const {name}=await body(req);
        const id=token(12), clean=text(name,1,40,'请输入团队名称，最多 40 字');
        await db.batch([
          db.prepare('INSERT INTO teams VALUES (?,?,?,?)').bind(id,clean,token(8).toUpperCase(),user.id),
          db.prepare('INSERT INTO members VALUES (?,?)').bind(id,user.id),
        ]);
        return send(res,{id},201);
      }
      if (method==='POST' && path==='/api/join') {
        rate(req);
        const {invite}=await body(req);
        const code=text(invite,16,16,'请输入 16 位团队邀请码').toUpperCase();
        const team=await one(`
          SELECT team AS id FROM invites WHERE code=?
          UNION ALL
          SELECT t.id FROM teams t WHERE t.invite=? AND NOT EXISTS (
            SELECT 1 FROM invites i WHERE i.team=t.id AND i.uid=t.owner
          )
          LIMIT 1`,code,code);
        if (!team) throw error(404,'邀请码不存在，请检查后重试');
        await run('INSERT OR IGNORE INTO members VALUES (?,?)',team.id,user.id);
        return send(res,{id:team.id});
      }
      const match=path.match(/^\/api\/teams\/([a-f0-9]{24})(?:\/(events|invite|import)(?:\/([a-f0-9]{24}))?)?$/);
      if (!match) throw error(404,'找不到该操作');
      const [,id,action,eventId]=match;
      const team=await one('SELECT t.* FROM teams t JOIN members m ON t.id=m.team WHERE t.id=? AND m.uid=?',id,user.id);
      if (!team) throw error(404,'找不到该团队');
      if (method==='POST' && action==='invite' && !eventId) {
        const invite=token(8).toUpperCase();
        await run('INSERT INTO invites (team,uid,code) VALUES (?,?,?) ON CONFLICT(team,uid) DO UPDATE SET code=excluded.code',id,user.id,invite);
        return send(res,{invite},201);
      }
      if (method==='GET' && !action) {
        const from=timestamp(url.searchParams.get('from')), to=timestamp(url.searchParams.get('to'));
        if (to<=from || to-from>32*day) throw error(400,'请选择不超过 32 天的日期范围');
        const members=await all('SELECT u.id,u.name FROM users u JOIN members m ON u.id=m.uid WHERE m.team=? ORDER BY m.rowid',id);
        const events=await all(`SELECT id,uid,CASE WHEN busy=1 AND uid<>? THEN '忙碌' ELSE title END AS title,
          CASE WHEN busy=1 AND uid<>? THEN 'other' ELSE kind END AS kind,start,end,busy,weekly
          ,repeat_until AS until,CASE WHEN busy=1 AND uid<>? THEN '' ELSE location END AS location
          FROM events WHERE team=? AND start<? AND (end>? OR (weekly=1 AND (repeat_until IS NULL OR repeat_until>=?))) ORDER BY start,id`,user.id,user.id,user.id,id,to,from,from-day);
        const ownInvite=await one('SELECT code FROM invites WHERE team=? AND uid=?',id,user.id);
        const invite=ownInvite?.code ?? (team.owner===user.id?team.invite:null);
        return send(res,{members,events,team:{id,name:team.name,owner:team.owner,invite}});
      }
      if (method==='POST' && action==='events' && !eventId) {
        const fields=eventFields(await body(req));
        const event=token(12);
        await run('INSERT INTO events (id,team,uid,title,kind,start,end,busy,weekly,repeat_until,location) VALUES (?,?,?,?,?,?,?,?,?,?,?)',event,id,user.id,...fields);
        return send(res,{id:event},201);
      }
      if (method==='POST' && action==='import' && !eventId) {
        const {events}=await body(req);
        if(!Array.isArray(events) || events.length<1 || events.length>40) throw error(400,'每次可导入 1 至 40 门课程');
        const fields=events.map(e=>eventFields({...e,kind:'class',weekly:e?.weekly!==false}));
        const statements=fields.map(f=>db.prepare(`INSERT INTO events (id,team,uid,title,kind,start,end,busy,weekly,repeat_until,location)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
            SELECT 1 FROM events WHERE team=? AND uid=? AND title=? AND kind=? AND start=? AND end=? AND weekly=? AND repeat_until IS ?
          )`).bind(token(12),id,user.id,...f,id,user.id,f[0],f[1],f[2],f[3],f[5],f[6]));
        const results=await db.batch(statements);
        return send(res,{added:results.reduce((total,result)=>total+result.meta.changes,0)},201);
      }
      if (action==='events' && eventId && ['PUT','DELETE'].includes(method)) {
        const fields=method==='PUT'?eventFields(await body(req)):null;
        const result=method==='PUT'
          ? await run('UPDATE events SET title=?,kind=?,start=?,end=?,busy=?,weekly=?,repeat_until=?,location=? WHERE id=? AND team=? AND uid=?',...fields,eventId,id,user.id)
          : await run('DELETE FROM events WHERE id=? AND team=? AND uid=?',eventId,id,user.id);
        if (!result.meta.changes) throw error(404,'找不到你创建的这条日程');
        return send(res,{ok:true});
      }
      throw error(404,'找不到该操作');
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent && !res.destroyed) send(res,{error:e.status?e.message:'服务器暂时无法处理请求'},e.status||500);
    }
  };
}
