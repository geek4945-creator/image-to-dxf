/* Hard Version 1.5 additions: tabs, reset-to-defaults, help bubbles, version / update check, zoom + edit tools,
   frame, brightness layers and history. Classic script: uses the globals of app.js (S, T, D, $, renderAll, ...). */
(function(){
'use strict';
const V=window.I2D_VERSION||{name:'Hard Version 1.5',version:'1.5.0',build:'dev',date:''};
const LS={get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }};
const PC=()=>window.polygonClipping;
const unit=()=>$('unit').value;
const num=(id,d=0)=>{ const v=parseFloat($(id).value); return isFinite(v)?v:d; };
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const API={backend:false};
window.I2D15={V,API};

// ======================================================================= tabs
const TABS=[['trace','Trace'],['edit','Edit'],['frame','Frame'],['layers','Layers'],['output','Table / Output'],['fold','Fold / Box'],['3d','3D Preview'],['history','History'],['all','All']];
const MAP={'s-reset':'*','s-src':'trace layers fold history','s-proc':'trace layers fold','s-size':'trace output frame layers','s-crop':'trace',
  's-rescan':'edit','s-merge':'edit','s-grid':'output','s-zones':'edit output','s-cut':'output','s-table':'output','s-exp':'trace output frame edit',
  's-edit':'edit','s-frame':'frame','s-layers':'layers','s-fold':'fold','s-3d':'3d','s-hist':'history',
  'view':'trace edit frame layers output history','toolRow':'trace output frame layers history','editRow':'edit','listPanel':'trace edit output',
  'foldView':'fold','view3d':'3d'};
let curTab='trace';
function tab(t){
  if(!TABS.some(x=>x[0]===t)) t='trace';
  const prev=curTab; curTab=t; document.body.dataset.tab=t;
  Object.entries(MAP).forEach(([id,v])=>{ const el=$(id); if(el) el.classList.toggle('tabhide',!((t==='all'&&!/^(foldView|view3d)$/.test(id))||v==='*'||v.split(' ').includes(t))); });
  const own={edit:'s-edit',frame:'s-frame',layers:'s-layers',fold:'s-fold','3d':'s-3d',history:'s-hist'}[t];
  const sb=$('s-reset')&&$('s-reset').parentNode; if(sb&&!tab.orig) tab.orig=[...sb.children];
  if(t==='all'&&tab.orig) tab.orig.forEach(n=>sb.appendChild(n));                                  // classic order
  if(own&&$(own)&&$('s-reset')&&$('s-reset').parentNode===$(own).parentNode) $('s-reset').after($(own));   // the tab's own panel first
  document.querySelectorAll('#tabBar button').forEach(b=>{ const on=b.dataset.t===t; b.classList.toggle('on',on); b.setAttribute('aria-selected',on); });
  if(t==='edit'&&!/^e-/.test(S.tool)) setTool('e-select');
  else if(t!=='edit'&&t!=='all'&&/^e-/.test(S.tool)) setTool('contour');
  if(t==='3d') load3d();
  if(t==='fold'&&window.I2D_FOLD) I2D_FOLD.update();
  if(t==='layers') scheduleLayers();
  if(t==='history') histRender();
  if(prev!==t) LS.set('i2d.tab',t);
  if(S.gray) renderSvg();
  return t;
}
$('tabBar').innerHTML=TABS.map(([k,n])=>`<button type="button" role="tab" data-t="${k}" id="tab_${k}">${n}</button>`).join('');
$('tabBar').addEventListener('click',e=>{ const b=e.target.closest('button[data-t]'); if(b) tab(b.dataset.t); });

// ======================================================================= version + update check
$('verName').textContent=V.name||'Hard Version 1.5';
$('verBuild').textContent=`(build ${V.build})`;
$('verInfo').textContent=`${V.name} · version ${V.version} · build ${V.build}${V.date?' · '+V.date:''}`;
document.title='Image → DXF · '+(V.name||'')+` (build ${V.build})`;
$('autoUpd').checked=!!LS.get('i2d.autoUpd',false);
$('autoUpd').addEventListener('change',()=>LS.set('i2d.autoUpd',$('autoUpd').checked));
let updSeen=null;
function showUpdate(j){
  updSeen=j.build; $('updText').textContent=`Update available: ${j.name||'new version'} (build ${j.build}).`; $('updBanner').hidden=false;
  $('updNote').textContent=`New build ${j.build} is available.`;
}
async function checkUpdate(manual){
  if(API.backend){ return winCheck(manual); }
  if(location.protocol==='file:'){ if(manual) $('updNote').textContent='Update check needs the web or Windows app (not a local file).'; return null; }
  try{
    const r=await fetch('version.json?_='+Date.now(),{cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    if(j.build&&j.build!==V.build){
      if($('autoUpd').checked&&!S.gray){ location.reload(); return j; }
      showUpdate(j);
    } else if(manual) $('updNote').textContent=`You are up to date (build ${V.build}).`;
    return j;
  }catch(e){ if(manual) $('updNote').textContent='Could not check for updates: '+e.message; return null; }
}
$('updCheck').onclick=()=>checkUpdate(true);
$('updReload').onclick=()=>{ if(API.backend) return winApply(); location.reload(); };
$('updLater').onclick=()=>{ $('updBanner').hidden=true; };
window.I2D15.checkUpdate=checkUpdate;
// Windows / Python edition (Flask backend)
async function winCheck(manual){
  try{ const j=await (await fetch('api/update/check',{cache:'no-store'})).json();
    if(j.error) throw new Error(j.error);
    if(j.available){ $('winUpdNote').textContent=`Update available: ${j.latest} (installed ${j.current}).`; showUpdate({name:j.latest_name||'new version',build:j.latest}); }
    else $('winUpdNote').textContent=manual?`Up to date (${j.current}).`:'';
    $('updNote').textContent=$('winUpdNote').textContent; return j;
  }catch(e){ if(manual) $('winUpdNote').textContent='Could not check for updates: '+e.message; return null; }
}
async function winApply(){
  $('winUpdNote').textContent='Downloading and installing the update… (history and settings are kept)';
  try{ const j=await (await fetch('api/update/apply',{method:'POST'})).json(); if(!j.ok) throw new Error(j.error||'update failed');
    $('winUpdNote').textContent=j.message||'Updated. Restarting…';
    const old=V.build; for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,1500)); try{ const v=await (await fetch('api/version',{cache:'no-store'})).json(); if(v.build&&v.build!==old){ location.reload(); return; } }catch(e){} }
    $('winUpdNote').textContent='Update installed. Close the window and start Image to DXF again.';
  }catch(e){ $('winUpdNote').textContent='Update failed: '+e.message; }
}
$('winUpdGo').onclick=winApply;
$('winAutoUpd').addEventListener('change',()=>fetch('api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auto_update:$('winAutoUpd').checked})}).catch(()=>{}));
async function detectBackend(){
  if(!/^https?:$/.test(location.protocol)||/github\.io$/.test(location.hostname)) return;
  try{ const r=await fetch('api/version',{cache:'no-store'}); if(!r.ok) return; const j=await r.json(); if(!j||!j.backend) return;
    API.backend=true; API.info=j; $('winUpd').hidden=false; $('winAutoUpd').checked=!!j.auto_update;
    $('histWhere').textContent='Windows app: history is saved in '+(j.history_dir||'%APPDATA%\\ImageToDXF\\history')+'.';
    histRender();
  }catch(e){}
}

// ======================================================================= help bubbles (ⓘ)
const HELP={
  resetDefaults:'Puts every setting back to how the app starts (inches, 10 in wide, threshold 128 …). The picture stays loaded and is re-traced. Contour edits are discarded; zones, crop and drawn areas are kept.',
  autoUpd:'When a new build is published, reload automatically, but only while no image is open, so you never lose work. Otherwise a banner asks you.',
  winAutoUpd:'Windows app only: check GitHub for a new release when the app starts and install it before opening. Your history and Python environment are kept.',
  threshold:'Brightness cut-off 0–255. Pixels darker than this become cut shapes (or lighter ones with Invert).',
  auto:'Pick the threshold automatically from the picture (Otsu method). Works well for clean black-on-white art.',
  invert:'Cut the light areas instead of the dark ones (for white art on a dark background).',
  blur:'Smooths the picture before tracing. Raise it for noisy photos or jagged edges; it rounds small details.',
  speckle:'Removes dots and islands smaller than this many pixels before tracing.',
  tolerance:'How far (in output units) the cut line may deviate from the pixels to save vertices. Smaller = more faithful, bigger files.',
  min_feature:'Shapes smaller than this (output units) are dropped. Stops tiny bits that would fall through the table.',
  holes:'Keep inner holes (the inside of an O, A, 8 …). Untick to cut only outer outlines.',
  drop_frame:'Drop a shape that traces the whole picture border (scanner edges, photo frames).',
  unit:'Units written into the DXF and used for every size field. Default: inches. Switching keeps sizes physically the same.',
  lock:'Keep width and height in proportion.', sizeBy:'Choose which number sets the scale: width, height, a percentage, or pixels per inch.',
  width:'Width of the output (see “refer to” below). With the lock on, height follows.', height:'Height of the output. With the lock on, width follows.',
  pct:'Scale where 100% = 96 pixels per inch.', dpi:'How many picture pixels make one inch.',
  sizeRef:'Traced shapes: the number you type is the exact DXF size of the shapes. Whole image: the picture frame (with its margins) gets that size.',
  asOn:'Use separate threshold / blur settings for the cropped area only.', asAuto:'Automatic threshold from the crop pixels only.', asNorm:'Stretch the crop’s contrast first: helps faint or dim areas.',
  asThr:'Threshold for the cropped area.', asInvert:'Invert inside the crop.', asBlur:'Blur inside the crop.', asSpeckle:'Remove specks smaller than this (crop).', asSimp:'Simplify tolerance in pixels (crop).', asMin:'Minimum shape size in pixels (crop).',
  rsAuto:'Automatic threshold for the re-scan rectangle.', rsNorm:'Stretch contrast in the re-scan rectangle first.', rsThr:'Threshold for the re-scan.', rsInvert:'Invert for the re-scan.', rsBlur:'Blur for the re-scan.', rsSpeckle:'Remove specks (re-scan).', rsSimp:'Simplify (re-scan, px).', rsMin:'Minimum size (re-scan, px).', rsReplace:'Remove the existing cuts inside the rectangle and use only the re-scan result.',
  mergeScope:'Which contours may be merged.', mergeTol:'Contours closer than this distance are treated as touching and unioned.',
  gridOn:'Show a grid over the picture. Click cells with the Grid cells tool to make an area of interest.', gridMode:'Define the grid by rows × columns or by cell size.', rows:'Grid rows.', cols:'Grid columns.', cell:'Grid cell size in output units.',
  insideFirst:'Write (and so cut) holes and nested islands before the outline that contains them, so parts don’t drop before their holes are cut.',
  nearest:'Order cuts to minimise travel between them.', ioLayers:'Put inner and outer cuts on separate layers CUT_INNER / CUT_OUTER (one-file mode).', showOrder:'Show the cut order numbers on the preview. Table jobs show P1·1, P1·2 … per pass.',
  tabsAll:'Add hold-in tabs (small uncut gaps) to every outer cut.', tabsSkipHoles:'Never put tabs on holes.', tabW:'Length of each uncut tab.', tabMode:'Fixed number of tabs per contour, or one every N units.', tabN:'Tabs per contour.', tabS:'Distance between tabs.',
  tblOn:'Split a job that is bigger than your table into passes. Each pass is its own file (or layer) with a torch park point.', tblPreset:'Common table sizes.', tblW:'Table length (X).', tblH:'Table height (Y).', tblCorner:'Where pass 1 starts on the material.',
  tblOv:'Extra overlap at each break so the passes line up.', tblMode:'Clip cuts at the break and finish them in the next pass, or keep each contour whole in the pass that holds its centre.', tblPark:'Where the torch goes at the end of each pass.', tblParkX:'Custom park X.', tblParkY:'Custom park Y.',
  tblMarks:'Add registration marks at the breaks (separate layers, not meant to be cut).', tblOut:'One DXF per pass in a zip, or a single DXF with a layer per pass.',
  limitArea:'Only export contours inside the area of interest (grid cells / drawn regions), if any.', clip:'Cut contours exactly at the area boundary instead of keeping whole shapes.', split:'One file, one layer per group, or separate files.', groupBy:'Group by contour or by area / grid cell.', zero:'Move each file so its lower-left corner is at 0,0.',
  dxfFmt:'Current: AutoCAD 2000 LWPOLYLINE (most programs). TorchMate-friendly: DXF R12 with closed POLYLINEs on one CUT layer in your units; markers, bend lines and registration marks are left out because they would be cut. R12 compatible: R12 POLYLINE, all layers kept, for older CAM software.',
  snapV:'While drawing or moving, jump to the nearest existing vertex.', snapG:'Round points to a grid of this size.', snapGs:'Snap grid size.', eraseMode:'Whole cut: tap a contour to delete it. One segment: tap an edge to remove just that segment (the cut becomes an open line).', bridgeW:'Width of a bridge made with the Connect / bridge tool.',
  frOn:'Add a border around the artwork. It is cut last.', frShape:'Rectangle, rounded rectangle or circle / ellipse.', frRad:'Corner radius of the rounded rectangle (inside edge).', frCircle:'Make the ellipse a true circle that encloses the artwork.', frOff:'Gap between the artwork’s bounding box and the frame.',
  frStyle:'Double outline: a frame band (an inner and an outer cut) that can be bridged to the art as one plate. Single outline: one border cut around everything.', frW:'Width of the frame band.',
  frBr:'Join the artwork to the frame band with bridges so everything is one piece (double outline only). The bridges run straight in from each side until they meet the art.', frBrN:'Bridges per side.', frBrW:'Bridge width.', frBrT:'Bridges on the top side.', frBrB:'Bridges on the bottom side.', frBrL:'Bridges on the left side.', frBrR:'Bridges on the right side.',
  lyN:'Number of brightness layers.', lyLo:'Threshold of the top (darkest) layer.', lyHi:'Threshold of layer 1 (the lightest cut-off, the largest piece).', lyBase:'Add a solid plate under everything as layer 1.', lyMargin:'Margin of the base plate around the art.',
  lyAlign:'Alignment holes are cut through every layer that has material there (use dowels/bolts to align). Registration marks are drawn on a REG layer for marking, not cutting.', lyHole:'Alignment hole diameter.', lyT:'Material thickness used for the 3D stack preview.', lyGap:'Gap between layers in the 3D preview.', lyOut:'Zip of one DXF per layer, a single DXF with layers LAYER_1…N, or both.',
  fdMode:'Outside: L, W, H are measured over the metal. Inside: measured inside the box.', fdL:'Box length.', fdW:'Box width.', fdH:'Box height (wall).', fdScale:'Scales L, W and H together (thickness and radius stay).',
  fdMat:'Material preset: sets a typical K-factor (you can save your own).', fdT:'Sheet thickness.', fdR:'Inside bend radius.', fdK:'K-factor: where the neutral axis sits, as a fraction of the thickness (0.33–0.5). 0.44 is typical for mild steel air bending.', fdA:'Bend angle (90° for a box).',
  fdRel:'Diameter of the round relief hole at each corner, so the corners can fold without tearing. 0 = automatic (radius T + R, i.e. Ø 2·(T+R)).', fdKerf:'Cut width of your torch/laser. Outlines are moved out by half of it so the part comes out at size.',
  fdImgMode:'Cut-outs: the dark parts of each face image are cut out. Inverted: the light parts are cut out.', fdMargin:'Keep face images this far from the bend lines and edges.', fdMirror:'Mirror the face images in the flat pattern so they read correctly from the outside once the walls are folded up.',
  v3Src:'Show the folded box or the layered stack.', v3Fold:'0% = flat, 100% = fully folded.', v3Holes:'Show cut-outs as holes.', histCap:'Maximum number of saved items; the oldest are removed first.', histMB:'Maximum storage; the oldest are removed first.'
};
let bubble=null;
function closeBubble(){ if(bubble){ bubble.remove(); bubble=null; } }
function openBubble(btn){
  closeBubble(); const t=HELP[btn.dataset.help]||btn.dataset.text; if(!t) return;
  bubble=document.createElement('div'); bubble.className='bubble'; bubble.setAttribute('role','tooltip'); bubble.textContent=t; document.body.appendChild(bubble);
  const r=btn.getBoundingClientRect(), bw=Math.min(300,innerWidth-16); bubble.style.width=bw+'px';
  let x=Math.max(8,Math.min(innerWidth-bw-8,r.left+r.width/2-bw/2)), y=r.bottom+6+scrollY;
  bubble.style.left=x+'px'; bubble.style.top=y+'px';
}
function addHelp(){
  Object.keys(HELP).forEach(id=>{
    const el=$(id); if(!el||el.dataset.hasHelp) return; el.dataset.hasHelp='1';
    const b=document.createElement('button'); b.type='button'; b.className='hlp'; b.dataset.help=id; b.textContent='ⓘ'; const lt=(el.closest('label')||{}).textContent||el.getAttribute('aria-label')||id; b.setAttribute('aria-label','Help: '+String(lt).trim().replace(/\s+/g,' ').slice(0,40));
    const lab=el.closest('label');   // a button inside a label does not toggle the label's control
    if(lab&&el.type==='range') lab.insertBefore(b,el); else if(lab&&lab.lastElementChild===el&&el.tagName!=='INPUT'||lab&&el.type==='number') el.after(b); else if(lab) lab.appendChild(b); else el.after(b);
  });
}
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('button.hlp'); if(b){ e.preventDefault(); e.stopPropagation(); if(bubble&&bubble.dataset.for===b.dataset.help) closeBubble(); else { openBubble(b); bubble&&(bubble.dataset.for=b.dataset.help); } return; }
  if(bubble&&!e.target.closest('.bubble')) closeBubble(); },true);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeBubble(); });
