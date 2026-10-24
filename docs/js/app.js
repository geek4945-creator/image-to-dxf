"use strict";
const $ = id => document.getElementById(id);
const S = {id:null, gray:null, W:0, H:0, fullGray:null, fullW:0, fullH:0, crop:null, cropSel:null, imgURL:null, fullURL:null, cropURL:null, maskURL:null,
           paths:[], items:[], selected:new Set(), cells:new Set(), areas:[], zones:[], zoneN:0, zsel:null, tabbed:new Set(), mask:null, plan:null,
           tool:'contour', hl:null, drag:null, edit:null, seq:0, areaN:0, loadTok:0, undo:[], redo:[], lines:[], edits:0, rs:null, sec:null};
window.__i2d = {S, dxfExtents:()=>dxfExtents(), exportBox:()=>exportBox(), refresh:()=>renderAll()};   // read-only debug/test hook
const NUM = ['threshold','blur','speckle','tolerance','min_feature'];
const BOOL = ['auto','invert','holes','drop_frame'];

function setStatus(t, err){ const s=$('status'); s.textContent=t; s.className='status'+(err?' err':''); }
const fmt=(v,d=6)=>String(+Number(v).toPrecision(d));
function params(){
  const sc=computeScale(); const p={unit:$('unit').value, scale:sc.sx, scaleY:sc.sy, width:sc.sx*(S.W||1)};
  NUM.forEach(k=>p[k]=parseFloat($(k).value)); BOOL.forEach(k=>p[k]=$(k).checked);
  if(assessOn()){                         // crop-local settings replace the global processing sliders
    const avg=Math.sqrt((sc.sx*sc.sy)||1);
    Object.assign(p,{auto:$('asAuto').checked,threshold:+$('asThr').value,invert:$('asInvert').checked,blur:+$('asBlur').value,speckle:+$('asSpeckle').value,tolerance:+$('asSimp').value*avg,min_feature:+$('asMin').value*avg});
  }
  return p;
}
const assessOn=()=>!!S.crop&&$('asOn').checked;
function traceGray(){                       // source pixels for tracing (optionally contrast-stretched for dim crops)
  if(assessOn()&&$('asNorm').checked){ if(S._st&&S._st.src===S.gray) return S._st.g; const g=T.stretch(S.gray); S._st={src:S.gray,g}; return g; }
  return S.gray;
}
// image-derived state (reset when an image is loaded or cleared)
function resetState(){
  Object.assign(S,{paths:[],items:[],selected:new Set(),cells:new Set(),areas:[],areaN:0,zones:[],zoneN:0,zsel:null,tabbed:new Set(),crop:null,cropSel:null,
    mask:null,maskURL:null,hl:null,drag:null,edit:null,plan:null,info:null,undo:[],redo:[],edits:0,rs:null,sec:null,lines:[],vb:null});
}
function revokeImageURLs(){ [S.fullURL,S.cropURL].forEach(u=>{ if(u) URL.revokeObjectURL(u); }); S.fullURL=S.cropURL=S.imgURL=null; }

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
async function grayURL(gray,w,h){
  const gc=document.createElement('canvas'); gc.width=w; gc.height=h; const gd=gc.getContext('2d').createImageData(w,h);
  for(let i=0;i<gray.length;i++){ const v=gray[i]; gd.data[4*i]=gd.data[4*i+1]=gd.data[4*i+2]=v; gd.data[4*i+3]=255; }
  gc.getContext('2d').putImageData(gd,0,0);
  return URL.createObjectURL(await new Promise(res=>gc.toBlob(res,'image/png')));
}
async function loadBlob(b){
  const tok=++S.loadTok;
  const img=await decodeBlob(b); const w0=img.width||img.naturalWidth, h0=img.height||img.naturalHeight;
  if(!w0||!h0) throw new Error(BADFMT);
  if(w0*h0>60e6) throw new Error('Image too large (>60 megapixels)');
  const c=document.createElement('canvas'); c.width=w0; c.height=h0; const x=c.getContext('2d',{willReadFrequently:true});
  x.fillStyle='#fff'; x.fillRect(0,0,w0,h0); x.drawImage(img,0,0);
  const id=x.getImageData(0,0,w0,h0); let g=T.toGray(id.data,w0,h0); const r=T.limitSize(g,w0,h0);
  const url=await grayURL(r.gray,r.w,r.h);
  if(tok!==S.loadTok){ URL.revokeObjectURL(url); return; }      // cleared / replaced while decoding
  revokeImageURLs(); resetState();
  Object.assign(S,{id:'img'+(++S.seq),gray:r.gray,W:r.w,H:r.h,fullGray:r.gray,fullW:r.w,fullH:r.h,fullURL:url,imgURL:url});
  $('empty').style.display='none'; $('svg').style.display='block';
  syncSize(); renderCrop();
  setStatus(`Loaded ${r.w}×${r.h}px`+(r.w!==w0?` (downscaled from ${w0}×${h0})`:'')); await retrace(true);
  if(window.I2D_onLoad) try{ I2D_onLoad(b); }catch(e){ console.error(e); }
}
async function sendFile(f){
  try{ setStatus('Loading…'); await loadBlob(f); }
  catch(e){ setStatus(e.message,true); }
}
const drop=$('drop');
$('fileIn').onchange=e=>{ if(e.target.files[0]) sendFile(e.target.files[0]); };
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

// ---------- clear image
function clearImage(){
  S.loadTok++; S.seq++; clearTimeout(timer); camStop();
  revokeImageURLs(); resetState();
  if(dlURL){ URL.revokeObjectURL(dlURL); dlURL=null; }
  Object.assign(S,{id:null,gray:null,fullGray:null,W:0,H:0,fullW:0,fullH:0,tool:'contour'});
  $('gridOn').checked=false; document.querySelector('input[name=tool][value=contour]').checked=true;
  ['fileIn','phoneIn'].forEach(k=>{ $(k).value=''; });
  $('svg').innerHTML=''; $('svg').style.display='none'; $('empty').style.display='';
  lastFile=null; $('share').hidden=true; $('info').textContent=''; $('dxfCheck').textContent=''; window.__lastExport=null;
  syncSize(); renderAll(); setStatus('Image cleared. Load an image to begin');
}
$('clearImg').onclick=clearImage;

// ---------- tracing
let timer=null;
function schedule(){ clearTimeout(timer); timer=setTimeout(()=>retrace(false),150); }
async function retrace(first){
  if(!S.gray) return; const seq=++S.seq; setStatus('Tracing…');
  await new Promise(r=>setTimeout(r,0)); if(seq!==S.seq) return;
  if(!(params().scale>0&&params().scaleY>0)) return setStatus('Enter a positive output size',true);
  try{
    const t0=performance.now(); let r; const hadEdits=S.edits>0&&!first;
    // Tolerance / min-feature are in output units, and the output scale depends on the traced shapes' box, so settle it (max 3 passes).
    for(let pass=0;;pass++){
      const p=params(); r=T.trace(traceGray(),S.W,S.H,p);
      if(seq!==S.seq) return;
      const changed = r.polys.length!==S.paths.length;
      S.paths=r.polys; S.items=r.items; S.mask=r.mask; S.maskURL=null; S.info=r.info;
      if(first||changed){ S.selected=new Set(S.paths.map((_,i)=>i)); S.tabbed=new Set(); }   // ids are positional: reset when the set changes
      else { S.selected=new Set([...S.selected].filter(i=>i<S.paths.length)); S.tabbed=new Set([...S.tabbed].filter(i=>i<S.paths.length)); }
      const sc=computeScale();
      if(pass>=2||!sc.ok||(Math.abs(sc.sx/p.scale-1)<0.02&&Math.abs(sc.sy/p.scaleY-1)<0.02)) break;
    }
    S.undo=[]; S.redo=[]; S.edits=0; S.rs=null; S.lines=(S.lines||[]).filter(l=>l.drawn); renderUndo();
    setStatus(`Traced in ${Math.round(performance.now()-t0)} ms`+(hadEdits?' · merge / re-scan / contour edits were discarded by the re-trace (drawn lines are kept)':'')); renderAll();
    const e=dxfExtents(), u=$('unit').value;
    $('info').textContent=`${r.info.paths} contours · ${r.info.vertices} vertices`+(e?` · DXF ${fmt(e.w,5)}×${fmt(e.h,5)} ${u}`:'')+` · ${r.info.dropped} dropped`;
  }catch(e){ setStatus(e.message,true); }
}
function maskURL(){
  if(S.maskURL||!S.mask) return S.maskURL;
  const c=document.createElement('canvas'); c.width=S.W; c.height=S.H; const x=c.getContext('2d'), d=x.createImageData(S.W,S.H);
  for(let i=0;i<S.mask.length;i++){ const v=S.mask[i]?0:255; d.data[4*i]=d.data[4*i+1]=d.data[4*i+2]=v; d.data[4*i+3]=255; }
  x.putImageData(d,0,0); return S.maskURL=c.toDataURL('image/png');
}

