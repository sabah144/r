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

/* ==== Normalize image URL locally (works with http(s), data:, blob:, and storage paths) ==== */
const DEFAULT_IMG = 'https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop';
function normalizeImgPublic(raw){
  const s = String(raw ?? '').trim();
  if (!s) return DEFAULT_IMG;

  // URL جاهز للاستخدام
if (/^(https?:\/\/|data:)/i.test(s)) return s;   // لا تقبل blob:

  // حماية من قيم خاطئة
  if (s === '[object Object]' || /^[{\[]/.test(s)) return DEFAULT_IMG;

  // حدّد البكت المناسب من النص إن وُجد، وإلا استخدم images
  const hintedBucket =
    /^menu-images\//i.test(s) ? 'menu-images' :
    /^images\//i.test(s)      ? 'images'      : 'images';

  const path = s.replace(/^(images|menu-images)\//i, '').replace(/^\/+/, '');

  // جرّب البناء عبر عميل Supabase إن كان متاحًا
  try{
    const urlObj = window.supabase?.storage?.from?.(hintedBucket)?.getPublicUrl?.(path);
    const url = urlObj?.data?.publicUrl || '';
    if (url) return url;
  }catch(_){}

  // خطة احتياطية: نبني الرابط يدويًا
  const base = (window.SUPABASE_URL || '').replace(/\/+$/,'');
  if (base) return `${base}/storage/v1/object/public/${hintedBucket}/${path}`;

  return DEFAULT_IMG;
}

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
        <div id="reserveErr" class="form-error small" style="display:none;color:#b91c1c"></div>
      </form>
        <div class="form-row">
          <label class="label" for="rNotes">ملاحظات (اختياري)</label>
          <textarea id="rNotes" class="input-md" rows="3" placeholder="مثال: تزيين بسيط لعيد ميلاد، قرب قسم العائلات..."></textarea>
        </div>

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
          name, phone, iso: new Date(`${date}T${time}`).toISOString(),
 people: ppl, kind: type, notes, duration_minutes: 90
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
    <svg class="star" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <defs>
        <clipPath id="${clipId}">
          <rect x="${x}" y="0" width="${width}" height="24"></rect>
        </clipPath>
      </defs>
      <path d="${d}" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1.2"></path>
      <g clip-path="url(#${clipId})">
        <path d="${d}" fill="#F5A524" stroke="#b45309" stroke-width="1.2"></path>
      </g>
    </svg>
  `;
}

/* إجمالي الـ FAB */
function updateFabTotal(){
  const el = document.getElementById('fabTotal');
  if(!el) return;
  const items = LS.get('menuItems', []);
  const cart  = LS.get('cart', []);
  const total = cart.reduce((s,ci)=>{
    const it = items.find(x=>x.id===ci.id);
    return s + (it?.price||0)*ci.qty;
  }, 0);
  el.textContent = formatPrice(total);
}

function renderCats(){
  const cats = LS.get('categories', []);
  const list = cats.filter(c => c.id !== 'all');
  const pseudo = { id:'sections', name:'كل الأقسام' };
  const i = list.findIndex(c => c.id === 'starters');
  if (i > -1) list.splice(i, 0, pseudo);
  else list.unshift(pseudo);

  function drawInto(container){
    if(!container) return;
    container.innerHTML = '';
    list.forEach(c=>{
      const btn = document.createElement('button');
      const isActive = state.activeCat===c.id;
      btn.className = 'pill' + (isActive ? ' active' : '');
      btn.dataset.id = c.id; // مهم للسلايدر والتتبّع
      const ico = catIcons[c.id] ? `<span class="ico">${catIcons[c.id]}</span>` : '';
      btn.innerHTML = `${ico}<span>${c.name}</span>`;
      btn.onclick = ()=>{
        if (c.id === 'sections'){
          state.activeCat = 'sections';
          renderItems(); renderCats();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (state.activeCat === 'sections'){
          const sec = document.getElementById('sec-'+c.id);
          if (sec) sec.scrollIntoView({ behavior:'smooth', block:'start' });
          // فعّلها فورًا على الشريط ليظهر المؤشر مباشرةً
          if(catRibbon){
            catRibbon.querySelectorAll('.pill').forEach(b=> b.classList.toggle('active', b===btn));
            moveCatUnderline();
          }
        } else {
          state.activeCat = c.id; renderItems(); renderCats();
        }
      };
      container.appendChild(btn);
    });
  }

  drawInto(catPills);
  drawInto(catRibbon);
  // حرّك المؤشر بعد اكتمال الرسم
  moveCatUnderline();

  // عند البداية فقط: حرّك السلايدر من "كل الأقسام" إلى التالي (تأثير بصري)
  if (state.activeCat === 'sections' && !didInitialKick) {
    requestAnimationFrame(() => setTimeout(kickUnderlineToNext, 60));
  }
}
renderCats();

function filteredItems(){
  const items = LS.get('menuItems', []).filter(i=>i.available!==false);
  return items.filter(i=> (state.activeCat==='all' || i.catId===state.activeCat) &&
                           (state.search==='' || i.name.includes(state.search) || i.desc?.includes(state.search)));
}

/* ===== Rating helpers ===== */
function userHasOrderedItem(itemId){
  const orders = LS.get('orders', []);
  const target = String(itemId);
  return orders.some(o =>
    Array.isArray(o.items) &&
    o.items.some(it => String(it.itemId ?? it.id ?? '') === target)
  );
}

function userHasRatedItem(itemId){
  const rated = LS.get('userRated', {});
  return !!rated[itemId];
}

function renderItems(){
  if(!grid) return;

  const allItems = LS.get('menuItems', []).filter(i=>i.available!==false);
  const q = (state.search||'').trim();

  // === بطاقة: السعر يمين + زر يسار + نجوم RTL جزئية + متوسط ملون ===
function cardHTML(i, idx){
  const eager = (Number(idx)||0) < 10; // أول 4 صور بسرعة عالية
    const already = userHasRatedItem(i.id);
    const avgRaw  = Math.max(0, Math.min(5, Number(i.rating?.avg || 0)));
    const avgTxt  = formatAvg(avgRaw);
    const avgClass= avgRaw >= 4.5 ? 'rate-good' : (avgRaw >= 3 ? 'rate-mid' : 'rate-bad');

    return `
      <div class="card">
<div class="item-img-wrap skeleton">
<img src="${normalizeImgPublic(i.img)}"
width="1600" height="1000"
     loading="${eager ? 'eager' : 'lazy'}"
     fetchpriority="${eager ? 'high' : 'auto'}"
     decoding="async"
     class="item-img"
     alt="${i.name}"
     onload="this.closest('.item-img-wrap')?.classList.remove('skeleton')"
     onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop'"/>

     onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop'"/>

          ${i.fresh?'<span class="img-badge">طازج</span>':""}
        </div>
        <div class="item-body">
          <div class="item-title">
            <h3>${i.name}</h3>
            <div class="price"><span>${formatPrice(i.price)}</span> ل.س</div>
          </div>

          <div class="item-desc">${i.desc||''}</div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
            <div class="stars ${already?'is-rated':''}" data-id="${i.id}" title="${already?'تم التقييم سابقاً':'اضغط للتقييم'}">
              ${[5,4,3,2,1].map(n=>{
                const f = Math.max(0, Math.min(1, avgRaw - (5 - n))); // املأ من اليمين إلى اليسار
                return starSVGFrac(f, `${i.id}-${n}`);
              }).join('')}
              <span class="avg-badge ${avgClass}" title="متوسط التقييم">${avgTxt}</span>
              <span class="small" style="margin-right:6px">(${formatInt(i.rating?.count||0)})</span>
            </div>
          </div>

          <div class="item-actions">
            <button class="btn btn-primary" onclick="addToCart('${i.id}', event)">أضِف إلى السلة</button>
          </div>

        </div>
      </div>
    `;
  }

  if (state.activeCat === 'sections'){
    grid.className = '';
    const cats = LS.get('categories', []).filter(c=>c.id!=='all');
    let html = '';
    cats.forEach(c=>{
      const arr = allItems.filter(i =>
        i.catId === c.id && (q==='' || i.name.includes(q) || i.desc?.includes(q))
      );
      if(arr.length===0) return;

      html += `
        <section class="menu-section" id="sec-${c.id}">
          <div class="card section-card">
            <div class="section-head">
              <h2 class="section-title">${c.name}</h2>
            </div>
            <div class="grid grid-3">
${arr.map((it,idx)=>cardHTML(it, idx)).join('')}
            </div>
          </div>
        </section>
      `;
    });

    grid.innerHTML = html || '<div class="small" style="color:var(--muted)">لا يوجد أصناف مطابقة.</div>';

    // فعِّل تتبّع الأقسام في وضع "كل الأقسام"
    setupSectionSpy();

  } else {
    grid.className = 'grid grid-3';
    const items = allItems.filter(i=>
      (state.activeCat==='all' || i.catId===state.activeCat) &&
      (q==='' || i.name.includes(q) || i.desc?.includes(q))
    );
grid.innerHTML = items.map((it,idx)=>cardHTML(it, idx)).join('');

    // أوقف التتبّع في الوضع العادي وحرّك المؤشر لمواءمة الحبة النشطة
    if(sectionObserver){ sectionObserver.disconnect(); sectionObserver = null; }
    moveCatUnderline();
  }

  // ⚠️ أزلنا ربط النقر لكل نجمة هنا لتفادي الازدواجية؛ معالج النقر العام موجود أسفل الملف.
}
renderItems();

/* ===== بحث ===== */
if(searchInput){
  searchInput.addEventListener('input', (e)=>{ state.search = e.target.value.trim(); renderItems(); });
}

/* =====================================================
   Cart
===================================================== */
function getCart(){ return LS.get('cart', []); }
function setCart(c){ LS.set('cart', c); updateCartCount(); updateFabTotal(); }
function updateCartCount(){
  const c = getCart();
  const n = c.reduce((a,b)=>a+b.qty,0);

  if(cartCount){
    if(n>0){ cartCount.style.display='inline-block'; cartCount.textContent = formatInt(n); }
    else{ cartCount.style.display='none'; }
  }
  if(cartFabCount){
    if(n>0){
      cartFabCount.textContent = formatInt(n);
      cartFabCount.hidden = false;
      cartFabCount.style.display = '';
    }else{
      cartFabCount.hidden = true;
      cartFabCount.style.display = 'none';
    }
  }
}
updateCartCount();

/* ====== إنشاء/تفعيل زر السلة العائم (FAB) ====== */
(function initFab(){
  try{
    // إن لم يكن موجودًا في الـ HTML لأي سبب، أنشئه (بالإجمالي):
    if(!cartFab){
      const btn = document.createElement('button');
      btn.id = 'cartFab';
      btn.className = 'cart-fab';
      btn.type = 'button';
      btn.setAttribute('aria-label','افتح السلة');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M7 4h-2l-1 2h2l3.6 7.59-1.35 2.41A2 2 0 0 0 10 18h9v-2h-8.42a.25.25 0 0 1-.22-.37L11 13h6a2 2 0 0 0 1.8-1.1l3-6H7.42L7 4Z" fill="currentColor"/>
        </svg>
        <span class="cart-fab__label"><span id="fabTotal">0</span> ل.س</span>
        <span id="cartFabCount" class="badge" hidden>0</span>
      `;
      document.body.appendChild(btn);
      cartFab = btn;
      cartFabCount = btn.querySelector('#cartFabCount');
    }
    // منع إغلاق السلة فور النقر على الـ FAB
    if(cartFab){
      cartFab.addEventListener('click', (e)=>{ e.stopPropagation(); openCart(); });
    }
    updateCartCount();
    updateFabTotal();
  }catch(e){}
})();

