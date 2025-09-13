/* =====================================================
   Shared Data Helpers (localStorage based)
===================================================== */
/* افتح الصفحة دائماً من البداية */
(function () {
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch(e){}
  // عند التحميل الأول
  window.addEventListener('load', () => { window.scrollTo(0, 0); });
  // عند الرجوع من الخلف/الكاش (Safari/Firefox)
  window.addEventListener('pageshow', (e) => { if (e.persisted) window.scrollTo(0, 0); });
})();
const LS = {
  get(key, def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def; }catch{ return def; } },
  set(key, val){ localStorage.setItem(key, JSON.stringify(val)); },
};
const nowISO = ()=> new Date().toISOString();

function seedIfNeeded(){

  // لا نُضيف بيانات تجريبية. فقط نضمن وجود المفاتيح كمصفوفات فارغة
  if(!localStorage.getItem('categories')) LS.set('categories', []);
  if(!localStorage.getItem('menuItems'))  LS.set('menuItems', []);

  if(!localStorage.getItem('orders')) LS.set('orders', []);
  if(!localStorage.getItem('notifications')) LS.set('notifications', []);
  if(!localStorage.getItem('ratings')) LS.set('ratings', []);
  if(!localStorage.getItem('userRated')) LS.set('userRated', {});
  /* ✅ تهيئة الحجوزات للربط مع لوحة التحكم */
  if(!localStorage.getItem('reservations')) LS.set('reservations', []);
}
seedIfNeeded();