// ---------- output size (units, width/height/scale/PPI, lock aspect)
// The size you enter is measured on a REFERENCE box, chosen with "Width / height refer to":
//   shapes (default) = bounding box of the shapes that will really be in the DXF  -> DXF extents == the entered size
//   image            = the whole image frame (incl. blank margins)  -> DXF shapes are smaller than the entered size
//   full             = the full original image while a crop is active (scale preserved)
const PX_PER_UNIT_100=()=>$('unit').value==='in'?96:96/25.4;      // 100 % = 96 px per inch
const UNIT_PER_INCH=()=>$('unit').value==='in'?1:25.4;
const bbCache=new WeakMap();
function pathBoxes(){
  let b=bbCache.get(S.paths); if(b) return b;
  b=S.paths.map(q=>{ let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for(const [x,y] of q){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } return [x0,y0,x1,y1]; });
  bbCache.set(S.paths,b); return b;
}
let boxKey=null, boxVal=null;
function exportBox(){                // px extents {w,h} of everything that will be written to the DXF (scale independent), or null
  if(!S.paths.length) return null;
  const ids=effectiveSelected(); if(!ids.length) return null;
  const regs=$('limitArea').checked?regions():[], clip=$('clip').checked;
  const key=[S.id,S.W,S.H,S.paths.length,ids.join(),clip,JSON.stringify(regs.map(r=>r.rect))].join('|');
  if(boxKey&&boxKey.k===key&&boxKey.p===S.paths) return boxVal;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  if(!regs.length){ const bb=pathBoxes(); ids.forEach(i=>{ const q=bb[i]; if(q[0]<x0)x0=q[0]; if(q[2]>x1)x1=q[2]; if(q[1]<y0)y0=q[1]; if(q[3]>y1)y1=q[3]; }); }
  else { try{ const pl=D.buildPlan(S.paths,{pxW:S.W,pxH:S.H,scale:1,scaleY:1,selected:ids,regions:regs,clip,split:'none'}); const q=D.entitiesBox(pl.entities); if(q){x0=q[0];y0=q[1];x1=q[2];y1=q[3];} }catch(e){} }
  boxVal=isFinite(x0)&&x1>x0&&y1>y0?{w:x1-x0,h:y1-y0}:null; boxKey={k:key,p:S.paths}; return boxVal;
}
function refName(){ const r=$('sizeRef').value; return r==='full'&&!S.crop?'image':r; }
function refDims(){
  const r=refName();
  if(r==='shapes'){ const b=exportBox(); if(b) return [b.w,b.h]; }
  if(r==='full') return [S.fullW,S.fullH];
  return [S.W||800,S.H||600];
}
function computeScale(){          // output units per image pixel (x and y)
  const mode=$('sizeBy').value, lock=$('lock').checked, [rw,rh]=refDims();
  const W=parseFloat($('width').value), Hh=parseFloat($('height').value), pct=parseFloat($('pct').value), dpi=parseFloat($('dpi').value);
  let sx,sy;
  if(mode==='width'){ sx=W/rw; sy=lock?sx:Hh/rh; }
  else if(mode==='height'){ sy=Hh/rh; sx=lock?sy:W/rw; }
  else if(mode==='percent') sx=sy=pct/100/PX_PER_UNIT_100();
  else sx=sy=UNIT_PER_INCH()/dpi;
  return {sx,sy,ok:sx>0&&sy>0&&isFinite(sx)&&isFinite(sy)};
}
function primaryFields(){         // fields the user is typing in for the current mode: never overwritten by the sync
  const mode=$('sizeBy').value, lock=$('lock').checked;
  return mode==='width'?(lock?['width']:['width','height']):mode==='height'?(lock?['height']:['width','height']):mode==='percent'?['pct']:['dpi'];
}
function writeFields(sc,keep){    // derive every field from a scale pair (output units per px)
  const [rw,rh]=refDims(), vals={width:rw*sc.sx,height:rh*sc.sy,pct:sc.sx*PX_PER_UNIT_100()*100,dpi:UNIT_PER_INCH()/sc.sx};
  Object.keys(vals).forEach(k=>{ if(!keep.includes(k)){ $(k).value=fmt(vals[k],7); $(k).dataset.last=$(k).value; } });
}
let lastSc=null;
// Real extents the DXF will have (output units): measured on the planned entities when tabs/order are active, else shapes box x scale.
function dxfExtents(sc){
  sc=sc||computeScale(); if(!sc.ok||!S.gray) return null;
  if(S.plan){ const q=D.entitiesBox(S.plan.entities); if(q) return {w:q[2]-q[0],h:q[3]-q[1],fromPlan:true}; }
  const b=exportBox(); return b?{w:b.w*sc.sx,h:b.h*sc.sy}:null;
}
const inch=(v,u)=>u==='in'?v:v/25.4, mmv=(v,u)=>u==='in'?v*25.4:v;
function renderSizeOut(sc){
  sc=sc||computeScale(); const o=$('sizeOut'), u=$('unit').value;
  if(!S.gray){ o.textContent='Output size: load an image to see it'; return; }
  if(!sc.ok){ o.textContent='Output size: enter a positive value'; return; }
  const e=dxfExtents(sc), fw=S.W*sc.sx, fh=S.H*sc.sy;
  const f=(w,h)=>`${inch(w,u).toFixed(3)} × ${inch(h,u).toFixed(3)} in (${mmv(w,u).toFixed(2)} × ${mmv(h,u).toFixed(2)} mm)`;
  if(!e){ o.textContent=`Output size: nothing selected. Image frame would be ${f(fw,fh)}`; return; }
  o.textContent=`DXF will measure ${f(e.w,e.h)}`+(S.crop?' – cropped area':'')+` · shapes only; the whole image frame at this scale is ${f(fw,fh)}`
    +(refName()==='shapes'?'':' · ⚠ the size you entered applies to the image frame, so the shapes are smaller (switch "refer to" to the traced shapes to size the cut itself)');
  o.dataset.w=e.w; o.dataset.h=e.h; o.dataset.fw=fw; o.dataset.fh=fh; o.dataset.u=u;
}
function syncSize(except){        // refresh derived fields, editability and the live readout
  const mode=$('sizeBy').value, sc=computeScale(), fullOK=!!S.crop, fo=$('sizeRef').querySelector('option[value=full]');
  $('rowPct').hidden=mode!=='percent'; $('rowDpi').hidden=mode!=='dpi';
  fo.hidden=fo.disabled=!fullOK; if(!fullOK&&$('sizeRef').value==='full') $('sizeRef').value='shapes';
  ['width','height','pct','dpi'].forEach(k=>$(k).readOnly=false);
  if(sc.ok){ writeFields(sc,primaryFields().concat(except||[])); lastSc=sc; }
  renderSizeOut(sc);
}
let curUnit='mm';
function convertUnits(){            // keep sizes physically the same when switching mm <-> in
  const u=$('unit').value; if(u===curUnit) return; const f=u==='in'?1/25.4:25.4;
  [['width',0],['height',0],['tolerance',1],['min_feature',1],['cell',0],['tabW',0],['tabS',0],['mergeTol',0],['tblW',0],['tblH',0],['tblOv',0],['tblParkX',0],['tblParkY',0]].forEach(([k,slider])=>{
    const el=$(k), v=parseFloat(el.value)*f;
    if(slider){ const cfg={tolerance:{mm:[5,0.05],in:[0.2,0.001]},min_feature:{mm:[50,0.5],in:[2,0.01]}}[k][u]; el.max=cfg[0]; el.step=cfg[1]; el.value=Math.min(cfg[0],v); const o=$('o_'+k); if(o) o.textContent=el.value; }
    else{ el.value=fmt(v,7); el.dataset.last=el.value; }
  });
  document.querySelectorAll('input.len').forEach(el=>{ const v=parseFloat(el.value); if(isFinite(v)) el.value=fmt(v*f,7); });   // Hard 1.5 fields (frame, edit, layers, fold)
  curUnit=u; document.querySelectorAll('.u').forEach(x=>x.textContent=u);
}
NUM.concat(BOOL).forEach(k=>{ const el=$(k); el.addEventListener('input',()=>{ const o=$('o_'+k); if(o) o.textContent=el.value; schedule(); renderGrid(); }); });
// Every size field applies immediately (input AND change). Typing in a field makes it the driver: no hidden read-only fields.
const DRIVES={width:'width',height:'height',pct:'percent',dpi:'dpi'};
function onSizeEdit(k){
  const lock=$('lock').checked, mode=$('sizeBy').value;
  if(k==='width'||k==='height'){
    if(mode==='percent'||mode==='dpi'||(lock&&mode!==DRIVES[k])) $('sizeBy').value=DRIVES[k];
  } else $('sizeBy').value=DRIVES[k];
}
['unit','sizeBy','lock','sizeRef','width','height','pct','dpi'].forEach(k=>{
  const el=$(k), num=['width','height','pct','dpi'].includes(k), h=ev=>{
    // 'change' fires on blur after 'input' already handled the same text (or after a programmatic rewrite): ignore it unless the value really changed
    if(num){ if(ev&&ev.type==='change'&&el.dataset.last===el.value) return; el.dataset.last=el.value; onSizeEdit(k); }
    if(k==='unit') convertUnits();
    if((k==='sizeBy'||k==='sizeRef')&&lastSc&&lastSc.ok){            // keep today's physical scale; just re-express it in the new mode / reference
      writeFields(lastSc,[]); }
    if(k==='unit'){ tblSave(); } if(!S.edits) schedule();
    recalc(); renderGrid(); renderSvg(); renderNotes(); };
  el.addEventListener('input',h); el.addEventListener('change',h);
});

