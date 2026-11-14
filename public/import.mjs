import { labels,parseText,parseGrid,toCalendar } from './timetable.mjs';
import { locateCards,cardCourse,screenshotMonday } from './cards.mjs';

const cdn='https://cdn.jsdelivr.net/npm';
const core=cdn+'/tesseract.js-core@6.0.0';
const workerUrl=cdn+'/tesseract.js@6.0.1/dist/worker.min.js';
let engine;
function loadEngine() {
  if(!engine) engine=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=cdn+'/tesseract.js@6.0.1/dist/tesseract.min.js';
    script.onload=()=>globalThis.Tesseract?resolve(globalThis.Tesseract):reject(new Error('识图组件未加载'));
    script.onerror=()=>reject(new Error('识图组件下载失败，请检查网络后重试'));
    document.head.append(script);
  }).catch(error=>{engine=null;throw error;});
  return engine;
}
async function prepareImage(file) {
  const bitmap=await createImageBitmap(file);
  try {
    const longest=Math.max(bitmap.width,bitmap.height);
    const scale=Math.min(1.75,2200/longest);
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*scale);
    canvas.height=Math.round(bitmap.height*scale);
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='white';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    // Cell borders interfere with OCR's page segmentation. Keep text and lightly
    // colored cells, while whitening long, thin horizontal and vertical lines.
    return canvas;
  } finally {bitmap.close();}
}
function cleanGrid(canvas) {
    const ctx=canvas.getContext('2d');
    const img=ctx.getImageData(0,0,canvas.width,canvas.height);
    const {data,width,height}=img;
    const mask=new Uint8Array(width*height);
    for(let i=0;i<mask.length;i++) {
      const p=i*4;
      const gray=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);
      mask[i]=gray<155?1:0;
    }
    function erase(start,length,stride,limit) {
      let first=-1;
      for(let i=0;i<=length;i++) {
        if(i<length&&mask[start+i*stride]) { if(first<0)first=i;continue; }
        if(first>=0&&i-first>=limit)for(let j=first;j<i;j++)data.fill(255,(start+j*stride)*4,(start+j*stride)*4+3);
        first=-1;
      }
    }
    for(let y=0;y<height;y++)erase(y*width,width,1,Math.max(45,width*.08));
    for(let x=0;x<width;x++)erase(x,height,width,Math.max(45,height*.08));
    ctx.putImageData(img,0,0);
    return canvas;
}

