"use strict";
const $ = id => document.getElementById(id);
const S = {id:null, gray:null, imgURL:null, maskURL:null, W:0, H:0, paths:[], items:[], selected:new Set(), cells:new Set(), areas:[], mask:null,
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
const T=window.I2D_TRACE, D=window.I2D_DXF;
const BADFMT='This browser cannot decode that file. Supported: PNG, JPG, BMP, WebP, GIF, AVIF, SVG. For TIFF or PDF, convert to PNG/JPG first (or use the Python/Windows edition, which reads them).';
async function decodeBlob(b){
  if(/pdf/i.test(b.type)||/\.pdf$/i.test(b.name||'')) throw new Error('PDF is not supported in the browser edition: export/screenshot the page as PNG or JPG and upload that.');
  if(window.createImageBitmap){ try{ return await createImageBitmap(b); }catch(e){} }
  return await new Promise((res,rej)=>{ const u=URL.createObjectURL(b), im=new Image(); im.onload=()=>{URL.revokeObjectURL(u);res(im);}; im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error(BADFMT));}; im.src=u; });
}
async function loadBlob(b){
  const img=await decodeBlob(b); const w0=img.width||img.naturalWidth, h0=img.height||img.naturalHeight;
  if(!w0||!h0) throw new Error(BADFMT);
  if(w0*h0>60e6) throw new Error('Image too large (>60 megapixels)');
  const c=document.createElement('canvas'); c.width=w0; c.height=h0; const x=c.getContext('2d',{willReadFrequently:true});
  x.fillStyle='#fff'; x.fillRect(0,0,w0,h0); x.drawImage(img,0,0);
  const id=x.getImageData(0,0,w0,h0); let g=T.toGray(id.data,w0,h0); const r=T.limitSize(g,w0,h0);
  const gc=document.createElement('canvas'); gc.width=r.w; gc.height=r.h; const gd=gc.getContext('2d').createImageData(r.w,r.h);
  for(let i=0;i<r.gray.length;i++){ const v=r.gray[i]; gd.data[4*i]=gd.data[4*i+1]=gd.data[4*i+2]=v; gd.data[4*i+3]=255; }
  gc.getContext('2d').putImageData(gd,0,0);
  if(S.imgURL) URL.revokeObjectURL(S.imgURL);
  S.imgURL=URL.createObjectURL(await new Promise(res=>gc.toBlob(res,'image/png')));
  Object.assign(S,{id:'img'+(++S.seq),gray:r.gray,W:r.w,H:r.h,paths:[],items:[],selected:new Set(),cells:new Set(),areas:[],mask:null,maskURL:null});
  $('empty').style.display='none'; $('svg').style.display='block';
  setStatus(`Loaded ${r.w}×${r.h}px`+(r.w!==w0?` (downscaled from ${w0}×${h0})`:'')); await retrace(true);
}
async function sendFile(f){
  try{ setStatus('Loading…'); await loadBlob(f); }
  catch(e){ setStatus(e.message,true); }
}
const drop=$('drop');
$('fileIn').onchange=e=>e.target.files[0]&&sendFile(e.target.files[0]);
['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
document.addEventListener('drop',e=>{const f=e.dataTransfer.files[0]; if(f) sendFile(f);});
$('urlGo').onclick=async()=>{
  const url=$('urlIn').value.trim(); if(!url) return setStatus('Enter an image URL first',true);
  try{
    setStatus('Fetching…'); let r;
    try{ r=await fetch(url,{mode:'cors',credentials:'omit'}); }
    catch(e){ throw new Error('The browser blocked this download (the site does not allow cross-origin access, i.e. CORS, or it is offline). Save the image to your computer (right-click → Save image as…) and upload it instead.'); }
    if(!r.ok) throw new Error('Server answered HTTP '+r.status+'. Check the link, or download the image and upload it instead.');
    const b=await r.blob(); if(b.size>25*1024*1024) throw new Error('File too large (limit 25 MB)');
    await loadBlob(b.type?b:new Blob([b],{type:'image/*'}));
  }catch(e){ setStatus(e.message,true); }
};
let stream=null;
async function camStart(){
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('not supported (needs HTTPS or localhost)');
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920}},audio:false});
    const v=$('video'); v.setAttribute('playsinline',''); v.muted=true; v.srcObject=stream; await v.play();
    $('camShot').disabled=false; $('camStop').disabled=false; setStatus('Camera on');
  }catch(e){ setStatus('Camera unavailable: '+e.message+' (needs HTTPS or localhost)',true); }
}
function camStop(){ if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;} $('video').srcObject=null; $('camShot').disabled=true; $('camStop').disabled=true; }
$('camStart').onclick=camStart; $('camStop').onclick=camStop;
$('phoneShot').onclick=()=>$('phoneIn').click();
$('phoneIn').onchange=e=>{const f=e.target.files[0]; if(f) sendFile(f); e.target.value='';};
$('pasteBtn').onclick=async()=>{
  try{ const items=await navigator.clipboard.read(); for(const it of items){ const t=it.types.find(x=>x.startsWith('image/')); if(t) return sendFile(await it.getType(t)); } setStatus('No image on the clipboard',true); }
  catch(e){ setStatus('Clipboard not available here: press Ctrl+V on the page, or upload a file',true); }
};
document.addEventListener('paste',e=>{ const f=[...(e.clipboardData?e.clipboardData.files:[])][0]; if(f) sendFile(f); });
$('camShot').onclick=()=>{
  const v=$('video'); if(!v.videoWidth) return;
  const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext('2d').drawImage(v,0,0); c.toBlob(b=>sendFile(new File([b],'capture.png',{type:'image/png'})),'image/png');
};