/* ===== تعديل: استقبل الحدث وأوقف انتشاره لمنع إغلاق البحث عند الإضافة ===== */
function addToCart(id, ev){
  if(ev) ev.stopPropagation();
  const cart = getCart();
  const existing = cart.find(x=>x.id===id);
  if(existing) existing.qty++;
  else cart.push({id, qty:1});
  setCart(cart);
  Toast.show('أُضيفت للسلة');
}

/* ===== فتح/إغلاق السلة ===== */
function openCart(){
  if(!cartDrawer) return;
  document.body.classList.add('cart-open');
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden','false');
  if(cartBtn) cartBtn.setAttribute('aria-expanded','true');
  if(cartFab) cartFab.classList.add('fab-hide');
  if(backdrop) backdrop.classList.add('open');
  renderCart();
}
function closeCart(){
  if(!cartDrawer) return;
  document.body.classList.remove('cart-open');
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden','true');
  if(cartBtn) cartBtn.setAttribute('aria-expanded','false');
  if(cartFab) cartFab.classList.remove('fab-hide');
  if(backdrop) backdrop.classList.remove('open');
}
if(cartBtn) cartBtn.addEventListener('click', openCart);
if(closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeCart);

// إغلاق من الخلفية
if(backdrop){ backdrop.addEventListener('click', ()=> closeCart()); }

