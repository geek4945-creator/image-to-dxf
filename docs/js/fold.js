/* Hard Version 1.5 · Fold / Box v1: open-top box flat pattern (cross layout) with bend allowance / deduction,
   corner reliefs, kerf allowance, face images and a plain-English breakdown. Uses app.js globals ($, T, D, fmt, ...). */
(function(){
'use strict';
const num=(id,d=0)=>{ const v=parseFloat($(id).value); return isFinite(v)?v:d; };
const KDEF={steel:0.44,alu:0.42,ss:0.45};
const kPresets=()=>{ try{ return Object.assign({},KDEF,JSON.parse(localStorage.getItem('i2d.kpresets')||'{}')); }catch(e){ return Object.assign({},KDEF); } };

// ---- pure math ------------------------------------------------------------------------------------------
function bendMath(Tk,R,K,deg){
  const a=deg*Math.PI/180, BA=a*(R+K*Tk), OSSB=(R+Tk)*Math.tan(a/2), BD=2*OSSB-BA;
  return {a,BA,OSSB,BD};
}
function compute(p){
  const s=(p.scale||100)/100; let L=p.L*s, W=p.W*s, H=p.H*s; const Tk=p.T, R=p.R, K=p.K, deg=p.A;
  const m=bendMath(Tk,R,K,deg);
  const Lo=p.mode==='inside'?L+2*Tk:L, Wo=p.mode==='inside'?W+2*Tk:W, Ho=p.mode==='inside'?H+Tk:H;
  const bL=Lo-2*m.OSSB, bW=Wo-2*m.OSSB, Hf=Ho-m.OSSB;
  const errs=[]; if(bL<=0||bW<=0) errs.push('The box is too small for this thickness and radius.'); if(Hf<=0) errs.push('The wall height is smaller than the bend setback.');
  if(!(Tk>0)) errs.push('Thickness must be above 0.');
  const flatX=bL+2*m.BA+2*Hf, flatY=bW+2*m.BA+2*Hf;
  const relD=p.rel>0?p.rel:2*(Tk+R);
  const xL=bL/2, yW=bW/2, e=m.BA+Hf;
  const faces={
    base:{rect:[-xL,-yW,xL,yW],rot:0},
    right:{rect:[xL+m.BA,-yW,xL+e,yW],rot:-90,bend:{x:xL+m.BA/2,axis:'y',dir:1},zone:[xL,-yW,xL+m.BA,yW]},
    left:{rect:[-xL-e,-yW,-xL-m.BA,yW],rot:90,bend:{x:-xL-m.BA/2,axis:'y',dir:-1},zone:[-xL-m.BA,-yW,-xL,yW]},
    back:{rect:[-xL,yW+m.BA,xL,yW+e],rot:0,bend:{y:yW+m.BA/2,axis:'x',dir:1},zone:[-xL,yW,xL,yW+m.BA]},
    front:{rect:[-xL,-yW-e,xL,-yW-m.BA],rot:180,bend:{y:-yW-m.BA/2,axis:'x',dir:-1},zone:[-xL,-yW-m.BA,xL,-yW]}
  };
  return Object.assign({p,Lo,Wo,Ho,Li:Lo-2*Tk,Wi:Wo-2*Tk,Hi:Ho-Tk,bL,bW,Hf,flatX,flatY,relD,faces,errs,total:Lo+2*Ho-2*m.BD},m);
}
const rectRing=([x0,y0,x1,y1],k=0)=>[[x0-k,y0-k],[x1+k,y0-k],[x1+k,y1+k],[x0-k,y1+k],[x0-k,y0-k]];
function circle(cx,cy,r,n=48){ const q=[]; for(let i=0;i<n;i++){ const t=2*Math.PI*i/n; q.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]); } q.push(q[0].slice()); return q; }
function outline(g,kerf){
  const k=(kerf||0)/2, PC=window.polygonClipping, F=g.faces;
  const cross=[...[F.base.rect],...['right','left','back','front'].map(n=>{ const f=F[n], z=f.zone; return [Math.min(f.rect[0],z[0]),Math.min(f.rect[1],z[1]),Math.max(f.rect[2],z[2]),Math.max(f.rect[3],z[3])]; })];
  let shape=PC.union(...cross.map(r=>[rectRing(r,k)]));
  const rr=g.relD/2-k; if(rr>0){ const holes=[[1,1],[1,-1],[-1,1],[-1,-1]].map(([sx,sy])=>[circle(sx*g.bL/2,sy*g.bW/2,rr)]); shape=PC.difference(shape,...holes); }
  const rings=[]; shape.forEach(poly=>poly.forEach(r=>rings.push(r.slice(0,-1)))); return rings;
}

