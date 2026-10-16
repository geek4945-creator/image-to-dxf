"use strict";
const $ = id => document.getElementById(id);
const S = {id:null, W:0, H:0, paths:[], items:[], selected:new Set(), cells:new Set(), areas:[], mask:null,
           tool:'contour', hl:null, drag:null, seq:0, areaN:0};
const NUM = ['threshold','blur','speckle','tolerance','min_feature','width'];
const BOOL = ['auto','invert','holes','drop_frame'];

function setStatus(t, err){ const s=$('status'); s.textContent=t; s.className='status'+(err?' err':''); }
function params(){
  const p={unit:$('unit').value};
  NUM.forEach(k=>p[k]=parseFloat($(k).value)); BOOL.forEach(k=>p[k]=$(k).checked); return p;
}

// ---------- sources
document.querySelectorAll('#srcTabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#srcTabs button').forEach(x=>x.classList.toggle('on',x===b));
  ['file','url','cam'].forEach(t=>$('tab-'+t).hidden=(t!==b.dataset.tab));
  if(b.dataset.tab!=='cam') camStop();
});
async function loadFromResponse(r){
  const j=await r.json(); if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
  Object.assign(S,{id:j.id,W:j.width,H:j.height,paths:[],items:[],selected:new Set(),cells:new Set(),areas:[],mask:null});
  $('empty').style.display='none'; $('svg').style.display='block';
  setStatus(`Loaded ${j.width}×${j.height}px`); await retrace(true);
}
async function sendFile(f){
  try{ setStatus('Uploading…'); const fd=new FormData(); fd.append('file',f,f.name||'capture.png');
    await loadFromResponse(await fetch('/api/upload',{method:'POST',body:fd})); }
  catch(e){ setStatus(e.message,true); }
}
const drop=$('drop');
$('fileIn').onchange=e=>e.target.files[0]&&sendFile(e.target.files[0]);
['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
document.addEventListener('drop',e=>{const f=e.dataTransfer.files[0]; if(f) sendFile(f);});
$('urlGo').onclick=async()=>{
  try{ setStatus('Fetching…');
    await loadFromResponse(await fetch('/api/fetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('urlIn').value})})); }
  catch(e){ setStatus(e.message,true); }
};
let stream=null;
async function camStart(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920}},audio:false});
    $('video').srcObject=stream; await $('video').play();
    $('camShot').disabled=false; $('camStop').disabled=false; setStatus('Camera on');
  }catch(e){ setStatus('Camera unavailable: '+e.message+' (needs HTTPS or localhost)',true); }
}
function camStop(){ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;} $('video').srcObject=null; $('camShot').disabled=true; $('camStop').disabled=true; }
$('camStart').onclick=camStart; $('camStop').onclick=camStop;
$('camShot').onclick=()=>{
  const v=$('video'); if(!v.videoWidth) return;
  const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext('2d').drawImage(v,0,0); c.toBlob(b=>sendFile(new File([b],'capture.png',{type:'image/png'})),'image/png');
};

// ---------- tracing
let timer=null;
function schedule(){ clearTimeout(timer); timer=setTimeout(()=>retrace(false),150); }
async function retrace(first){
  if(!S.id) return; const seq=++S.seq;
  try{
    const r=await fetch('/api/trace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:S.id,params:params(),mask:true})});
    const j=await r.json(); if(!r.ok) throw new Error(j.error);
    if(seq!==S.seq) return;
    const changed = j.paths.length!==S.paths.length;
    S.paths=j.paths; S.items=j.info.items; S.mask=j.mask; S.info=j.info;
    if(first||changed) S.selected=new Set(S.paths.map((_,i)=>i));   // ids are positional: reset when the set changes
    else S.selected=new Set([...S.selected].filter(i=>i<S.paths.length));
    $('info').textContent=`${j.info.paths} contours · ${j.info.vertices} vertices · ${j.info.width}×${j.info.height} ${j.info.unit} · ${j.info.dropped} dropped`;
    $('heightNote').textContent=`× ${j.info.height} ${j.info.unit}`;
    setStatus('Traced'); renderAll();
  }catch(e){ setStatus(e.message,true); }
}
NUM.concat(BOOL,['unit']).forEach(k=>{
  const el=$(k); el.addEventListener('input',()=>{ const o=$('o_'+k); if(o) o.textContent=el.value; if(k==='unit') document.querySelectorAll('.u').forEach(u=>u.textContent=el.value); schedule(); renderGrid(); });
});

// ---------- grid
function gridDims(){
  if(!S.W) return {rows:0,cols:0,cw:0,ch:0};
  if($('gridMode').value==='count'){
    const rows=Math.max(1,parseInt($('rows').value)||1), cols=Math.max(1,parseInt($('cols').value)||1);
    return {rows,cols,cw:S.W/cols,ch:S.H/rows};
  }
  const scale=(parseFloat($('width').value)||1)/S.W;                // units per px
  const px=Math.max(1,(parseFloat($('cell').value)||1)/scale);
  return {rows:Math.min(200,Math.ceil(S.H/px)),cols:Math.min(200,Math.ceil(S.W/px)),cw:px,ch:px};
}
function cellRect(r,c){ const g=gridDims(); return [c*g.cw,r*g.ch,Math.min(S.W,(c+1)*g.cw),Math.min(S.H,(r+1)*g.ch)]; }
const cellLabel=(r,c)=>`R${r+1}C${c+1}`;
['gridOn','gridMode','rows','cols','cell'].forEach(k=>$(k).addEventListener('input',()=>{
  $('gridCount').hidden=$('gridMode').value!=='count'; $('gridSize').hidden=$('gridMode').value!=='size';
  S.cells=new Set(); renderAll(); }));
document.querySelectorAll('input[name=tool]').forEach(r=>r.onchange=()=>{S.tool=r.value; if(r.value==='cell'&&!$('gridOn').checked){$('gridOn').checked=true;} renderAll();});
$('clearAreas').onclick=()=>{S.cells=new Set();S.areas=[];renderAll();};
$('allCells').onclick=()=>{const g=gridDims(); for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++)S.cells.add(r+','+c); $('gridOn').checked=true; renderAll();};
function regions(){
  const out=[]; S.cells.forEach(k=>{const [r,c]=k.split(',').map(Number); out.push({rect:cellRect(r,c),label:cellLabel(r,c)});});
  S.areas.forEach(a=>out.push({rect:a.rect,label:a.label})); return out;
}