/* === إغلاق السلة عند النقر خارجها — نسخة محصّنة بـ composedPath === */
document.addEventListener('click', function (e) {
  if(!cartDrawer || !cartDrawer.classList.contains('open')) return;

  const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
  const isInside = (node)=> node && (path ? path.includes(node) : node.contains(e.target));

  const inside =
    isInside(cartDrawer) ||
    (cartFab && isInside(cartFab)) ||
    (cartBtn && isInside(cartBtn));

  if(!inside) closeCart();
});

/* ===== رسم محتوى السلة ===== */
function renderCart(){
  if(!cartItemsEl || !cartTotalEl) return;
  const items = LS.get('menuItems', []);
  const cart  = getCart();
  let total = 0;

  cartItemsEl.innerHTML = '';
  if(cart.length===0){
    cartItemsEl.innerHTML = '<div class="small" style="text-align:center;color:var(--muted)">السلة فارغة</div>';
  }

  cart.forEach(ci=>{
    const item = items.find(x=>x.id===ci.id);
    if(!item) return;
    const sum = item.price * ci.qty;
    total += sum;

    const row = document.createElement('div');
    row.className='cart-item';
    row.innerHTML = `
<img src="${normalizeImgPublic(item.img)}"
     loading="lazy" decoding="async" alt="${item.name}"
     onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop'"/>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${item.name}</strong>
          <button title="حذف" style="border:none;background:transparent;cursor:pointer;color:#b91c1c;font-weight:700" aria-label="حذف" onclick="removeFromCart('${ci.id}', event)">×</button>
        </div>
        <div class="small" style="color:var(--muted)">${formatPrice(item.price)} ل.س</div>
        <div class="qty" style="margin-top:6px">
          <button onclick="incQty('${ci.id}', event)">+</button>
          <span><strong>${formatInt(ci.qty)}</strong></span>
          <button onclick="decQty('${ci.id}', event)">-</button>
          <span class="small" style="margin-right:auto;color:var(--muted)">المجموع: ${formatPrice(sum)} ل.س</span>
        </div>
      </div>
    `;
    cartItemsEl.appendChild(row);
  });
  cartTotalEl.textContent = formatPrice(total);
  updateFabTotal();
}