// ---------- grid
function gridDims(){
  if(!S.W) return {rows:0,cols:0,cw:0,ch:0};
  if($('gridMode').value==='count'){
    const rows=Math.max(1,parseInt($('rows').value)||1), cols=Math.max(1,parseInt($('cols').value)||1);
    return {rows,cols,cw:S.W/cols,ch:S.H/rows};
  }
  const scale=computeScale().sx||1;                                // units per px
  const px=Math.max(1,(parseFloat($('cell').value)||1)/scale);
  return {rows:Math.min(200,Math.ceil(S.H/px)),cols:Math.min(200,Math.ceil(S.W/px)),cw:px,ch:px};
}
function cellRect(r,c){ const g=gridDims(); return [c*g.cw,r*g.ch,Math.min(S.W,(c+1)*g.cw),Math.min(S.H,(r+1)*g.ch)]; }
const cellLabel=(r,c)=>`R${r+1}C${c+1}`;
['gridOn','gridMode','rows','cols','cell'].forEach(k=>$(k).addEventListener('input',()=>{
  $('gridCount').hidden=$('gridMode').value!=='count'; $('gridSize').hidden=$('gridMode').value!=='size';
  S.cells=new Set(); renderAll(); }));
function setTool(t){ S.tool=t; const r=document.querySelector(`input[name=tool][value=${t}]`); if(r) r.checked=true; if(t==='cell'&&!$('gridOn').checked){$('gridOn').checked=true;} renderAll(); }
document.querySelectorAll('input[name=tool]').forEach(r=>r.onchange=()=>setTool(r.value));
$('clearAreas').onclick=()=>{S.cells=new Set();S.areas=[];renderAll();};
$('allCells').onclick=()=>{const g=gridDims(); for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++)S.cells.add(r+','+c); $('gridOn').checked=true; renderAll();};
function regions(){
  const out=[]; S.cells.forEach(k=>{const [r,c]=k.split(',').map(Number); out.push({rect:cellRect(r,c),label:cellLabel(r,c)});});
  S.areas.forEach(a=>out.push({rect:a.rect,label:a.label})); return out;
}

// ---------- zones
const inRect=(x,y,r)=>x>=r[0]&&x<=r[2]&&y>=r[1]&&y<=r[3];
const inZone=(it,z)=>inRect(it.cx,it.cy,z.rect)||inRect(it.bcx,it.bcy,z.rect);      // centroid or bbox centre inside
const zoneIds=z=>S.items.filter(it=>inZone(it,z)).map(it=>it.id);
function excludedSet(){ const ex=new Set(); S.zones.forEach(z=>{ if(!z.on) zoneIds(z).forEach(i=>ex.add(i)); }); return ex; }
function effectiveSelected(){ const ex=excludedSet(); return [...S.selected].filter(i=>!ex.has(i)).sort((a,b)=>a-b); }
function addZone(rect){ const z={id:++S.zoneN,label:'Z'+S.zoneN,rect,on:true}; S.zones.push(z); S.zsel=z.id; return z; }
$('zoneAdd').onclick=()=>{ if(!S.gray) return setStatus('Load an image first',true);
  const k=S.zones.length%4*0.04; addZone([S.W*(0.25+k),S.H*(0.25+k),S.W*(0.75+k>1?1:0.75+k),S.H*(0.75+k>1?1:0.75+k)].map(v=>Math.round(v))); renderAll(); };
$('zoneClear').onclick=()=>{ S.zones=[]; S.zsel=null; renderAll(); };
function renderZones(){
  const box=$('zoneList'); if(!S.zones.length){ box.innerHTML='<div class="note">No zones</div>'; return; }
  box.innerHTML=S.zones.map(z=>{ const ids=zoneIds(z), on=ids.filter(i=>S.selected.has(i)).length;
    return `<div class="zone-item${z.id===S.zsel?' active':''}${z.on?'':' zoff'}" data-zid="${z.id}">
      <label class="row"><input type="checkbox" data-act="toggle" ${z.on?'checked':''}> <b>${z.label}</b> <span>cuts ${z.on?'on':'off'}</span> <small class="note">${ids.length} contour(s), ${on} selected</small></label>
      <div class="row zbtns"><button data-act="on" title="Select every contour in this zone (and switch the zone on)">Enable all</button><button data-act="off" title="Deselect every contour in this zone">Disable all</button><button data-act="inv" title="Invert selection of the contours in this zone">Invert</button><button data-act="del">Delete</button></div></div>`; }).join('');
}
$('zoneList').addEventListener('click',e=>{
  const item=e.target.closest('.zone-item'); if(!item) return; const z=S.zones.find(q=>q.id===+item.dataset.zid); if(!z) return;
  const act=e.target.dataset&&e.target.dataset.act; S.zsel=z.id;
  if(act==='toggle') z.on=e.target.checked;
  else if(act==='on'){ z.on=true; zoneIds(z).forEach(i=>S.selected.add(i)); }
  else if(act==='off') zoneIds(z).forEach(i=>S.selected.delete(i));
  else if(act==='inv') zoneIds(z).forEach(i=>S.selected.has(i)?S.selected.delete(i):S.selected.add(i));
  else if(act==='del') S.zones=S.zones.filter(q=>q!==z);
  renderAll();
});
document.addEventListener('keydown',e=>{
  if((e.key==='Delete'||e.key==='Backspace')&&S.zsel&&S.tool==='zone'&&!/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||'')){
    S.zones=S.zones.filter(z=>z.id!==S.zsel); S.zsel=null; renderAll(); e.preventDefault(); }
});