addEventListener('scroll',()=>{},{passive:true});

// ======================================================================= settings snapshot / reset
const SKIP=/^(fileIn|phoneIn|urlIn|histCap|histMB|autoUpd|winAutoUpd)$/;
function settingEls(){ return [...document.querySelectorAll('#panel input[id], #panel select[id], #view .toolbar input[id]')].filter(el=>!SKIP.test(el.id)&&el.type!=='file'&&el.type!=='radio'&&!el.dataset.keep&&!el.closest('#list')); }
function collectSettings(){ const o={unit:unit(),tab:curTab,v:{}}; settingEls().forEach(el=>{ o.v[el.id]=el.type==='checkbox'?el.checked:el.value; }); return o; }
function fire(el){ ['input','change'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true}))); }
function refreshDependents(){ settingEls().forEach(el=>{ if(el.id!=='unit'&&(el.type==='checkbox'||el.tagName==='SELECT')) fire(el); }); document.querySelectorAll('input[type=range]').forEach(el=>{ const o=$('o_'+el.id); if(o) o.textContent=el.value; }); }
function applySettings(o){
  if(!o||!o.v) return;
  const u=o.unit==='mm'?'mm':'in'; $('unit').value=u; curUnit=u; document.querySelectorAll('.u').forEach(x=>x.textContent=u);
  try{ localStorage.setItem(UNIT_KEY,u); }catch(e){}
  settingEls().forEach(el=>{ if(!(el.id in o.v)||el.id==='unit') return; const v=o.v[el.id]; if(el.type==='checkbox') el.checked=!!v; else el.value=v; el.dataset.last=el.value; });
  refreshDependents(); tblSave(); syncSize();
}
function resetDefaults(skipConfirm){
  if(!skipConfirm&&!confirm('Reset all settings to their defaults?\n\nThe image stays loaded and is re-traced. Contour edits are discarded; zones, crop and areas are kept.')) return false;
  settingEls().forEach(el=>{
    if(el.type==='checkbox') el.checked=el.defaultChecked;
    else if(el.tagName==='SELECT'){ const d=[...el.options].find(x=>x.defaultSelected)||el.options[0]; if(d) el.value=d.value; }
    else el.value=el.defaultValue;
    el.dataset.last=el.value;
  });
  try{ localStorage.removeItem(UNIT_KEY); localStorage.removeItem(TBL_KEY); localStorage.removeItem('i2d.v15'); }catch(e){}
  curUnit='mm'; applyUnitDefaults('in'); tblLoad(); $('mergeTol').value=0.01; $('mergeTol').dataset.last='0.01';
  refreshDependents(); S.vb=null; zoomUser=false;
  if(window.I2D_FOLD) I2D_FOLD.reset();
  syncSize(); if(S.gray) retrace(false); else renderAll();
  setStatus('Settings reset to defaults'+(S.gray?' · re-tracing the image':''));
  return true;
}
$('resetDefaults').onclick=()=>resetDefaults(false);
window.I2D15.resetDefaults=resetDefaults; window.I2D15.collectSettings=collectSettings; window.I2D15.applySettings=applySettings;
// remember the Hard 1.5 panels (frame / layers / edit / fold) on this device
const KEEP_IDS=()=>[...document.querySelectorAll('#s-frame [id], #s-layers [id], #s-edit [id], #s-fold [id], #dxfFmt, #s-3d select')].filter(el=>/INPUT|SELECT/.test(el.tagName)&&el.type!=='file');
function save15(){ const o={unit:unit()}; KEEP_IDS().forEach(el=>o[el.id]=el.type==='checkbox'?el.checked:el.value); LS.set('i2d.v15',o); }
function load15(){ const o=LS.get('i2d.v15',null); if(!o) return; const f=o.unit&&o.unit!==unit()?(unit()==='in'?1/25.4:25.4):1;
  KEEP_IDS().forEach(el=>{ if(!(el.id in o)) return; if(el.type==='checkbox') el.checked=!!o[el.id]; else el.value=el.classList.contains('len')&&f!==1?fmt(parseFloat(o[el.id])*f,7):o[el.id]; }); }