// ---- face images ----------------------------------------------------------------------------------------
const FACE_NAMES=[['base','Base (bottom)'],['front','Front wall'],['back','Back wall'],['left','Left wall'],['right','Right wall']];
const IMGS={};
async function loadFace(name,file){
  const url=URL.createObjectURL(file); try{ const im=new Image(); im.src=url; await im.decode();
    const k=Math.min(1,700/Math.max(im.width,im.height)), w=Math.max(1,Math.round(im.width*k)), h=Math.max(1,Math.round(im.height*k));
    const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,w,h); x.drawImage(im,0,0,w,h);
    const d=x.getImageData(0,0,w,h).data, g=new Uint8Array(w*h); for(let i=0;i<w*h;i++) g[i]=(d[4*i]*299+d[4*i+1]*587+d[4*i+2]*114)/1000;
    IMGS[name]={gray:g,w,h,name:file.name,thumb:c.toDataURL('image/jpeg',0.6)};
  } finally{ URL.revokeObjectURL(url); }
}
function setFaceGray(name,gray,w,h){ IMGS[name]={gray,w,h,name:'test'}; update(); }
function facePolys(g,name,margin,mode,mirror){
  const im=IMGS[name]; if(!im) return [];
  const f=g.faces[name], [x0,y0,x1,y1]=f.rect, fw=x1-x0-2*margin, fh=y1-y0-2*margin; if(fw<=0||fh<=0) return [];
  const rot=f.rot, swap=Math.abs(rot)===90, iw=swap?im.h:im.w, ih=swap?im.w:im.h, s=Math.min(fw/iw,fh/ih);
  const base=(typeof params==='function')?params():{};
  const p=Object.assign({},base,{scale:s,scaleY:s,width:s*im.w,invert:mode==='inv',auto:true,holes:true,drop_frame:true});
  if(!isFinite(p.tolerance)) Object.assign(p,{blur:1,speckle:4,tolerance:0.005,min_feature:0.02,threshold:128});
  const r=T.trace(im.gray,im.w,im.h,p), cx=(x0+x1)/2, cy=(y0+y1)/2, t=rot*Math.PI/180, c=Math.cos(t), sn=Math.sin(t);
  return r.polys.map(q=>q.map(([px,py])=>{ let u=(px-im.w/2)*s, v=(im.h/2-py)*s; if(mirror) u=-u; return [cx+u*c-v*sn, cy+u*sn+v*c]; }));
}
function faceCuts(g){
  const margin=num('fdMargin',0.25), mode=$('fdImgMode').value, mirror=$('fdMirror').checked, out={};
  FACE_NAMES.forEach(([n])=>{ out[n]=facePolys(g,n,margin,mode,mirror); }); return out;
}