// ---------- crop / focus
function renderCrop(){
  $('cropApply').disabled=!S.cropSel; $('cropReset').disabled=!S.crop; $('asRow').hidden=!S.crop;
  $('cropNote').textContent=S.crop?`Cropped to x ${S.crop[0]}–${S.crop[2]}, y ${S.crop[1]}–${S.crop[3]} px of the ${S.fullW}×${S.fullH} px image (${S.W}×${S.H} px traced; DXF origin = crop corner)`
    :(S.cropSel?'Crop area drawn: press "Focus / Crop to area"':'No crop');
}
$('cropDraw').onclick=()=>{ if(!S.gray) return setStatus('Load an image first',true); setTool('crop'); setStatus('Drag a rectangle on the image, then press Focus / Crop to area'); };
async function cropTo(rectInView){
  const off=S.crop?[S.crop[0],S.crop[1]]:[0,0], c=T.cropGray(S.gray,S.W,S.H,rectInView);
  const url=await grayURL(c.gray,c.w,c.h); if(S.cropURL) URL.revokeObjectURL(S.cropURL);
  S.cropURL=url; S.imgURL=url; S.gray=c.gray; S.W=c.w; S.H=c.h;
  S.crop=[off[0]+c.rect[0],off[1]+c.rect[1],off[0]+c.rect[2],off[1]+c.rect[3]];
}
function resetGeometryState(){ Object.assign(S,{paths:[],items:[],selected:new Set(),tabbed:new Set(),cells:new Set(),areas:[],zones:[],zsel:null,cropSel:null,mask:null,maskURL:null,plan:null,hl:null}); }
$('cropApply').onclick=async()=>{
  if(!S.cropSel||!S.gray) return;
  const r=S.cropSel.map(Math.round); if(r[2]-r[0]<4||r[3]-r[1]<4) return setStatus('Crop area is too small (min 4×4 px)',true);
  await cropTo(r); resetGeometryState(); setTool('contour'); syncSize(); renderCrop(); setStatus(`Focused on ${S.W}×${S.H} px`); await retrace(true);
};
$('cropReset').onclick=async()=>{
  if(!S.crop) return;
  if(S.cropURL){ URL.revokeObjectURL(S.cropURL); S.cropURL=null; }
  Object.assign(S,{gray:S.fullGray,W:S.fullW,H:S.fullH,imgURL:S.fullURL,crop:null}); resetGeometryState();
  syncSize(); renderCrop(); setStatus('Crop reset'); await retrace(true);
};

// ---------- cut order + tabs (planning = the same code that writes the DXF)
function tabOpts(){
  const w=parseFloat($('tabW').value), all=$('tabsAll').checked;
  if(!(w>0)||!(all||S.tabbed.size)) return null;
  return {width:w,count:parseInt($('tabN').value)||1,spacing:$('tabMode').value==='spacing'?(parseFloat($('tabS').value)||0):0,
    allOuter:all,ids:[...S.tabbed],skipHoles:$('tabsSkipHoles').checked};
}
function exportOpts(){
  const sc=computeScale(), split=$('split').value;
  const table=tableOpts(), splitEff=table.on&&split==='files'?'layers':split;
  return {pxW:S.W,pxH:S.H,scale:sc.sx,scaleY:sc.sy,unit:$('unit').value,selected:effectiveSelected(),table,
    regions:$('limitArea').checked?regions():[],clip:$('clip').checked,split:splitEff,groupBy:$('groupBy').value,zeroOrigin:$('zero').checked,
    insideFirst:$('insideFirst').checked,nearest:$('nearest').checked,innerOuterLayers:$('ioLayers').checked&&splitEff==='none',
    isHole:S.items.map(i=>i.hole),tabs:tabOpts(),format:($('dxfFmt')||{}).value||'r2000',extra:window.I2D_EXTRA?I2D_EXTRA():[]};
}
function prepExport(o){ let polys=S.paths; if(window.I2D_PREP){ const r=I2D_PREP(polys,o); if(r){ polys=r.polys; o=r.o; } } return [polys,o]; }  // hook: frame bridges etc.
function updatePlan(){
  S.plan=null; S.sec=null; $('tabNote').textContent=''; $('orderNote').textContent=''; $('tblNote').textContent='';
  if(!S.items.length||!computeScale().ok) return;
  let o=exportOpts(), polys; [polys,o]=prepExport(o);
  const need=o.tabs||o.insideFirst||o.nearest||$('showOrder').checked||o.table.on;
  if(!need||!o.selected.length){ if(o.tabs) $('tabNote').textContent='Nothing selected for export.'; return; }
  try{ S.plan=D.buildPlan(polys,o); }catch(e){ $('tabNote').textContent=e.message; return; }
  if(o.table.on){
    try{ S.sec=D.sectionize(S.plan.entities,Object.assign({unit:o.unit,insideFirst:o.insideFirst,nearest:o.nearest},o.table),polys===S.paths?rootsOf():D.nestRoots(polys));
      const N=S.sec.passes.length, w=S.sec.warnings;
      $('tblNote').textContent=(N===1?'The job fits on the table: 1 pass (park marker still added).':`${N} passes (${S.sec.cols.length} × ${S.sec.rows.length}). Next to the preview: dashed frames = table position, shaded blocks = what each pass cuts.`)+(w.length?' ⚠ '+w.join(' ⚠ '):''); }
    catch(e){ $('tblNote').textContent='⚠ '+e.message; }
  }
  const st=S.plan.stats;
  if(o.insideFirst||o.nearest) $('orderNote').textContent=`DXF entity order: ${o.insideFirst?`inner contours first (deepest nesting ${st.maxDepth} → 0)`:'file order'}${o.nearest?', nearest-neighbour within each level':''} · ${st.units} cut(s).`
    +($('ioLayers').checked&&o.split!=='none'?' (CUT_INNER/OUTER layers only apply to one-file mode)':'');
  else if($('ioLayers').checked&&o.split==='none') $('orderNote').textContent='';
  if(S.sec&&S.sec.passes.length>1) $('orderNote').textContent+=` Table job: Pass 1 is cut first; numbering restarts in each pass (P1·1, P1·2 … P2·1 …).`;
  if(o.tabs) $('tabNote').textContent=`${st.tabbed} contour(s) get ${st.tabs} tab(s) of ${$('tabW').value} ${$('unit').value}`+(st.tabSkipped?` · ${st.tabSkipped} too small for tabs (left closed)`:'')+'.';
}
function recalc(){ $('dxfCheck').textContent=''; syncSize(); updatePlan(); renderSizeOut(); }       // scale -> plan -> readout, in that order
function refresh(){ recalc(); renderSvg(); renderList(); renderNotes(); }
['insideFirst','nearest','ioLayers','showOrder','tabsAll','tabsSkipHoles','tabW','tabN','tabS','tabMode','split','groupBy','zero'].forEach(k=>{
  $(k).addEventListener('input',()=>{ if(k==='tabMode') $('tabSpacingWrap').hidden=$('tabMode').value!=='spacing'; refresh(); }); });
$('tabsSel').onclick=()=>{ S.selected.forEach(i=>S.tabbed.add(i)); refresh(); };
$('tabsClear').onclick=()=>{ S.tabbed=new Set(); $('tabsAll').checked=false; refresh(); };

