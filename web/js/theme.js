"use strict";
// Light / Dark / Auto theme toggle (saved in localStorage). Auto follows the system.
(function(){
  const root=document.documentElement, KEY='i2d-theme', mq=window.matchMedia('(prefers-color-scheme: dark)');
  const COLORS={light:'#111827',dark:'#0b0f17'};
  function get(){ try{ const t=localStorage.getItem(KEY); return t==='light'||t==='dark'?t:'auto'; }catch(e){ return 'auto'; } }
  function apply(t){
    if(t==='auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme',t);
    const eff=t==='auto'?(mq.matches?'dark':'light'):t;
    document.querySelectorAll('meta[name=theme-color]').forEach(m=>m.setAttribute('content',COLORS[eff]));
    document.querySelectorAll('#themeSwitch button').forEach(b=>{const on=b.dataset.theme===t; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on);});
    window.__theme={choice:t,effective:eff};
  }
  document.querySelectorAll('#themeSwitch button').forEach(b=>b.addEventListener('click',()=>{
    const t=b.dataset.theme; try{ t==='auto'?localStorage.removeItem(KEY):localStorage.setItem(KEY,t); }catch(e){} apply(t);
  }));
  (mq.addEventListener?mq.addEventListener.bind(mq,'change'):mq.addListener.bind(mq))(()=>{ if(get()==='auto') apply('auto'); });
  apply(get());
})();