// ======================================================================= zoom / pan
let zoomUser=false;
function baseVb(){ return (window.I2D_VB&&I2D_VB())||[0,0,S.W,S.H]; }
function curVb(){ return S.vb||baseVb(); }
function zoomAt(f,cx,cy){
  if(!S.gray) return; const [x,y,w,h]=curVb(); const b=baseVb();
  let nw=Math.max(b[2]/64,Math.min(b[2]*4,w/f)), nh=nw*h/w;
  if(cx==null){ cx=x+w/2; cy=y+h/2; }
  S.vb=[cx-(cx-x)*nw/w, cy-(cy-y)*nh/h, nw, nh]; zoomUser=true; renderSvg(); zoomNote();
}
function zoomFit(){ S.vb=null; zoomUser=false; if(S.gray) renderSvg(); zoomNote(); }
function zoomNote(){ const b=baseVb(), z=S.vb?b[2]/S.vb[2]:1; $('zFit').textContent=z>1.01||z<0.99?`Fit (${Math.round(z*100)}%)`:'Fit'; }
function svgPoint(cx,cy){ const svg=$('svg'), p=svg.createSVGPoint(); p.x=cx; p.y=cy; const q=p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x,q.y]; }
$('zIn').onclick=()=>zoomAt(1.5); $('zOut').onclick=()=>zoomAt(1/1.5); $('zFit').onclick=zoomFit;
const stage=$('stage');
stage.addEventListener('wheel',e=>{ if(!S.gray) return; e.preventDefault(); const [x,y]=svgPoint(e.clientX,e.clientY); zoomAt(Math.pow(1.0015,-e.deltaY*(e.deltaMode===1?33:1)),x,y); },{passive:false});
const ptrs=new Map(); let gest=null;
function panBy(dxScreen,dyScreen){ const svg=$('svg'), r=svg.getBoundingClientRect(), [x,y,w,h]=curVb(), k=Math.max(w/r.width,h/r.height); S.vb=[x-dxScreen*k,y-dyScreen*k,w,h]; zoomUser=true; renderSvg(); }
stage.addEventListener('pointerdown',e=>{
  if(!S.gray) return; if(e.pointerType==='mouse'||!e.isPrimary&&ptrs.size>1) ptrs.clear(); if(e.isPrimary) ptrs.clear(); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){ S.drag=null; S.edit=null; ed.drag=null; const [a,b]=[...ptrs.values()]; gest={kind:'pinch',d:Math.hypot(a.x-b.x,a.y-b.y),c:[(a.x+b.x)/2,(a.y+b.y)/2]}; e.stopPropagation(); e.preventDefault(); return; }
  if(e.button===1||S.tool==='e-pan'){ gest={kind:'pan',x:e.clientX,y:e.clientY}; try{ stage.setPointerCapture(e.pointerId); }catch(_){} e.stopPropagation(); e.preventDefault(); }
},true);
stage.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(!gest) return; e.stopPropagation();
  if(gest.kind==='pan'){ panBy(e.clientX-gest.x,e.clientY-gest.y); gest.x=e.clientX; gest.y=e.clientY; }
  else if(gest.kind==='pinch'&&ptrs.size>=2){ const [a,b]=[...ptrs.values()], d=Math.hypot(a.x-b.x,a.y-b.y), c=[(a.x+b.x)/2,(a.y+b.y)/2];
    panBy(c[0]-gest.c[0],c[1]-gest.c[1]); const p=svgPoint(c[0],c[1]); zoomAt(d/(gest.d||d),p[0],p[1]); gest.d=d; gest.c=c; }
},true);
const endPtr=e=>{ ptrs.delete(e.pointerId); if(gest&&(gest.kind==='pan'||ptrs.size<2)){ if(gest.kind==='pinch'||gest.kind==='pan') e.stopPropagation(); gest=null; } };
stage.addEventListener('pointerup',endPtr,true); stage.addEventListener('pointercancel',endPtr,true);
window.addEventListener('pointerup',e=>{ if(ptrs.has(e.pointerId)) endPtr(e); },true); window.addEventListener('pointercancel',e=>{ if(ptrs.has(e.pointerId)) endPtr(e); },true);

