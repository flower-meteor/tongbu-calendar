export const DAY=86_400_000, WEEK=7*DAY, MINUTE=60_000, ZONE='Asia/Shanghai';
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const dateKey=t=>dateFormatter.format(t);
export const timeLabel=t=>timeFormatter.format(t);
export const startOfDay=t=>Date.parse(dateKey(t)+'T00:00:00+08:00');
export const startOfWeek=t=>{
  const start=startOfDay(t), d=new Date(start+8*60*MINUTE).getUTCDay();
  return start-((d+6)%7)*DAY;
};
export function occurrences(events,from,to) {
  return events.flatMap(e=>{
    if (!e.weekly) return e.end>from&&e.start<to?[e]:[];
    const list=[];
    for (let i=Math.max(0,Math.floor((from-e.end)/WEEK)+1);e.start+i*WEEK<to;i++) {
      list.push({...e,start:e.start+i*WEEK,end:e.end+i*WEEK,originalStart:e.start,originalEnd:e.end});
    }
    return list;
  }).sort((a,b)=>a.start-b.start || a.end-b.end);
}
export function available(events,memberIds,from,to,minutes,now=Date.now()) {
  if (!memberIds.length) return [];
  const relevant=events.filter(e=>memberIds.includes(e.uid));
  const windows=[];
  for(let d=startOfDay(Math.max(from,now));d<to;d+=DAY) {
    const first=Math.max(d+8*60*MINUTE,from,Math.ceil(now/(15*MINUTE))*15*MINUTE);
    const last=Math.min(d+22*60*MINUTE,to);
    let cursor=first;
    for(const e of relevant) {
      if(e.end<=cursor || e.start>=last) continue;
      if(e.start-cursor>=minutes*MINUTE) windows.push({start:cursor,end:e.start});
      cursor=Math.max(cursor,e.end);
      if(cursor>=last) break;
    }
    if(last-cursor>=minutes*MINUTE) windows.push({start:cursor,end:last});
  }
  return windows;
}