// ---------- rendering
const NS='http://www.w3.org/2000/svg';
function renderAll(){ recalc(); renderSvg(); renderList(); renderNotes(); renderZones(); renderCrop(); renderMergeScope(); renderUndo(); if(S.rs) rsCompute(); }
function renderGrid(){ if(S.gray) renderSvg(); }
const HANDLES={nw:[0,0],n:[.5,0],ne:[1,0],e:[1,.5],se:[1,1],s:[.5,1],sw:[0,1],w:[0,.5]};
function rectSvg(kind,id,rect,cls,label){
  const [x0,y0,x1,y1]=rect, k=S.W/(($('svg').getBoundingClientRect().width)||S.W);
  const half=Math.max(4*k,Math.min((matchMedia('(pointer:coarse)').matches?13:8)*k,0.2*Math.min(x1-x0,y1-y0)));   // handles shrink on tiny rectangles
  let h=`<rect class="${cls}" data-kind="${kind}" data-zid="${id}" data-h="move" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/>`;
  if(label) h+=`<text class="lbl" x="${x0+4*k}" y="${y0+15*k}" style="font-size:${13*k}px">${label}</text>`;
  for(const [m,[fx,fy]] of Object.entries(HANDLES)) h+=`<rect class="zh" data-kind="${kind}" data-zid="${id}" data-h="${m}" x="${x0+(x1-x0)*fx-half}" y="${y0+(y1-y0)*fy-half}" width="${2*half}" height="${2*half}"/>`;
  return h;
}
function renderSvg(){
  const svg=$('svg'); if(!S.gray){return;}
  { const vb=S.vb||(window.I2D_VB&&I2D_VB()); svg.setAttribute('viewBox',vb?vb.join(' '):`0 0 ${S.W} ${S.H}`); } svg.style.width=Math.min(S.W,1400)+'px'; svg.style.aspectRatio=`${S.W}/${S.H}`; svg.setAttribute('class','tool-'+S.tool);
  let h='';
  if($('showImg').checked) h+=`<image href="${S.imgURL}" width="${S.W}" height="${S.H}"/>`;
  if($('showMask').checked && S.mask) h+=`<image href="${maskURL()}" width="${S.W}" height="${S.H}" opacity=".6" style="mix-blend-mode:multiply"/>`;
  // selected cells + areas under vectors
  S.cells.forEach(k=>{const [r,c]=k.split(',').map(Number),[x0,y0,x1,y1]=cellRect(r,c); h+=`<rect class="cell" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/>`;});
  S.areas.forEach(a=>{const [x0,y0,x1,y1]=a.rect; h+=`<rect class="area" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"/><text class="lbl" x="${x0+4}" y="${y0+14}">${a.label}</text>`;});
  const ex=excludedSet();
  if($('showVec').checked){
    const order=S.paths.map((_,i)=>i).sort((a,b)=>S.items[b].area-S.items[a].area);   // big first, small (holes) on top
    for(const i of order){
      const cls='c'+(S.selected.has(i)?'':' off')+(ex.has(i)?' zx':'')+(S.hl===i?' hl':'')+(S.tabbed.has(i)?' tabbed':'');
      h+=`<polygon class="${cls}" data-id="${i}" points="${S.paths[i].map(p=>p.join(',')).join(' ')}"/>`;
    }
  }
  if(S.plan){                                                                 // tabs (uncut gaps) + cut order numbers
    const sc=computeScale(), toPx=([x,y])=>[+(x/sc.sx).toFixed(2),+(S.H-y/sc.sy).toFixed(2)];
    S.plan.gaps.forEach(g=>{ h+=`<polyline class="tabhalo" points="${g.pts.map(p=>toPx(p).join(',')).join(' ')}"/><polyline class="tabgap" points="${g.pts.map(p=>toPx(p).join(',')).join(' ')}"/>`; });
    if($('showOrder').checked){
      const k=S.W/(($('svg').getBoundingClientRect().width)||S.W), seen=new Set(); let n=0;
      const sec=$('tblOn').checked&&S.sec&&S.sec.passes.length?S.sec:null;
      if(sec){                                                                 // table job: numbers restart in every pass, Pass 1 first
        const multi=sec.passes.length>1;
        for(const P of sec.passes){ const pseen=new Set();
          for(const e of P.ents){ if(e.cid<0||pseen.has(e.pseq)) continue; pseen.add(e.pseq); if(++n>800) break; const [x,y]=toPx(e.pts[0]);
            h+=`<text class="ord" data-pass="${P.n}" x="${x}" y="${y}" style="font-size:${12*k}px">${multi?'P'+P.n+'·':''}${e.pseq}</text>`; } }
      } else
      for(const e of S.plan.entities){ if(seen.has(e.seq)) continue; seen.add(e.seq); if(++n>800) break; const [x,y]=toPx(e.pts[0]);
        h+=`<text class="ord" x="${x}" y="${y}" style="font-size:${12*k}px">${e.seq}</text>`; }
    }
  }
  if($('gridOn').checked){
    const g=gridDims(); let d='';
    for(let c=1;c<g.cols;c++) d+=`M${c*g.cw} 0V${S.H}`; for(let r=1;r<g.rows;r++) d+=`M0 ${r*g.ch}H${S.W}`;
    h+=`<path class="g" d="${d}" style="pointer-events:none"/>`;
    const fs=Math.max(8,Math.min(g.cw,g.ch)/6,0)>S.W/45?S.W/45:Math.max(8,Math.min(g.cw,g.ch)/6);
    if(g.rows*g.cols<=400) for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++) h+=`<text class="lbl" style="font-size:${fs}px;opacity:.6" x="${c*g.cw+3}" y="${r*g.ch+fs+1}">${cellLabel(r,c)}</text>`;
  }
  S.zones.forEach(z=>{ h+=rectSvg('zone',z.id,z.rect,'zone'+(z.on?'':' off')+(z.id===S.zsel?' sel':''),`${z.label} ${z.on?'ON':'OFF'}`); });
  if(S.cropSel){ const [x0,y0,x1,y1]=S.cropSel; h+=`<path class="cropdim" fill-rule="evenodd" d="M0 0H${S.W}V${S.H}H0Z M${x0} ${y0}H${x1}V${y1}H${x0}Z"/>`+rectSvg('crop',0,S.cropSel,'cropsel','CROP'); }
  if(S.drag){const [x0,y0,x1,y1]=normRect(S.drag.rect); h+=`<rect class="${S.drag.kind==='zone'?'zone sel':S.drag.kind==='crop'?'cropsel':S.drag.kind==='rescan'?'rsarea':'area'}" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" style="pointer-events:none"/>`;}
  h+=rescanSvg()+tableSvg();
  if(window.I2D_OVERLAY) try{ h+=I2D_OVERLAY(); }catch(e){ console.error(e); }
  svg.innerHTML=h;
}
['showImg','showMask','showVec'].forEach(k=>$(k).onchange=renderSvg);
window.addEventListener('resize',()=>{ if(S.gray) renderSvg(); });
function renderList(){
  const ul=$('list'); const MAX=1500; let h=''; const ex=excludedSet();
  S.items.slice(0,MAX).forEach(it=>{
    const on=S.selected.has(it.id), zx=ex.has(it.id), tb=S.tabbed.has(it.id);
    h+=`<li data-id="${it.id}" class="${on?'':'off'}${zx?' zx':''}"><input type="checkbox" ${on?'checked':''} tabindex="-1"><b>#${it.id}</b><span>${it.w}×${it.h}</span><span class="tag">${zx?'zone off':it.hole?'hole':''}</span>`+
      `<button class="tabbtn${tb?' on':''}" data-tab="${it.id}" aria-pressed="${tb}" title="Leave tabs on this cut">⊓</button></li>`;
  });
  if(S.items.length>MAX) h+=`<li class="off">… ${S.items.length-MAX} more (use select tools)</li>`;
  ul.innerHTML=h;
  $('selCount').textContent=S.items.length?`(${S.selected.size}/${S.items.length})`:'';
}
function renderNotes(){
  const n=regions().length, eff=effectiveSelected(), nex=S.selected.size-eff.length; $('areaNote').textContent=n?`${n} area(s)`:'no area';
  $('exportNote').textContent=S.items.length?`${eff.length} contour(s) will be exported`+(nex?` (${nex} excluded by zones that are off)`:'')+(n&&$('limitArea').checked?`, limited to ${n} area(s)`:''):'';
  $('download').disabled=!S.items.length||!eff.length; $('clearImg').disabled=!S.gray;
}
$('list').addEventListener('click',e=>{
  const tb=e.target.closest('button.tabbtn'); if(tb){ const i=+tb.dataset.tab; S.tabbed.has(i)?S.tabbed.delete(i):S.tabbed.add(i); e.stopPropagation(); refresh(); return; }
  const li=e.target.closest('li[data-id]'); if(li){toggle(+li.dataset.id);} });
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
['limitArea','clip'].forEach(k=>$(k).onchange=()=>refresh());