// ======================================================================= edit tools
const ed={pick:null,draft:null,drag:null,hover:null};
const snapR=()=>{ const svg=$('svg'), r=svg.getBoundingClientRect(), [,,w]=curVb(); return (matchMedia('(pointer:coarse)').matches?16:9)*w/(r.width||w); };
function scalePx(){ const sc=computeScale(); return sc.ok?sc.sx:1; }
function allShapes(){ const L=[]; S.paths.forEach((q,i)=>L.push({t:'p',i,pts:q,closed:true})); (S.lines||[]).forEach((l,i)=>L.push({t:'l',i,pts:l.pts,closed:!!l.closed})); return L; }
function nearestVertex(x,y,r){ let best=null, r2=r*r; for(const s of allShapes()){ const q=s.pts; for(let k=0;k<q.length;k++){ const d=(q[k][0]-x)**2+(q[k][1]-y)**2; if(d<r2){ r2=d; best={s,k,p:q[k]}; } } } return best; }
function segD2(px,py,a,b){ const dx=b[0]-a[0], dy=b[1]-a[1], L=dx*dx+dy*dy; let t=L?((px-a[0])*dx+(py-a[1])*dy)/L:0; t=Math.max(0,Math.min(1,t)); return (px-a[0]-t*dx)**2+(py-a[1]-t*dy)**2; }
function nearestSeg(x,y,r){ let best=null, r2=r*r; for(const s of allShapes()){ const q=s.pts, n=q.length, m=s.closed?n:n-1; for(let k=0;k<m;k++){ const d=segD2(x,y,q[k],q[(k+1)%n]); if(d<r2){ r2=d; best={s,k}; } } } return best; }
function insideShape(x,y){ let best=null; S.paths.forEach((q,i)=>{ if(D.inRing(x,y,q)){ const a=S.items[i]?Math.abs(S.items[i].area):0; if(!best||a<best.a) best={s:{t:'p',i,pts:q,closed:true},a}; } }); return best&&best.s; }
function snap(p,exclude){
  if($('snapV').checked){ const v=nearestVertex(p[0],p[1],snapR()); if(v&&(!exclude||v.p!==exclude)) return v.p.slice(); }
  if($('snapG').checked){ const g=num('snapGs',0)/scalePx(); if(g>0) return [Math.round(p[0]/g)*g,Math.round(p[1]/g)*g]; }
  return p;
}
function holesOf(polys){ const d=D.nestingDepths(polys); return d.map(v=>v%2===1); }
function commit(label,paths,lines,sel){
  const keepSel=sel||new Set(paths.map((_,i)=>i));
  setContours(paths,holesOf(paths),[...keepSel],label); S.lines=lines;
  $('editNote').textContent=label+' · undo with Undo / Ctrl+Z'; ed.pick=null; renderAll(); renderUndo();
}
function remapSel(removeIdx,newCount){ const rm=new Set(removeIdx), sel=new Set(); let j=0; S.paths.forEach((_,i)=>{ if(rm.has(i)) return; if(S.selected.has(i)) sel.add(j); j++; }); for(;j<newCount;j++) sel.add(j); return sel; }
function withoutIdx(arr,idx){ const rm=new Set(idx); return arr.filter((_,i)=>!rm.has(i)); }
function openAt(q,k,closed){ // remove segment k (q[k]->q[k+1]) from a closed ring -> one open polyline
  if(closed){ const n=q.length; const out=[]; for(let t=1;t<=n;t++) out.push(q[(k+t)%n]); return [out]; }
  const a=q.slice(0,k+1), b=q.slice(k+1); return [a,b].filter(x=>x.length>=2);
}
function editDown(e){
  const t=S.tool; if(!/^e-/.test(t)||t==='e-pan'||!S.gray) return;
  const [x,y]=svgPoint(e.clientX,e.clientY), r=snapR();
  if(t==='e-select'){ const s=nearestSeg(x,y,r)||(insideShape(x,y)?{s:insideShape(x,y)}:null);
    ed.pick=s?{s:s.s}:null; S.hl=s&&s.s.t==='p'?s.s.i:null;
    $('editNote').textContent=s?(s.s.t==='p'?`Contour #${s.s.i+1}: ${s.s.pts.length} vertices${S.items[s.s.i]&&S.items[s.s.i].hole?' (hole)':''}. Press Delete to erase it.`:`Line ${s.s.i+1}: ${s.s.pts.length} points${S.lines[s.s.i].drawn?' (drawn)':''}.`):'Nothing here.'; renderSvg(); return; }
  if(t==='e-erase'){
    if($('eraseMode').value==='seg'){ const g=nearestSeg(x,y,r); if(!g) return setStatus('Tap closer to an edge to erase a segment',true);
      const parts=openAt(g.s.pts,g.k,g.s.closed);
      if(g.s.t==='p'){ commit('Erase segment',withoutIdx(S.paths,[g.s.i]),S.lines.concat(parts.map(p=>({pts:p,drawn:false}))),remapSel([g.s.i],S.paths.length-1)); }
      else { const L=S.lines.slice(); const old=L[g.s.i]; L.splice(g.s.i,1,...parts.map(p=>({pts:p,drawn:old.drawn}))); commit('Erase segment',S.paths,L,new Set(S.selected)); }
      return; }
    const g=nearestSeg(x,y,r); const s=g?g.s:insideShape(x,y); if(!s) return setStatus('Nothing to erase here',true);
    if(s.t==='p') commit('Erase cut',withoutIdx(S.paths,[s.i]),S.lines,remapSel([s.i],S.paths.length-1));
    else commit('Erase line',S.paths,withoutIdx(S.lines,[s.i]),new Set(S.selected));
    return; }
  if(t==='e-draw'){ const p=snap([x,y]);
    if(!ed.draft) ed.draft=[p];
    else { const f=ed.draft[0]; if(ed.draft.length>=3&&Math.hypot(p[0]-f[0],p[1]-f[1])<r) return drawClose(); ed.draft.push(p); }
    $('editNote').textContent=`Drawing: ${ed.draft.length} point(s). Tap the first point or “Close shape” to close it, “Finish line” for an open line.`; renderSvg(); return; }
  if(t==='e-move'){ const v=nearestVertex(x,y,r); if(!v) return;
    ed.drag={s:v.s,k:v.k,orig:v.p.slice(),pts:v.s.pts.map(p=>p.slice())}; try{ $('svg').setPointerCapture(e.pointerId); }catch(_){} e.preventDefault(); return; }
  if(t==='e-straight'||t==='e-split'){
    const v=nearestVertex(x,y,r); if(!v) return setStatus('Tap a vertex',true);
    if(t==='e-split'&&v.s.t==='l'&&!v.s.closed){ const q=v.s.pts; if(v.k===0||v.k===q.length-1) return setStatus('Pick an inner point of the line to split it',true);
      const L=S.lines.slice(), old=L[v.s.i]; L.splice(v.s.i,1,{pts:q.slice(0,v.k+1),drawn:old.drawn},{pts:q.slice(v.k),drawn:old.drawn}); return commit('Split line',S.paths,L,new Set(S.selected)); }
    if(!ed.pick||ed.pick.kind!==t){ ed.pick={kind:t,s:v.s,k:v.k,p:v.p}; $('editNote').textContent=(t==='e-split'?'Split: now tap a second vertex on the same cut.':'Straighten: now tap the second vertex; the points between are removed.'); renderSvg(); return; }
    const a=ed.pick; ed.pick=null;
    if(a.s.t!==v.s.t||a.s.i!==v.s.i||a.k===v.k){ renderSvg(); return setStatus('Pick two different vertices on the same cut',true); }
    const q=v.s.pts, n=q.length; let i=a.k, j=v.k;
    if(t==='e-straight'){
      let out;
      if(v.s.closed){ const fw=(j-i+n)%n, bw=(i-j+n)%n; if(fw>bw){ [i,j]=[j,i]; } out=[]; for(let k=0;k<n;k++){ const d=(k-i+n)%n, dj=(j-i+n)%n; if(d===0||d>=dj) out.push(q[k]); } }
      else { if(i>j) [i,j]=[j,i]; out=q.slice(0,i+1).concat(q.slice(j)); }
      if(v.s.closed&&out.length<3) return setStatus('Too few points left',true);
      if(v.s.t==='p'){ const P=S.paths.slice(); P[v.s.i]=out; commit('Straighten',P,S.lines,new Set(S.selected)); }
      else { const L=S.lines.slice(); L[v.s.i]=Object.assign({},L[v.s.i],{pts:out}); commit('Straighten',S.paths,L,new Set(S.selected)); }
      return; }
    // split a closed cut along the chord i-j into two closed cuts
    if(!v.s.closed) return; if(i>j) [i,j]=[j,i]; if(j-i<2||n-(j-i)<2) return setStatus('Vertices are adjacent: nothing to split',true);
    const A=q.slice(i,j+1), B=q.slice(j).concat(q.slice(0,i+1));
    if(v.s.t==='p'){ const P=withoutIdx(S.paths,[v.s.i]).concat([A,B]); commit('Split cut',P,S.lines,remapSel([v.s.i],P.length)); }
    else { const L=S.lines.slice(); L.splice(v.s.i,1,{pts:A,closed:true,drawn:true},{pts:B,closed:true,drawn:true}); commit('Split cut',S.paths,L,new Set(S.selected)); }
    return; }
  if(t==='e-bridge'){
    const v=nearestVertex(x,y,r);
    const endp=v&&v.s.t==='l'&&!v.s.closed&&(v.k===0||v.k===v.s.pts.length-1)?v:null;
    const g=endp?null:(nearestSeg(x,y,r)||(insideShape(x,y)?{s:insideShape(x,y)}:null));
    const hit=endp?{kind:'end',s:endp.s,k:endp.k}:g&&g.s.t==='p'?{kind:'cut',s:g.s}:null;
    if(!hit) return setStatus('Tap a cut (to bridge two cuts) or an open line end (to connect lines)',true);
    if(!ed.pick||ed.pick.kind!=='e-bridge'){ ed.pick=Object.assign({kind:'e-bridge'},hit); $('editNote').textContent=hit.kind==='end'?'Connect: tap another line end (or the other end of the same line to close it).':'Bridge: tap the second cut.'; renderSvg(); return; }
    const a=ed.pick; ed.pick=null;
    if(a.kind==='end'&&hit.kind==='end') return connectEnds(a,hit);
    if(a.kind==='cut'&&hit.kind==='cut'&&a.s.i!==hit.s.i) return bridgeCuts(a.s.i,hit.s.i);
    renderSvg(); return setStatus('Pick two cuts, or two open line ends',true);
  }
}
function connectEnds(a,b){
  const L=S.lines.slice(), A=L[a.s.i].pts, B=L[b.s.i].pts;
  if(a.s.i===b.s.i){ if(A.length<3) return setStatus('Too short to close',true); const P=S.paths.concat([A.slice()]); L.splice(a.s.i,1); return commit('Close line into a cut',P,L,new Set([...S.selected,P.length-1])); }
  const a1=a.k===0?A.slice().reverse():A.slice(), b1=b.k===0?B.slice():B.slice().reverse();
  const j={pts:a1.concat(b1),drawn:L[a.s.i].drawn||L[b.s.i].drawn};
  const keep=L.filter((_,i)=>i!==a.s.i&&i!==b.s.i); keep.push(j); commit('Connect lines',S.paths,keep,new Set(S.selected));
}
function bridgeCuts(i,j){
  const A=S.paths[i], B=S.paths[j]; let best=[Infinity];
  const step=a=>Math.max(1,Math.floor(a.length/400));
  for(let p=0;p<A.length;p+=step(A)) for(let q=0;q<B.length;q+=step(B)){ const d=(A[p][0]-B[q][0])**2+(A[p][1]-B[q][1])**2; if(d<best[0]) best=[d,A[p],B[q]]; }
  const [,pa,pb]=best, w=num('bridgeW',0.1)/scalePx(), dx=pb[0]-pa[0], dy=pb[1]-pa[1], L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L, nx=-uy*w/2, ny=ux*w/2, ext=Math.max(1,w/2);
  const s0=[pa[0]-ux*ext,pa[1]-uy*ext], s1=[pb[0]+ux*ext,pb[1]+uy*ext];
  const rect=[[[s0[0]+nx,s0[1]+ny],[s1[0]+nx,s1[1]+ny],[s1[0]-nx,s1[1]-ny],[s0[0]-nx,s0[1]-ny],[s0[0]+nx,s0[1]+ny]]];
  const cl=q=>{ const r=q.map(p=>[p[0],p[1]]); r.push(r[0].slice()); return [r]; };
  const holeA=S.items[i]&&S.items[i].hole, holeB=S.items[j]&&S.items[j].hole;
  let res; try{ res=(holeA&&holeB)?PC().union(cl(A),cl(B),rect):PC().union(cl(A),cl(B),rect); }catch(e){ return setStatus('Bridge failed: '+e.message,true); }
  const rings=[]; res.forEach(poly=>poly.forEach(r=>rings.push(r.slice(0,-1))));
  const P=withoutIdx(S.paths,[i,j]).concat(rings);
  commit(holeA||holeB?'Bridge (holes joined)':'Bridge cuts',P,S.lines,remapSel([i,j],P.length));
}
function drawFinish(){ if(!ed.draft||ed.draft.length<2){ ed.draft=null; renderSvg(); return; } const L=(S.lines||[]).concat([{pts:ed.draft,drawn:true}]); ed.draft=null; commit('Draw line',S.paths,L,new Set(S.selected)); }
function drawClose(){ if(!ed.draft||ed.draft.length<3) return setStatus('A closed shape needs at least 3 points',true); const L=(S.lines||[]).concat([{pts:ed.draft,closed:true,drawn:true}]); ed.draft=null; commit('Draw closed shape',S.paths,L,new Set(S.selected)); }
$('drawFinish').onclick=drawFinish; $('drawClose').onclick=drawClose; $('drawCancel').onclick=()=>{ ed.draft=null; ed.pick=null; $('editNote').textContent=''; renderSvg(); };
$('undo2').onclick=()=>$('undoEdit').click(); $('redo2').onclick=()=>redoEdit();
$('recalcOrder').onclick=()=>{ if(!S.gray) return; if(!$('insideFirst').checked&&!$('nearest').checked) $('nearest').checked=true; $('showOrder').checked=true; refresh(); setStatus('Cut order recalculated'+(S.plan?` · ${S.plan.stats.units} cut(s)`:'')); };
const svgEl2=$('svg');
svgEl2.addEventListener('pointerdown',e=>{ if(/^e-/.test(S.tool)&&!gest) editDown(e); });
svgEl2.addEventListener('pointermove',e=>{
  if(!/^e-/.test(S.tool)) return; const [x,y]=svgPoint(e.clientX,e.clientY);
  if(ed.drag){ const p=snap([x,y],ed.drag.orig); ed.drag.pts[ed.drag.k]=p; renderSvg(); return; }
  if(S.tool==='e-draw'&&ed.draft){ ed.hover=snap([x,y]); renderSvg(); }
});
svgEl2.addEventListener('pointerup',()=>{
  if(!ed.drag) return; const d=ed.drag; ed.drag=null;
  if(d.pts[d.k][0]===d.orig[0]&&d.pts[d.k][1]===d.orig[1]){ renderSvg(); return; }
  if(d.s.t==='p'){ const P=S.paths.slice(); P[d.s.i]=d.pts; commit('Move vertex',P,S.lines,new Set(S.selected)); }
  else { const L=S.lines.slice(); L[d.s.i]=Object.assign({},L[d.s.i],{pts:d.pts}); commit('Move vertex',S.paths,L,new Set(S.selected)); }
});
svgEl2.addEventListener('dblclick',e=>{ if(S.tool==='e-draw'&&ed.draft){ e.preventDefault(); if(ed.draft.length>2){ ed.draft.pop(); } drawFinish(); } });
document.addEventListener('keydown',e=>{
  if(/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||'')) return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); if(e.shiftKey) redoEdit(); else $('undoEdit').click(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){ e.preventDefault(); redoEdit(); }
  else if(S.tool==='e-draw'&&e.key==='Enter') drawFinish();
  else if(S.tool==='e-draw'&&e.key==='Escape'){ ed.draft=null; renderSvg(); }
  else if(S.tool==='e-select'&&(e.key==='Delete'||e.key==='Backspace')&&ed.pick&&ed.pick.s){ const s=ed.pick.s; ed.pick=null;
    if(s.t==='p') commit('Erase cut',withoutIdx(S.paths,[s.i]),S.lines,remapSel([s.i],S.paths.length-1)); else commit('Erase line',S.paths,withoutIdx(S.lines,[s.i]),new Set(S.selected)); }
});
window.I2D15.edit={ed,commit,bridgeCuts,connectEnds,zoomAt,zoomFit,curVb};