function crop(canvas,x,y,w,h,card=false) {
  const result=document.createElement('canvas'), scale=2.6, pad=16;
  result.width=Math.ceil(w*scale)+pad*2;result.height=Math.ceil(h*scale)+pad*2;
  const cx=result.getContext('2d');
  cx.fillStyle='white';cx.fillRect(0,0,result.width,result.height);
  cx.drawImage(canvas,x,y,w,h,pad,pad,w*scale,h*scale);
  if(card){
    const img=cx.getImageData(pad,pad,Math.floor(w*scale),Math.floor(h*scale));
    const data=img.data;
    const p=(8*img.width+8)*4;
    const threshold=Math.min(240,Math.max(170,Math.min(data[p],data[p+1],data[p+2])+26));
    for(let i=0;i<data.length;i+=4){
      const ink=Math.min(data[i],data[i+1],data[i+2])>=threshold?0:255;
      data[i]=data[i+1]=data[i+2]=ink;
    }
    cx.putImageData(img,pad,pad);
  }
  return result;
}
async function recognize(file,logger,onWorker,startDate,onProgress) {
  const [Tesseract,canvas]=await Promise.all([loadEngine(),prepareImage(file)]);
  const worker=await Tesseract.createWorker('chi_sim+eng',1,{logger,corePath:core,workerPath:workerUrl,workerBlobURL:true});
  onWorker(worker);
  try {
    const ctx=canvas.getContext('2d');
    const cells=locateCards(ctx.getImageData(0,0,canvas.width,canvas.height));
    if(cells.length) {
      const top=Math.min(...cells.map(c=>c.y)), unit=cells[0].w;
      await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE,tessedit_char_whitelist:'0123456789-./ '});
      const dateImage=crop(canvas,unit*.42,Math.max(0,top-unit*.55),canvas.width-unit*.42,unit*.44);
      let header=(await worker.recognize(dateImage)).data.text;
      let date=screenshotMonday(header,startDate);
      if(!date){
        const pitch=unit+3;
        for(let day=0;day<7;day++){
          const x=canvas.width-(7-day)*pitch;
          const cell=crop(canvas,Math.max(0,x+8),top-unit*.55,pitch-16,unit*.44);
          header+=' '+(await worker.recognize(cell)).data.text.trim();
        }
        date=screenshotMonday(header,startDate);
      }
      await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_BLOCK,tessedit_char_whitelist:''});
      const rows=[];
      for(const [i,c] of cells.entries()){
        onProgress(i+1,cells.length);
        const inset=Math.max(3,Math.round(c.w*.018));
        const image=crop(canvas,c.x+inset,c.y+inset,c.w-2*inset,c.h-2*inset,true);
        const raw=(await worker.recognize(image)).data.text;
        const result=cardCourse(raw.split(/\r?\n/).map(text=>({text})),c);
        if(!result.title)result.flag='请按原图补填课名和地点';
        rows.push(result);
      }
      return {rows:rows.sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start)),date,weekOnly:true};
    }
    cleanGrid(canvas);
    await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT});
    const {data}=await worker.recognize(canvas,{}, {text:true,tsv:true});
    const grid=parseGrid(data.tsv||'');
    if(grid.length)return {rows:grid};
    const text=parseText(data.text||'');
    if(text.length)return {rows:text};
    await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.AUTO});
    const fallback=await worker.recognize(canvas,{}, {text:true,tsv:true});
    const parsed=parseGrid(fallback.data.tsv||'');
    return {rows:parsed.length?parsed:parseText(fallback.data.text||'')};
  } finally {await worker.terminate();onWorker(null);}
}