/* ========== Global Modal Helper ========== */
(function(){
  const $ = (s)=>document.querySelector(s);
  const Modal = {
    root:null, title:null, body:null, actions:null, closeBtn:null,
    ensure(){
      if(this.root) return true;
      this.root = $('#appModal');
      if(!this.root) return false;
      this.title   = $('#appModalTitle');
      this.body    = $('#appModalBody');
      this.actions = $('#appModalActions');
      this.closeBtn= $('#appModalClose');
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

/* =====================================================
   Rendering the Menu
===================================================== */
const catPills       = document.querySelector('#catPills');
const catRibbon      = document.querySelector('#catRibbon');
const grid           = document.querySelector('#itemsGrid');
const searchInput    = document.querySelector('#searchInput');
const cartBtn        = document.querySelector('#cartBtn');   // قد يكون غير موجود
const cartCount      = document.querySelector('#cartCount'); // قد يكون غير موجود
const cartDrawer     = document.querySelector('#cartDrawer');
const closeDrawerBtn = document.querySelector('#closeDrawer');
const checkoutBtn    = document.querySelector('#checkoutBtn');
const cartItemsEl    = document.querySelector('#cartItems');
const cartTotalEl    = document.querySelector('#cartTotal');

/* ===== FAB refs ===== */
let cartFab       = document.querySelector('#cartFab');
let cartFabCount  = document.querySelector('#cartFabCount');
const fabTotalEl  = document.querySelector('#fabTotal'); // قد يكون موجودًا في HTML الجديد

/* ===== Backdrop + Toast ===== */
const backdrop = document.getElementById('backdrop');

/* ---------- Inject minimal CSS for moving underline (إن لم يكن موجودًا في styles.css) ---------- */
function injectUnderlineStyle(){
  if(document.getElementById('catUnderlineStyle')) return;
  const s = document.createElement('style');
  s.id = 'catUnderlineStyle';
  s.textContent = `
    #catRibbon{ position:relative; }
    #catRibbon .cat-underline{
      position:absolute; bottom:4px; height:3px; background:var(--primary);
      border-radius:999px; width:0; transform:translateX(0);
      transition:transform .24s ease, width .24s ease; pointer-events:none;
    }
  `;
  document.head.appendChild(s);
}
injectUnderlineStyle();

/* ---------- Underline slider + Section spy ---------- */
function ensureCatUnderline(){
  if(!catRibbon) return null;
  let u = catRibbon.querySelector('.cat-underline');
  if(!u){
    u = document.createElement('span');
    u.className = 'cat-underline';
    catRibbon.appendChild(u);
  }
  return u;
}
function moveCatUnderline(){
  const u = ensureCatUnderline();
  if(!u || !catRibbon) return;
  const active = catRibbon.querySelector('.pill.active') || catRibbon.querySelector('.pill');
  if(!active){ u.style.width='0px'; return; }
  const w = active.offsetWidth;
  const x = active.offsetLeft - catRibbon.scrollLeft; // تعويض سكرول أفقي للرِبن
  u.style.width = w + 'px';
  u.style.transform = `translateX(${x}px)`;
}
window.addEventListener('resize', moveCatUnderline);
if(catRibbon){ catRibbon.addEventListener('scroll', moveCatUnderline, {passive:true}); }

/* ===== حركة البداية: انقل السلايدر من "كل الأقسام" إلى التالي عند أول تحميل ===== */
let didInitialKick = false;
function kickUnderlineToNext(){
  if(didInitialKick || !catRibbon) return;
  const pills = Array.from(catRibbon.querySelectorAll('.pill'));
  if(pills.length < 2) return;
  // ابحث عن زر "كل الأقسام"
  const first = pills.find(p => p.dataset.id === 'sections') || pills[0];
  const idx   = pills.indexOf(first);
  const next  = pills[idx + 1] || pills[1];
  if(!next) return;

  // فعّل الـ active بصريًا على التالي (لا نغيّر state.activeCat)
  catRibbon.querySelectorAll('.pill').forEach(b => b.classList.toggle('active', b === next));
  didInitialKick = true;
  // حرّك السلايدر بعد تبديل الـ active لإظهار الأنيميشن
  requestAnimationFrame(() => moveCatUnderline());
}

let sectionObserver = null;
function setupSectionSpy(){
  if(sectionObserver){ sectionObserver.disconnect(); sectionObserver = null; }
  if(state.activeCat !== 'sections') return;

  const sections = Array.from(document.querySelectorAll('.menu-section'));
  if(sections.length === 0) return;

  sectionObserver = new IntersectionObserver((entries)=>{
    const vis = entries.filter(e=>e.isIntersecting).sort((a,b)=> b.intersectionRatio - a.intersectionRatio)[0];
    if(!vis) return;
    const catId = vis.target.id.replace('sec-','');

    // حدّث شريط الأقسام
    if(catRibbon){
      catRibbon.querySelectorAll('.pill').forEach(btn=>{
        btn.classList.toggle('active', btn.dataset.id === catId);
      });
      moveCatUnderline();
    }
    // حدّث قائمة الجانب
    const side = document.querySelector('#sideCats');
    if(side){
      side.querySelectorAll('a').forEach(a=>{
        a.classList.toggle('active', a.getAttribute('data-id') === catId);
      });
    }
  }, { root:null, threshold:0.55 });

  sections.forEach(sec=> sectionObserver.observe(sec));
}

/* Toast بسيط */
const Toast = {
  el: document.getElementById('appToast'),
  show(msg='أُضيفت للسلة'){
    if(!this.el){
      this.el = document.createElement('div');
      this.el.id = 'appToast'; this.el.className = 'toast';
      document.body.appendChild(this.el);
    }
    this.el.textContent = msg;
    this.el.classList.add('open');
    clearTimeout(this._t);
    this._t = setTimeout(()=> this.el.classList.remove('open'), 1400);
  }
};

/* ===== Search Panel ===== */
const searchToggle = document.querySelector('#searchToggle');
const searchPanel  = document.querySelector('#searchPanel');
const searchClose  = document.querySelector('#searchClose');

function openSearchPanel(){
  if(!searchPanel) return;
  searchPanel.classList.add('open');
  searchPanel.setAttribute('aria-hidden','false');
  if(searchToggle) searchToggle.setAttribute('aria-expanded','true');
  setTimeout(()=> searchInput && searchInput.focus(), 120);
}

/* ===== Hero: Reserve Modal =====
   (تاريخ منفصل + وقت منفصل + نوع الحجز + ملاحظات + تحقق ذكي) */
document.addEventListener('DOMContentLoaded', ()=>{
  const reserveBtn = document.getElementById('reserveBtn');
  if (!reserveBtn) return;

  reserveBtn.addEventListener('click', ()=>{
    const html = `
      <form id="reserveForm" class="form-vertical" novalidate style="display:grid;gap:12px">
        <div class="form-row">
          <label class="label" for="rName">الاسم <span class="req">*</span></label>
          <input id="rName" class="input-md" type="text" autocomplete="name" />
        </div>

        <div class="form-row">
          <label class="label" for="rPhone">رقم الجوال <span class="req">*</span></label>
          <input id="rPhone" class="input-md" type="tel" inputmode="tel" placeholder="05xxxxxxxx" />
        </div>

        <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label class="label" for="rDate">التاريخ <span class="req">*</span></label>
            <input id="rDate" class="input-md" type="date" />
          </div>
          <div>
            <label class="label" for="rTime">الوقت <span class="req">*</span></label>
            <input id="rTime" class="input-md" type="time" step="900" />
          </div>
        </div>

        <div class="form-row">
          <label class="label" for="rPeople">عدد الأشخاص <span class="req">*</span></label>
          <input id="rPeople" class="input-md" type="number" min="1" value="2" />
        </div>

        <div class="form-row">
          <label class="label" for="rType">نوع الحجز</label>
          <select id="rType" class="input-md">
            <option value="table">طاولة داخل المطعم</option>
            <option value="family">قسم العائلات</option>
            <option value="private">قسم خاص / مناسبات</option>
            <option value="full">حجز المطعم كامل</option>
          </select>
        </div>

        <div class="form-row">
          <label class="label" for="rNotes">ملاحظات (اختياري)</label>
          <textarea id="rNotes" class="input-md" rows="3" placeholder="مثال: تزيين بسيط لعيد ميلاد، قرب قسم العائلات..."></textarea>
        </div>

        <div id="reserveErr" class="form-error small" style="display:none;color:#b91c1c"></div>
      </form>
    `;

    const ok = document.createElement('button'); ok.className='btn btn-primary'; ok.textContent='تأكيد الحجز';
    const cancel = document.createElement('button'); cancel.className='btn btn-ghost';  cancel.textContent='إلغاء';
    cancel.onclick = ()=> Modal.hide();

    // [FIX] اجعل الحدث async
    ok.onclick = async ()=>{
      const name  = document.getElementById('rName')?.value.trim()  || '';
      const phone = document.getElementById('rPhone')?.value.trim() || '';
      const date  = document.getElementById('rDate')?.value || '';
      const time  = document.getElementById('rTime')?.value || '';
      const ppl   = Number(document.getElementById('rPeople')?.value || 0);
      const type  = document.getElementById('rType')?.value || 'table';
      const notes = document.getElementById('rNotes')?.value?.trim() || '';
      const errEl = document.getElementById('reserveErr');

      const errors = [];
      if(!name)  errors.push('يرجى إدخال الاسم.');
      if(!phone) errors.push('يرجى إدخال رقم الجوال.');
      if(!date)  errors.push('يرجى اختيار التاريخ.');
      if(!time)  errors.push('يرجى اختيار الوقت.');
      if(!ppl || ppl < 1) errors.push('عدد الأشخاص غير صحيح.');

      const todayStr = (()=>{ const d=new Date(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${dd}`; })();
      if(date && date < todayStr) errors.push('لا يمكن اختيار تاريخ في الماضي.');

      // حدود ساعات العمل
      const minTime = '12:00';
      const maxTime = '23:30';
      if(time && time < minTime) errors.push(`الوقت يجب أن يكون بعد ${minTime}.`);
      if(time && time > maxTime) errors.push(`الوقت يجب أن يكون قبل ${maxTime}.`);

      // لو التاريخ اليوم: لا تسمح بوقت مضى
      if(date === todayStr && time){
        const now = new Date();
        const hh = String(now.getHours()).padStart(2,'0');
        const mm = String(now.getMinutes()).padStart(2,'0');
        const nowHM = `${hh}:${mm}`;
        if(time < nowHM) errors.push('الوقت المختار سابق للوقت الحالي.');
      }

      if(errors.length){
        errEl.style.display='block';
        errEl.innerHTML = errors.map(e=>`• ${e}`).join('<br>');
        return;
      }

      // [FIX] تحقّق من توفر الجسر
      if(!window.supabaseBridge || !window.supabaseBridge.createReservationSB){
        Modal.info('الخدمة غير متاحة الآن. تأكد من تحميل Supabase والجسر.','تعذّر الإرسال');
        return;
      }

      // [FIX] لفّ النداء بـ try/catch
      try{
        await window.supabaseBridge.createReservationSB({
          name, phone, iso: `${date}T${time}`, people: ppl, kind: type, notes, duration_minutes: 90
        });

        // إشعار لصفحة لوحة التحكم
        const ns = LS.get('notifications', []);
        ns.unshift({
          id: crypto.randomUUID(),
          type: 'reservation',
          title: 'طلب حجز جديد',
          message: `${name} — ${ppl} أشخاص — ${date} ${time}`,
          time: nowISO(),
          read: false
        });
        LS.set('notifications', ns);
      }catch(e){
        console.error(e);
        Modal.info('تعذّر إرسال الحجز، حاول لاحقًا.','خطأ');
        return; // لا تُظهر نجاح عند الفشل
      }
      /* }catch(e){} */ // [FIX] تحييد الـ catch القديم

      Modal.hide();
      Modal.info('تم استلام طلب الحجز وسنقوم بالتواصل لتأكيده.','حجز طاولة');
    };

    Modal.show('حجز طاولة', html, [ok, cancel]);

    // تهيئة الحقول: أقل تاريخ = اليوم، والوقت ضمن ساعات العمل
    const rDate = document.getElementById('rDate');
    const rTime = document.getElementById('rTime');
    const todayStr = (()=>{ const d=new Date(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${d.getFullYear()}-${m}-${dd}`; })();
    if(rDate){ rDate.min = todayStr; if(!rDate.value) rDate.value = todayStr; }
    if(rTime){
      rTime.min = '12:00';
      rTime.max = '23:30';
      rTime.step = 900; // كل 15 دقيقة
    }
    setTimeout(()=> document.getElementById('rName')?.focus(), 50);
  });
});

/* إغلاق البحث */
function closeSearchPanel(){
  if(!searchPanel) return;
  if (searchInput && searchInput.value !== '') searchInput.value = '';
  if (typeof state !== 'undefined'){ state.search = ''; try{ renderItems(); }catch{} }
  searchPanel.classList.remove('open');
  searchPanel.setAttribute('aria-hidden','true');
  if(searchToggle) searchToggle.setAttribute('aria-expanded','false');
}
if(searchToggle) searchToggle.addEventListener('click', (e)=>{ e.stopPropagation(); openSearchPanel(); });
if(searchClose)  searchClose .addEventListener('click', closeSearchPanel);

/* ===== تعديل مهم: لا تُغلق البحث عند النقر داخل شبكة النتائج (#itemsGrid) أو داخل عناصره ===== */
document.addEventListener('click', (e)=>{
  if(!searchPanel || !searchPanel.classList.contains('open')) return;

  const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
  const isInside = (el)=> el && (path ? path.includes(el) : el.contains(e.target));

  const inside =
    isInside(searchPanel) ||
    (searchToggle && isInside(searchToggle)) ||
    (grid && isInside(grid)); // ✅ اعتبر شبكة النتائج كجزء من البحث

  if(!inside) closeSearchPanel();
});

/* =====================================================
   حالة الواجهة
===================================================== */
const state = { activeCat:'sections', search:'' };
const catIcons = { 'all':'🍽️','sections':'🗂️','starters':'🥗','mains':'🍛','desserts':'🍰','drinks':'🥤' };

/* ==== تنسيق أرقام إنجليزي لجميع العروض ==== */
const formatPrice = (n)=> Number(n||0).toLocaleString('en-US'); // أسعار
const formatInt   = (n)=> Number(n||0).toLocaleString('en-US'); // أعداد صحيحة (عدادات)
const formatAvg   = (n)=> Number(n||0).toLocaleString('en-US', { minimumFractionDigits:1, maximumFractionDigits:1 }); // متوسط

/* ===== نجمة بملء جزئي (RTL fill) مع حدود ===== */
function starSVGFrac(fill, key){
  const w = Math.max(0, Math.min(1, Number(fill)||0));
  const clipId = `clip-${key}`;
  const d = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  const width = (w*24).toFixed(2);
  const x = (24 - w*24).toFixed(2); // ابدأ القص من اليمين لليسار
  return `
    <svg class="star" viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <defs>
        <clipPath id="${clipId}">
          <rect x="${x}" y="0" width="${width}" height="24"/>
        </clipPath>
      </defs>
      <path d="${d}" fill="#e5e7eb" stroke="#d1d5db" stroke-width="1"></path>
      <g clip-path="url(#${clipId})">
        <path d="${d}" fill="#f59e0b"></path>
      </g>
    </svg>
  `;
}

/* =====================================================
   Load + Render categories + Items
===================================================== */
function renderCategories(){
  const cats = LS.get('categories', []);
  const items = LS.get('menuItems', []);

  // احسب متوسط التقييم لكل عنصر إن لزم (هنا نعتبره موجود ضمن rating.avg)
  const catIds = new Set(items.map(it => it.catId).filter(Boolean));
  const allBtn = `<button class="pill ${state.activeCat==='all'?'active':''}" data-id="all"><span class="ico">🍽️</span>الكل</button>`;
  const sectionsBtn = `<button class="pill ${state.activeCat==='sections'?'active':''}" data-id="sections"><span class="ico">🗂️</span>الأقسام</button>`;
  const catBtns = cats
    .filter(c => catIds.has(c.id))
    .map(c => `<button class="pill ${state.activeCat===c.id?'active':''}" data-id="${c.id}"><span class="ico">${catIcons[c.id]||'🍽️'}</span>${c.name}</button>`)
    .join('');

  if(catPills){
    catPills.innerHTML = allBtn + sectionsBtn + catBtns;
    catPills.querySelectorAll('.pill').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.id;
        state.activeCat = id;
        state.search = ''; if(searchInput){ searchInput.value = ''; }
        renderItems();
        // تحريك شريط الأقسام في الرِبن إن وُجد
        if(catRibbon){
          catRibbon.querySelectorAll('.pill').forEach(b=> b.classList.toggle('active', b===btn));
          moveCatUnderline();
        }
        // مراقبة الأقسام عند اختيار "الأقسام"
        if(id === 'sections') setupSectionSpy();
        else if(sectionObserver){ sectionObserver.disconnect(); sectionObserver = null; }
      });
    });
  }

  if(catRibbon){
    catRibbon.innerHTML = sectionsBtn + catBtns;
    catRibbon.querySelectorAll('.pill').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        // عند اختيار "الأقسام": تمرير إلى القسم المعني بدلاً من إعادة بناء العناصر
        const id = btn.dataset.id;
        catRibbon.querySelectorAll('.pill').forEach(b=> b.classList.toggle('active', b===btn));
        moveCatUnderline();
        if(id === 'sections'){
          state.activeCat = 'sections'; renderItems();
          setupSectionSpy();
          return;
        }
        const sec = document.getElementById('sec-'+id);
        if(sec){
          sec.scrollIntoView({ behavior:'smooth', block:'start' });
          state.activeCat = 'sections'; // نقلل تشويش الحالة، نرجع للوضع الأقسام
          setupSectionSpy();
        }else{
          // لا يوجد قسم على الصفحة، اعرض قائمة بهذا التصنيف فقط
          state.activeCat = id; renderItems();
        }
      });
    });
    requestAnimationFrame(() => { moveCatUnderline(); kickUnderlineToNext(); });
  }
}