/* ===== دوال الكمية (توقف انتشار الحدث) ===== */
function incQty(id, ev){
  if(ev) ev.stopPropagation();
  const c=getCart(); const x=c.find(i=>i.id===id);
  if(x){ x.qty++; setCart(c); renderCart(); }
}
function decQty(id, ev){
  if(ev) ev.stopPropagation();
  const c=getCart(); const x=c.find(i=>i.id===id);
  if(x){
    x.qty--;
    if(x.qty<=0){ return removeFromCart(id, ev); }
    setCart(c); renderCart();
  }
}
function removeFromCart(id, ev){
  if(ev) ev.stopPropagation();
  const c=getCart().filter(i=>i.id!==id);
  setCart(c); renderCart();
}

/* ============================
   نافذة إدخال بيانات الطلب
===============================*/
/* ============================
   نافذة إدخال بيانات الطلب (جديدة)
===============================*/
function askOrderInfo(){
  return new Promise((resolve)=>{
    const html = `
      <form id="orderForm" class="form-vertical" novalidate>
        <div style="display:flex;gap:8px;margin:0 0 12px">
          <button type="button" id="tabTable" class="btn btn-primary">طاولة</button>
          <button type="button" id="tabOut"   class="btn btn-ghost">سفري/توصيل</button>
        </div>

        <div id="panelTable">
          <div class="form-row">
            <label class="label" for="tableInput">رقم الطاولة <span class="req">*</span></label>
            <input id="tableInput" class="input-md" type="text" inputmode="numeric" pattern="[0-9]*" dir="auto" placeholder="مثال: 12" />
          </div>

          <div class="form-row">
            <label class="label" for="notesInput">ملاحظات <span class="small" style="color:var(--muted)">(اختياري)</span></label>
            <textarea id="notesInput" class="input-md" rows="3" placeholder="مثلاً: بدون بصل / زيادة صوص"></textarea>
          </div>
        </div>

        <div id="panelOut" style="display:none">
          <div class="form-row">
            <label class="label" for="dlvyLoc">الموقع</label>
            <input id="dlvyLoc" class="input-md" type="text" dir="auto" placeholder="مثلاً: شارع الملك، بناية 5، شقة 10" />
          </div>
          <div class="form-row">
            <label class="label" for="dlvyPhone">رقم الهاتف</label>
            <input id="dlvyPhone" class="input-md" type="tel" inputmode="tel" dir="ltr" placeholder="05xxxxxxxx" />
          </div>
          <div class="form-row">
            <label class="label" for="dlvyNotes">تعليمات إضافية للتوصيل <span class="small" style="color:var(--muted)">(اختياري)</span></label>
            <textarea id="dlvyNotes" class="input-md" rows="3" placeholder="مثلاً: البيت خلف المسجد، اتصل قبل الوصول"></textarea>
          </div>
        </div>

        <div id="orderErr" class="form-error small" style="display:none"></div>
      </form>
    `;

    const ok = document.createElement('button'); ok.className='btn btn-primary'; ok.textContent='إرسال الطلب';
    const cancel = document.createElement('button'); cancel.className='btn btn-ghost'; cancel.textContent='إلغاء';

    ok.onclick = ()=>{
      const mode = (document.body.dataset.orderMode || 'table');
      const err  = document.querySelector('#orderErr');
      const mark = (el, bad)=>{ if(!el) return; el.style.borderColor = bad ? '#ef4444' : 'var(--border)'; };

      if(mode==='table'){
        const tableEl = document.querySelector('#tableInput');
        const notesEl = document.querySelector('#notesInput');
        const table   = (tableEl?.value||'').trim();
        const notes   = (notesEl?.value||'').trim();

        let hasErr = false;
        if(!table){ hasErr = true; mark(tableEl, true); }

        if(hasErr){
          if(err){ err.textContent = 'يرجى إدخال رقم الطاولة.'; err.style.display='block'; }
          return;
        }
        if(err) err.style.display='none';

        Modal.hide();
        resolve({ mode:'table', table, notes });
      } else {
        const locEl   = document.querySelector('#dlvyLoc');
        const phoneEl = document.querySelector('#dlvyPhone');
        const notesEl = document.querySelector('#dlvyNotes');
        const location = (locEl?.value||'').trim();
        const phone    = (phoneEl?.value||'').trim();
        const notes    = (notesEl?.value||'').trim();

        let hasErr = false;
        if(!location){ hasErr = true; mark(locEl, true); }
        if(!phone){ hasErr = true; mark(phoneEl, true); }

        if(hasErr){
          if(err){ err.textContent = 'أدخل الموقع ورقم الهاتف.'; err.style.display='block'; }
          return;
        }
        if(err) err.style.display='none';

        Modal.hide();
        resolve({ mode:'out', table:'', phone, location, notes });
      }
    };
    cancel.onclick = ()=>{ Modal.hide(); resolve(null); };

    Modal.show('إتمام الطلب', html, [ok, cancel]);

    // تركيز تلقائي + تبديل الوضع + دعم Enter للإرسال
    setTimeout(()=>{
      const tabTable = document.querySelector('#tabTable');
      const tabOut   = document.querySelector('#tabOut');
      const pTable = document.querySelector('#panelTable');
      const pOut   = document.querySelector('#panelOut');
      const activate = (mode)=>{
        document.body.dataset.orderMode = mode;
        if(mode==='table'){
          tabTable.className = 'btn btn-primary';
          tabOut.className   = 'btn btn-ghost';
          pTable.style.display = 'block';
          pOut.style.display   = 'none';
          document.querySelector('#tableInput')?.focus();
        }else{
          tabOut.className   = 'btn btn-primary';
          tabTable.className = 'btn btn-ghost';
          pOut.style.display   = 'block';
          pTable.style.display = 'none';
          document.querySelector('#dlvyLoc')?.focus();
        }
      };
      tabTable?.addEventListener('click', ()=> activate('table'));
      tabOut?.addEventListener('click', ()=> activate('out'));
      activate('table');

      const formEl  = document.querySelector('#orderForm');
      if(formEl){ formEl.addEventListener('submit', (e)=>{ e.preventDefault(); ok.click(); }); }
    }, 10);
  });
}