// ---------- rendering
const NS='http://www.w3.org/2000/svg';
function renderAll(){ renderSvg(); renderList(); renderNotes(); }
function renderGrid(){ if(S.id) renderSvg(); }
function renderSvg(){
  const svg=$('svg'); if(!S.id){return;}
  svg.setAttribute('viewBox',`0 0 ${S.W} ${S.H}`); svg.style.width=Math.min(S.W,1400)+'px'; svg.style.aspectRatio=`${S.W}/${S.H}`;
  let h='';
  if($('showImg').checked) h+=`<image href="/api/image/${S.id}" width="${S.W}" height="${S.H}"/>`;
  if($('showMask').checked && S.mask) h+=`<image href="${S.mask}" width="${S.W}" height="${S.H}" opacity=".6" style="mix-blend-mode:multiply"/>`;
  // selected cells + areas under vectors
  S.cells.forEach(k=>{const [r,c]=k.split(',').map(Number),[x0,y0,x1,y1]=cellRect(r,c); h+=`<rect class="cell" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/>`;});
  S.areas.forEach(a=>{const [x0,y0,x1,y1]=a.rect; h+=`<rect class="area" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/><text class="lbl" x="${x0+4}" y="${y0+14}">${a.label}</text>`;});
  if($('showVec').checked){
    const order=S.paths.map((_,i)=>i).sort((a,b)=>S.items[b].area-S.items[a].area);   // big first, small (holes) on top
    for(const i of order){
      const cls='c'+(S.selected.has(i)?'':' off')+(S.hl===i?' hl':'');
      h+=`<polygon class="${cls}" data-id="${i}" points="${S.paths[i].map(p=>p.join(',')).join(' ')}"/>`;
    }
  }
  if($('gridOn').checked){
    const g=gridDims(); let d='';
    for(let c=1;c<g.cols;c++) d+=`M${c*g.cw} 0V${S.H}`; for(let r=1;r<g.rows;r++) d+=`M0 ${r*g.ch}H${S.W}`;
    h+=`<path class="g" d="${d}" style="pointer-events:none"/>`;
    const fs=Math.max(8,Math.min(g.cw,g.ch)/6,0)>S.W/45?S.W/45:Math.max(8,Math.min(g.cw,g.ch)/6);
    if(g.rows*g.cols<=400) for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++) h+=`<text class="lbl" style="font-size:${fs}px;opacity:.6" x="${c*g.cw+3}" y="${r*g.ch+fs+1}">${cellLabel(r,c)}</text>`;
  }
  if(S.drag){const [x0,y0,x1,y1]=normRect(S.drag); h+=`<rect class="area" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/>`;}
  svg.innerHTML=h;
}
['showImg','showMask','showVec'].forEach(k=>$(k).onchange=renderSvg);
function renderList(){
  const ul=$('list'); const MAX=1500; let h='';
  S.items.slice(0,MAX).forEach(it=>{
    const on=S.selected.has(it.id);
    h+=`<li data-id="${it.id}" class="${on?'':'off'}"><input type="checkbox" ${on?'checked':''} tabindex="-1"><b>#${it.id}</b><span>${it.w}×${it.h}</span><span class="tag">${it.hole?'hole':''}</span></li>`;
  });
  if(S.items.length>MAX) h+=`<li class="off">… ${S.items.length-MAX} more (use select tools)</li>`;
  ul.innerHTML=h;
  $('selCount').textContent=S.items.length?`(${S.selected.size}/${S.items.length})`:'';
}
function renderNotes(){
  const n=regions().length; $('areaNote').textContent=n?`${n} area(s)`:'no area';
  $('exportNote').textContent=S.items.length?`${S.selected.size} contour(s) selected`+(n&&$('limitArea').checked?`, limited to ${n} area(s)`:''):'';
  $('download').disabled=!S.items.length||!S.selected.size;
}
$('list').addEventListener('click',e=>{const li=e.target.closest('li[data-id]'); if(li){toggle(+li.dataset.id);}});
$('list').addEventListener('mouseover',e=>{const li=e.target.closest('li[data-id]'); const id=li?+li.dataset.id:null; if(id!==S.hl){S.hl=id; renderSvg();}});
$('list').addEventListener('mouseleave',()=>{S.hl=null;renderSvg();});
function toggle(i){ S.selected.has(i)?S.selected.delete(i):S.selected.add(i); renderAll(); }
$('selAll').onclick=()=>{S.selected=new Set(S.paths.map((_,i)=>i));renderAll();};
$('selNone').onclick=()=>{S.selected=new Set();renderAll();};
$('selInv').onclick=()=>{S.selected=new Set(S.paths.map((_,i)=>i).filter(i=>!S.selected.has(i)));renderAll();};
$('selArea').onclick=()=>{
  const rs=regions().map(r=>r.rect); if(!rs.length) return setStatus('Draw a region or click grid cells first',true);
  S.selected=new Set(S.paths.map((_,i)=>i).filter(i=>{
    const xs=S.paths[i].map(p=>p[0]),ys=S.paths[i].map(p=>p[1]);
    const bx0=Math.min(...xs),bx1=Math.max(...xs),by0=Math.min(...ys),by1=Math.max(...ys);
    return rs.some(([x0,y0,x1,y1])=>bx0<x1&&bx1>x0&&by0<y1&&by1>y0);}));
  renderAll();
};
['limitArea','clip'].forEach(k=>$(k).onchange=renderNotes);

