import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server.mjs';
import { WEEK, available, dateKey, timeLabel, startOfWeek, occurrences } from '../public/calendar.mjs';

const when=value=>Date.parse('2026-11-16T'+value+':00+08:00');
const iso=time=>new Date(time).toISOString();
const from=when('00:00'), to=from+WEEK;
const week='?'+new URLSearchParams({from:iso(from),to:iso(to)});
const event={title:'流体力学',kind:'class',start:iso(when('09:00')),end:iso(when('10:00')),weekly:true,busy:true};

async function fixture(t, options) {
  const server=makeServer(options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  return async (path,method='GET',body,headers={})=>{
    const r=await fetch(base+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
}
async function exercise(request, makeUser) {
  const owner=await makeUser(1), peer=await makeUser(2), outsider=await makeUser(3);
  const team=await request('/api/teams','POST',{name:'五人项目组'},owner);
  assert.equal(team.status,201);
  const path='/api/teams/'+team.data.id;
  const initial=await request(path+week,'GET',null,owner);
  const invite=initial.data.team.invite;
  assert.equal(invite.length,16);
  assert.equal((await request(path+week,'GET',null,outsider)).status,404);
  assert.equal((await request('/api/join','POST',{invite},peer)).status,200);
  const added=await request(path+'/events','POST',event,owner);
  assert.equal(added.status,201);
  const shared=await request(path+week,'GET',null,peer);
  assert.equal(shared.data.members.length,2);
  assert.equal(shared.data.team.invite,null);
  assert.equal(shared.data.events[0].title,'忙碌');
  assert.equal(shared.data.events[0].kind,'other');
  assert.ok(!JSON.stringify(shared.data).includes(event.title));
  assert.equal((await request(path+'/events/'+added.data.id,'DELETE',null,peer)).status,404);
  assert.equal((await request(path+'/events','POST',{...event,end:event.start},peer)).status,400);
  assert.equal((await request(path+'/invite','POST',null,peer)).status,403);
  assert.equal((await request(path+'/invite','POST',null,owner)).status,200);
  assert.equal((await request('/api/join','POST',{invite},outsider)).status,404);
  assert.equal((await request(path+'/events/'+added.data.id,'PUT',{...event,busy:false},owner)).status,200);
  assert.equal((await request(path+week,'GET',null,peer)).data.events[0].title,event.title);
  assert.equal((await request(path+'/events/'+added.data.id,'DELETE',null,owner)).status,200);
  assert.equal((await request(path+week,'GET',null,peer)).data.events.length,0);
}
test('standalone registration, sessions, sharing and per-team authorization',async t=>{
  const request=await fixture(t);
  assert.equal((await request('/api/teams')).status,401);
  await exercise(request,async i=>{
    const body={name:'同学'+i,email:`member${i}@example.test`,password:'long-password-'+i};
    const result=await request('/api/register','POST',body);
    assert.equal(result.status,200);
    assert.equal((await request('/api/login','POST',body)).status,200);
    return {cookie:result.cookie};
  });
  const blocked=await request('/api/register','POST',{},{origin:'https://unrelated.example'});
  assert.equal(blocked.status,403);
});
test('hosted sign-in identity and separate app profiles',async t=>{
  const request=await fixture(t,{sitesIdentity:true});
  assert.deepEqual((await request('/api/me')).data,{user:null,hosted:true,signedIn:false});
  assert.equal((await request('/api/register','POST',{name:'游客'})).status,401);
  await exercise(request,async i=>{
    const headers={'oai-authenticated-user-id':'sites-account-'+i};
    assert.equal((await request('/api/me','GET',null,headers)).data.signedIn,true);
    assert.equal((await request('/api/register','POST',{name:'成员'+i},headers)).status,200);
    return headers;
  });
});
test('weekly and overnight time windows are calculated in Beijing time',()=>{
  assert.equal(startOfWeek(when('00:15')),from);
  assert.equal(dateKey(from),'2026-11-16');
  assert.equal(timeLabel(from),'00:00');
  const raw=[{uid:'a',start:when('09:00'),end:when('10:00'),weekly:1},{uid:'b',start:when('09:30'),end:when('11:00'),weekly:1}];
  const nextWeek=occurrences(raw,from+WEEK,to+WEEK);
  assert.equal(nextWeek[0].start,when('09:00')+WEEK);
  assert.equal(nextWeek[0].originalStart,raw[0].start);
  const slots=available(nextWeek,['a','b'],from+WEEK,to+WEEK,60,from);
  assert.deepEqual(slots.slice(0,2),[
    {start:when('08:00')+WEEK,end:when('09:00')+WEEK},
    {start:when('11:00')+WEEK,end:when('22:00')+WEEK},
  ]);
  assert.deepEqual(available(nextWeek,[],from+WEEK,to+WEEK,60,from),[]);
});