/* =====================================================
   Checkout
===================================================== */
if(checkoutBtn){
  checkoutBtn.addEventListener('click', async ()=>{
    const cart = getCart(); if(cart.length===0) return;
    const items = LS.get('menuItems', []);
    let total=0;

    // [FIX] جهّز عناصر الطلب والإجمالي ومعرّف للعرض
    const orderItems = cart.map(ci=>{
      const it = items.find(x=>x.id===ci.id) || {};
      return { itemId: ci.id, name: it.name || '', price: Number(it.price||0), qty: ci.qty };
    });
    total = orderItems.reduce((s,x)=> s + x.price * x.qty, 0);
    let orderId = Math.floor(Date.now()/1000);
    let __orderSuccessShown = false;

    const info = await askOrderInfo();
    if(!info) return;
const { mode, table, notes, phone, location } = info;

// ...
try{
  if(!window.supabaseBridge || !window.supabaseBridge.createOrderSB){
    throw new Error('Supabase bridge not ready');
  }

  const order_name  = (mode === 'out') ? 'سفري/توصيل' : '';
  const notesMerged = (mode === 'out')
    ? [location ? `الموقع: ${location}` : null, notes || ''].filter(Boolean).join('\n')
    : (notes || '');

  await window.supabaseBridge.createOrderSB({
    order_name,
    phone:   (mode === 'out')   ? (phone || '') : '',
    table_no:(mode === 'table') ? (table || '') : '',
    notes: notesMerged,
    items: orderItems.map(x => ({ id: x.itemId, name: x.name, price: x.price, qty: x.qty }))
  });

// ⚡ أبلغ لوحات الأدمن فوراً بقدوم طلب جديد
try { window.notifyAdminNewOrder && window.notifyAdminNewOrder(); } catch {}

      // تنظيف السلة وعرض نجاح (ابقِ منطقك كما هو) — [FIX] عرض مرّة واحدة
      if(!__orderSuccessShown){
        LS.set('cart', []); updateCartCount(); renderCart(); closeCart();
        Modal.info('تم إرسال الطلب بنجاح!    .','نجاح');
        __orderSuccessShown = true;
      }
    }catch(e){
      console.error(e);
      Modal.info('تعذّر إرسال الطلب، حاول لاحقاً.','خطأ');
      return;
    }

    const notifs = LS.get('notifications', []);
    notifs.unshift({ id: crypto.randomUUID(), type:'order', title:`طلب جديد #${formatInt(orderId)}`, message:`إجمالي: ${formatPrice(total)} ل.س`, time: nowISO(), read:false });
    LS.set('notifications', notifs);

    // [FIX] امنع التكرار مرة ثانية
    if(!__orderSuccessShown){
      LS.set('cart', []); updateCartCount(); renderCart(); closeCart();
      Modal.info('تم إرسال الطلب بنجاح!    .','نجاح');
      __orderSuccessShown = true;
    }

    /*
        LS.set('cart', []); updateCartCount(); renderCart(); closeCart();
        Modal.info('تم إرسال الطلب بنجاح! ستصلك رسالة تأكيد قريباً.','نجاح');
    */
  });
}