// ======================================================================= frame
function artBoxPx(){
  const ids=effectiveSelected(); let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const add=q=>{ for(const [x,y] of q){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } };
  ids.forEach(i=>add(S.paths[i])); (S.lines||[]).forEach(l=>add(l.pts));
  return isFinite(x0)?[x0,y0,x1,y1]:null;
}
function shapeRing(kind,hw,hh,r,circle){   // output units, centred at 0,0
  const out=[];
  if(kind==='ellipse'){ let a=hw*Math.SQRT2, b=hh*Math.SQRT2; if(circle){ a=b=Math.hypot(hw,hh); } const n=144; for(let k=0;k<n;k++){ const t=2*Math.PI*k/n; out.push([a*Math.cos(t),b*Math.sin(t)]); } return {ring:out,a,b}; }
  r=kind==='round'?Math.max(0,Math.min(r,hw,hh)):0;
  if(r<=0) return {ring:[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]};
  const seg=16, C=[[hw-r,hh-r,0],[-hw+r,hh-r,90],[-hw+r,-hh+r,180],[hw-r,-hh+r,270]];
  C.forEach(([cx,cy,a0])=>{ for(let k=0;k<=seg;k++){ const t=(a0+90*k/seg)*Math.PI/180; out.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]); } });
  return {ring:out};
}
let frCache={key:null,val:null};
function frameGeom(){
  if(!$('frOn').checked||!S.gray) return null; const sc=computeScale(); if(!sc.ok) return null;
  const b=artBoxPx(); if(!b) return null;
  const key=[S.paths.length,S.paths[0]&&S.paths[0].length,S.selected.size,(S.lines||[]).length,b.join(','),sc.sx,sc.sy,KEEP_IDS().filter(el=>el.id.startsWith('fr')).map(el=>el.type==='checkbox'?el.checked:el.value).join('|')].join(';');
  if(frCache.key===key) return frCache.val;
  const cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2, hw=(b[2]-b[0])/2*sc.sx, hh=(b[3]-b[1])/2*sc.sy;
  const kind=$('frShape').value, off=Math.max(0,num('frOff')), w=Math.max(0,num('frW')), r=Math.max(0,num('frRad')), circle=$('frCircle').checked, band=$('frStyle').value==='band'&&w>0;
  const toPx=q=>q.map(([x,y])=>[cx+x/sc.sx,cy-y/sc.sy]);
  let inner, outer;
  if(kind==='ellipse'){ const base=shapeRing('ellipse',hw,hh,0,circle); const mk=d=>{ const a=base.a+d, bb=(circle?base.a:base.b)+d, n=144, o=[]; for(let k=0;k<n;k++){ const t=2*Math.PI*k/n; o.push([a*Math.cos(t),bb*Math.sin(t)]); } return o; };
    inner=mk(off); outer=band?mk(off+w):null; }
  else { inner=shapeRing(kind,hw+off,hh+off,r).ring; outer=band?shapeRing(kind,hw+off+w,hh+off+w,kind==='round'?r+w:0).ring:null; }
  const rings=[toPx(inner)].concat(outer?[toPx(outer)]:[]);
  const val={rings,band,cx,cy,sc,bridges:band&&$('frBr').checked};
  frCache={key,val}; return val;
}
function bridgeRects(G,selRings){
  const n=Math.max(1,Math.min(10,Math.round(num('frBrN',1)))), w=num('frBrW',0.2), sc=G.sc, out=[];
  const inner=G.rings[0], outer=G.rings[1]; const b=artBoxPx(); if(!b||!outer) return out;
  const inArt=(x,y)=>{ let c=0; for(const q of selRings) if(D.inRing(x,y,q)) c++; return c%2===1; };
  const inBand=(x,y)=>D.inRing(x,y,outer)&&!D.inRing(x,y,inner);
  const sides=[['frBrT',0,-1],['frBrB',0,1],['frBrL',-1,0],['frBrR',1,0]];
  const ob=D.bboxOf(outer);
  sides.forEach(([id,sx,sy])=>{ if(!$(id).checked) return;
    for(let k=0;k<n;k++){
      const f=(k+0.5)/n, horiz=sx===0;
      const along=horiz?b[0]+(b[2]-b[0])*f:b[1]+(b[3]-b[1])*f;
      let x=horiz?along:(sx<0?ob[0]:ob[2]), y=horiz?(sy<0?ob[1]:ob[3]):along;
      const dx=-sx, dy=-sy, stepPx=0.5; let enter=null, hit=null;
      for(let t=0;t<20000;t++){ x+=dx*stepPx; y+=dy*stepPx; if(x<ob[0]-1||x>ob[2]+1||y<ob[1]-1||y>ob[3]+1) break;
        if(enter==null&&inBand(x,y)) enter=[x,y]; if(enter&&inArt(x,y)){ hit=[x,y]; break; } }
      if(!enter||!hit) continue;
      const hwPx=horiz?w/2/sc.sx:w/2/sc.sy, ovl=2;
      if(horiz){ const ya=Math.min(enter[1],hit[1]+dy*ovl), yb=Math.max(enter[1],hit[1]+dy*ovl); out.push([[along-hwPx,ya],[along+hwPx,ya],[along+hwPx,yb],[along-hwPx,yb]]); }
      else { const xa=Math.min(enter[0],hit[0]+dx*ovl), xb=Math.max(enter[0],hit[0]+dx*ovl); out.push([[xa,along-hwPx],[xb,along-hwPx],[xb,along+hwPx],[xa,along+hwPx]]); }
    } });
  return out;
}
const closeR=q=>{ const r=q.map(p=>[p[0],p[1]]); r.push(r[0].slice()); return r; };
window.I2D_EXTRA=function(){
  const ex=[];
  (S.lines||[]).forEach(l=>ex.push({pts:l.pts,closed:!!l.closed,kind:'line',layer:'CUT_EDIT'}));
  const G=frameGeom(); if(G&&!G.bridges) G.rings.forEach(q=>ex.push({pts:q,closed:true,kind:'frame',layer:'CUT_FRAME'}));
  return ex;
};
window.I2D_PREP=function(polys,o){
  const G=frameGeom(); if(!G||!G.bridges) return null;
  const sel=o.selected.map(i=>polys[i]);
  try{
    let art=[]; sel.forEach(q=>{ const p=[[closeR(q)]]; art=art.length?PC().xor(art,p):p; });
    const band=PC().difference([[closeR(G.rings[1])]],[[closeR(G.rings[0])]]);
    const br=bridgeRects(G,sel).map(q=>[closeR(q)]);
    const res=PC().union(art,band,...br);
    const rings=[]; res.forEach(poly=>poly.forEach(r=>rings.push(r.slice(0,-1))));
    const d=D.nestingDepths(rings);
    const o2=Object.assign({},o,{selected:rings.map((_,i)=>i),isHole:d.map(v=>v%2===1),framed:true,extra:(o.extra||[]).filter(x=>x.kind!=='frame')});
    if(o2.tabs&&!o2.tabs.allOuter) o2.tabs=null; else if(o2.tabs) o2.tabs=Object.assign({},o2.tabs,{ids:[]});
    $('frNote').textContent=`Frame band + ${br.length} bridge(s) merged with the artwork into ${res.length} piece(s) (${rings.length} cuts). The DXF size includes the frame.`;
    return {polys:rings,o:o2};
  }catch(e){ $('frNote').textContent='⚠ Could not merge the bridges: '+e.message; return null; }
};
window.I2D_VB=function(){
  const G=frameGeom(); if(!G) return null; let x0=0,y0=0,x1=S.W,y1=S.H;
  G.rings.forEach(q=>q.forEach(([x,y])=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }));
  if(x0>=0&&y0>=0&&x1<=S.W&&y1<=S.H) return null; const m=(x1-x0)*0.02; return [x0-m,y0-m,x1-x0+2*m,y1-y0+2*m];
};
function frameUi(){
  const k=$('frShape').value, band=$('frStyle').value==='band';
  $('frRadRow').hidden=k!=='round'; $('frCircle').closest('label').hidden=k!=='ellipse'; $('frWRow').hidden=!band;
  ['frBr','frBrN','frBrW','frBrT'].forEach(id=>{ const el=$(id); el.disabled=!band; });
  if(!$('frOn').checked) $('frNote').textContent='';
  else if(!$('frBr').checked||!band){ const G=frameGeom(); if(G){ const bb=D.bboxOf(G.rings[G.rings.length-1]); $('frNote').textContent=`Frame ${fmt((bb[2]-bb[0])*G.sc.sx,5)} × ${fmt((bb[3]-bb[1])*G.sc.sy,5)} ${unit()} · ${G.rings.length} cut(s), cut last${band?' (band)':''}. The artwork keeps the size you set.`; } }
}
document.querySelectorAll('#s-frame input, #s-frame select').forEach(el=>el.addEventListener('input',()=>{ frCache.key=null; frameUi(); if(!zoomUser) S.vb=null; save15(); refresh(); }));