// ---------- pointer interaction on preview (mouse, pen and touch)
function pt(e){ const svg=$('svg'); const p=svg.createSVGPoint(); p.x=e.clientX; p.y=e.clientY; const q=p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0,Math.min(S.W,q.x)),Math.max(0,Math.min(S.H,q.y))]; }
const normRect=d=>[Math.min(d[0],d[2]),Math.min(d[1],d[3]),Math.max(d[0],d[2]),Math.max(d[1],d[3])];
const svgEl=$('svg');
const MINSZ=4;
function editRect(ed,x,y){                // move / resize helper, clamped to the image
  const dx=x-ed.start[0], dy=y-ed.start[1]; let [x0,y0,x1,y1]=ed.orig; const m=ed.mode;
  if(m==='move'){ const w=x1-x0,h=y1-y0; x0=Math.max(0,Math.min(S.W-w,x0+dx)); y0=Math.max(0,Math.min(S.H-h,y0+dy)); return [x0,y0,x0+w,y0+h]; }
  if(m.includes('w')) x0=Math.max(0,Math.min(x1-MINSZ,x0+dx)); if(m.includes('e')) x1=Math.min(S.W,Math.max(x0+MINSZ,x1+dx));
  if(m.includes('n')) y0=Math.max(0,Math.min(y1-MINSZ,y0+dy)); if(m.includes('s')) y1=Math.min(S.H,Math.max(y0+MINSZ,y1+dy));
  return [x0,y0,x1,y1];
}
svgEl.addEventListener('pointerdown',e=>{
  if(!S.gray) return; const [x,y]=pt(e), d=(e.target&&e.target.dataset)||{};
  if(S.tool==='zone'||S.tool==='crop'){
    const zid=+d.zid; const z=d.kind==='zone'?S.zones.find(q=>q.id===zid):null;
    if(d.h&&d.kind===S.tool&&(z||d.kind==='crop')){
      S.edit={kind:d.kind,zid,mode:d.h,start:[x,y],orig:(z?z.rect:S.cropSel).slice()}; if(z) S.zsel=z.id;
    } else S.drag={kind:S.tool,rect:[x,y,x,y]};
    svgEl.setPointerCapture(e.pointerId); e.preventDefault(); renderSvg();
  }
  else if(S.tool==='region'||S.tool==='rescan'){ S.drag={kind:S.tool,rect:[x,y,x,y]}; svgEl.setPointerCapture(e.pointerId); if(S.tool==='rescan') e.preventDefault(); }
  else if(S.tool==='cell'){
    const g=gridDims(); const c=Math.min(g.cols-1,Math.floor(x/g.cw)), r=Math.min(g.rows-1,Math.floor(y/g.ch)); const k=r+','+c;
    S.cells.has(k)?S.cells.delete(k):S.cells.add(k); renderAll();
  } else if(S.tool==='contour'){
    const id=d.id; if(id!==undefined) toggle(+id);
  }
});
svgEl.addEventListener('pointercancel',()=>{ if(S.drag||S.edit){S.drag=null;S.edit=null; renderSvg();} });
svgEl.addEventListener('pointermove',e=>{
  if(S.edit){ const [x,y]=pt(e), r=editRect(S.edit,x,y); if(S.edit.kind==='zone'){ const z=S.zones.find(q=>q.id===S.edit.zid); if(z) z.rect=r; } else S.cropSel=r; renderSvg(); return; }
  if(e.pointerType==='touch'&&!S.drag) return;   // no hover highlight on touch
  if(S.drag){ const [x,y]=pt(e); S.drag.rect[2]=x; S.drag.rect[3]=y; renderSvg(); return; }
  if(S.tool==='contour'){ const id=e.target.dataset&&e.target.dataset.id; const n=id!==undefined?+id:null; if(n!==S.hl){S.hl=n; renderSvg();} }
});
svgEl.addEventListener('pointerup',e=>{
  if(S.edit){ S.edit=null; renderAll(); return; }
  if(!S.drag) return; const dr=S.drag, r=normRect(dr.rect); S.drag=null;
  if(r[2]-r[0]>3&&r[3]-r[1]>3){
    if(dr.kind==='region'){ S.areaN++; S.areas.push({rect:r,label:'AREA'+S.areaN}); }
    else if(dr.kind==='zone') addZone(r);
    else if(dr.kind==='crop') S.cropSel=r;
    else if(dr.kind==='rescan'){ S.rs={rect:r,res:null}; rsCompute(); }
  }
  renderAll();
});

// ---------- undoable contour edits (merge touching cuts, re-scan)
const snapState=label=>({label,paths:S.paths,items:S.items,selected:new Set(S.selected),tabbed:new Set(S.tabbed),lines:S.lines.slice()});
function pushUndo(label){ S.undo.push(snapState(label)); if(S.undo.length>40) S.undo.shift(); S.redo=[]; renderUndo(); }
function renderUndo(){ const b=$('undoEdit'); b.disabled=!S.undo.length; b.title=S.undo.length?'Undo: '+S.undo[S.undo.length-1].label:'Nothing to undo';
  const r=$('redoEdit'); if(r){ r.disabled=!S.redo.length; r.title=S.redo.length?'Redo: '+S.redo[S.redo.length-1].label:'Nothing to redo'; } }
function setContours(polys,holes,selIdx,label){
  pushUndo(label); const sc=computeScale();
  S.paths=polys; S.items=polys.map((q,i)=>T.makeItem(q,holes[i],i,sc.sx||1,sc.sy||1));
  S.selected=new Set(selIdx); S.tabbed=new Set(); S.edits++; S.hl=null;
}
$('undoEdit').onclick=()=>{
  const u=S.undo.pop(); if(!u) return; S.redo.push(snapState(u.label));
  Object.assign(S,{paths:u.paths,items:u.items,selected:u.selected,tabbed:u.tabbed,lines:u.lines||[],hl:null}); S.edits=Math.max(0,S.edits-1);
  $('mergeNote').textContent=''; if(S.rs) rsCompute(); setStatus('Undid: '+u.label); renderAll(); renderUndo();
};
function redoEdit(){
  const u=S.redo.pop(); if(!u) return; S.undo.push(snapState(u.label));
  Object.assign(S,{paths:u.paths,items:u.items,selected:u.selected,tabbed:u.tabbed,lines:u.lines||[],hl:null}); S.edits++;
  if(S.rs) rsCompute(); setStatus('Redid: '+u.label); renderAll(); renderUndo();
}
if($('redoEdit')) $('redoEdit').onclick=redoEdit;
// --- merge touching cuts
function mergeScopeIds(){
  const v=$('mergeScope').value;
  if(v==='all') return null; if(v==='selected') return [...S.selected];
  const z=S.zones.find(q=>'z'+q.id===v); return z?zoneIds(z):[];
}
function renderMergeScope(){
  const sel=$('mergeScope'), cur=sel.value;
  sel.innerHTML='<option value="all">all contours</option><option value="selected">only selected</option>'+S.zones.map(z=>`<option value="z${z.id}">inside zone ${z.label}</option>`).join('');
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:'all';
  $('mergeGo').disabled=!S.paths.length;
}
$('mergeGo').onclick=()=>{
  if(!S.paths.length) return; const sc=computeScale(), u=$('unit').value, tol=Math.max(0,parseFloat($('mergeTol').value)||0), tolPx=tol/Math.sqrt(sc.sx*sc.sy);
  const scope=mergeScopeIds(), n0=S.paths.length;
  if(scope&&!scope.length){ $('mergeNote').textContent='Nothing in that scope (select contours or choose another scope).'; return; }
  const r=D.mergeContours(S.paths,scope,tolPx);
  if(!r.clusters){ $('mergeNote').textContent=`Nothing to merge: no contours touch within ${fmt(tol,4)} ${u}. Still ${n0} contours. (1 image pixel = ${fmt(Math.sqrt(sc.sx*sc.sy),3)} ${u}: shapes separated by a thin gap need a tolerance of at least that gap.)`; return; }
  const rem=new Set(r.removed), polys=[], holes=[], sel=[];
  S.paths.forEach((q,i)=>{ if(rem.has(i)) return; if(S.selected.has(i)) sel.push(polys.length); polys.push(q); holes.push(S.items[i].hole); });
  r.added.forEach(a=>{ if(a.from.some(i=>S.selected.has(i))) sel.push(polys.length); polys.push(a.pts); holes.push(a.hole); });
  setContours(polys,holes,sel,'merge touching cuts');
  $('mergeNote').textContent=`Merged ${r.before} touching contours into ${r.after} (${r.clusters} group${r.clusters>1?'s':''}). All contours: ${n0} → ${polys.length}. Undo restores them.`;
  setStatus(`Merged ${r.before} → ${r.after} contours`); renderAll();
};
['mergeScope','mergeTol'].forEach(k=>$(k).addEventListener('input',()=>{ $('mergeNote').textContent=''; }));