// ---------- pointer interaction on preview
function pt(e){ const svg=$('svg'); const p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY; const q=p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0,Math.min(S.W,q.x)),Math.max(0,Math.min(S.H,q.y))]; }
const normRect=d=>[Math.min(d[0],d[2]),Math.min(d[1],d[3]),Math.max(d[0],d[2]),Math.max(d[1],d[3])];
const svgEl=$('svg');
svgEl.addEventListener('pointerdown',e=>{
  if(!S.id) return; const [x,y]=pt(e);
  if(S.tool==='region'){ S.drag=[x,y,x,y]; svgEl.setPointerCapture(e.pointerId); }
  else if(S.tool==='cell'){
    const g=gridDims(); const c=Math.min(g.cols-1,Math.floor(x/g.cw)), r=Math.min(g.rows-1,Math.floor(y/g.ch)); const k=r+','+c;
    S.cells.has(k)?S.cells.delete(k):S.cells.add(k); renderAll();
  } else if(S.tool==='contour'){
    const id=e.target.dataset&&e.target.dataset.id; if(id!==undefined) toggle(+id);
  }
});
svgEl.addEventListener('pointermove',e=>{
  if(S.drag){ const [x,y]=pt(e); S.drag[2]=x; S.drag[3]=y; renderSvg(); return; }
  if(S.tool==='contour'){ const id=e.target.dataset&&e.target.dataset.id; const n=id!==undefined?+id:null; if(n!==S.hl){S.hl=n; renderSvg();} }
});
svgEl.addEventListener('pointerup',()=>{
  if(!S.drag) return; const r=normRect(S.drag); S.drag=null;
  if(r[2]-r[0]>3&&r[3]-r[1]>3){ S.areaN++; S.areas.push({rect:r,label:'AREA'+S.areaN}); }
  renderAll();
});

// ---------- export
$('download').onclick=async()=>{
  const limit=$('limitArea').checked;
  const body={id:S.id,params:params(),selected:[...S.selected].sort((a,b)=>a-b),regions:limit?regions():[],
              clip:$('clip').checked,split:$('split').value,group_by:$('groupBy').value,zero_origin:$('zero').checked};
  try{
    setStatus('Building DXF…');
    const r=await fetch('/api/dxf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){ throw new Error((await r.json()).error||('HTTP '+r.status)); }
    const m=/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition')||''); const b=await r.blob();
    const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=m?m[1]:'cut.dxf'; a.click(); URL.revokeObjectURL(a.href);
    setStatus(`Downloaded ${a.download} (${r.headers.get('X-Paths')} paths, ${r.headers.get('X-Groups')} group(s))`);
  }catch(e){ setStatus(e.message,true); }
};