// ======================================================================= overlay (frame, lines, vertices, draft)
window.I2D_OVERLAY=function(){
  let h=''; const [,,vw]=curVb(), svg=$('svg'), k=vw/((svg.getBoundingClientRect().width)||vw);
  const G=frameGeom();
  if(G){ if(G.bridges){ const sel=effectiveSelected().map(i=>S.paths[i]); bridgeRects(G,sel).forEach(q=>{ h+=`<polygon class="frbr" points="${q.map(p=>p.join(',')).join(' ')}"/>`; }); }
    G.rings.forEach(q=>{ h+=`<polygon class="frame" points="${q.map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join(' ')}"/>`; }); }
  (S.lines||[]).forEach((l,i)=>{ h+=`<${l.closed?'polygon':'polyline'} class="eline${ed.pick&&ed.pick.s&&ed.pick.s.t==='l'&&ed.pick.s.i===i?' hl':''}" points="${l.pts.map(p=>p.join(',')).join(' ')}"/>`; });
  if(/^e-/.test(S.tool)){
    const r=3*k, show=[];
    if(ed.drag) show.push(ed.drag.pts); else if(S.hl!=null&&S.paths[S.hl]) show.push(S.paths[S.hl]);
    if(ed.pick&&ed.pick.s) show.push(ed.pick.s.pts);
    if(ed.drag) h+=`<polygon class="edrag" points="${ed.drag.pts.map(p=>p.join(',')).join(' ')}"/>`;
    show.forEach(q=>{ if(q.length<=1500) q.forEach(p=>{ h+=`<circle class="vtx" cx="${p[0]}" cy="${p[1]}" r="${r}"/>`; }); });
    if(ed.pick&&ed.pick.p) h+=`<circle class="vtx pick" cx="${ed.pick.p[0]}" cy="${ed.pick.p[1]}" r="${r*2}"/>`;
    if(ed.draft){ const q=ed.draft.concat(ed.hover?[ed.hover]:[]); h+=`<polyline class="draft" points="${q.map(p=>p.join(',')).join(' ')}"/>`; ed.draft.forEach(p=>{ h+=`<circle class="vtx" cx="${p[0]}" cy="${p[1]}" r="${r}"/>`; }); }
  }
  return h;
};

