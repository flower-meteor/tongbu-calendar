import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../server.mjs';
import { WEEK, available, dateKey, timeLabel, startOfWeek, occurrences } from '../public/calendar.mjs';
import { parseText, parseGrid, toCalendar } from '../public/timetable.mjs';

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
  const owner=await makeUser(1), peer=await makeUser(2), outsider=await makeUser(3), another=await makeUser(4);
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
  assert.equal((await request(path+'/invite','POST',null,outsider)).status,404);
  const peerInvite=await request(path+'/invite','POST',null,peer);
  assert.equal(peerInvite.status,201);
  assert.equal((await request('/api/join','POST',{invite:peerInvite.data.invite},outsider)).status,200);
  const ownerInvite=await request(path+'/invite','POST',null,owner);
  assert.equal(ownerInvite.status,201);
  assert.equal((await request('/api/join','POST',{invite},another)).status,404);
  assert.equal((await request('/api/join','POST',{invite:peerInvite.data.invite},another)).status,200);
  const updatedPeer=await request(path+'/invite','POST',null,peer);
  assert.equal(updatedPeer.status,201);
  assert.notEqual(updatedPeer.data.invite,peerInvite.data.invite);
  assert.equal((await request('/api/join','POST',{invite:peerInvite.data.invite},another)).status,404);
  assert.equal((await request('/api/join','POST',{invite:ownerInvite.data.invite},another)).status,200);
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
test('hosted registration establishes a secure app session independently of ChatGPT identity',async t=>{
  const request=await fixture(t,{worker:true,secureCookies:true});
  const headers={'oai-authenticated-user-id':'sites-account'};
  assert.deepEqual((await request('/api/me','GET',null,headers)).data,{user:null});
  assert.equal((await request('/api/teams','GET',null,headers)).status,401);
  const result=await request('/api/register','POST',{name:'成员',email:'hosted@example.test',password:'test-password'});
  assert.equal(result.status,200);
  assert.match(result.cookie,/^tongbu=[a-f0-9]{64}$/);
  assert.equal((await request('/api/me','GET',null,{cookie:result.cookie})).data.user.name,'成员');
  assert.equal((await request('/api/logout','POST',null,{cookie:result.cookie})).status,200);
  assert.equal((await request('/api/me','GET',null,{cookie:result.cookie})).data.user,null);
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

test('OCR parser maps Chinese columns, periods and semester weeks',()=>{
  const word=(line,x,y,w,value)=>[5,1,1,1,line,1,x,y,w,20,97,value].join('\t');
  const data=[
    word(1,130,30,60,'星期一'),word(1,330,30,60,'星期二'),word(1,530,30,60,'星期三'),
    word(2,10,115,65,'1-2节'),word(3,128,113,80,'高等数学'),word(4,135,140,65,'2-16周'),
    word(5,10,245,65,'3-4节'),word(6,330,240,80,'大学英语'),word(7,330,265,65,'1-8周'),
  ].join('\n');
  const rows=parseGrid(data);
  assert.deepEqual(rows.map(({title,day,start,end,fromWeek,toWeek})=>[title,day,start,end,fromWeek,toWeek]),[
    ['高等数学',0,'08:00','09:40',2,16],['大学英语',1,'10:00','11:40',1,8],
  ]);
  const list=parseText('周三 线性代数 9:00-10:30 第1-8周');
  assert.equal(list[0].title,'线性代数');
  assert.deepEqual(toCalendar(list,'2026-11-16',16),[{title:'线性代数',start:'2026-11-18T01:00:00.000Z',end:'2026-11-18T02:30:00.000Z',until:'2027-01-06T01:00:00.000Z'}]);
});

test('batch import validates all courses, skips duplicate imports and respects the last week',async t=>{
  const request=await fixture(t);
  const registration=await request('/api/register','POST',{name:'测试者',email:'import@example.test',password:'test-password'});
  const headers={cookie:registration.cookie};
  const team=await request('/api/teams','POST',{name:'我的团队'},headers);
  const path='/api/teams/'+team.data.id;
  const entry={title:'高等数学',start:iso(when('09:00')),end:iso(when('10:00')),until:iso(when('09:00')+WEEK)};
  assert.equal((await request(path+'/import','POST',{events:[entry,{...entry,end:entry.start}]},headers)).status,400);
  assert.deepEqual((await request(path+week,'GET',null,headers)).data.events,[]);
  assert.equal((await request(path+'/import','POST',{events:[entry,entry]},headers)).data.added,1);
  assert.equal((await request(path+'/import','POST',{events:[entry]},headers)).data.added,0);
  const list=(await request(path+week,'GET',null,headers)).data.events;
  assert.equal(occurrences(list,from,from+4*WEEK).length,2);
});