// --- re-scan area
const RSK=['rsThr','rsBlur','rsSpeckle','rsSimp','rsMin'], RSO={rsThr:'o_rsThr',rsBlur:'o_rsBlur',rsSpeckle:'o_rsSpeckle',rsSimp:'o_rsSimp',rsMin:'o_rsMin'};
function rsCompute(){
  const rs=S.rs; $('rsAdd').disabled=true; $('rsClear').disabled=!rs;
  if(!rs||!rs.rect||!S.gray){ $('rsNote').textContent=''; return; }
  const sc=computeScale(); if(!sc.ok) return;
  const c=T.cropGray(S.gray,S.W,S.H,rs.rect.map(Math.round));
  if(c.w<3||c.h<3){ $('rsNote').textContent='Area too small'; rs.res=null; return; }
  let g=c.gray; if($('rsNorm').checked) g=T.stretch(g);
  const avg=Math.sqrt(sc.sx*sc.sy);
  const p={unit:$('unit').value,scale:sc.sx,scaleY:sc.sy,threshold:+$('rsThr').value,auto:$('rsAuto').checked,invert:$('rsInvert').checked,blur:+$('rsBlur').value,speckle:+$('rsSpeckle').value,
    tolerance:+$('rsSimp').value*avg,min_feature:+$('rsMin').value*avg,holes:true,drop_frame:false};
  const r=T.trace(g,c.w,c.h,p), ox=c.rect[0], oy=c.rect[1];
  const polys=r.polys.map(q=>q.map(([x,y])=>[x+ox,y+oy])), holes=r.items.map(i=>i.hole);
  const dup=polys.map((q,k)=>{                                   // already-existing near-identical contour?
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; q.forEach(([x,y])=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; });
    const tol=Math.max(2,0.04*Math.max(x1-x0,y1-y0));
    return S.items.findIndex(it=>it.hole===holes[k]&&Math.abs(it.bbox[0]-x0)<=tol&&Math.abs(it.bbox[1]-y0)<=tol&&Math.abs(it.bbox[2]-x1)<=tol&&Math.abs(it.bbox[3]-y1)<=tol);
  });
  rs.res={polys,holes,dup,rect:c.rect};
  const nd=dup.filter(i=>i>=0).length, nn=polys.length-nd;
  $('rsNote').textContent=polys.length?`Found ${polys.length} contour(s) in the area: ${nn} new, ${nd} already in the cuts.`:'Nothing found in the area with these settings (try Local auto, Stretch contrast, or a different threshold).';
  $('rsAdd').disabled=!polys.length;
}
function rsRefresh(){ rsCompute(); renderSvg(); }
RSK.forEach(k=>$(k).addEventListener('input',()=>{ $(RSO[k]).textContent=$(k).value; rsRefresh(); }));
['rsAuto','rsNorm','rsInvert'].forEach(k=>$(k).addEventListener('input',rsRefresh));
$('rsReplace').addEventListener('input',()=>{ $('rsNote').textContent=$('rsNote').textContent; });
$('rsDraw').onclick=()=>{ if(!S.gray) return setStatus('Load an image first',true); setTool('rescan'); setStatus('Drag a rectangle over the missed shape, tune the settings, then Add to cuts'); };
$('rsClear').onclick=()=>{ S.rs=null; rsCompute(); renderSvg(); };
$('rsAdd').onclick=()=>{
  const res=S.rs&&S.rs.res; if(!res||!res.polys.length) return;
  const rep=$('rsReplace').checked, rect=res.rect, polys=[], holes=[], sel=[];
  S.paths.forEach((q,i)=>{ const it=S.items[i]; if(rep&&it.bcx>=rect[0]&&it.bcx<=rect[2]&&it.bcy>=rect[1]&&it.bcy<=rect[3]) return; if(S.selected.has(i)) sel.push(polys.length); polys.push(q); holes.push(it.hole); });
  const n0=S.paths.length, kept=polys.length; let added=0;
  res.polys.forEach((q,k)=>{ if(!rep&&res.dup[k]>=0) return; sel.push(polys.length); polys.push(q); holes.push(res.holes[k]); added++; });
  if(!added){ $('rsNote').textContent='Everything found is already in the cuts.'; return; }
  setContours(polys,holes,sel,'re-scan area'); S.rs=null;
  $('rsNote').textContent=`Added ${added} contour(s)`+(rep?` (replaced ${n0-kept} existing in the area)`:'')+`. Contours: ${n0} → ${polys.length}. Undo restores them.`;
  setStatus(`Re-scan added ${added} contour(s)`); setTool('contour');
};
function rescanSvg(){
  const rs=S.rs; if(!rs||!rs.rect) return '';
  const [x0,y0,x1,y1]=rs.rect; let h=`<rect class="rsarea" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" style="pointer-events:none"/>`;
  if(rs.res) rs.res.polys.forEach((q,k)=>{ h+=`<polygon class="rspoly${rs.res.dup[k]>=0?' dup':''}" points="${q.map(p=>p.join(',')).join(' ')}"/>`; });
  return h;
}

// --- crop assessment (local settings for the whole cropped section)
$('asOn').addEventListener('input',()=>{ $('asBox').hidden=!$('asOn').checked; schedule(); });
[['asThr','o_asThr'],['asBlur','o_asBlur'],['asSpeckle','o_asSpeckle'],['asSimp','o_asSimp'],['asMin','o_asMin']].forEach(([k,o])=>$(k).addEventListener('input',()=>{ $(o).textContent=$(k).value; schedule(); }));
['asAuto','asNorm','asInvert'].forEach(k=>$(k).addEventListener('input',schedule));
$('asGo').onclick=async()=>{ if(!S.crop) return setStatus('Crop an area first',true); $('asOn').checked=true; $('asBox').hidden=false; await retrace(true); setStatus('Re-assessed the whole cropped section with local settings'); };

// ---------- table size & material moves
const TBL_PRESETS={'24x24':[24,24],'24x48':[24,48],'48x48':[48,48],'48x96':[48,96],'60x120':[60,120]}, TBL_KEY='i2d.table';
function tableOpts(){
  const g=k=>parseFloat($(k).value);
  return {on:$('tblOn').checked,L:g('tblW'),H:g('tblH'),overlap:Math.max(0,g('tblOv')||0),corner:$('tblCorner').value,mode:$('tblMode').value,park:$('tblPark').value,parkX:g('tblParkX')||0,parkY:g('tblParkY')||0,
    marks:$('tblMarks').checked,single:$('tblOut').value==='single'};
}
function tblSave(){
  try{ const k=UNIT_PER_INCH(), g=id=>(parseFloat($(id).value)||0)/k;
    localStorage.setItem(TBL_KEY,JSON.stringify({preset:$('tblPreset').value,w:g('tblW'),h:g('tblH'),ov:g('tblOv'),corner:$('tblCorner').value,mode:$('tblMode').value,park:$('tblPark').value,px:g('tblParkX'),py:g('tblParkY'),marks:$('tblMarks').checked,out:$('tblOut').value})); }catch(e){}
}
function tblLoad(){
  const d={preset:'48x48',w:48,h:48,ov:1,corner:'bl',mode:'clip',park:'bl',px:0,py:0,marks:false,out:'files'};
  try{ Object.assign(d,JSON.parse(localStorage.getItem(TBL_KEY)||'{}')); }catch(e){}
  const k=UNIT_PER_INCH(), set=(id,v)=>{ $(id).value=fmt(v*k,6); $(id).dataset.last=$(id).value; };
  set('tblW',d.w); set('tblH',d.h); set('tblOv',d.ov); set('tblParkX',d.px); set('tblParkY',d.py);
  $('tblPreset').value=[...$('tblPreset').options].some(o=>o.value===d.preset)?d.preset:'custom';
  $('tblCorner').value=d.corner; $('tblMode').value=d.mode; $('tblPark').value=d.park; $('tblMarks').checked=!!d.marks; $('tblOut').value=d.out;
  $('tblParkXY').hidden=$('tblPark').value!=='custom';
}
const rootCache=new WeakMap();
function rootsOf(){ let r=rootCache.get(S.paths); if(!r){ r=D.nestRoots(S.paths); rootCache.set(S.paths,r); } return r; }
$('tblOn').addEventListener('input',()=>{ $('tblBox').hidden=!$('tblOn').checked; refresh(); });
$('tblPreset').addEventListener('input',()=>{
  const v=TBL_PRESETS[$('tblPreset').value]; if(v){ const k=UNIT_PER_INCH(); $('tblW').value=fmt(v[0]*k,6); $('tblH').value=fmt(v[1]*k,6); }
  tblSave(); refresh(); });
['tblW','tblH'].forEach(id=>$(id).addEventListener('input',()=>{
  const k=UNIT_PER_INCH(), w=parseFloat($('tblW').value)/k, h=parseFloat($('tblH').value)/k;
  const m=Object.keys(TBL_PRESETS).find(n=>Math.abs(TBL_PRESETS[n][0]-w)<1e-6&&Math.abs(TBL_PRESETS[n][1]-h)<1e-6); $('tblPreset').value=m||'custom'; tblSave(); refresh(); }));