// ---- UI --------------------------------------------------------------------------------------------------
function readParams(){ return {mode:$('fdMode').value,L:num('fdL'),W:num('fdW'),H:num('fdH'),scale:num('fdScale',100),T:num('fdT'),R:num('fdR'),K:num('fdK',0.44),A:num('fdA',90),rel:num('fdRel'),kerf:num('fdKerf')}; }
let CUR=null;
function f4(v){ return fmt(v,4); }
function update(){
  const p=readParams(), u=$('unit').value, g=compute(p); g.unit=u;
  let rings=[], cuts={};
  if(!g.errs.length){ try{ rings=outline(g,p.kerf); cuts=faceCuts(g); }catch(e){ g.errs.push(e.message); } }
  g.outline=rings; g.cuts=cuts; CUR=g;
  render(g); return g;
}
function render(g){
  const u=g.unit, svg=$('fdSvg');
  if(g.errs.length){ $('fdInfo').textContent='⚠ '+g.errs.join(' '); svg.innerHTML=''; $('fdMath').innerHTML=''; $('fdNote').textContent='⚠ '+g.errs.join(' '); return; }
  const X=g.flatX+2*(g.p.kerf||0), Y=g.flatY+2*(g.p.kerf||0), pad=Math.max(X,Y)*0.05, sw=Math.max(X,Y)/400;
  svg.setAttribute('viewBox',`${-X/2-pad} ${-Y/2-pad} ${X+2*pad} ${Y+2*pad}`);
  const P=q=>'M'+q.map(([x,y])=>`${x.toFixed(4)} ${(-y).toFixed(4)}`).join('L')+'Z';
  let h=`<path class="fdcut" d="${g.outline.map(P).join('')}" fill-rule="evenodd" stroke-width="${sw}"/>`;
  Object.values(g.cuts).forEach(list=>{ if(list.length) h+=`<path class="fdimg" d="${list.map(P).join('')}" fill-rule="evenodd" stroke-width="${sw*0.7}"/>`; });
  Object.values(g.faces).forEach(f=>{ if(!f.bend) return; const z=f.zone; const l=f.bend.axis==='y'?[[f.bend.x,z[1]],[f.bend.x,z[3]]]:[[z[0],f.bend.y],[z[2],f.bend.y]];
    h+=`<line class="fdbend" x1="${l[0][0]}" y1="${-l[0][1]}" x2="${l[1][0]}" y2="${-l[1][1]}" stroke-width="${sw}" stroke-dasharray="${sw*6} ${sw*4}"/>`; });
  const fs=Math.max(X,Y)/40;
  const lab=(x,y,t)=>`<text x="${x}" y="${-y}" font-size="${fs}" text-anchor="middle" class="fdlab">${t}</text>`;
  h+=lab(0,0,'BASE')+lab(0,g.faces.back.rect[1]+(g.Hf/2),'BACK')+lab(0,g.faces.front.rect[1]+(g.Hf/2),'FRONT')+lab(g.faces.left.rect[0]+g.Hf/2,0,'LEFT')+lab(g.faces.right.rect[0]+g.Hf/2,0,'RIGHT');
  svg.innerHTML=h;
  $('fdInfo').textContent=`flat ${f4(g.flatX)} × ${f4(g.flatY)} ${u} · BA ${f4(g.BA)} · BD ${f4(g.BD)}`;
  const nCuts=Object.values(g.cuts).reduce((s,l)=>s+l.length,0);
  $('fdNote').textContent=`Flat pattern ${f4(g.flatX)} × ${f4(g.flatY)} ${u}, 4 bends (BEND layer), ${g.outline.length} outline cut(s)${nCuts?`, ${nCuts} face-image cut(s)`:''}.`;
  const deg=g.p.A;
  $('fdMath').innerHTML=`<h3>How the numbers were worked out</h3><ol>
<li>Box (outside): <b>${f4(g.Lo)} × ${f4(g.Wo)} × ${f4(g.Ho)} ${u}</b>; inside: ${f4(g.Li)} × ${f4(g.Wi)} × ${f4(g.Hi)} ${u}${g.p.scale!==100?` (scaled ${g.p.scale}%)`:''}${g.p.mode==='inside'?' — you entered inside sizes, so outside = inside + 2·T (height + T).':'.'}</li>
<li>Bend allowance (the length of metal used up by each bend): BA = angle in radians × (R + K × T) = ${f4(g.a)} × (${f4(g.p.R)} + ${g.p.K} × ${f4(g.p.T)}) = <b>${f4(g.BA)} ${u}</b>.</li>
<li>Outside setback (how far the bend pulls back from the outside corner): OSSB = (R + T) × tan(${deg}°/2) = <b>${f4(g.OSSB)} ${u}</b>.</li>
<li>Bend deduction: BD = 2 × OSSB − BA = <b>${f4(g.BD)} ${u}</b>. Each bend makes the flat ${f4(g.BD)} ${u} shorter than adding the outside sizes.</li>
<li>Flat length = L + 2·H − 2·BD = ${f4(g.Lo)} + 2×${f4(g.Ho)} − 2×${f4(g.BD)} = <b>${f4(g.flatX)} ${u}</b>; flat width = W + 2·H − 2·BD = <b>${f4(g.flatY)} ${u}</b>.</li>
<li>Base panel between the bend zones: ${f4(g.bL)} × ${f4(g.bW)} ${u}. Each wall: flat height ${f4(g.Hf)} ${u} (H − OSSB) plus a ${f4(g.BA)} ${u} bend zone; the dashed bend line is in the middle of the zone.</li>
<li>Bend 1 (front), 2 (back), 3 (left), 4 (right): each ${deg}°, inside radius ${f4(g.p.R)} ${u}, bend line ${f4(g.bL/2+g.BA/2)} ${u} (left/right) or ${f4(g.bW/2+g.BA/2)} ${u} (front/back) from the centre of the base.</li>
<li>Corner relief: a round hole Ø ${f4(g.relD)} ${u} at each base corner${g.p.rel>0?'':' (auto: radius T + R)'} so the walls fold without tearing; the corners are notched so walls don't overlap.</li>
${g.p.kerf>0?`<li>Kerf allowance: outlines moved out by ${f4(g.p.kerf/2)} ${u} (half the kerf) and reliefs shrunk by the same, so parts come out at size. Face-image cut-outs are not compensated.</li>`:''}
<li>Change any size, the thickness, the scale or the units and all of this is recalculated.</li></ol>`;
}
function entities(g){
  const ents=[]; const shift=([x,y])=>[x+g.flatX/2+(g.p.kerf||0),y+g.flatY/2+(g.p.kerf||0)];
  FACE_NAMES.forEach(([n])=>(g.cuts[n]||[]).forEach(q=>ents.push({layer:'CUT_FACE',pts:q.map(shift),closed:true})));
  // inner relief rings (holes of the outline, if any) first, outer outline last
  const depth=D.nestingDepths(g.outline);
  g.outline.map((q,i)=>({q,d:depth[i]})).sort((a,b)=>b.d-a.d).forEach(({q})=>ents.push({layer:'CUT',pts:q.map(shift),closed:true}));
  Object.values(g.faces).forEach(f=>{ if(!f.bend) return; const z=f.zone; const l=f.bend.axis==='y'?[[f.bend.x,z[1]],[f.bend.x,z[3]]]:[[z[0],f.bend.y],[z[2],f.bend.y]]; ents.push({layer:'BEND',pts:l.map(shift),closed:false}); });
  return ents;
}
async function download(){
  const g=update(); if(g.errs.length) return setStatus(g.errs.join(' '),true);
  const f0=$('dxfFmt').value; D.setFormat(f0);
  try{ let ents=entities(g); if(f0==='torchmate') ents=ents.map(e=>e.layer==='CUT_FACE'?Object.assign({},e,{layer:'CUT'}):e);
    const txt=D.writeEntities(ents,g.unit); window.__lastFold={text:txt,format:f0,flatX:g.flatX,flatY:g.flatY,BA:g.BA,BD:g.BD};
    const f={bytes:new TextEncoder().encode(txt),mime:'application/dxf',filename:`box_${f4(g.Lo)}x${f4(g.Wo)}x${f4(g.Ho)}${g.unit}.dxf`};
    const how=await saveFile(f); setStatus(`${how==='share'?'Shared':'Downloaded'} ${f.filename}`);
  }catch(e){ setStatus(e.message,true); } finally{ D.setFormat('r2000'); }
}
function facesUi(){
  $('fdFaces').innerHTML=FACE_NAMES.map(([n,l])=>`<div class="fdface" data-f="${n}"><span>${l}</span><label class="filebtn">Image…<input type="file" accept="image/*" data-face="${n}" hidden></label><button type="button" data-clear="${n}">✕</button><small data-name="${n}"></small></div>`).join('');
}
function faceNames(){ FACE_NAMES.forEach(([n])=>{ const el=document.querySelector(`[data-name="${n}"]`); if(el) el.textContent=IMGS[n]?IMGS[n].name:''; }); }
facesUi();
$('fdFaces').addEventListener('change',async e=>{ const i=e.target.closest('input[data-face]'); if(!i||!i.files[0]) return; try{ await loadFace(i.dataset.face,i.files[0]); }catch(err){ setStatus('Could not read the image: '+err.message,true); } i.value=''; faceNames(); update(); });
$('fdFaces').addEventListener('click',e=>{ const b=e.target.closest('button[data-clear]'); if(!b) return; delete IMGS[b.dataset.clear]; faceNames(); update(); });
$('fdMat').addEventListener('change',()=>{ const k=kPresets()[$('fdMat').value]; if(k!=null) $('fdK').value=k; update(); });
$('fdK').addEventListener('input',()=>{ const k=+$('fdK').value, m=Object.entries(kPresets()).find(([,v])=>Math.abs(v-k)<1e-9); if(!m) $('fdMat').value='custom'; });
$('fdSaveK').onclick=()=>{ const m=$('fdMat').value; if(m==='custom') return setStatus('Pick a material first, then save its K-factor',true); const o=JSON.parse(localStorage.getItem('i2d.kpresets')||'{}'); o[m]=+$('fdK').value; localStorage.setItem('i2d.kpresets',JSON.stringify(o)); setStatus(`Saved K = ${$('fdK').value} for ${$('fdMat').selectedOptions[0].text}`); };
document.querySelectorAll('#s-fold input:not([type=file]), #s-fold select').forEach(el=>el.addEventListener('input',()=>update()));
$('unit').addEventListener('input',()=>setTimeout(update,0));
['tolerance','min_feature','blur','speckle','threshold'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('input',()=>{ if(Object.keys(IMGS).length) update(); }); });
$('fdDl').onclick=download;
function reset(){ Object.keys(IMGS).forEach(k=>delete IMGS[k]); try{ localStorage.removeItem('i2d.kpresets'); }catch(e){} faceNames(); update(); }
window.I2D_FOLD={bendMath,compute,update,reset,entities,current:()=>CUR,setFaceGray,outline,FACE_NAMES};
update();
})();
