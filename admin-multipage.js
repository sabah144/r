// Admin multipage helpers
(function(){
  // Guard: require auth for all admin pages

  // Highlight active nav link
 // const links = document.querySelectorAll('.sidebar .side-link');
  //const path = location.pathname.split('/').pop() || 'admin.html';
 // links.forEach(a=>{
   // const href = a.getAttribute('href');
   // if((path==='' && href==='admin.html') || href===path){
    //  a.classList.add('active');
    //  a.setAttribute('aria-current','page');
   // }
//  });

  // Close notifications drawer on outside click (mobile/desktop)
  const drawer = document.getElementById('notifDrawer');
  const btn = document.getElementById('notifyBtn');
  if(drawer && btn){
    document.addEventListener('click', (e)=>{
      if(!drawer.classList.contains('open')) return;
      const inside = drawer.contains(e.target) || btn.contains(e.target);
      if(!inside){ drawer.classList.remove('open'); }
    });
  }

  // Override renderNotifs to only show 'order' type
  const renderFiltered = function(){
    const box = document.querySelector('#notifList');
    if(!box) return;
const ns = JSON.parse(localStorage.getItem('notifications')||'[]');
    if(ns.length===0){ box.innerHTML='<div class="small" style="color:var(--muted)">لا يوجد إشعارات</div>'; return; }
    box.innerHTML = ns.map(n=>`
      <div class="card" style="padding:12px;border:1px solid #eee">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${n.title}</strong>
<span class="badge ${n.type==='order'?'badge-danger':'badge-olive'} small">
  ${n.type==='order'?'طلب':(n.type==='reservation'?'حجز':'إشعار')}
</span>        </div>
        <div class="small" style="margin-top:6px">${n.message||''}</div>
        <div class="small" style="margin-top:6px;color:var(--muted)">${new Date(n.time).toLocaleString('ar-EG')}</div>
      </div>
    `).join('');
  };
  window.renderNotifs = renderFiltered;

  // Re-render after load in case admin.js rendered before override
  document.addEventListener('DOMContentLoaded', ()=>{
    try{ renderFiltered(); }catch(e){}
  });
  // Re-render notifications after Supabase sync
document.addEventListener('sb:admin-synced', () => {
  try{ renderFiltered(); }catch(e){}
});

})();
// ===== Global Modal Helper (admin + pages that load this file) =====
(function(){
  const $ = (s)=>document.querySelector(s);
  const Modal = {
    root:null, title:null, body:null, actions:null, closeBtn:null,
    ensure(){
      if(this.root) return true;
      this.root = $('#appModal');
      if(!this.root) return false;
      this.title = $('#appModalTitle');
      this.body = $('#appModalBody');
      this.actions = $('#appModalActions');
      this.closeBtn = $('#appModalClose');
      if(this.closeBtn) this.closeBtn.onclick = ()=>this.hide();
      this.root.addEventListener('click', e=>{ if(e.target===this.root) this.hide(); });
      document.addEventListener('keydown', e=>{ if(e.key==='Escape') this.hide(); });
      return true;
    },
    show(title, html, btns){
      if(!this.ensure()){ alert((html||'').toString().replace(/<[^>]+>/g,'')); return; }
      this.title.textContent = title || '';
      this.body.innerHTML = html || '';
      this.actions.innerHTML = '';
      (btns||[]).forEach(b=> this.actions.appendChild(b));
      this.root.classList.add('open');
      this.root.setAttribute('aria-hidden','false');
    },
    hide(){
      if(!this.root) return;
      this.root.classList.remove('open');
      this.root.setAttribute('aria-hidden','true');
    },
    info(msg, title){
      const ok = document.createElement('button');
      ok.className='btn btn-primary'; ok.textContent='موافق';
      ok.onclick = ()=> this.hide();
      this.show(title||'إشعار', `<div class="small">${msg}</div>`, [ok]);
    },
    confirm(msg, title){
      return new Promise((resolve)=>{
        const yes = document.createElement('button'); yes.className='btn btn-primary'; yes.textContent='تأكيد';
        const no  = document.createElement('button'); no.className='btn btn-ghost';   no.textContent='إلغاء';
        yes.onclick=()=>{ this.hide(); resolve(true); };
        no.onclick =()=>{ this.hide(); resolve(false);};
        this.show(title||'تأكيد', `<div class="small">${msg}</div>`, [yes, no]);
      });
    }
  };
  
  window.Modal = Modal;
})();
// Highlight active sidebar link based on current page
(function () {
  function setActiveSideLink() {
    var here = (location.pathname.split('/').pop() || '').toLowerCase() || 'admin.html';
    var links = document.querySelectorAll('.sidebar .side-link');
    var matched = false;
    links.forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
      var isMatch = href === here;
      a.classList.toggle('active', isMatch);
      if (isMatch) matched = true;
    });
    if (!matched && links[0]) links[0].classList.add('active');
  }
  document.addEventListener('DOMContentLoaded', setActiveSideLink);
})();
// ===== Mobile Right Sidebar (open/close + close on link click) =====
(function(){
  function ready(fn){ 
    if(document.readyState !== 'loading') fn(); 
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function(){
    var navActions = document.querySelector('.navbar .nav-actions');
    var aside = document.querySelector('.admin-layout .sidebar');
    if(!navActions || !aside) return;

    // 1) زر القائمة (يُحقن تلقائياً إن لم يوجد)
    var btn = document.getElementById('adminMenuBtn');
    if(!btn){
      btn = document.createElement('button');
      btn.id = 'adminMenuBtn';
      btn.className = 'btn btn-ghost';
      btn.type = 'button';
      btn.setAttribute('aria-expanded','false');
      btn.innerHTML = 'القائمة';
      navActions.prepend(btn);
    }

    // 2) قناع خلفي لإغلاق الدرج عند الضغط خارجاً
    var mask = document.getElementById('sideMask');
    if(!mask){
      mask = document.createElement('div');
      mask.id = 'sideMask';
      mask.className = 'side-mask';
      document.body.appendChild(mask);
    }
closeSide(); // ضمان إغلاق القائمة عند التحميل

    function openSide(){
      aside.classList.add('open');
      mask.classList.add('open');
      btn.setAttribute('aria-expanded','true');
    }
 

    function closeSide(){
      aside.classList.remove('open');
      mask.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    }
    function toggleSide(){
      if(aside.classList.contains('open')) closeSide(); else openSide();
    }
closeSide(); // إغلاق افتراضي عند تحميل الصفحة
window.addEventListener('pageshow', closeSide);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') closeSide(); });

    // 3) ربط الأحداث
    btn.addEventListener('click', function(e){ e.stopPropagation(); toggleSide(); });
    mask.addEventListener('click', closeSide);
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeSide(); });
    window.addEventListener('resize', function(){ if(window.innerWidth > 960) closeSide(); });

    // 4) إغلاق عند اختيار أي رابط (مع الانتقال)
    aside.querySelectorAll('a.side-link').forEach(function(a){
      a.addEventListener('click', function(){ closeSide(); }, {passive:true});
    });
  });
})();
