import { dateKey } from './calendar.mjs';

// Colored cells form tall, nearly solid rectangles, separated by pale grid lines.
export function locateCards({data,width,height}) {
  const mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++){
    const p=i*4, hi=Math.max(data[p],data[p+1],data[p+2]), lo=Math.min(data[p],data[p+1],data[p+2]);
    if(hi-lo>=23 && hi>=100)mask[i]=1;
  }
  const stack=new Int32Array(mask.length), candidates=[];
  for(let start=0;start<mask.length;start++){
    if(!mask[start])continue;
    let size=0, count=0, left=width, right=0, top=height, bottom=0;
    const add=i=>{if(mask[i]){mask[i]=0;stack[size++]=i;}};
    add(start);
    while(size){
      const i=stack[--size], x=i%width, y=Math.floor(i/width);
      count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      if(x>0)add(i-1);
      if(x<width-1)add(i+1);
      if(y>0)add(i-width);
      if(y<height-1)add(i+width);
    }
    const w=right-left+1,h=bottom-top+1;
    if(w>=width*.095&&w<=width*.17&&h>=w*.75&&h<=w*5&&count>w*h*.63)candidates.push({x:left,y:top,w,h});
  }
  if(candidates.length<3)return [];
  const widths=candidates.map(c=>c.w).sort((a,b)=>a-b);
  const pitch=widths[Math.floor(widths.length/2)]+Math.max(1,width*.002);
  const cells=candidates.filter(c=>Math.abs(c.w-pitch)<pitch*.15);
  for(const c of cells)c.day=6-Math.round((width-c.x-c.w/2-pitch/2)/pitch);
  const valid=cells.filter(c=>c.day>=0&&c.day<=6).sort((a,b)=>a.y-b.y);
  const bands=[];
  for(const c of valid){
    const band=bands.at(-1);
    if(!band||c.y-band[0].y>pitch*.25)bands.push([c]);else band.push(c);
  }
  if(bands.length!==4)return [];
  // Check the two morning bands, the lunch break, and the two afternoon bands.
  const [a,b,c,d]=bands.map(band=>band[0].y);
  if(Math.abs((b-a)-bands[0][0].h)>pitch*.3||c-b<bands[1][0].h+pitch*.45||Math.abs((d-c)-bands[2][0].h)>pitch*.3)return [];
  const origin=valid.reduce((sum,cell)=>sum+cell.x+cell.w/2-cell.day*pitch,0)/valid.length;
  return bands.flatMap((band,block)=>{
    const y=Math.round(band.reduce((sum,cell)=>sum+cell.y,0)/band.length);
    const h=Math.round(band.reduce((sum,cell)=>sum+cell.h,0)/band.length);
    const w=Math.round(pitch-3);
    return Array.from({length:7},(_,day)=>{
      const center=origin+day*pitch, x=Math.round(center-w/2);
      let count=0;
      for(const yy of [.28,.5,.72])for(const xx of [-.38,-.3,0,.3,.38]){
        const offset=(Math.round(y+h*yy)*width+Math.round(center+pitch*xx))*4;
        const rgb=data.subarray(offset,offset+3);
        if(Math.max(...rgb)-Math.min(...rgb)>=23)count++;
      }
      return count>=6?{x,y,w,h,day,block}:null;
    }).filter(Boolean);
  });
}

const blocks=[['08:00','10:00'],['10:00','12:00'],['14:00','16:00'],['16:00','18:00']];
export function cardCourse(lines,cell) {
  const [start,end]=blocks[cell.block];
  const parts=lines.map(line=>line.text.replace(/\s+/g,'').replace(/[.…]{2,}/g,'…').replace(/[|_]+$/g,'')).filter(Boolean);
  const place=parts.findIndex((s,i)=>i>0&&/^(?:将军路|明故宫|天目湖|[^\d]{1,6}校区)|\d{3,}/.test(s));
  const title=(place<0?parts:parts.slice(0,place)).join('').trim().replace(/[（(]([一二三四五六七八九十]+)[,，)）]?$/,'（$1）');
  const location=(place<0?[]:parts.slice(place)).join('').trim().replace(/([^\d])(\d{3,})$/,'$1 $2');
  return {title,location,day:cell.day,start,end,fromWeek:1,toWeek:1,
    flag:title.includes('…')?'截图中的课名有省略，请按原课表补全':!location?'请核对上课地点':null};
}

export function screenshotMonday(raw,currentDate) {
  const dates=[...raw.matchAll(/(?:^|[^\d])(\d{1,2})\s*[-–—/.]\s*(\d{1,2})(?!\d)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  for(const m of raw.matchAll(/(?:^|\s)(1[0-2]|0[1-9])([0-3]\d)(?=\s|$)/g))dates.push([Number(m[1]),Number(m[2])]);
  const years=[...new Set([Number(currentDate.slice(0,4)),Number(currentDate.slice(0,4))-1,Number(currentDate.slice(0,4))+1])];
  const today=Date.parse(currentDate);
  let best;
  for(const [index,[month,day]] of dates.entries())for(const year of years){
    const stamp=Date.UTC(year,month-1,day);
    const base=new Date(stamp);
    if(base.getUTCMonth()!==month-1||base.getUTCDate()!==day)continue;
    const offset=(base.getUTCDay()+6)%7;
    const monday=stamp-offset*86_400_000;
    const hits=dates.filter(([m,d])=>Array.from({length:7},(_,i)=>new Date(monday+i*86_400_000)).some(date=>date.getUTCMonth()===m-1&&date.getUTCDate()===d)).length;
    if(hits<3)continue;
    const score=hits*1000-Math.abs(stamp-today)/86_400_000-index*.001;
    if(!best||score>best.score)best={monday,score};
  }
  return best?dateKey(best.monday):null;
}