// ---------- tracing
let timer=null;
function schedule(){ clearTimeout(timer); timer=setTimeout(()=>retrace(false),150); }
async function retrace(first){
  if(!S.gray) return; const seq=++S.seq; setStatus('Tracing…');
  await new Promise(r=>setTimeout(r,0)); if(seq!==S.seq) return;
  try{
    const t0=performance.now(); const r=T.trace(S.gray,S.W,S.H,params());
    if(seq!==S.seq) return;
    const changed = r.polys.length!==S.paths.length;
    S.paths=r.polys; S.items=r.items; S.mask=r.mask; S.maskURL=null; S.info=r.info;
    if(first||changed) S.selected=new Set(S.paths.map((_,i)=>i));   // ids are positional: reset when the set changes
    else S.selected=new Set([...S.selected].filter(i=>i<S.paths.length));
    $('info').textContent=`${r.info.paths} contours · ${r.info.vertices} vertices · ${r.info.width}×${r.info.height} ${r.info.unit} · ${r.info.dropped} dropped`;
    $('heightNote').textContent=`× ${r.info.height} ${r.info.unit}`;
    setStatus(`Traced in ${Math.round(performance.now()-t0)} ms`); renderAll();
  }catch(e){ setStatus(e.message,true); }
}
function maskURL(){
  if(S.maskURL||!S.mask) return S.maskURL;
  const c=document.createElement('canvas'); c.width=S.W; c.height=S.H; const x=c.getContext('2d'), d=x.createImageData(S.W,S.H);
  for(let i=0;i<S.mask.length;i++){ const v=S.mask[i]?0:255; d.data[4*i]=d.data[4*i+1]=d.data[4*i+2]=v; d.data[4*i+3]=255; }
  x.putImageData(d,0,0); return S.maskURL=c.toDataURL('image/png');
}
let curUnit='mm';
function convertUnits(){            // keep sizes physically the same when switching mm <-> in
  const u=$('unit').value; if(u===curUnit) return; const f=u==='in'?1/25.4:25.4;
  const fmt=v=>String(+v.toPrecision(4));
  [['width',0],['tolerance',1],['min_feature',1],['cell',0]].forEach(([k,slider])=>{
    const el=$(k), v=parseFloat(el.value)*f;
    if(slider){ const cfg={tolerance:{mm:[5,0.05],in:[0.2,0.001]},min_feature:{mm:[50,0.5],in:[2,0.01]}}[k][u]; el.max=cfg[0]; el.step=cfg[1]; el.value=Math.min(cfg[0],v); const o=$('o_'+k); if(o) o.textContent=el.value; }
    else el.value=fmt(v);
  });
  curUnit=u;
}
NUM.concat(BOOL,['unit']).forEach(k=>{
  const el=$(k); el.addEventListener('input',()=>{ if(k==='unit') convertUnits(); const o=$('o_'+k); if(o) o.textContent=el.value; if(k==='unit') document.querySelectorAll('.u').forEach(u=>u.textContent=el.value); schedule(); renderGrid(); });
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
function renderGrid(){ if(S.gray) renderSvg(); }
function renderSvg(){
  const svg=$('svg'); if(!S.gray){return;}
  svg.setAttribute('viewBox',`0 0 ${S.W} ${S.H}`); svg.style.width=Math.min(S.W,1400)+'px'; svg.style.aspectRatio=`${S.W}/${S.H}`;
  let h='';
  if($('showImg').checked) h+=`<image href="${S.imgURL}" width="${S.W}" height="${S.H}"/>`;
  if($('showMask').checked && S.mask) h+=`<image href="${maskURL()}" width="${S.W}" height="${S.H}" opacity=".6" style="mix-blend-mode:multiply"/>`;
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
  S.selected=new Set(S.items.filter(it=>{const [bx0,by0,bx1,by1]=it.bbox; return rs.some(([x0,y0,x1,y1])=>bx0<x1&&bx1>x0&&by0<y1&&by1>y0);}).map(it=>it.id));
  renderAll();
};
['limitArea','clip'].forEach(k=>$(k).onchange=renderNotes);

// ---------- pointer interaction on preview
function pt(e){ const svg=$('svg'); const p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY; const q=p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0,Math.min(S.W,q.x)),Math.max(0,Math.min(S.H,q.y))]; }
const normRect=d=>[Math.min(d[0],d[2]),Math.min(d[1],d[3]),Math.max(d[0],d[2]),Math.max(d[1],d[3])];
const svgEl=$('svg');
svgEl.addEventListener('pointerdown',e=>{
  if(!S.gray) return; const [x,y]=pt(e);
  if(S.tool==='region'){ S.drag=[x,y,x,y]; svgEl.setPointerCapture(e.pointerId); }
  else if(S.tool==='cell'){
    const g=gridDims(); const c=Math.min(g.cols-1,Math.floor(x/g.cw)), r=Math.min(g.rows-1,Math.floor(y/g.ch)); const k=r+','+c;
    S.cells.has(k)?S.cells.delete(k):S.cells.add(k); renderAll();
  } else if(S.tool==='contour'){
    const id=e.target.dataset&&e.target.dataset.id; if(id!==undefined) toggle(+id);
  }
});
svgEl.addEventListener('pointercancel',()=>{ if(S.drag){S.drag=null; renderSvg();} });
svgEl.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'&&!S.drag) return;   // no hover highlight on touch
  if(S.drag){ const [x,y]=pt(e); S.drag[2]=x; S.drag[3]=y; renderSvg(); return; }
  if(S.tool==='contour'){ const id=e.target.dataset&&e.target.dataset.id; const n=id!==undefined?+id:null; if(n!==S.hl){S.hl=n; renderSvg();} }
});
svgEl.addEventListener('pointerup',e=>{
  if(!S.drag) return; const r=normRect(S.drag); S.drag=null;
  if(r[2]-r[0]>3&&r[3]-r[1]>3){ S.areaN++; S.areas.push({rect:r,label:'AREA'+S.areaN}); }
  renderAll();
});

