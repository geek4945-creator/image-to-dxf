/* Hard Version 1.5 · lightweight 3D preview (lazy-loaded). Plain canvas 2D, painter's algorithm, no libraries.
   Fold source: folds the walls of the Fold / Box flat pattern about their bend lines. Layers source: extrudes the
   brightness layers by the material thickness with a gap between them. */
(function(){
'use strict';
const cv=$('c3d'), ctx=cv.getContext('2d');
const cam={yaw:-0.6,pitch:1.0,zoom:1};
let anim=null, polys=[], size=1, center=[0,0,0];
function colors(){ const cs=getComputedStyle(document.body); return {bg:cs.getPropertyValue('--bg').trim()||'#fff',fg:cs.getPropertyValue('--fg').trim()||'#111',dark:document.documentElement.dataset.theme==='dark'||matchMedia('(prefers-color-scheme: dark)').matches&&document.documentElement.dataset.theme!=='light'}; }
const thin=(q,max)=>{ if(q.length<=max) return q; const st=q.length/max, o=[]; for(let i=0;i<max;i++) o.push(q[Math.floor(i*st)]); return o; };

// ---- scene builders -------------------------------------------------------------------------------------
function foldScene(){
  const g=window.I2D_FOLD&&I2D_FOLD.current(); if(!g||g.errs.length) return {list:[],note:'Set up a box in the Fold / Box tab first.'};
  const f=+$('v3Fold').value/100, th=f*g.p.A*Math.PI/180, holes=$('v3Holes').checked, list=[];
  const xb=g.bL/2+g.BA/2, yb=g.bW/2+g.BA/2;
  const tf={
    base:p=>[p[0],p[1],0],
    right:p=>{ const d=p[0]-xb; return [xb+d*Math.cos(th),p[1],d*Math.sin(th)]; },
    left:p=>{ const d=p[0]+xb; return [-xb+d*Math.cos(th),p[1],-d*Math.sin(th)]; },
    back:p=>{ const d=p[1]-yb; return [p[0],yb+d*Math.cos(th),d*Math.sin(th)]; },
    front:p=>{ const d=p[1]+yb; return [p[0],-yb+d*Math.cos(th),-d*Math.sin(th)]; }
  };
  const F=g.faces, e=g.Hf+g.BA;
  const R={base:[-xb,-yb,xb,yb],right:[xb,-g.bW/2,g.bL/2+e,g.bW/2],left:[-g.bL/2-e,-g.bW/2,-xb,g.bW/2],back:[-g.bL/2,yb,g.bL/2,g.bW/2+e],front:[-g.bL/2,-g.bW/2-e,g.bL/2,-yb]};
  Object.keys(tf).forEach(n=>{ const [x0,y0,x1,y1]=R[n], cuts=(g.cuts&&g.cuts[n]||[]).map(q=>thin(q,400));
    const outer=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(tf[n]);
    list.push({rings:[outer].concat(holes?cuts.map(q=>q.map(tf[n])):[]),kind:'sheet'});
    if(!holes) cuts.forEach(q=>list.push({rings:[q.map(p=>{ const v=tf[n](p); return v; })],kind:'fallout',lift:1}));
  });
  return {list,note:`Box ${fmt(g.Lo,4)} × ${fmt(g.Wo,4)} × ${fmt(g.Ho,4)} ${g.unit} · fold ${Math.round(f*100)}%`};
}
function layerScene(){
  let L=window.I2D_LAYERS&&(I2D_LAYERS.current()||I2D_LAYERS.compute()); if(!L) return {list:[],note:'Load an image and set up layers in the Layers tab first.'};
  const t=Math.max(1e-6,parseFloat($('lyT').value)||0.125), gap=Math.max(0,parseFloat($('lyGap').value)||0), list=[], H=S.H;
  const toU=([x,y])=>[x*L.sc.sx,(H-y)*L.sc.sy];
  L.layers.forEach((ly,i)=>{ const z0=i*(t+gap), z1=z0+t;
    const rings=ly.polys.map(q=>thin(q,300).map(toU));
    ly.holes.forEach(p=>{ const c=toU(p), q=[]; for(let k=0;k<24;k++){ const a=2*Math.PI*k/24; q.push([c[0]+L.hr*Math.cos(a),c[1]+L.hr*Math.sin(a)]); } rings.push(q); });
    const hue=25, lt=80-Math.round(45*i/Math.max(1,L.layers.length-1));
    list.push({rings:rings.map(q=>q.map(p=>[p[0],p[1],z1])),kind:'top',col:`hsl(${hue} 45% ${lt}%)`});
    list.push({rings:rings.map(q=>q.map(p=>[p[0],p[1],z0])),kind:'top',col:`hsl(${hue} 45% ${lt-10}%)`});
    rings.forEach(q=>{ for(let k=0;k<q.length;k++){ const a=q[k], b=q[(k+1)%q.length]; list.push({rings:[[[a[0],a[1],z0],[b[0],b[1],z0],[b[0],b[1],z1],[a[0],a[1],z1]]],kind:'side',col:`hsl(${hue} 40% ${lt-20}%)`}); } });
  });
  return {list,note:`${L.layers.length} layers · ${fmt(t,4)} ${L.unit} thick, ${fmt(gap,4)} ${L.unit} apart`};
}

// ---- render ---------------------------------------------------------------------------------------------
function draw(){
  const r=cv.getBoundingClientRect(), dpr=Math.min(2,devicePixelRatio||1), W=Math.max(10,Math.round(r.width*dpr)), H=Math.max(10,Math.round(r.height*dpr));
  if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
  const sc=$('v3Src').value==='layers'?layerScene():foldScene(); polys=sc.list; $('v3Note').textContent=sc.note+(polys.length?' · drag to orbit, wheel/pinch to zoom':'');
  const C=colors(); ctx.fillStyle=C.dark?'#15181c':'#f4f5f7'; ctx.fillRect(0,0,W,H);
  if(!polys.length) return;
  let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
  polys.forEach(p=>p.rings[0].forEach(([x,y,z])=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; if(z<z0)z0=z; if(z>z1)z1=z; }));
  center=[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2]; size=Math.max(x1-x0,y1-y0,z1-z0)||1;
  const cy=Math.cos(cam.yaw), sy=Math.sin(cam.yaw), cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch), dist=size*3, f=Math.min(W,H)*0.9*cam.zoom*dist/size/1.6;
  const view=([x,y,z])=>{ x-=center[0]; y-=center[1]; z-=center[2]; const X=x*cy-y*sy, Y=x*sy+y*cy; const Y2=Y*cp-z*sp, Z2=Y*sp+z*cp; return [X,Y2,Z2]; };
  const proj=v=>{ const k=f/(dist-v[1]); return [W/2+v[0]*k,H/2-v[2]*k]; };
  const L=[0.3,-0.5,0.8], ln=Math.hypot(...L);
  const items=polys.map(p=>{ const vr=p.rings.map(q=>q.map(view)); const o=vr[0]; let d=0; o.forEach(v=>d+=v[1]); d/=o.length;
    let nx=0,ny=0,nz=0; const w=p.rings[0]; for(let i=0;i<w.length;i++){ const a=w[i], b=w[(i+1)%w.length]; nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1]); }
    const nl=Math.hypot(nx,ny,nz)||1, sh=Math.abs((nx*L[0]+ny*L[1]+nz*L[2])/nl/ln);
    return {p,vr,d:d-(p.lift?size*0.002:0),sh}; });
  items.sort((a,b)=>b.d-a.d);
  ctx.lineJoin='round';
  items.forEach(({p,vr,sh})=>{ ctx.beginPath(); vr.forEach(q=>{ q.forEach((v,i)=>{ const [X,Y]=proj(v); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }); ctx.closePath(); });
    let col=p.col; if(!col){ const l=Math.round((C.dark?35:55)+sh*30); col=p.kind==='fallout'?`hsl(200 30% ${l-15}%)`:`hsl(210 8% ${l}%)`; }
    else { col=col.replace(/(\d+)%\)$/,(m,v)=>Math.max(5,Math.min(95,Math.round(+v*(0.75+0.35*sh))))+'%)'); }
    ctx.fillStyle=col; ctx.fill('evenodd'); if(p.kind!=='side'){ ctx.strokeStyle=C.dark?'rgba(255,255,255,.35)':'rgba(0,0,0,.45)'; ctx.lineWidth=1; ctx.stroke(); } });
}
let raf=0; function redraw(){ cancelAnimationFrame(raf); raf=requestAnimationFrame(()=>{ try{ draw(); }catch(e){ $('v3Note').textContent='3D error: '+e.message; } }); }

