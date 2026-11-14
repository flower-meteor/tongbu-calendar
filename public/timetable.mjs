import { DAY, WEEK } from './calendar.mjs';

export const labels=['周一','周二','周三','周四','周五','周六','周日'];
export const slots=[
  ['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],
  ['14:00','14:45'],['14:55','15:40'],['16:00','16:45'],['16:55','17:40'],
  ['19:00','19:45'],['19:55','20:40'],['20:50','21:35'],['21:45','22:30'],
];
const dayChar='一二三四五六日天';
const compact=s=>s.normalize('NFKC').replace(/\s+/g,'').replace(/[—–－~～至到]/g,'-');
const weekday=c=>Math.min(dayChar.indexOf(c),6);
const ranges=/(?:第)?(\d{1,2})(?:-(\d{1,2}))?节/;
const timeRange=/((?:[01]?\d|2[0-3]):[0-5]\d)-((?:[01]?\d|2[0-3]):[0-5]\d)/;
const weeksRange=/(?:第)?(\d{1,2})(?:-(\d{1,2}))?周/;
const labelPattern=/^(?:星期|周|礼拜)([一二三四五六日天])$/;
const localTime=t=>t.padStart(5,'0');

function course(source,day,section) {
  const s=compact(source);
  const periods=s.match(ranges), hours=s.match(timeRange), weeks=s.match(weeksRange);
  const first=Number(periods?.[1] ?? section?.[0]), last=Number(periods?.[2] ?? periods?.[1] ?? section?.[1]);
  const fromWeek=Number(weeks?.[1]), toWeek=Number(weeks?.[2] ?? weeks?.[1]);
  const validWeeks=fromWeek>=1&&toWeek<=30&&toWeek>=fromWeek;
  const stripDate=s.replace(/(?:星期|周|礼拜)[一二三四五六日天]/g,'');
  const title=stripDate.split(/[@#：:（(【\[<，,;；]|(?:第)?\d{1,2}(?:-\d{1,2})?(?:节|周)|\d{1,2}:\d{2}/)[0]
    .replace(/^[^\p{L}]+|[^\p{L}\p{N}]+$/gu,'');
  if(title.length<2 || !/\p{L}/u.test(title)||/^(?:时间|课表|星期|课程表|节次|上午|下午|晚上|课程|学期|星期表|教师|教室|备注|周次)$/.test(title)) return null;
  return {title:title.slice(0,100),day,
    start:hours?localTime(hours[1]):slots[first-1]?.[0]??'',
    end:hours?localTime(hours[2]):slots[last-1]?.[1]??'',
    fromWeek:validWeeks?fromWeek:1,toWeek:validWeeks?toWeek:null,
    flag:/[单双]周|\d周[,，、]\d/.test(s)?'周次含单双周或不连续周，请拆分或手动调整':null};
}

export function parseText(raw) {
  const found=[];
  let day=-1;
  for(const line of raw.split(/\r?\n/)) {
    const s=compact(line), marker=s.match(/^(?:星期|周|礼拜)([一二三四五六日天])[：:]?/);
    if(marker)day=weekday(marker[1]);
    if(day<0||!(ranges.test(s)||timeRange.test(s))) continue;
    const data=course(marker?s.slice(marker[0].length):s,day);
    if(data?.start&&data.end)found.push(data);
  }
  return found;
}

function ocrLines(tsv) {
  const groups=new Map();
  for (const row of tsv.split(/\r?\n/)) {
    const col=row.split('\t');
    if(col[0]!=='5'||col.length<12||!col[11].trim())continue;
    const key=col.slice(1,5).join('/'), words=groups.get(key)??[];
    words.push({x:Number(col[6]),y:Number(col[7]),w:Number(col[8]),h:Number(col[9]),text:col.slice(11).join('\t')});
    groups.set(key,words);
  }
  return [...groups.values()];
}

export function parseGrid(tsv) {
  const lines=ocrLines(tsv), headers=[];
  for(const line of lines) for(let i=0;i<line.length;i++) {
    for(let count=1; count<=3&&i+count<=line.length;count++) {
      const selected=line.slice(i,i+count);
      const s=compact(selected.map(w=>w.text).join(''));
      const header=s.match(labelPattern);
      if(header){const first=selected[0],last=selected.at(-1);headers.push({day:weekday(header[1]),x:(first.x+last.x+last.w)/2,y:first.y,h:first.h});break;}
    }
  }
  let group=[];
  for(const header of headers) {
    const aligned=headers.filter(h=>Math.abs(h.y-header.y)<Math.max(h.h,header.h)*1.5);
    if(new Set(aligned.map(h=>h.day)).size>new Set(group.map(h=>h.day)).size)group=aligned;
  }
  const columns=[...new Map(group.map(h=>[h.day,h])).values()].sort((a,b)=>a.x-b.x);
  if(columns.length<3)return [];
  const step=columns.slice(1).map((c,i)=>(c.x-columns[i].x)/Math.max(1,c.day-columns[i].day)).sort((a,b)=>a-b);
  const width=step[Math.floor(step.length/2)];
  if(width<=0)return [];
  const bodyY=Math.max(...group.map(h=>h.y+h.h));
  const left=columns[0].x-width*.56;
  const rows=[], cells=new Map(columns.map(c=>[c.day,[]]));
  for(const line of lines) {
    const buckets=new Map();
    for(const w of line) {
      if(w.y+w.h/2<bodyY)continue;
      const x=w.x+w.w/2;
      const c=columns.reduce((a,b)=>Math.abs(a.x-x)<=Math.abs(b.x-x)?a:b);
      const key=x<left?-1:Math.abs(c.x-x)<width*.58?c.day:null;
      if(key==null)continue;
      const bucket=buckets.get(key)??[];bucket.push(w);buckets.set(key,bucket);
    }
    for(const [key,words] of buckets) {
      const y=words.reduce((sum,w)=>sum+w.y+w.h/2,0)/words.length, h=Math.max(...words.map(w=>w.h));
      const s=compact(words.map(w=>w.text).join(' '));
      if(key===-1) {
        const match=s.match(/^(?:第)?(\d{1,2})(?:-(\d{1,2}))?节?$/);
        const start=Number(match?.[1]),end=Number(match?.[2]??match?.[1]);
        if(start>=1&&end<=slots.length&&end>=start)rows.push({y,start,end});
      } else if(s) cells.get(key).push({y,h,s});
    }
  }
  rows.sort((a,b)=>a.y-b.y);
  const result=[];
  for(const [day,list] of cells) {
    const ordered=list.sort((a,b)=>a.y-b.y);
    const runs=[];
    for(const item of ordered) {
      const last=runs.at(-1);
      const metadata=/^(?:第)?\d{1,2}(?:-\d{1,2})?[节周]|^[@（(\[【]|^[单双]周/.test(item.s);
      if(last && item.y-last.lastY<Math.max(last.height,item.h)*2.3 && metadata) {
        last.parts.push(item.s);last.lastY=item.y;
      } else {
        runs.push({y:item.y,lastY:item.y,height:item.h,parts:[item.s]});
      }
    }
    for(const run of runs) {
      const nearest=rows.reduce((a,b)=>!a||Math.abs(b.y-run.y)<Math.abs(a.y-run.y)?b:a,null);
      const rowSpacing=rows.length>1?(rows.at(-1).y-rows[0].y)/(rows.length-1):run.height*2;
      const row=nearest&&Math.abs(nearest.y-run.y)<=rowSpacing*.72?[nearest.start,nearest.end]:null;
      const data=course(run.parts.join('('),day,row);
      if(data)result.push(data);
    }
  }
  return result.sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start));
}

export function toCalendar(rows,monday,defaultEnd) {
  const base=Date.parse(monday+'T00:00:00+08:00');
  const weekday=new Date(base+8*3_600_000).getUTCDay();
  if(!Number.isFinite(base)||weekday!==1)throw new Error('请选择开学第一周的周一');
  return rows.map((r,i)=>{
    const first=Number(r.fromWeek),last=Number(r.toWeek||defaultEnd),day=Number(r.day);
    if(!r.title?.trim()||r.title.trim().length>100||!Number.isInteger(first)||!Number.isInteger(last)||first<1||last>30||first>last)throw new Error('请核对第 '+(i+1)+' 行的课程名称和周次');
    const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if(!Number.isInteger(day)||day<0||day>6||!clock.test(r.start)||!clock.test(r.end)||r.start>=r.end)throw new Error('请核对第 '+(i+1)+' 行的星期和时间');
    const make=(week,clock)=>new Date(base+(week-1)*WEEK+day*DAY+Number(clock.slice(0,2))*3_600_000+Number(clock.slice(3))*60_000).toISOString();
    return {title:r.title.trim(),start:make(first,r.start),end:make(first,r.end),until:make(last,r.start)};
  });
}