/* =====================================================
   Rating
===================================================== */
async function rateItem(id, stars){
  if(!userHasOrderedItem(id)){
    Modal.info('لا يمكنك التقييم إلا بعد طلب هذا الصنف على هذا الجهاز.','غير مسموح');
    return;
  }
  if(userHasRatedItem(id)){
    Modal.info('لقد قُمت بتقييم هذا الصنف مسبقاً.','تم التقييم');
    return;
  }

  const items = LS.get('menuItems', []);
  const it = items.find(x => String(x.id) === String(id)); 
  if(!it) return;

  // تحديث متوسط التقييم محليًا (تفاؤلي)
  const rating = it.rating || { avg:0, count:0 };
  const totalScore = rating.avg * rating.count + stars;
  rating.count += 1;
  rating.avg = +(totalScore / rating.count).toFixed(2);
  it.rating = rating;
  LS.set('menuItems', items);

  // سجل التقييمات المحلي
  const rs = LS.get('ratings', []);
  rs.unshift({ id:(crypto?.randomUUID?.()||String(Date.now())), itemId:id, stars, time:nowISO(), name:it.name });
  LS.set('ratings', rs);

  // قفل التقييم لهذا الجهاز (مرّة واحدة)
  const rated = LS.get('userRated', {}) || {};
  rated[String(id)] = true;
  LS.set('userRated', rated);

  // إشعار محلي
  const notifs = LS.get('notifications', []);
  notifs.unshift({ 
    id:(crypto?.randomUUID?.()||String(Date.now())), 
    type:'rating',
    title:`تقييم جديد (${stars}★)`,
    message: it.name, 
    time: nowISO(), 
    read:false 
  });
  LS.set('notifications', notifs);

  // حفظ في Supabase (تجاهُل الخطأ إن وُجد)
  try { await window.supabaseBridge?.createRatingSB?.({ item_id:id, stars }); } 
  catch(e){ console.warn('persist rating failed', e); }

  renderItems();
  Modal.info('شكراً لتقييمك!','تم');
}


/* =====================================================
   Front Sidebar
===================================================== */
const menuBtn       = document.querySelector('#menuBtn');
const frontSidebar  = document.querySelector('#frontSidebar');
const closeFrontBtn = document.querySelector('#closeFront');
const sideCatsBox   = document.querySelector('#sideCats');