// ---- interaction ----------------------------------------------------------------------------------------
const P=new Map(); let pd=0;
cv.style.touchAction='none';
cv.addEventListener('pointerdown',e=>{ P.set(e.pointerId,[e.clientX,e.clientY]); cv.setPointerCapture(e.pointerId); if(P.size===2){ const [a,b]=[...P.values()]; pd=Math.hypot(a[0]-b[0],a[1]-b[1]); } });
cv.addEventListener('pointermove',e=>{ const o=P.get(e.pointerId); if(!o) return; const n=[e.clientX,e.clientY];
  if(P.size===1){ cam.yaw-=(n[0]-o[0])*0.01; cam.pitch=Math.max(0.05,Math.min(Math.PI-0.05,cam.pitch-(n[1]-o[1])*0.01)); }
  P.set(e.pointerId,n); if(P.size===2){ const [a,b]=[...P.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(pd) cam.zoom=Math.max(0.2,Math.min(8,cam.zoom*d/pd)); pd=d; }
  redraw(); });
const up=e=>{ P.delete(e.pointerId); pd=0; }; cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{ e.preventDefault(); cam.zoom=Math.max(0.2,Math.min(8,cam.zoom*Math.pow(1.0015,-e.deltaY))); redraw(); },{passive:false});
$('v3Fold').addEventListener('input',()=>{ $('o_v3Fold').textContent=$('v3Fold').value; redraw(); });
['v3Src','v3Holes'].forEach(id=>$(id).addEventListener('input',redraw));
$('v3Reset').onclick=()=>{ Object.assign(cam,{yaw:-0.6,pitch:1.0,zoom:1}); redraw(); };
$('v3Play').onclick=()=>{ if(anim){ cancelAnimationFrame(anim); anim=null; $('v3Play').textContent='▶ Animate fold'; return; }
  $('v3Src').value='fold'; const t0=performance.now(); $('v3Play').textContent='■ Stop';
  const step=t=>{ const k=((t-t0)/3000)%2, v=k<1?k:2-k; $('v3Fold').value=Math.round(v*100); $('o_v3Fold').textContent=$('v3Fold').value; draw(); anim=requestAnimationFrame(step); }; anim=requestAnimationFrame(step); };
document.addEventListener('input',e=>{ if(document.body.dataset.tab==='3d'&&e.target.closest&&e.target.closest('#s-fold,#s-layers')) redraw(); });
addEventListener('resize',()=>{ if(document.body.dataset.tab==='3d') redraw(); });
window.I2D_3D={show:redraw,draw,cam,scene:()=>polys};
})();