/* ======= Ratings: render a row of 5 stars with partial fill ======= */
function renderStars(avg, id){
  const a = Number(avg||0);
  let html = `<div class="stars" aria-label="متوسط ${a.toFixed(1)} من 5">`;
  for(let i=0;i<5;i++){
    const fill = Math.max(0, Math.min(1, a - i));
    html += starSVGFrac(fill, `${id}-${i}`);
  }
  html += `<span class="avg-badge badge badge-muted small" style="margin-inline-start:8px">${formatAvg(a)}</span></div>`;
  return html;
}

/* ======== Group items by category to sections (when state.activeCat==='sections') ======== */
function renderSections(items){
  const cats = LS.get('categories', []);
  // بناء خريطة id->اسم
  const catMap = new Map(cats.map(c => [c.id, c.name]));
  // تجميع العناصر حسب catId
  const groups = items.reduce((acc, it)=>{
    const id = it.catId || 'uncat';
    (acc[id] = acc[id] || []).push(it);
    return acc;
  }, {});
  // رتّب حسب ترتيب الأقسام (sort) لو موجود
  const catOrder = new Map(cats.map((c,i)=>[c.id, c.sort ?? (i+1)]));
  const ids = Object.keys(groups).sort((a,b)=>(catOrder.get(a)||9999)-(catOrder.get(b)||9999));

  const frag = document.createDocumentFragment();
  ids.forEach(id=>{
    const sec = document.createElement('section');
    sec.className = 'menu-section';
    sec.id = 'sec-'+id;
    const title = catMap.get(id) || 'أخرى';
    sec.innerHTML = `
      <div class="card" style="padding:16px">
        <h2 style="margin:0 0 10px">${title}</h2>
        <div class="grid grid-3"></div>
      </div>
    `;
    const g = sec.querySelector('.grid');
    groups[id].forEach(it => g.appendChild(itemCard(it)));
    frag.appendChild(sec);
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}

/* ======== Item Card ======== */
function itemCard(it){
  const card = document.createElement('div');
  card.className = 'card';
  card.style.overflow = 'hidden';
  card.innerHTML = `
    <div class="item-img-wrap">
      ${it.fresh ? '<span class="img-badge">طازج</span>' : ''}
      <img class="item-img" src="${escapeAttr(it.img||'')}" alt="${escapeAttr(it.name)}" onerror="this.src='https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1200&auto=format&fit=crop'" />
    </div>
    <div class="item-body">
      <div class="item-title">
        <h3>${escapeHTML(it.name)}</h3>
        <div class="price">${formatPrice(it.price)} ل.س</div>
      </div>
      <div class="item-desc">${escapeHTML(it.desc||'')}</div>
      <div class="item-actions">
        ${renderStars(it?.rating?.avg || 0, it.id)}
        <button class="btn btn-primary btn-compact addBtn">أضف للسلة</button>
      </div>
    </div>
  `;
  card.querySelector('.addBtn').addEventListener('click', ()=>{
    addToCart(it);
  });
  return card;
}

// ملحقات HTML آمنة (بدائية)
function escapeHTML(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function escapeAttr(s){ return escapeHTML(s).replace(/"/g,'&quot;'); }

/* ========= Render items ========= */
function renderItems(){
  const items = LS.get('menuItems', []);
  const q = state.search.trim().toLowerCase();
  let filtered = items;

  if(state.activeCat && state.activeCat !== 'all' && state.activeCat !== 'sections'){
    filtered = filtered.filter(it => it.catId === state.activeCat);
  }

  if(q){
    filtered = filtered.filter(it =>
      (it.name||'').toLowerCase().includes(q) ||
      (it.desc||'').toLowerCase().includes(q)
    );
  }

  // وضع الأقسام: قسّم الكروت على أقسام
  if(state.activeCat === 'sections'){
    renderSections(filtered);
    return;
  }

  grid.innerHTML = '';
  if(filtered.length === 0){
    grid.innerHTML = `<div class="card" style="padding:16px">لا يوجد أصناف مطابقة.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(it => frag.appendChild(itemCard(it)));
  grid.appendChild(frag);
}

/* ========= Search input ========= */
if(searchInput){
  searchInput.addEventListener('input', ()=>{
    state.search = searchInput.value || '';
    renderItems();
  });
}

/* =====================================================
   Cart (localStorage)
===================================================== */
function getCart(){ return LS.get('cart', []); }
function setCart(c){ LS.set('cart', c); updateCartUI(); }

function addToCart(item){
  const c = getCart();
  const idx = c.findIndex(x => x.id === item.id);
  if(idx >= 0) c[idx].qty += 1;
  else c.push({ id:item.id, name:item.name, price:item.price, qty:1, img:item.img || '' });
  setCart(c);
  Toast.show('أُضيفت للسلة');
}
function removeFromCart(id){
  const c = getCart().filter(x => x.id !== id);
  setCart(c);
}
function incQty(id){
  const c = getCart();
  const it = c.find(x => x.id === id);
  if(!it) return;
  it.qty += 1;
  setCart(c);
}
function decQty(id){
  const c = getCart();
  const it = c.find(x => x.id === id);
  if(!it) return;
  it.qty -= 1;
  if(it.qty <= 0) return removeFromCart(id);
  setCart(c);
}

/* ===== Drawer ===== */
function openDrawer(){
  if(cartDrawer){
    cartDrawer.classList.add('open');
    cartDrawer.setAttribute('aria-hidden','false');
    if(backdrop){ backdrop.classList.add('open'); backdrop.onclick = closeDrawer; }
  }
}
function closeDrawer(){
  if(cartDrawer){
    cartDrawer.classList.remove('open');
    cartDrawer.setAttribute('aria-hidden','true');
    if(backdrop){ backdrop.classList.remove('open'); backdrop.onclick = null; }
  }
}
if(cartBtn) cartBtn.addEventListener('click', openDrawer);
if(closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);

/* ===== Cart UI ===== */
function updateCartUI(){
  const c = getCart();
  const total = c.reduce((a,b)=> a + (Number(b.price||0) * Number(b.qty||0)), 0);
  const count = c.reduce((a,b)=> a + (Number(b.qty||0)), 0);

  if(cartCount) cartCount.textContent = String(count || 0);
  if(cartFabCount) cartFabCount.textContent = String(count || 0);
  if(fabTotalEl) fabTotalEl.textContent = `${formatPrice(total)} ل.س`;

  if(cartItemsEl){
    if(c.length === 0){
      cartItemsEl.innerHTML = '<div class="small" style="color:var(--muted)">السلة فارغة</div>';
    }else{
      cartItemsEl.innerHTML = c.map(it => `
        <div class="cart-item">
          <img src="${escapeAttr(it.img||'')}" alt="${escapeAttr(it.name)}" />
          <div style="flex:1">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
              <strong>${escapeHTML(it.name)}</strong>
              <span class="price">${formatPrice(it.price)} ل.س</span>
            </div>
            <div class="qty">
              <button type="button" aria-label="إنقاص" onclick="decQty('${it.id}')">−</button>
              <span>${formatInt(it.qty)}</span>
              <button type="button" aria-label="زيادة" onclick="incQty('${it.id}')">+</button>
            </div>
          </div>
          <button class="btn btn-ghost" title="إزالة" onclick="removeFromCart('${it.id}')">إزالة</button>
        </div>
      `).join('');
    }
  }
  if(cartTotalEl) cartTotalEl.textContent = `${formatPrice(total)} ل.س`;
}
window.updateCartUI = updateCartUI;

/* ===== Checkout ===== */
async function checkout(){
  const cart = getCart();
  if(!cart.length){ Modal.info('السلة فارغة.'); return; }

  const html = `
    <div style="display:grid;gap:12px">
      <label class="label">* طريقة الطلب</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="ordType" value="dine" checked /> تناول في المطعم</label>
        <label style="display:inline-flex;align-items:center;gap:6px"><input type="radio" name="ordType" value="take" /> سفري</label>
      </div>
      <label class="label">اسم (اختياري)</label>
      <input id="chName" class="input" placeholder="مثال: أبو أحمد" />
      <label class="label">رقم الطاولة (اختياري)</label>
      <input id="chTable" class="input" inputmode="numeric" placeholder="5" />
      <label class="label">ملاحظات</label>
      <textarea id="chNotes" class="input" rows="3" placeholder="مثال: بدون بصل…"></textarea>
      <div class="small" style="color:var(--muted)">* تعني حقلًا مهمًا.</div>
    </div>
  `;
  const ok = { label:'تأكيد الطلب', className:'btn btn-primary', onClick: async ()=>{
    const orderType = document.querySelector('input[name="ordType"]:checked')?.value || 'dine';
    const name  = document.getElementById('chName')?.value || '';
    const table = document.getElementById('chTable')?.value || '';
    const notes = document.getElementById('chNotes')?.value || '';

    const items = cart.map(it => ({ id: it.id, name: it.name, price: it.price, qty: it.qty }));
    try{
      const fn = window.supabaseBridge?.createOrderSB;
      if(!fn){ throw new Error('الجسر غير متاح'); }
      const res = await fn({ order_name:name, table_no: orderType==='dine' ? table : '', phone:'', notes, items });
      // إشعار لوحة الإدارة
      try{ window.notifyAdminNewOrder?.(); }catch{}
      // نظّف السلة ثم أغلق
      setCart([]);
      hideModal();
      Modal.info(`تم إنشاء الطلب بنجاح. رقم الطلب: #${res?.id || '—'}`);
    }catch(e){
      console.error(e);
      Modal.info('تعذّر إنشاء الطلب حالياً. حاول لاحقاً.');
    }
  }};
  const cancel = { label:'إلغاء', className:'btn btn-ghost', onClick: hideModal };
  showModal({ title:'تأكيد الطلب', bodyHTML: html, actions:[ok, cancel] });
}
if(checkoutBtn) checkoutBtn.addEventListener('click', checkout);

/* =====================================================
   Public Interval — polling + initial sync signal
===================================================== */
let __PUB_INT = null;
function startPublicInterval(){
  // لا تبدأ أكثر من مرة
  if(__PUB_INT) return;
  // تحديث الواجهة عند تغيّر التخزين المحلي
  window.addEventListener('storage', (e)=>{
    if(!e || !['categories','menuItems','cart','ratings'].includes(e.key||'')) return;
    if(['categories','menuItems'].includes(e.key)) renderCategories();
    renderItems();
    updateCartUI();
  });

  // رسم أولي من المخزن
  renderCategories();
  renderItems();
  updateCartUI();

  // استطلاع خفيف كل 4 ثوانٍ لحين اعتماد Realtime بالكامل (اختياري)
  __PUB_INT = setInterval(async ()=>{
    try{
      // دع صفحات الأدمن تعرف أننا نريد تحديثًا إذا توفّر (broadcast)
      // (اختياري) — لا يؤثر على الأداء إن لم يوجد مستمعون
      if(window.__LIVE_CH){
        try{ await window.__LIVE_CH.send({ type:'broadcast', event:'ping', payload:{ ts: Date.now() } }); }catch{}
      }
    }catch{}
  }, 4000);
}
window.startPublicInterval = startPublicInterval;

/* =====================================================
   Ratings (public): allow users to rate per item once
===================================================== */
function getRatedMap(){ return LS.get('userRated', {}); }
function setRatedMap(m){ LS.set('userRated', m); }

function rateItem(itemId, stars){
  // لكل جهاز: تقييم واحد لكل عنصر — تُخزّن محلياً + إرسال للسيرفر عند توفّر Supabase
  const s = Math.min(5, Math.max(1, Number(stars)||0));
  const m = getRatedMap();
  if(m[itemId]){ Modal.info('لقد قمت بتقييم هذا الصنف مسبقاً.'); return; }

  // حدّث العرض المحلي (متوسط وعدد)
  const list = LS.get('menuItems', []);
  const it = list.find(x => x.id === itemId);
  if(it){
    const c = Number(it?.rating?.count||0);
    const a = Number(it?.rating?.avg||0);
    const newAvg = ((a * c) + s) / (c + 1);
    it.rating = { avg: newAvg, count: c + 1 };
    LS.set('menuItems', list);
    renderItems();
  }

  // خزّن أنّ هذا المستخدم قيّم العنصر
  m[itemId] = s; setRatedMap(m);

  // أرسل للسيرفر إن توفر الجسر
  try{
    if(window.supabase && window.supabase.from){
      // ندخل تقييم للسيرفر — آمن حتى لو فشل
      window.supabase.from('ratings').insert([{ item_id:itemId, stars:s }]).then(()=>{}).catch(()=>{});
    }
  }catch{}
}

/* =====================================================
   Expose some helpers to window (used by inline onclicks)
===================================================== */
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.incQty = incQty;
window.decQty = decQty;
window.checkout = checkout;
window.rateItem = rateItem;

/* =====================================================
   Live sync hooks — when bridge syncs data to localStorage
===================================================== */
document.addEventListener('sb:public-synced', ()=>{
  try{ renderCategories(); renderItems(); updateCartUI(); }catch(e){}
});

/* =====================================================
   Accessibility & small UX touches
===================================================== */
// اجعل زر الفاب يظهر عند تمرير صفحة القائمة (إن كان موجوداً في الصفحة)
(function(){
  const fab = document.getElementById('cartFab');
  if(!fab) return;
  let lastY = window.scrollY;
  function onScroll(){
    const y = window.scrollY;
    if(y > 240 && y > lastY) fab.classList.add('show');
    else if(y < 120) fab.classList.remove('show');
    lastY = y;
  }
  window.addEventListener('scroll', onScroll, { passive:true });
})();

// اغلق الدرج بالسحب على الموبايل (تحسين بسيط)
(function(){
  if(!cartDrawer) return;
  let startX = null;
  function onTouchStart(e){ startX = e.touches[0].clientX; }
  function onTouchMove(e){
    if(startX == null) return;
    const dx = e.touches[0].clientX - startX;
    // drawer يمين (translateX 0 ← 100%)
    if(dx > 60){ closeDrawer(); startX = null; }
  }
  cartDrawer.addEventListener('touchstart', onTouchStart, { passive:true });
  cartDrawer.addEventListener('touchmove', onTouchMove, { passive:true });
})();

/* =====================================================
   Hours (opening times) — simple demo section
===================================================== */
(function(){
  const hoursEl = document.getElementById('hoursList');
  const badge = document.getElementById('openNowBadge');
  if(!hoursEl || !badge) return;

  const hours = [
    { d:'السبت',    from:'12:00', to:'23:00' },
    { d:'الأحد',    from:'12:00', to:'23:00' },
    { d:'الاثنين',  from:'12:00', to:'23:00' },
    { d:'الثلاثاء', from:'12:00', to:'23:00' },
    { d:'الأربعاء', from:'12:00', to:'23:00' },
    { d:'الخميس',   from:'12:00', to:'23:00' },
    { d:'الجمعة',   from:'12:00', to:'23:00' }
  ];

  hoursEl.innerHTML = hours.map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #eee">
      <span>${h.d}</span><span>${h.from} – ${h.to}</span>
    </div>
  `).join('');

  function isOpenNow(){
    const now = new Date();
    // JS: 0=Sunday → 6=Saturday; نعيدها ل: سبت=6...جمعة=5 (ليس مهمًا في الديمو)
    const day = (now.getDay()+6)%7;
    const h = hours[day];
    const cur = now.toTimeString().slice(0,5);
    return cur >= h.from && cur <= h.to;
  }

  function update(){
    badge.textContent = isOpenNow() ? 'مفتوح الآن' : 'مغلق الآن';
    badge.className = 'badge small ' + (isOpenNow() ? 'badge-olive' : 'badge-muted');
  }
  update();
  setInterval(update, 60_000);
})();

/* =====================================================
   Migrator: v2025-09 helper to adapt older local data
===================================================== */
(function migrateLocal(){
  try{
    // تأكد من شكل menuItems (rating كبنية {avg,count})
    const arr = LS.get('menuItems', []);
    let changed = false;
    for(const it of arr){
      if(!it.rating || typeof it.rating !== 'object'){
        const a = Number(it.rating_avg||0);
        const c = Number(it.rating_count||0);
        if(a || c){
          it.rating = { avg:a, count:c };
          delete it.rating_avg; delete it.rating_count;
          changed = true;
        }
      }
      if('cat_id' in it && !it.catId){ it.catId = it.cat_id; delete it.cat_id; changed = true; }
      if('desc' in it && !it.desc){ it.desc = it['desc']; delete it['desc']; changed = true; }
    }
    if(changed) LS.set('menuItems', arr);
  }catch{}
})();

/* =====================================================
   Hero background fallback if image fails to load
===================================================== */
(function(){
  const bg = document.querySelector('.hero-landing .hero-bg');
  if(!bg) return;
  const img = new Image();
  const url = (bg.style.backgroundImage || '').replace(/^url\(["']?|["']?\)$/g,'').replace(/^url\(/,'').replace(/\)$/,'');
  if(!url) return;
  img.onload = ()=>{};
  img.onerror = ()=>{
    bg.style.backgroundImage = 'linear-gradient(180deg, #dd5b5b, #c53f3f)';
  };
  img.src = url;
})();

/* =====================================================
   SEO/Meta micro enhancements (no-op if tags absent)
===================================================== */
(function(){
  // تعيين عنوان ديناميكي صغير عند التركيز على البحث
  if(searchInput){
    const base = document.title;
    searchInput.addEventListener('focus', ()=>{ document.title = 'بحث… — ' + base; });
    searchInput.addEventListener('blur',  ()=>{ document.title = base; });
  }
})();