// ======================================================================= brightness layers
let lyTimer=null, LY=null;
function lyThresholds(){ const n=Math.max(2,Math.min(12,Math.round(num('lyN',3)))), lo=num('lyLo',60), hi=num('lyHi',200), out=[]; for(let i=0;i<n;i++) out.push(Math.round(hi-(hi-lo)*i/(n-1))); return out; }
function scheduleLayers(){ clearTimeout(lyTimer); lyTimer=setTimeout(()=>{ try{ computeLayers(); }catch(e){ $('lyNote').textContent='⚠ '+e.message; } },200); }
function computeLayers(){
  $('lyThr').textContent=lyThresholds().join(', ');
  if(!S.gray){ LY=null; $('lyPrev').innerHTML=''; $('lyNote').textContent='Load an image first.'; return null; }
  const sc=computeScale(); if(!sc.ok) return null;
  const base=params(), thr=lyThresholds(), layers=[];
  thr.forEach((t,i)=>{ const p=Object.assign({},base,{threshold:t,auto:false}); const r=T.trace(traceGray(),S.W,S.H,p); layers.push({n:i+1,t,polys:r.polys}); });
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; layers.forEach(L=>L.polys.forEach(q=>q.forEach(([x,y])=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; })));
  if(!isFinite(x0)){ LY=null; $('lyNote').textContent='No shapes at these thresholds.'; $('lyPrev').innerHTML=''; return null; }
  const m=num('lyMargin',0.5); const mx=m/sc.sx, my=m/sc.sy;
  if($('lyBase').checked){ layers.unshift({n:0,t:null,polys:[[[x0-mx,y0-my],[x1+mx,y0-my],[x1+mx,y1+my],[x0-mx,y1+my]]],plate:true}); layers.forEach((L,i)=>L.n=i+1); x0-=mx; y0-=my; x1+=mx; y1+=my; }
  const align=$('lyAlign').value, hr=num('lyHole',0.25)/2, ins=Math.max(hr*2,m/2);
  const pts=[[x0+ins/sc.sx,y0+ins/sc.sy],[x1-ins/sc.sx,y0+ins/sc.sy],[x1-ins/sc.sx,y1-ins/sc.sy],[x0+ins/sc.sx,y1-ins/sc.sy]];
  layers.forEach(L=>{ L.holes=[]; if(align!=='holes') return; pts.forEach(p=>{ let c=0; L.polys.forEach(q=>{ if(D.inRing(p[0],p[1],q)) c++; }); if(c%2===1) L.holes.push(p); }); });
  LY={layers,box:[x0,y0,x1,y1],sc,align,hr,pts,unit:unit()};
  renderLayers(); return LY;
}
function renderLayers(){
  const L=LY; if(!L) return; const [x0,y0,x1,y1]=L.box, w=x1-x0, h=y1-y0, pad=w*0.03, k=w/300;
  let s='', N=L.layers.length;
  L.layers.forEach((ly,i)=>{ const lt=88-Math.round(60*i/Math.max(1,N-1)); const d=ly.polys.map(q=>'M'+q.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L')+'Z').join('');
    s+=`<path d="${d}" fill-rule="evenodd" fill="hsl(25 45% ${lt}%)" stroke="var(--fg)" stroke-width="${k*0.6}" opacity=".92" transform="translate(${(i*k*4).toFixed(2)} ${(-i*k*4).toFixed(2)})"><title>Layer ${ly.n}${ly.t!=null?' · threshold '+ly.t:' · base plate'}</title></path>`;
    ly.holes.forEach(p=>{ s+=`<circle cx="${p[0]}" cy="${p[1]}" r="${L.hr/L.sc.sx}" fill="var(--panel)" stroke="var(--fg)" stroke-width="${k*0.6}" transform="translate(${(i*k*4).toFixed(2)} ${(-i*k*4).toFixed(2)})"/>`; }); });
  if(L.align==='marks') L.pts.forEach(([x,y])=>{ const r=6*k; s+=`<path d="M${x-r} ${y}H${x+r}M${x} ${y-r}V${y+r}" stroke="var(--g)" stroke-width="${k}"/>`; });
  const svg=$('lyPrev'); svg.setAttribute('viewBox',`${x0-pad} ${y0-pad-N*k*4} ${w+2*pad+N*k*4} ${h+2*pad+N*k*4}`); svg.innerHTML=s;
  $('lyNote').textContent=`${N} layer(s): `+L.layers.map(ly=>`L${ly.n} ${ly.t!=null?'≤'+ly.t:'plate'} (${ly.polys.length} cuts${ly.holes.length?', '+ly.holes.length+' holes':''})`).join(' · ');
}
function layerEntities(ly,L){
  const o={pxW:S.W,pxH:S.H,scale:L.sc.sx,scaleY:L.sc.sy,unit:L.unit,selected:null,split:'none',insideFirst:true,nearest:true,extra:[]};
  if(!ly.polys.length) return [];
  const plan=D.buildPlan(ly.polys,o), name='LAYER_'+ly.n, ents=plan.entities.map(e=>Object.assign({},e,{layer:name}));
  const toOut=([x,y])=>[x*L.sc.sx,(S.H-y)*L.sc.sy];
  ly.holes.forEach(p=>{ const c=toOut(p), n=48, q=[]; for(let k=0;k<n;k++){ const t=2*Math.PI*k/n; q.push([c[0]+L.hr*Math.cos(t),c[1]+L.hr*Math.sin(t)]); } ents.unshift({layer:name,pts:q,closed:true}); });
  if(L.align==='marks') L.pts.forEach(p=>{ const c=toOut(p), r=Math.max(L.hr,0.1); ents.push({layer:'REG',pts:[[c[0]-r,c[1]],[c[0]+r,c[1]]],closed:false},{layer:'REG',pts:[[c[0],c[1]-r],[c[0],c[1]+r]],closed:false}); });
  return ents;
}
async function downloadLayers(){
  const L=computeLayers(); if(!L) return setStatus('Nothing to export: load an image first',true);
  const fmtv=$('dxfFmt').value, mode=$('lyOut').value, enc=new TextEncoder(), prev='r2000';
  D.setFormat(fmtv);
  try{
    const per=L.layers.map(ly=>({ly,ents:layerEntities(ly,L)}));
    const files=[]; let single=null;
    if(mode!=='single') per.forEach(({ly,ents})=>files.push({name:`layer_${String(ly.n).padStart(2,'0')}.dxf`,data:enc.encode(D.writeEntities(ents,L.unit))}));
    if(mode!=='zip'){ single=D.writeEntities(per.flatMap(x=>x.ents),L.unit); if(mode==='both') files.push({name:'layers_combined.dxf',data:enc.encode(single)}); }
    const f=mode==='single'?{bytes:enc.encode(single),mime:'application/dxf',filename:'layers.dxf'}:{bytes:await D.makeZip(files),mime:'application/zip',filename:'layers.zip'};
    const how=await saveFile(f); lastFile=f;
    window.__lastLayers={filename:f.filename,layers:L.layers.length,mode,format:fmtv,texts:mode==='single'?[single]:files.map(x=>new TextDecoder().decode(x.data))};
    setStatus(`${how==='share'?'Shared':'Downloaded'} ${f.filename} (${L.layers.length} layers)`);
  }catch(e){ setStatus(e.message,true); } finally{ D.setFormat(prev); }
}
$('lyGo').onclick=()=>computeLayers(); $('lyDl').onclick=downloadLayers;
$('lyAuto').onclick=()=>{ if(S.gray){ const t=T.otsu(S.gray); $('lyLo').value=Math.max(10,Math.round(t*0.45)); $('lyHi').value=Math.min(245,Math.round(t+(255-t)*0.6)); } scheduleLayers(); save15(); };
document.querySelectorAll('#s-layers input, #s-layers select').forEach(el=>el.addEventListener('input',()=>{ save15(); scheduleLayers(); }));
window.I2D_LAYERS={compute:computeLayers,current:()=>LY,thresholds:lyThresholds};

// ======================================================================= history (IndexedDB, or the Windows app's folder)
const IDB={db:null,
  open(){ if(this.db) return Promise.resolve(this.db); return new Promise((res,rej)=>{ if(!window.indexedDB) return rej(new Error('IndexedDB is not available')); const r=indexedDB.open('i2d-history',1);
    r.onupgradeneeded=()=>{ r.result.createObjectStore('items',{keyPath:'id'}); }; r.onsuccess=()=>{ this.db=r.result; res(this.db); }; r.onerror=()=>rej(r.error); }); },
  async tx(mode,fn){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction('items',mode), st=t.objectStore('items'); let out; const q=fn(st); if(q) q.onsuccess=()=>{ out=q.result; }; t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error('aborted')); }); },
  put(rec){ return this.tx('readwrite',st=>st.put(rec)); }, get(id){ return this.tx('readonly',st=>st.get(id)); },
  all(){ return this.tx('readonly',st=>st.getAll()); }, del(id){ return this.tx('readwrite',st=>st.delete(id)); }, clear(){ return this.tx('readwrite',st=>st.clear()); }
};
const HIST={
  async list(){ if(API.backend){ const j=await (await fetch('api/history',{cache:'no-store'})).json(); return j.items||[]; } return (await IDB.all()).map(r=>({id:r.id,date:r.date,name:r.name,size:r.size,thumb:r.thumb})); },
  async add(rec){ if(API.backend){ const fd=new FormData(); fd.append('image',rec.blob,rec.name||'image'); fd.append('meta',JSON.stringify({name:rec.name,date:rec.date,thumb:rec.thumb,settings:rec.settings})); const j=await (await fetch('api/history',{method:'POST',body:fd})).json(); if(j.error) throw new Error(j.error); return j.id; }
    await IDB.put(rec); return rec.id; },
  async get(id){ if(API.backend){ const m=await (await fetch('api/history/'+encodeURIComponent(id),{cache:'no-store'})).json(); const b=await (await fetch('api/history/'+encodeURIComponent(id)+'/image')).blob(); return Object.assign(m,{blob:b}); } return IDB.get(id); },
  async settings(id,settings){ if(API.backend){ await fetch('api/history/'+encodeURIComponent(id)+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}); return; }
    const r=await IDB.get(id); if(r){ r.settings=settings; r.date=r.date; await IDB.put(r); } },
  async del(id){ if(API.backend){ await fetch('api/history/'+encodeURIComponent(id),{method:'DELETE'}); return; } return IDB.del(id); },
  async clear(){ if(API.backend){ await fetch('api/history',{method:'DELETE'}); return; } return IDB.clear(); }
};
async function thumbOf(){ try{ const im=new Image(); im.src=S.fullURL||S.imgURL; await im.decode(); const k=Math.min(1,120/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.max(1,Math.round(im.width*k)); c.height=Math.max(1,Math.round(im.height*k)); c.getContext('2d').drawImage(im,0,0,c.width,c.height); return c.toDataURL('image/jpeg',0.7); }catch(e){ return ''; } }
async function enforceCap(){ if(API.backend) return; const cap=Math.max(1,num('histCap',40)), mb=Math.max(1,num('histMB',200))*1048576; const all=(await IDB.all()).sort((a,b)=>b.date.localeCompare(a.date)); let tot=0;
  for(let i=0;i<all.length;i++){ tot+=all[i].size||0; if(i>=cap||(tot>mb&&i>0)) await IDB.del(all[i].id); } }
let persisted=false, curHist=null, reopening=false;
async function histSaveBlob(b){
  try{
    if(!persisted&&navigator.storage&&navigator.storage.persist){ persisted=true; navigator.storage.persist().catch(()=>{}); }
    const rec={id:'h'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),date:new Date().toISOString(),name:b.name||(b.type?b.type.replace('image/','image.'):'image'),type:b.type,size:b.size||0,blob:b,thumb:await thumbOf(),settings:collectSettings()};
    curHist=await HIST.add(rec); await enforceCap(); if(curTab==='history') histRender();
  }catch(e){ $('histNote').textContent='History not saved: '+e.message; }
}
window.I2D_onLoad=function(b){ if(reopening) return; histSaveBlob(b); };
let histTimer=null;
document.addEventListener('input',e=>{ if(!curHist||!e.target.closest||!e.target.closest('#panel,#view .toolbar')) return; clearTimeout(histTimer); histTimer=setTimeout(()=>{ HIST.settings(curHist,collectSettings()).catch(()=>{}); },1500); });
async function histRender(){
  const el=$('histList'); let items;
  try{ items=await HIST.list(); }catch(e){ el.innerHTML=''; $('histNote').textContent='History unavailable: '+e.message; return; }
  items.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const tot=items.reduce((s,i)=>s+(i.size||0),0);
  $('histNote').textContent=items.length?`${items.length} item(s), ${(tot/1048576).toFixed(1)} MB`:'No saved images yet. Images you open are saved here automatically.';
  el.innerHTML=items.map(i=>`<div class="hitem${i.id===curHist?' cur':''}" data-id="${esc(i.id)}">${i.thumb?`<img src="${esc(i.thumb)}" alt="">`:'<span class="noimg">?</span>'}<div class="hmeta"><b>${esc(i.name||'image')}</b><small>${esc(new Date(i.date).toLocaleString())} · ${((i.size||0)/1024).toFixed(0)} KB</small>
    <div class="row"><button type="button" data-act="open">Reopen</button><button type="button" data-act="del">Delete</button></div></div></div>`).join('');
}
$('histList').addEventListener('click',async e=>{ const b=e.target.closest('button[data-act]'); if(!b) return; const id=b.closest('.hitem').dataset.id;
  if(b.dataset.act==='del'){ await HIST.del(id); if(curHist===id) curHist=null; histRender(); return; }
  try{ setStatus('Reopening…'); const r=await HIST.get(id); if(!r||!r.blob) throw new Error('Item not found');
    reopening=true; try{ await loadBlob(r.blob); } finally{ reopening=false; }
    curHist=id; if(r.settings){ applySettings(r.settings); await retrace(true); } histRender(); setStatus('Reopened '+(r.name||'image')+' with its saved settings');
  }catch(err){ setStatus('Could not reopen: '+err.message,true); } });