export function openImport({showDialog,dialog,overlay,startDate,onSave}) {
  const rows=[];
  let busy=false, closed=false, worker;
  showDialog('上传课表',`<p>选择课表截图或照片。识别在浏览器内完成，图片不会上传。</p>
  <form id="timetable-form"><label>课表图片<input id="ocr-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
  <div class="row"><button type="button" id="ocr-start" class="primary">识别课表</button><span id="ocr-status" role="status" class="small muted"></span></div>
  <img id="ocr-preview" alt="原课表预览" hidden>
  <div id="ocr-review" hidden>
    <p class="small" id="ocr-help"></p>
    <div class="split"><label><span id="ocr-date-label">课表第 1 周的周一</span><input id="ocr-week" type="date" value="${startDate}"></label>
    <label id="ocr-end-label">默认最后一周<input id="ocr-end" type="number" min="1" max="30" value="16"></label></div>
    <div id="ocr-rows"></div>
    <div class="row"><button type="button" id="ocr-add">＋ 补一门</button><button type="submit" id="ocr-save" class="primary">加入我的日历</button></div>
  </div>
  <div class="error" id="ocr-error" role="alert"></div></form>`);
  const get=id=>overlay.querySelector('#'+id);
  const input=get('ocr-file'), preview=get('ocr-preview');
  const status=get('ocr-status'), message=get('ocr-error'), review=get('ocr-review');
  let previewUrl='', weekOnly=false, cardProgress=false;
  dialog.addEventListener('close',()=>{
    closed=true;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    if(worker)void worker.terminate();
  },{once:true});
  input.onchange=()=>{
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=input.files[0]?URL.createObjectURL(input.files[0]):'';
    preview.src=previewUrl;
    preview.hidden=!previewUrl;
    rows.length=0;review.hidden=true;status.textContent='';message.textContent='';
  };
  function drawRows(){
    const list=get('ocr-rows');list.replaceChildren();
    rows.forEach((row,index)=>{
      const box=document.createElement('fieldset');
      box.className='ocr-row';
      const legend=document.createElement('legend');legend.textContent='课程 '+(index+1);
      box.append(legend);
      function field(label,key,type) {
        const wrapper=document.createElement('label');wrapper.textContent=label;
        const el=document.createElement(type==='select'?'select':'input');
        if(type==='select'){
          labels.forEach((name,i)=>el.append(new Option(name,i)));
        }else{
          el.type=type;
          if(type==='number'){el.min='1';el.max='30';}
          if(type==='text')el.maxLength=100;
        }
        el.value=row[key]??'';
        el.oninput=()=>{row[key]=el.value;};
        wrapper.append(el);box.append(wrapper);
      }
      field('课程名称','title','text');field('上课地点','location','text');field('星期','day','select');field('开始','start','time');
      field('结束','end','time');
      if(!weekOnly){field('起始周','fromWeek','number');field('结束周（可空）','toWeek','number');}
      const remove=document.createElement('button');remove.type='button';remove.className='quiet danger';remove.textContent='移除';
      remove.onclick=()=>{rows.splice(index,1);drawRows();};box.append(remove);
      if(row.flag){const flag=document.createElement('p');flag.className='small ocr-flag';flag.textContent=row.flag;box.append(flag);}
      list.append(box);
    });
    get('ocr-save').disabled=!rows.length;
  }
  get('ocr-add').onclick=()=>{
    if(rows.length>=40){message.textContent='每次最多导入 40 门课程';return;}
    rows.push({title:'',day:0,start:'',end:'',fromWeek:1,toWeek:null});drawRows();
  };
  get('ocr-start').onclick=async()=>{
    const file=input.files[0];message.textContent='';
    if(!file){message.textContent='请先选择图片';return;}
    if(file.size>12*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){message.textContent='请选择 12 MB 以内的 PNG、JPG 或 WebP 图片';return;}
    if(busy)return;
    busy=true;weekOnly=false;cardProgress=false;get('ocr-start').disabled=true;input.disabled=true;review.hidden=true;
    status.textContent='正在加载中文识图模型，首次可能需要一两分钟…';
    try {
      const result=await recognize(file,m=>{
        if(!cardProgress&&m.status==='recognizing text')status.textContent='正在识别 '+Math.round(m.progress*100)+'%';
      },w=>{worker=w;if(closed&&w)void w.terminate();},startDate,(i,total)=>{
        cardProgress=true;status.textContent='正在识别课程块 '+i+'/'+total;
      });
      if(closed)return;
      weekOnly=Boolean(result.weekOnly);
      get('ocr-date-label').textContent=weekOnly?'截图所示周的周一':'课表第 1 周的周一';
      get('ocr-week').value=result.date||(weekOnly?'':startDate);
      get('ocr-end-label').hidden=weekOnly;
      get('ocr-help').textContent=weekOnly
        ?(result.date?'已从表头匹配日期。':'未能从表头确认日期，请先选择截图所示周的周一。')+' 只导入截图这一周。请核对课名和地点。'
        :'请核对课程名、地点、上课时间和周次。按节次识别的时间可按学校作息表修改。';
      rows.splice(0,rows.length,...result.rows.slice(0,40));
      status.textContent=rows.length?'识别到 '+rows.length+' 条候选课程':'没读出课程，请换清晰截图或补填';
      review.hidden=false;drawRows();
    } catch(e) {
      if(!closed){status.textContent='';message.textContent=e.message||'识图失败，请换一张清晰截图';review.hidden=false;drawRows();}
    } finally {
      if(!closed){busy=false;get('ocr-start').disabled=false;input.disabled=false;}
    }
  };
  get('timetable-form').onsubmit=async e=>{
    e.preventDefault();message.textContent='';
    const button=get('ocr-save');button.disabled=true;
    try { await onSave(toCalendar(rows,get('ocr-week').value,get('ocr-end').value,weekOnly)); }
    catch(err){message.textContent=err.message;button.disabled=false;}
  };
}