['tblOv','tblCorner','tblMode','tblPark','tblParkX','tblParkY','tblMarks','tblOut'].forEach(id=>{ const f=()=>{ $('tblParkXY').hidden=$('tblPark').value!=='custom'; tblSave(); refresh(); }; $(id).addEventListener('input',f); $(id).addEventListener('change',f); });
function tableSvg(){
  const sec=S.sec; if(!sec||!sec.passes.length||!$('tblOn').checked) return '';
  const sc=computeScale(), T0=tableOpts(), X=v=>+(v/sc.sx).toFixed(2), Y=v=>+(S.H-v/sc.sy).toFixed(2), k=S.W/(($('svg').getBoundingClientRect().width)||S.W);
  let h='';
  sec.passes.forEach(P=>{
    const [rx0,ry0,rx1,ry1]=P.region, a=X(rx0), b=X(rx1), c=Y(ry1), d=Y(ry0);
    h+=`<rect class="tblreg p${P.n%2}" x="${a}" y="${c}" width="${b-a}" height="${d-c}"/>`;
  });
  sec.passes.forEach(P=>{
    const wx0=X(P.ox), wx1=X(P.ox+T0.L), wy0=Y(P.oy+T0.H), wy1=Y(P.oy);
    h+=`<rect class="tblwin" x="${wx0}" y="${wy0}" width="${wx1-wx0}" height="${wy1-wy0}"/>`;
    const [rx0,ry0,rx1,ry1]=P.region, a=X(rx0), b=X(rx1), c=Y(ry1), d=Y(ry0);
    h+=`<text class="tbllbl" x="${(a+b)/2}" y="${(c+d)/2}" text-anchor="middle" style="font-size:${16*k}px">${P.label}</text>`;
    if(P.c>0){ const bx=T0.corner[1]==='r'?b:a; h+=`<path class="tblbrk" d="M${bx} ${c}V${d}"/>`; }
    if(P.r>0){ const by=T0.corner[0]==='t'?d:c; h+=`<path class="tblbrk" d="M${a} ${by}H${b}"/>`; }
    h+=`<circle class="tblpark" cx="${X(P.ox+P.park[0])}" cy="${Y(P.oy+P.park[1])}" r="${6*k}"/>`;
  });
  return h;
}

// ---------- export (all in the browser)
let lastFile=null, dlURL=null;
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
    if(dlURL) URL.revokeObjectURL(dlURL);
    const u=a.href=dlURL=URL.createObjectURL(new Blob([f.bytes],{type:f.mime})); a.download=f.filename; a.rel='noopener'; a.style.display='none';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>{ URL.revokeObjectURL(u); if(dlURL===u) dlURL=null; },60000);
    return 'download';
  }catch(e){ if(await shareFile(f)) return 'share'; throw e; }
}
// DXF check: the numbers below come from re-reading the generated file, not from the on-screen settings.
function showCheck(r,o){
  if(r.check.table){
    const c=r.check, el=$('dxfCheck'), f=v=>(+v.toFixed(3)).toString();
    el.textContent=`DXF check (re-read from the file${c.files>1?'s':''}): ${c.files} file(s) in ${o.unit}: `+c.perFile.map(q=>`${q.name} ${f(q.width)} × ${f(q.height)}`).join(' · ')+(c.warnings&&c.warnings.length?' · ⚠ '+c.warnings.join(' ⚠ '):' · ✓ each pass fits the table '+f(o.table.L)+' × '+f(o.table.H));
    el.className='note strong'+(c.warnings&&c.warnings.length?' err':'');
    return {table:true,files:c.files,perFile:c.perFile,unit:c.unit,ok:c.unit===o.unit&&!(c.warnings&&c.warnings.length),warnings:c.warnings||[]};
  }
  const c=r.check, u=o.unit, uname=c.unit==='in'?'inches':c.unit==='mm'?'mm':'?', el=$('dxfCheck'), f=v=>(+v.toFixed(4)).toString();
  const b=exportBox(), sc=computeScale(), req=b?{w:b.w*sc.sx,h:b.h*sc.sy}:null, framed=(o.extra||[]).length>0||o.framed, shapes=refName()==='shapes'&&!framed;
  const tol=Math.max(0.005*Math.max(req?req.w:0,req?req.h:0),1e-4)+(o.tabs?o.tabs.width:0);
  const okUnit=c.unit===u, okSize=!req||(Math.abs(c.width-req.w)<=tol&&Math.abs(c.height-req.h)<=tol);
  let t=`DXF check (re-read from the file): ${f(c.width)} × ${f(c.height)} ${u} · units ${uname}${okUnit?'':' ⚠ unexpected'} · ${c.polylines} polylines`+(o.zeroOrigin&&o.split==='files'?' (largest file)':'');
  if(shapes) t+=okSize&&okUnit?` · ✓ matches the size you set (${f(req.w)} × ${f(req.h)} ${u})`:` · ⚠ expected ${req?f(req.w)+' × '+f(req.h):'?'} ${u}`;
  else if(framed) t+=` · includes the frame / drawn lines, so it is larger than the artwork size you set (${req?f(req.w)+' × '+f(req.h):'?'} ${u})`;
  else t+=' · size was set on the image/frame, so the shapes are smaller than the entered width/height (expected)';
  el.textContent=t; el.className='note strong'+((shapes&&!(okSize&&okUnit))?' err':'');
  return {width:c.width,height:c.height,unit:c.unit,polylines:c.polylines,ok:okUnit&&okSize,requested:req};
}
$('share').onclick=async()=>{ if(!lastFile) return; const ok=await shareFile(lastFile); setStatus(ok?`Shared ${lastFile.filename}`:'Sharing is not available here: use Download DXF',!ok); };
$('download').onclick=async()=>{
  try{
    setStatus('Building DXF…'); await new Promise(r=>setTimeout(r,0));
    if(!S.paths.length) throw new Error('Nothing to export: no shapes found with these settings');
    if(!computeScale().ok) throw new Error('Enter a positive output size');
    let o=exportOpts(), polys; if(!o.selected.length) throw new Error('Nothing to export: every selected contour is in a zone that is switched off');
    [polys,o]=prepExport(o); const r=await D.exportDxf(polys,o);
    lastFile={bytes:r.bytes,mime:r.mime,filename:r.filename};
    const how=await saveFile(lastFile);
    setStatus(`${how==='share'?'Shared':'Downloaded'} ${r.filename} (${r.paths} paths, ${r.groups} group(s))`);
    if(canShareFiles()) $('share').hidden=false;
    const chk=showCheck(r,o);
    window.__lastExport={format:o.format,filename:r.filename,paths:r.paths,groups:r.groups,stats:r.plan.stats,unit:o.unit,check:chk,sections:r.sections?r.sections.passes.length:0};
  }catch(e){ setStatus(e.message,true); }
};
// ---------- unit default + persistence: inches by default, the choice is remembered on this device
const UNIT_KEY='i2d.unit';
function savedUnit(){ try{ const u=localStorage.getItem(UNIT_KEY); return u==='mm'||u==='in'?u:'in'; }catch(e){ return 'in'; } }
function applyUnitDefaults(u){
  $('unit').value=u;
  if(u==='in'){
    convertUnits();
    Object.entries({width:10,height:7.5,cell:1,tabW:0.05,tabS:2}).forEach(([k,v])=>{ $(k).value=v; $(k).dataset.last=String(v); });   // tidy inch defaults (10 in wide)
    [['tolerance',0.01],['min_feature',0.04]].forEach(([k,v])=>{ $(k).value=v; $('o_'+k).textContent=v; });
  }
  document.querySelectorAll('.u').forEach(x=>x.textContent=u);
  document.querySelectorAll('input.len').forEach(el=>{ el.value=fmt(parseFloat(el.defaultValue)*(u==='in'?1:25.4),7); });   // Hard 1.5 fields: HTML defaults are inches
  curUnit=u;
}
function initUnit(){
  applyUnitDefaults(savedUnit());              // the HTML defaults are written in mm; convert them once if we start in inches
  $('unit').addEventListener('change',()=>{ try{ localStorage.setItem(UNIT_KEY,$('unit').value); }catch(e){} });
  $('unit').addEventListener('input',()=>{ try{ localStorage.setItem(UNIT_KEY,$('unit').value); }catch(e){} });
}
initUnit();
tblLoad(); $('mergeTol').value=$('unit').value==='in'?0.01:0.25; $('mergeTol').dataset.last=$('mergeTol').value;
syncSize(); renderAll();