// ---------- export (all in the browser)
let lastFile=null;
const mkFile=(f,type)=>new File([f.bytes],f.filename,{type:type||f.mime});
function canShareFiles(){
  if(!navigator.share||!navigator.canShare) return false;
  try{ return navigator.canShare({files:[new File([new Uint8Array(1)],'x.dxf',{type:'application/octet-stream'})]}); }catch(e){ return false; }
}
// Share sheet (iOS "Save to Files", AirDrop, ...). Tries the real MIME type first, then a generic one.
async function shareFile(f){
  for(const type of [f.mime,'application/octet-stream']){
    const file=mkFile(f,type);
    try{ if(!navigator.canShare||navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:f.filename}); return true; } }
    catch(e){ if(e&&e.name==='AbortError') return true; }   // user dismissed the sheet
  }
  return false;
}
// Blob link first (works in iOS Safari 13+); share sheet as fallback when the download attribute is unsupported or the click throws.
async function saveFile(f){
  const a=document.createElement('a');
  if(!('download' in a)){ if(await shareFile(f)) return 'share'; throw new Error('Could not start the download in this browser. Try a desktop browser.'); }
  try{
    a.href=URL.createObjectURL(new Blob([f.bytes],{type:f.mime})); a.download=f.filename; a.rel='noopener'; a.style.display='none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),60000);
    return 'download';
  }catch(e){ if(await shareFile(f)) return 'share'; throw e; }
}
$('share').onclick=async()=>{ if(!lastFile) return; const ok=await shareFile(lastFile); setStatus(ok?`Shared ${lastFile.filename}`:'Sharing is not available here: use Download DXF',!ok); };
$('download').onclick=async()=>{
  const limit=$('limitArea').checked, p=params();
  try{
    setStatus('Building DXF…'); await new Promise(r=>setTimeout(r,0));
    if(!S.paths.length) throw new Error('Nothing to export: no shapes found with these settings');
    const r=await D.exportDxf(S.paths,{pxW:S.W,pxH:S.H,scale:p.width/S.W,unit:p.unit,selected:[...S.selected].sort((a,b)=>a-b),
      regions:limit?regions():[],clip:$('clip').checked,split:$('split').value,groupBy:$('groupBy').value,zeroOrigin:$('zero').checked});
    lastFile={bytes:r.bytes,mime:r.mime,filename:r.filename};
    const how=await saveFile(lastFile);
    setStatus(`${how==='share'?'Shared':'Downloaded'} ${r.filename} (${r.paths} paths, ${r.groups} group(s))`);
    if(canShareFiles()) $('share').hidden=false;
    window.__lastExport={filename:r.filename,paths:r.paths,groups:r.groups};
  }catch(e){ setStatus(e.message,true); }
};