$('histClear').onclick=async()=>{ if(!confirm('Delete every saved image from the history?')) return; await HIST.clear(); curHist=null; histRender(); };
$('histSave').onclick=async()=>{ if(!S.gray) return setStatus('Load an image first',true); if(curHist){ await HIST.settings(curHist,collectSettings()); setStatus('Saved the current settings to the history'); } else setStatus('Nothing to save',true); };
['histCap','histMB'].forEach(id=>{ $(id).value=LS.get('i2d.'+id,$(id).value); $(id).addEventListener('change',()=>{ LS.set('i2d.'+id,$(id).value); enforceCap().then(histRender); }); });
window.I2D15.hist={HIST,IDB,render:histRender,current:()=>curHist};

// ======================================================================= 3D (lazy)
let v3loading=null;
function load3d(){ if(window.I2D_3D){ I2D_3D.show(); return Promise.resolve(); } if(v3loading) return v3loading;
  v3loading=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='js/viewer3d.js?v='+encodeURIComponent(V.build); s.onload=()=>{ try{ I2D_3D.show(); }catch(e){ console.error(e); } res(); }; s.onerror=()=>{ $('v3Note').textContent='Could not load the 3D viewer.'; rej(new Error('load')); }; document.head.appendChild(s); });
  return v3loading; }
window.I2D15.load3d=load3d; window.I2D15.tab=tab;

// ======================================================================= start-up
$('dxfFmt').addEventListener('input',()=>{ save15(); $('dxfCheck').textContent=''; });
document.querySelectorAll('#s-edit input, #s-edit select').forEach(el=>el.addEventListener('input',save15));
load15(); addHelp(); frameUi();
$('unit').addEventListener('input',()=>{ frCache.key=null; save15(); if(curTab==='layers') scheduleLayers(); });
tab(LS.get('i2d.tab','trace'));
window.__i2d=Object.assign(window.__i2d||{},{tab,reset:resetDefaults,version:V,frame:frameGeom,layers:()=>LY});
detectBackend();
setTimeout(()=>checkUpdate(false),4000);
setInterval(()=>checkUpdate(false),15*60*1000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) checkUpdate(false); });
})();