function openFront(){
  if(!frontSidebar) return;
  frontSidebar.classList.add('open');
  frontSidebar.setAttribute('aria-hidden','false');
  if(menuBtn) menuBtn.setAttribute('aria-expanded','true');
}
function closeFront(){
  if(!frontSidebar) return;
  frontSidebar.classList.remove('open');
  frontSidebar.setAttribute('aria-hidden','true');
  if(menuBtn) menuBtn.setAttribute('aria-expanded','false');
}
if(menuBtn) menuBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openFront(); });
if(closeFrontBtn) closeFrontBtn.addEventListener('click', closeFront);

document.addEventListener('click', (e)=>{
  if(!frontSidebar || !frontSidebar.classList.contains('open')) return;
  const inside = frontSidebar.contains(e.target) || (menuBtn && menuBtn.contains(e.target));
  if(!inside) closeFront();
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape'){ closeFront(); closeCart(); closeSearchPanel(); }
});

// إغلاق القائمة الجانبية عند الضغط على أي رابط داخلها
document.querySelectorAll('#frontSidebar a').forEach(function(link){
  link.addEventListener('click', function(){
    document.getElementById('frontSidebar').classList.remove('open');
    document.body.classList.remove('sidebar-open');
    document.getElementById('menuBtn').setAttribute('aria-expanded','false');
  }, {passive:true});
});

function renderSideCats(){
  if(!sideCatsBox) return;
  const cats = LS.get('categories', []);
  const list = cats.filter(c=>c.id!=='all');
  sideCatsBox.innerHTML = list.map(c =>
    `<a href="#" data-id="${c.id}" class="${state.activeCat===c.id?'active':''}">${c.name}</a>`
  ).join('');
  sideCatsBox.querySelectorAll('a').forEach(a=>{
    a.addEventListener('click', (ev)=>{
      ev.preventDefault();
      const id = a.getAttribute('data-id');
      if(state.activeCat==='sections'){
        const sec = document.getElementById('sec-'+id);
        if (sec) sec.scrollIntoView({ behavior:'smooth', block:'start' });
        // مزامنة الشريط والسلايدر
        if(catRibbon){
          catRibbon.querySelectorAll('.pill').forEach(b=> b.classList.toggle('active', b.dataset.id === id));
          moveCatUnderline();
        }
        // إبقاء تمييز الرابط حسب القسم الحالي (hash) في القائمة الأساسية
        function setActivePrimaryLink(){
          const links = document.querySelectorAll('.primary-links a');
          const current = (location.hash || '#home').toLowerCase();
          links.forEach(a => {
            const href = (a.getAttribute('href') || '').toLowerCase();
            a.classList.toggle('active', href === current);
          });
        }
        // شغّلها عند التحميل وتغيّر الهاش
        document.addEventListener('DOMContentLoaded', setActivePrimaryLink);
        window.addEventListener('hashchange', setActivePrimaryLink);

      }else{
        state.activeCat = id;
        renderItems();
        renderCats();
      }
      closeFront();
    });
  });
}
renderSideCats();

/* ======= Sync + Storage ======= */
window.addEventListener('storage', (e)=>{
  if(e.key==='categories'){ renderSideCats(); renderCats(); }
  if(e.key==='menuItems'){ renderItems(); updateFabTotal(); }
});

/* 🔁 IMPORTANT: أزِل once:true لتعمل بعد كل مزامنة عامة */
document.addEventListener('sb:public-synced', () => {
  try { renderSideCats(); } catch(e){}
  try { renderCats(); } catch(e){}
  try { renderItems(); } catch(e){}
});

/* تحريك المؤشر بعد تحميل كل شيء (لضمان القياسات) */
window.addEventListener('load', moveCatUnderline);

document.addEventListener('DOMContentLoaded', setupHours);

