import { DAY, WEEK, MINUTE, dateKey, timeLabel, startOfDay, startOfWeek, occurrences, available } from './calendar.mjs';
import { openImport } from './import.mjs';

const $=id=>document.getElementById(id);
const main=$('main'), dialog=$('dialog'), overlay=$('dialog-body');
const kinds={class:'课程',exam:'考试',activity:'活动',meeting:'会议',other:'其他'};
const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
const state={user:null, team:null, members:[], raw:[], week:startOfWeek(Date.now()), filter:'all', invite:new URL(location.href).searchParams.get('join')||''};
let toastTimer, updateNumber=0;
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=t=>dateKey(t)+'T'+timeLabel(t);
const utc=t=>new Date(t).toISOString();
const events=()=>occurrences(state.raw,state.week,state.week+WEEK);
const name=id=>state.members.find(m=>m.id===id)?.name||'成员';
const range=(a,b)=>timeLabel(a)+'–'+(dateKey(a)===dateKey(b)?'':dateKey(b).slice(5)+' ')+timeLabel(b);

async function api(url,method='GET',data) {
  const res=await fetch('/api'+url,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  const out=await res.json().catch(()=>null);
  if (!res.ok || !out) throw new Error(out?.error||'请求失败，请稍后重试');
  return out;
}
function toast(message) {
  $('toast').textContent=message; $('toast').hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,2800);
}
function screen(html) {
  main.innerHTML=html; main.setAttribute('aria-busy','false');
  $('top-tools').hidden=!state.user;
  $('account').textContent=state.user?.name||'';
}
function form(id,fn) {
  const node=$(id);
  node.onsubmit=async e=>{
    e.preventDefault();
    const error=node.querySelector('.error'), button=node.querySelector('button[type=submit]');
    error.textContent=''; button.disabled=true;
    try { await fn(Object.fromEntries(new FormData(node))); }
    catch(e) { error.textContent=e.message; }
    finally { button.disabled=false; }
  };
}
const message='<div class="error" role="alert"></div>';
const intro='<div class="intro"><img src="/mark.svg" alt=""><h1>把时间<br>约到一起。</h1><p>把课表、考试和活动放在同一张日历里，直接找到大家都空的时间。</p><div class="sample" aria-label="日程显示示例"><div class="event class">09:00 · 专业课</div><div class="event exam">14:00 · 期中考试</div><div class="free">17:30–18:30 · 示例共同空闲</div></div></div>';
function auth(register=true) {
  screen(`<section class="gate">
    ${intro}
    <div class="gate-form"><h2>${register?'注册同频':'登录同频'}</h2>${state.invite?'<p>已收到团队邀请，登录后确认加入。</p>':register?'<p>填写昵称、邮箱和密码即可注册。创建团队后就能邀请队友。</p>':''}
    <form id="auth-form">${register?'<label>昵称<input name="name" required maxlength="28" autocomplete="nickname"></label>':''}
    <label>邮箱<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
    <label>密码<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${register?'new-password':'current-password'}"></label>
    ${message}<button class="primary" type="submit">${register?'注册并登录':'登录'}</button></form>
    <button id="auth-switch" class="quiet switch">${register?'已有账号，去登录':'创建账号'}</button></div></section>`);
  $('auth-switch').onclick=()=>auth(!register);
  form('auth-form',async fields=>{
    const result=await api(register?'/register':'/login','POST',fields);
    state.user=result.user;
    try { await teams(!state.invite); } catch(e) { failure(e); }
  });
}
function failure(e) {
  screen(`<section class="team-form"><h2>暂时无法加载</h2><p>${safe(e.message)}</p><button id="reload">重试</button></section>`);
  $('reload').onclick=()=>location.reload();
}
async function teams(openLast=false) {
  ++updateNumber; state.team=null;
  const out=await api('/teams');
  const last=sessionStorage.getItem('tongbu-team');
  if(openLast && !state.invite && out.teams.length) return loadTeam((out.teams.find(t=>t.id===last)??out.teams[0]).id);
  screen(`<section class="team-form"><h2>你的团队</h2><div class="team-list">
    ${out.teams.length?out.teams.map(t=>`<button data-team="${safe(t.id)}">${safe(t.name)} →</button>`).join(''):'<p>创建一个团队，或使用队友发来的邀请码。</p>'}</div>
    <form id="create-team" class="inline-form"><label>团队名称<input name="name" required maxlength="40" placeholder="例如：大创项目组"></label><button class="primary" type="submit">创建团队</button>${message}</form>
    <hr><form id="join-team" class="inline-form"><label>邀请码<input name="invite" value="${safe(state.invite)}" required minlength="16" maxlength="16" spellcheck="false" autocomplete="off"></label><button type="submit">加入团队</button>${message}</form></section>`);
  main.querySelectorAll('[data-team]').forEach(b=>b.onclick=()=>loadTeam(b.dataset.team).catch(failure));
  form('create-team',async data=>{const {id}=await api('/teams','POST',data); await loadTeam(id);});
  form('join-team',async data=>{
    const {id}=await api('/join','POST',data);
    state.invite=''; history.replaceState(null,'','/'); await loadTeam(id);
  });
}
async function loadTeam(id,week=state.week) {
  const request=++updateNumber;
  const out=await api(`/teams/${id}?from=${encodeURIComponent(utc(week))}&to=${encodeURIComponent(utc(week+WEEK))}`);
  if (request!==updateNumber) return;
  if(state.team?.id!==id) state.filter='all';
  Object.assign(state,{team:out.team,members:out.members,raw:out.events,week});
  sessionStorage.setItem('tongbu-team',id); dashboard();
}
function memberRow(m) {return `<div class="member"><span class="avatar">${safe(Array.from(m.name)[0])}</span><span>${safe(m.name)}${state.user.id===m.id?'（我）':''}${state.team.owner===m.id?' · 创建者':''}</span></div>`;}
function dashboard() {
  const show=events().filter(e=>state.filter==='all'||e.uid===state.filter), today=dateKey(Date.now());
  const days=Array.from({length:7},(_,i)=>{
    const d=state.week+i*DAY, key=dateKey(d);
    const items=show.filter(e=>e.end>d&&e.start<d+DAY);
    return `<section class="day ${key===today?'today':''}"><button class="day-head" data-day="${d}" aria-label="${key} 添加日程">${weekdays[i]} <strong>${Number(key.slice(-2))}</strong><span aria-hidden="true">＋</span></button>
      <div class="cards">${items.map(e=>`<button class="event ${kinds[e.kind]?e.kind:'other'}" data-event="${e.id}:${e.start}"><span>${range(Math.max(e.start,d),Math.min(e.end,d+DAY-1))}</span><b>${safe(e.title)}</b>${e.location?`<small>${safe(e.location)}</small>`:''}<small>${safe(name(e.uid))}${e.weekly?' · 每周':''}</small></button>`).join('')}</div></section>`;
  }).join('');
  const {team}=state;
  screen(`<div class="headline"><div><h1>${safe(team.name)}</h1><p>${state.members.length} 位成员 · 北京时间 (UTC+8)</p></div><div class="actions"><button id="find">找共同空闲</button><button id="import">上传课表</button><button class="primary" id="add">＋ 新建日程</button></div></div>
    <div class="dashboard"><section class="calendar" aria-label="团队周历">
    <div class="calendar-top"><div class="nav"><button id="prev" aria-label="上一周">‹</button><button id="next" aria-label="下一周">›</button><button id="current">本周</button></div><h2>${dateKey(state.week).replaceAll('-','/')} — ${dateKey(state.week+6*DAY).slice(5).replace('-','/')}</h2><button id="refresh">刷新</button></div>
    <div class="legend">${Object.entries(kinds).map(([k,v])=>`<span class="${k}">${v}</span>`).join('')}</div><div class="week">${days}</div></section>
    <aside class="side"><section class="panel"><h3>团队成员</h3>${state.members.map(memberRow).join('')}
    <label>筛选日程<select id="filter"><option value="all">所有成员</option>${state.members.map(m=>`<option value="${m.id}">${safe(m.name)}</option>`).join('')}</select></label></section>
    <section class="panel"><h3>邀请队友</h3><p>每位成员都能生成自己的邀请码。队友注册后可用它加入本团队。</p>${team.invite?`<code>${safe(team.invite)}</code>`:''}
    <div class="row">${team.invite?'<button id="copy">复制邀请链接</button>':''}<button id="renew" ${team.invite?'class="quiet"':'class="primary"'}>${team.invite?'更新我的邀请码':'生成邀请码'}</button></div></section></aside></div>`);
  $('filter').value=state.filter;
  $('filter').onchange=e=>{state.filter=e.target.value;dashboard();$('filter').focus();};
  const move=week=>loadTeam(team.id,week).catch(e=>toast(e.message));
  $('prev').onclick=()=>move(state.week-WEEK); $('next').onclick=()=>move(state.week+WEEK);
  $('current').onclick=()=>move(startOfWeek(Date.now())); $('refresh').onclick=()=>move(state.week);
  $('find').onclick=findMeeting;
  $('add').onclick=()=>editEvent();
  $('import').onclick=()=>openImport({showDialog,dialog,overlay,startDate:dateKey(state.week),onSave:async events=>{
    const {added}=await api(`/teams/${team.id}/import`,'POST',{events});
    dialog.close();
    await loadTeam(team.id,startOfWeek(Date.parse(events[0].start))).catch(failure);
    toast(added?'已加入 '+added+' 门课程':'这些课程已在日历中');
  }});
  main.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>editEvent(null,Number(b.dataset.day)+9*60*MINUTE));
  main.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{
    const event=show.find(e=>e.id+':'+e.start===b.dataset.event);
    if(event.uid===state.user.id) editEvent(event);
    else showDialog(event.title,`<p>${safe(name(event.uid))} · ${kinds[event.kind]}<br>${dateKey(event.start)} · ${range(event.start,event.end)}${event.weekly?' · 每周重复':''}${event.location?'<br>地点：'+safe(event.location):''}</p>`);
  });
  if(team.invite) {
    $('copy').onclick=async()=>{
      const link=new URL('/',location.origin); link.searchParams.set('join',team.invite);
      try { await navigator.clipboard.writeText(link.href); toast('邀请链接已复制'); }
      catch { showDialog('邀请链接',`<label>复制后发给队友<input readonly value="${safe(link.href)}"></label>`);overlay.querySelector('input').select(); }
    };
  }
  const generateInvite=async e=>{
    const button=e.currentTarget;
    const updating=Boolean(team.invite);
    button.disabled=true;
    try {
      const {invite}=await api(`/teams/${team.id}/invite`,'POST');
      if(dialog.open) dialog.close();
      if(state.team?.id===team.id) { state.team.invite=invite; dashboard(); }
      toast(updating?'邀请码已更新':'邀请码已生成');
    } catch(err){toast(err.message);button.disabled=false;}
  };
  $('renew').onclick=team.invite?()=>{
    showDialog('更新我的邀请码','<p>你的旧链接会失效。队友发出的链接和已加入的成员不受影响。</p><div class="row"><button class="primary" id="confirm-invite">确认更新</button></div>');
    $('confirm-invite').onclick=generateInvite;
  }:generateInvite;
}
function showDialog(title,html) {
  overlay.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${safe(title)}</h2><button id="close-dialog" class="quiet" aria-label="关闭">×</button></div>${html}`;
  $('close-dialog').onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();
}
function editEvent(event=null,start=null,end=null,isMeeting=false) {
  const team=state.team.id;
  start=event?.originalStart ?? event?.start ?? start ?? Math.max(state.week+9*60*MINUTE,Math.ceil(Date.now()/(30*MINUTE))*30*MINUTE);
  end=event?.originalEnd ?? event?.end ?? end ?? start+60*MINUTE;
  showDialog(event?'编辑日程':'新建日程',`<form id="event-form">
    <label>名称<input name="title" required maxlength="100" value="${safe(event?.title??(isMeeting?'项目会议':''))}" placeholder="例如：材料力学"></label>
    <label>地点（可选）<input name="location" maxlength="100" value="${safe(event?.location)}" placeholder="例如：将军路二号楼 2201"></label>
    <label>类型<select name="kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <div class="split"><label>开始 · 北京时间<input name="start" required type="datetime-local" value="${local(start)}"></label><label>结束 · 北京时间<input name="end" required type="datetime-local" value="${local(end)}"></label></div>
    <label class="check"><input type="checkbox" name="weekly" ${event?.weekly?'checked':''}>每周重复${event?.weekly?'（编辑整个系列）':''}</label>
    <label>重复截止日期（可选）<input type="date" name="until" value="${event?.until==null?'':dateKey(event.until)}"></label>
    <label class="check"><input type="checkbox" name="busy" ${event?.busy?'checked':''}>对队友仅显示「忙碌」</label>
    ${message}<div class="form-actions">${event?'<button type="button" id="delete" class="danger">删除日程</button>':''}<button class="primary" type="submit">保存日程</button></div></form>`);
  const formNode=$('event-form');
  formNode.elements.kind.value=event?.kind??(isMeeting?'meeting':'class');
  formNode.elements.start.onchange=()=>{
    if(formNode.elements.end.value<=formNode.elements.start.value) formNode.elements.end.value=local(Date.parse(formNode.elements.start.value+'+08:00')+60*MINUTE);
  };
  form('event-form',async data=>{
    const url=`/teams/${team}/events${event?'/'+event.id:''}`;
    await api(url,event?'PUT':'POST',{...data,start:data.start+'+08:00',end:data.end+'+08:00',weekly:!!data.weekly,busy:!!data.busy,until:data.weekly&&data.until?data.until+'T'+data.start.slice(11)+'+08:00':null});
    dialog.close(); await loadTeam(team,event?state.week:startOfWeek(Date.parse(data.start+'+08:00'))).catch(failure); toast('日程已保存');
  });
  if(event) $('delete').onclick=()=>{
    showDialog('删除日程',`<p>${event.weekly?'这会删除整个每周重复的系列。':'确认删除这条日程？'}</p>${message}<div class="form-actions"><button id="back">返回</button><button id="delete-confirm" class="danger">确认删除</button></div>`);
    $('back').onclick=()=>editEvent(event);
    $('delete-confirm').onclick=async e=>{
      e.target.disabled=true;
      try { await api(`/teams/${team}/events/${event.id}`,'DELETE'); dialog.close(); await loadTeam(team).catch(failure); toast('日程已删除'); }
      catch(err){ overlay.querySelector('.error').textContent=err.message;e.target.disabled=false; }
    };
  };
}
function findMeeting() {
  showDialog('找共同空闲',`<p class="small">在当前周的 08:00–22:00 内，按已填写的日程计算。</p>
    <form id="find-form"><div class="members-filter">${state.members.map(m=>`<label class="check"><input type="checkbox" name="member" value="${m.id}" checked>${safe(m.name)}</label>`).join('')}</div>
    <label>会议时长<select name="length"><option value="30">30 分钟</option><option value="60" selected>60 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select></label>
    ${message}<button class="primary" type="submit">查找时段</button></form><div id="slots" class="slots" aria-live="polite"></div>`);
  form('find-form', async data=>{
    const team=state.team.id, week=state.week;
    const members=new FormData($('find-form')).getAll('member');
    $('slots').replaceChildren();
    if(!members.length) throw new Error('请至少选择一位成员');
    const result=await api(`/teams/${team}?from=${encodeURIComponent(utc(week))}&to=${encodeURIComponent(utc(week+WEEK))}`);
    if(!dialog.open||!$('slots')||state.team?.id!==team)return;
    const minutes=Number(data.length), slots=available(occurrences(result.events,week,week+WEEK),members,week,week+WEEK,minutes);
    $('slots').innerHTML=slots.length?slots.map(({start,end})=>`<button data-slot="${start}">${dateKey(start).slice(5)} · ${range(start,end)}　预约 →</button>`).join(''):'<p>当前周没有匹配的时段。可以切到下周，或缩短会议时长。</p>';
    $('slots').querySelectorAll('button').forEach(b=>b.onclick=()=>editEvent(null,Number(b.dataset.slot),Number(b.dataset.slot)+minutes*MINUTE,true));
  });
}
$('teams-button').onclick=()=>teams().catch(failure);
$('logout').onclick=async()=>{
  try { await api('/logout','POST'); ++updateNumber;state.user=null;state.team=null;auth(false); }
  catch(e){toast(e.message);}
};
api('/me').then(({user})=>{state.user=user;return user?teams(true):auth();}).catch(failure);