function setupHours(){
  const wrap  = document.getElementById('hoursList');
  const badge = document.getElementById('openNowBadge');
  if(!wrap || !badge) return;

  // إعدادات الوقت: 9:00 صباحًا إلى 1:00 صباحًا (اليوم التالي)
  const OPEN_MIN  = 9*60;   // 09:00
  const CLOSE_MIN = 25*60;  // 01:00 (+24h)

  // ترتيب الأيام مطابق لـ getDay(): 0=الأحد … 6=السبت
  const days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

  // دقائق منذ بداية الأسبوع (الأحد 00:00)
  function nowAbsMinutes(){
    const n = new Date();
    return n.getDay()*1440 + n.getHours()*60 + n.getMinutes();
  }

  // هل الآن ضمن أي نافذة عمل (مع مراعاة الامتداد بعد منتصف الليل)؟
  function isOpenNow(){
    const now = nowAbsMinutes();
    const WEEK = 7*1440;
    for(let d=0; d<7; d++){
      const start = d*1440 + OPEN_MIN;      // d 09:00
      const end   = d*1440 + CLOSE_MIN;     // d 25:00 => 01:00 لليوم التالي
      if( (now >= start && now < end) || (end > WEEK && (now+WEEK) >= start && (now+WEEK) < end) ){
        return true;
      }
    }
    return false;
  }

  // فورمات 12 ساعة (1–12 فقط) + ص/م
  function fmt12(hh, mm){
    const am = hh < 12;
    let h = hh % 12; if(h === 0) h = 12;
    return `${h}:${String(mm).padStart(2,'0')} ${am?'ص':'م'}`;
  }
  function fmtFromMinutes(mins){
    const H = Math.floor((mins%1440)/60);
    const M = (mins%60);
    return fmt12(H, M);
  }

  // بناء الصفوف
  const today = new Date().getDay(); // 0..6 (0=الأحد)
  const startStr = fmtFromMinutes(OPEN_MIN);   // 9:00 ص
  const endStr   = fmtFromMinutes(CLOSE_MIN);  // 1:00 ص

  wrap.innerHTML = days.map((name, idx)=>{
    const isToday = idx === today;
    const stClass = isToday ? 'badge ' + (isOpenNow()?'open':'closed') : 'badge neutral';
    const stText  = isToday ? (isOpenNow()?'مفتوح الآن':'مغلق الآن') : '—';
    return `
      <div class="hours-row ${isToday?'today':''}">
        <div class="day">${name}</div>
        <div class="time">${startStr} — ${endStr}</div>
        <div class="st"><span class="${stClass} small">${stText}</span></div>
      </div>
    `;
  }).join('');

  // شارة الحالة أعلى الكارد
  if(isOpenNow()){
    badge.className = 'badge small open';
    badge.textContent = 'مفتوح الآن';
  }else{
    badge.className = 'badge small closed';
    badge.textContent = 'مغلق الآن';
  }
}
/* ==== Force English digits sitewide (٠-٩ / ۰-۹ -> 0-9) ==== */
(function(){
  const map = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
  };
  const re = /[٠-٩۰-۹]/g;
  const norm = s => s.replace(re, ch => map[ch] || ch);

  // بدّل كل النصوص الظاهرة عند التحميل
  function walk(node){
    if(node.nodeType === Node.TEXT_NODE){
      const t = node.nodeValue, nt = norm(t);
      if(t !== nt) node.nodeValue = nt;
      return;
    }
    if(node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') return;
    for(let i=0;i<node.childNodes.length;i++) walk(node.childNodes[i]);
  }

  document.addEventListener('DOMContentLoaded', () => {
    walk(document.body);

    // راقب أي محتوى يُضاف ديناميكياً وطبّق التطبيع عليه
    const mo = new MutationObserver(muts=>{
      for(const m of muts){
        if(m.type === 'characterData'){ walk(m.target); }
        m.addedNodes && m.addedNodes.forEach(n => walk(n));
      }
    });
    mo.observe(document.body, { childList:true, subtree:true, characterData:true });

    // طبّع إدخال المستخدم في الحقول أثناء الكتابة
    document.addEventListener('input', (e)=>{
      const el = e.target;
      if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'){
        const v = el.value, nv = norm(v);
        if(v !== nv){
          const pos = el.selectionStart;
          el.value = nv;
          try{ el.setSelectionRange(pos, pos); }catch(_){}
        }
      }
    }, true);
  });
})();

/* ======= تقييم النجوم بتفويض نقر واحد صحيح الاتجاه ======= */
document.addEventListener('click', (e)=>{
  const starEl = e.target.closest('.stars .star');
  if(!starEl) return;

  const wrap = starEl.closest('.stars');
  const id = wrap?.dataset?.id;
  if(!id) return;

  if(userHasRatedItem(id)){
    Modal.info('لقد قُمت بتقييم هذا الصنف مسبقاً.','تم التقييم');
    return;
  }
  if(!userHasOrderedItem(id)){
    Modal.info('لا يمكنك التقييم إلا بعد طلب هذا الصنف على هذا الجهاز.','غير مسموح');
    return;
  }

  const all = Array.from(wrap.querySelectorAll('.star')); // ترتيبها DOM = [5,4,3,2,1]
  const idx = all.indexOf(starEl);                        // 0→5 نجوم، 4→نجمة واحدة
  const stars = Math.max(1, 5 - idx);

  rateItem(id, stars);
});
