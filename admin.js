// Auth logout (non-intrusive)
(function () {
  const btn = document.querySelector('#logoutBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      try { await window.supabase.auth.signOut(); } catch {}
      location.href = 'login.html';
    });
  }
})();

/* =====================================================
   Shared helpers
===================================================== */
const LS = {
  get(key, def) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? def;
    } catch {
      return def;
    }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
};

const nowISO = () => new Date().toISOString();

// DOM helpers (حماية آمنة)
const q = (sel) => document.querySelector(sel);
const on = (sel, ev, fn) => {
  const el = q(sel);
  if (el) el.addEventListener(ev, fn);
};
const setText = (sel, val) => {
  const el = q(sel);
  if (el) el.textContent = String(val ?? '');
};
const setHTML = (sel, html) => {
  const el = q(sel);
  if (el) el.innerHTML = html ?? '';
};

// NEW: helper لتحويل الملف إلى DataURL (سقوط احتياطي محلي)
const fileToDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/* =====================================================
   Modal system (بديل احترافي عن السناك بار/التوست)
   - يُنشئ نافذة عامة تُستخدم للفورمات
===================================================== */
(function injectModalStyles(){
  if (q('#modalStyles')) return;
  const st = document.createElement('style');
  st.id = 'modalStyles';
  st.textContent = `
  .app-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999}
  .app-modal-overlay.open{display:flex}
  .app-modal{width:min(680px, 96vw);background:var(--card, #fff);color:var(--text, #1f2937);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}
  .app-modal header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #eee;background:var(--bg, #fff)}
  .app-modal header h3{margin:0;font-size:18px}
  .app-modal .body{padding:16px 18px;max-height:min(70vh, calc(100dvh - 160px));overflow:auto}
  .app-modal .actions{display:flex;gap:8px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #eee;background:var(--bg,#fff)}
  .app-input{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;outline:none}
  .app-input:focus{border-color:var(--primary,#d64848); box-shadow:0 0 0 3px var(--ring, rgba(214,72,72,.2))}
  .app-label{display:block;margin:6px 0 6px;font-size:13px;color:var(--muted,#6b7280)}
  .app-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .app-grid-1{display:grid;grid-template-columns:1fr;gap:12px}
  .btn{padding:10px 14px;border:none;border-radius:10px;cursor:pointer}
  .btn-ghost{background:#f3f4f6}
  .btn-olive{background:var(--olive,#5e7a4e);color:#fff}
  .btn-danger{background:var(--primary,#d64848);color:#fff}
  .btn-primary{background:var(--primary,#d64848);color:#fff}
  .imgPrev{width:100%;max-height:220px;object-fit:cover;border-radius:12px;border:1px solid #eee}

  /* --- NEW: تنسيق زر رفع الصورة داخل نافذة التعديل --- */
  .file-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .file-hidden{position:absolute;left:-9999px}
  .file-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:var(--primary,#d64848);color:#fff;cursor:pointer;border:none}
  .file-btn:focus{outline:3px solid var(--ring, rgba(214,72,72,.2))}
  .file-name{font-size:12px;color:var(--muted,#6b7280)}
  `;
  document.head.appendChild(st);
})();

function ensureModalHost(){
  let overlay = q('#appModalOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'appModalOverlay';
  overlay.className = 'app-modal-overlay';
  overlay.innerHTML = `
    <div class="app-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <header>
        <h3 id="modalTitle"></h3>
        <button type="button" class="btn btn-ghost" id="modalCloseBtn">إغلاق</button>
      </header>
      <div class="body" id="modalBody"></div>
      <div class="actions" id="modalActions"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) hideModal(); });
  on('#modalCloseBtn','click', hideModal);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') hideModal(); });
  return overlay;
}
function showModal({title, bodyHTML, actions=[]}){
  const ov = ensureModalHost();
  q('#modalTitle').textContent = title || '';
  q('#modalBody').innerHTML = bodyHTML || '';
  const act = q('#modalActions'); act.innerHTML = '';
  actions.forEach(({label, className='btn', onClick})=>{
    const b = document.createElement('button');
    b.type='button'; b.className = className; b.textContent = label;
    b.addEventListener('click', onClick);
    act.appendChild(b);
  });
  ov.classList.add('open');
}
function hideModal(){
  const ov = q('#appModalOverlay');
  if (ov) ov.classList.remove('open');
}

/* =====================================================
   Modal Fallback (للتأكيدات البسيطة فقط)
===================================================== */
if (!window.Modal) {
  window.Modal = {
    confirm(msg, title) {
      const text = (title ? title + ':\n' : '') + (msg ?? '');
      return Promise.resolve(window.confirm(text));
    },
    info(msg, title) {
      const text = (title ? title + ':\n' : '') + (msg ?? '');
      window.alert(text);
    },
    show(){}, hide(){},
  };
}

/* =====================================================
   Navbar actions
===================================================== */
on('#refresh', 'click', () => location.reload());

// Notifications drawer
const notifBtn = q('#notifyBtn');
const notifDrawer = q('#notifDrawer');
const closeNotif = q('#closeNotif');

if (notifBtn && notifDrawer) {
notifBtn.addEventListener('click', () => { try{ renderNotifs(); }catch(e){}; notifDrawer.classList.add('open'); });
}
if (closeNotif && notifDrawer) {
  closeNotif.addEventListener('click', () => notifDrawer.classList.remove('open'));
}

on('#markAllRead', 'click', () => {
  const ns = LS.get('notifications', []);
  ns.forEach((n) => (n.read = true));
  LS.set('notifications', ns);
  updateNotifCount();
  updateOrderCounters();
  updateReservationCounters(); // NEW
  renderNotifs();
});

/* NEW: استمع لتغييرات الحجوزات أيضًا */
window.addEventListener('storage', (e) => {
  if (!e || !e.key || ['notifications','orders','menuItems','ratings','categories','reservations'].includes(e.key)) {
  updateAll();
}

});

/* =====================================================
   KPIs + Tables
===================================================== */
function fmt(n) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat('ar-EG').format(num);
}

function updateKPIs() {
  const orders = LS.get('orders', []);
  const totalSales = orders.reduce((a, b) => a + (Number(b.total) || 0), 0);
  const pending = orders.filter((o) => o.status === 'new').length;
  const items = LS.get('menuItems', []);

  let allAvg = 0, allCount = 0;
  items.forEach((it) => {
    if (it.rating) {
      const c = Number(it.rating.count) || 0;
      const a = Number(it.rating.avg) || 0;
      allAvg += a * c;
      allCount += c;
    }
  });
  const avg = allCount ? allAvg / allCount : 0;

  setText('#totalSales', fmt(totalSales));
  setText('#pendingCount', fmt(pending));
  setText('#totalOrders', fmt(orders.length));
  setText('#avgRating', (avg || 0).toFixed(1));
  setText('#ratingsCount', (allCount || 0) + '+');

  // top dishes this week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const map = {};
  orders
    .filter((o) => {
      const t = o.time ? new Date(o.time) : null;
      return t && t >= weekStart;
    })
    .forEach((o) => {
      if (Array.isArray(o.items)) {
        o.items.forEach((it) => {
          const name = it?.name ?? 'غير مسمى';
          const qty = Number(it?.qty) || 0;
          map[name] = (map[name] || 0) + qty;
        });
      }
    });
  const top = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  setText('#topDishes', top.length ? top.map(([n, q]) => `${n} × ${q}`).join('، ') : 'لا يوجد بيانات بعد');

  const weekTotal = orders
    .filter((o) => {
      const t = o.time ? new Date(o.time) : null;
      return t && t >= weekStart;
    })
    .reduce((a, b) => a + (Number(b.total) || 0), 0);

  setText('#weekSales', weekTotal ? `إجمالي ${fmt(weekTotal)} ل.س خلال 7 أيام` : 'لا يوجد بيانات بعد');
}

/* ===== Order workflow: تم الاستلام → قيد التحضير → تم التسليم ===== */
function nextActionLabel(s) {
  if (s === 'new') return 'تم الاستلام';
  if (s === 'received') return 'قيد التحضير';
  if (s === 'preparing') return 'تم التسليم';
  return 'تم التسليم';
}
function statusBtnClass(s) {
  if (s === 'new') return 'sbtn-new';
  if (s === 'received') return 'sbtn-received';
  if (s === 'preparing') return 'sbtn-preparing';
  return 'sbtn-done';
}
function advanceStatusInline(orderId) {
  const orders = LS.get('orders', []);
  const o = orders.find((x) => x.id === orderId);
  if (!o) return;
  if (o.status === 'new') o.status = 'received';
  else if (o.status === 'received') o.status = 'preparing';
  else if (o.status === 'preparing') o.status = 'delivered';
  else return;
  LS.set('orders', orders);
  const notifs = LS.get('notifications', []);
  notifs.unshift({
    id: crypto.randomUUID(),
    type: 'order',
    title: `تحديث حالة الطلب #${o.id}`,
    message: `${o.status}`,
    time: nowISO(),
    read: false,
  });
  LS.set('notifications', notifs);
  updateAll();
}
async function deleteOrderInline(orderId) {
  const ok = await window.Modal.confirm('هل تريد حذف هذا الطلب؟ سيتم خصمه من إجمالي المبيعات.', 'تأكيد الحذف');
  if (!ok) return;
  try{
    if (window.supabaseBridge?.deleteOrderSB) {
      await window.supabaseBridge.deleteOrderSB(orderId);
    } else {
      let orders = LS.get('orders', []).filter(o => o.id !== orderId);
      LS.set('orders', orders);
    }
    updateAll();
  }catch(e){
    console.error(e);
    window.Modal.info('تعذّر حذف الطلب من القاعدة.', 'خطأ');
  }

}
function updateOrderCounters() {
const orders = LS.get('orders', []).filter(o => o.source !== 'demo');
  const counts = {
    all: orders.length,
    new: orders.filter((o) => o.status === 'new').length,
    received: orders.filter((o) => o.status === 'received').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    active: orders.filter((o) => o.status !== 'delivered').length,
  };
  // Try to show active count near "إدارة الطلبات" link if found
  const sideLinks = document.querySelectorAll('.side-link');
  sideLinks.forEach((el) => {
    if (el.textContent.includes('إدارة الطلبات')) {
      let b = el.querySelector('.badge-pill');
      if (!b) {
        b = document.createElement('span');
        b.className = 'badge-pill';
        el.appendChild(b);
      }
      b.textContent = counts.active;
    }
  });
  // Notification summary line (FIXED typo)
  const sum = q('#notifSummary');
  if (sum) {
    sum.textContent = `الطلبات النشطة: ${counts.active} — جديد: ${counts.new}، قيد التحضير: ${counts.received}، جاهز: ${counts.preparing}، مُسلّم: ${counts.delivered}`;
  }
}

/* ===== NEW: Reservation counters badge beside "معلومات الحجوزات" ===== */
function updateReservationCounters(){
  const res = LS.get('reservations', []);
  // نعتبر "new" = جديدة، والبقية حالات أخرى (confirmed/assigned/seated/cancelled...)
  const newCount = res.filter(r => (r?.status || 'new') === 'new').length;

  const sideLinks = document.querySelectorAll('.side-link');
  sideLinks.forEach((el) => {
    if (el.textContent.includes('معلومات الحجوزات')) {
      let b = el.querySelector('.badge-pill');
      if (!b) {
        b = document.createElement('span');
        b.className = 'badge-pill';
        el.appendChild(b);
      }
      b.textContent = newCount;
    }
  });

  // سطر تلخيص اختياري إن وُجد عنصر #resvSummary
  const box = q('#resvSummary');
  if(box){
    const confirmed = res.filter(r => r.status === 'confirmed').length;
    const seated    = res.filter(r => r.status === 'seated').length;
    const cancelled = res.filter(r => r.status === 'cancelled').length;
    box.textContent = `حجوزات — جديد: ${newCount}، مؤكد: ${confirmed}، حاضر: ${seated}، ملغي: ${cancelled}`;
  }
}

function renderOrdersTable() {
  const tbody = q('#ordersTable tbody');
  if (!tbody) return;
  const orders = LS.get('orders', []);
  tbody.innerHTML = orders
    .map((o) => {
      const safeId = JSON.stringify(o.id);
      const itemCount =
        o.itemCount ??
        (Array.isArray(o.items)
          ? o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0)
          : 0);
      const when = o.time ? new Date(o.time).toLocaleString('ar-EG') : '-';
      const total = fmt(Number(o.total) || 0);
      return `
    <tr>
      <td>#${o.id}</td>
      <td>${o.orderName || '-'}</td>
      <td>${itemCount}</td>
      <td>${o.table || '-'}</td>
      <td>
        ${
          o.status !== 'delivered'
            ? `<button type="button" class="status-btn ${statusBtnClass(
                o.status
              )}" onclick='advanceStatusInline(${safeId})'>${nextActionLabel(o.status)}</button>`
            : `<span class="status s-delivered">تم التسليم</span>`
        }
      </td>
      <td>${total} ل.س</td>
      <td>${when}</td>
      <td><button type="button" class="btn btn-danger" onclick='deleteOrderInline(${safeId})'>حذف</button></td>
    </tr>
  `;
    })
    .join('');
}

/* ================= Notifications ================= */
function renderNotifs() {
  const box = q('#notifList');
  if (!box) return;
  const ns = LS.get('notifications', []);
  if (ns.length === 0) {
    box.innerHTML = '<div class="small" style="color:var(--muted)">لا يوجد إشعارات</div>';
    return;
  }
  box.innerHTML = ns
    .map((n) => {
      let label = 'تقييم';
      let badgeClass = 'badge-muted';
      if (n.type === 'order') { label = 'طلب'; badgeClass = 'badge-danger'; }
      else if (n.type === 'reservation') { label = 'حجز'; badgeClass = 'badge-olive'; }

      return `
    <div class="card" style="padding:12px;border:1px solid #eee">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${n.title}</strong>
        <span class="badge ${badgeClass} small">${label}</span>
      </div>
      <div class="small" style="margin-top:6px">${n.message || ''}</div>
      <div class="small" style="margin-top:6px;color:var(--muted)">${n.time ? new Date(n.time).toLocaleString('ar-EG') : '-'}</div>
    </div>
  `;
    })
    .join('');
}
function updateNotifCount() {
  const ns = LS.get('notifications', []);
  const unread = ns.filter((n) => !n.read).length;
  const el = q('#notifCount');
  if (!el) return;
  if (unread > 0) {
    el.style.display = 'inline-block';
    el.textContent = unread;
  } else {
    el.style.display = 'none';
  }
}

/* ================= Menu & Categories Management ================= */
function fillCatSelect() {
  const cats = LS.get('categories', []);
  const sel = q('#catSelect');
  if (!sel) return;
  sel.innerHTML = '';
  cats
    .filter((c) => c.id !== 'all')
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
}
function renderCatsTable() {
  const cats = LS.get('categories', []);
  const items = LS.get('menuItems', []);
  const body = q('#catsTable tbody');
  if (!body) return;
  body.innerHTML = cats
    .filter((c) => c.id !== 'all')
    .map((c) => {
      const count = items.filter((i) => i.catId === c.id).length;
      const safeId = JSON.stringify(c.id);
      return `<tr>
      <td>${c.name}</td>
      <td>${count}</td>
      <td style="display:flex;gap:6px">
        <button type="button" class="btn btn-olive" onclick='editCat(${safeId})'>تعديل</button>
        <button type="button" class="btn btn-danger" onclick='deleteCat(${safeId})'>حذف</button>
      </td>
    </tr>`;
    })
    .join('');
}

function renderItemsTable() {
  const items = LS.get('menuItems', []);
  const cats = LS.get('categories', []);
  const body = q('#itemsTable tbody');
  if (!body) return;
  body.innerHTML = items
    .map((it) => {
      const catName = cats.find((c) => c.id === it.catId)?.name || '-';
      const rate = it.rating ? `${(it.rating.avg || 0).toFixed(1)}★ (${it.rating.count || 0})` : '—';
      const safeId = JSON.stringify(it.id);
      return `<tr>
      <td>${it.name}</td>
      <td>${fmt(it.price)} ل.س</td>
      <td>${catName}</td>
      <td>${rate}</td>
      <td>${it.available === false ? 'غير متاح' : 'متاح'}</td>
      <td style="display:flex;gap:6px">
        <button type="button" class="btn btn-ghost" onclick='toggleItem(${safeId})'>${it.available === false ? 'إتاحة' : 'إيقاف'}</button>
        <button type="button" class="btn btn-olive" onclick='editItem(${safeId})'>تعديل</button>
        <button type="button" class="btn btn-danger" onclick='deleteItem(${safeId})'>حذف</button>
      </td>
    </tr>`;
    })
    .join('');
}

async function deleteCat(id) {
  if (id === 'all') { window.Modal.info('لا يمكن حذف قسم "جميع الأطباق".','تنبيه'); return; }
  const okCat = await window.Modal.confirm('هل تريد حذف هذا القسم؟', 'تأكيد الحذف');
  if (!okCat) return;
  try{
    if (window.supabaseBridge?.deleteCategorySB) {
      await window.supabaseBridge.deleteCategorySB(id);
      await window.supabaseBridge.syncAdminDataToLocal();
    } else {
      let cats = LS.get('categories', []);
      cats = cats.filter((c) => c.id !== id);
      LS.set('categories', cats);
    }
    fillCatSelect();
    renderCatsTable();
    renderItemsTable();
  }catch(e){
    window.Modal.info('تعذّر حذف القسم من قاعدة البيانات','خطأ');
  }
}

/* ======= NEW: Edit Category via Modal (no snackbar) ======= */
function editCat(id){
  if(id === 'all'){ window.Modal.info('لا يمكن تعديل قسم "جميع الأطباق".','تنبيه'); return; }
  const cats = LS.get('categories', []);
  const c = cats.find(x => x.id === id);
  if(!c) return;

  const body = `
    <div class="app-grid-1">
      <div>
        <label class="app-label">اسم القسم</label>
        <input class="app-input" id="ec_name" type="text" value="\${c.name || ''}" />
      </div>
      <div class="small" style="color:var(--muted);margin-top:8px">
        المعرّف: <code>\${c.id}</code> (لا يمكن تغييره من هنا)
      </div>
    </div>
  `;
  async function submit(){
    const name = q('#ec_name').value.trim();
    if(!name){ window.Modal.info('الاسم مطلوب','تنبيه'); return; }
    try{
      if(window.supabaseBridge?.updateCategorySB){
        await window.supabaseBridge.updateCategorySB(c.id, { name });
        await window.supabaseBridge.syncAdminDataToLocal();
      }else{
        c.name = name;
        LS.set('categories', cats);
      }
      hideModal();
      fillCatSelect(); renderCatsTable(); renderItemsTable();
      const notifs = LS.get('notifications', []);
      notifs.unshift({
        id: crypto.randomUUID(), type:'inventory',
        title: 'تعديل قسم', message: name, time: nowISO(), read:false
      });
      LS.set('notifications', notifs);
      updateNotifCount(); updateOrderCounters(); updateReservationCounters();
    }catch(e){
      window.Modal.info('تعذّر تحديث القسم في قاعدة البيانات','خطأ');
    }
  }
  showModal({
    title:'تعديل قسم',
    bodyHTML: body,
    actions:[
      {label:'إلغاء', className:'btn btn-ghost', onClick: hideModal},
      {label:'حفظ', className:'btn btn-primary', onClick: submit},
    ],
  });
}


/* ======= Toggle & Delete Item (SB-aware) ======= */
async function toggleItem(id) {
  const items = LS.get('menuItems', []);
  const it = items.find((x) => x.id === id);
  if (!it) return;
  try{
    if(window.supabaseBridge?.updateMenuItemSB){
      await window.supabaseBridge.updateMenuItemSB(id, { available: !it.available });
      await window.supabaseBridge.syncAdminDataToLocal();
    }else{
      it.available = !it.available;
      LS.set('menuItems', items);
    }
  }catch(e){
    window.Modal.info('تعذّر تعديل إتاحة الصنف','خطأ');
  }
  renderItemsTable();
}

async function deleteItem(id) {
  const ok = await window.Modal.confirm('حذف هذا الطبق؟','تأكيد الحذف');
  if(!ok) return;
  try{
    if(window.supabaseBridge?.deleteMenuItemSB){
      await window.supabaseBridge.deleteMenuItemSB(id);
      await window.supabaseBridge.syncAdminDataToLocal();
    }else{
      let items = LS.get('menuItems', []);
      items = items.filter((i) => i.id !== id);
      LS.set('menuItems', items);
    }
  }catch(e){
    window.Modal.info('تعذّر حذف الصنف من قاعدة البيانات','خطأ');
  }
  renderItemsTable();
}

/* ======= NEW: Edit Item via Modal (with styled upload + Storage) ======= */
function editItem(id){
  const items = LS.get('menuItems', []);
  const it = items.find(x => x.id === id);
  if(!it) return;

  const cats = LS.get('categories', []).filter(c => c.id !== 'all');
  const catOpts = cats.map(c => `<option value="${c.id}" ${c.id===it.catId?'selected':''}>${c.name}</option>`).join('');

  const body = `
    <form id="editItemForm" class="app-grid-1">
      <div class="app-grid">
        <div>
          <label class="app-label">اسم الطبق</label>
          <input class="app-input" id="ei_name" type="text" value="${it.name || ''}" required />
        </div>
        <div>
          <label class="app-label">السعر (ل.س)</label>
          <input class="app-input" id="ei_price" type="number" min="0" step="0.01" value="${it.price || 0}" required />
        </div>
      </div>
      <div>
        <label class="app-label">الوصف</label>
        <textarea class="app-input" id="ei_desc" rows="3">${it.desc || ''}</textarea>
      </div>
      <div class="app-grid">
        <div>
          <label class="app-label">القسم</label>
          <select class="app-input" id="ei_cat">${catOpts}</select>
        </div>
        <div>
          <label class="app-label">متاح؟</label>
          <select class="app-input" id="ei_avail">
            <option value="true" ${it.available!==false?'selected':''}>نعم</option>
            <option value="false" ${it.available===false?'selected':''}>لا</option>
          </select>
        </div>
      </div>

      <div class="app-grid">
        <div>
          <label class="app-label">رابط الصورة (URL)</label>
          <input class="app-input" id="ei_imgUrl" type="text" value="${it.img || ''}" placeholder="https://..." />
        </div>
        <div>
          <label class="app-label">رفع صورة من الجهاز</label>
          <div class="file-picker">
            <input id="ei_imgFile" class="file-hidden" type="file" accept="image/*" />
            <label for="ei_imgFile" class="file-btn">اختيار ملف</label>
            <span id="ei_fileName" class="file-name">لم يتم اختيار ملف</span>
          </div>
        </div>
      </div>

      <div>
        <img id="ei_imgPrev" class="imgPrev" src="${it.img || ''}" alt="">
      </div>
    </form>
  `;

  function wireImagePreview(){
    const f = q('#ei_imgFile');
    const u = q('#ei_imgUrl');
    const prev = q('#ei_imgPrev');
    const nameEl = q('#ei_fileName');

    if (f) {
      f.addEventListener('change', ()=>{
        const file = f.files && f.files[0];
        if(nameEl) nameEl.textContent = file ? file.name : 'لم يتم اختيار ملف';
        if(!file){
          if(!u || !u.value.trim()){ prev.removeAttribute('src'); }
          return;
        }
        const reader = new FileReader();
        reader.onload = ()=>{ prev.src = reader.result; };
        reader.readAsDataURL(file);
      });
    }
    if (u) {
      u.addEventListener('input', ()=>{
        const url = u.value.trim();
        if (url) prev.src = url;
        if(nameEl && (!f.files || !f.files[0])) nameEl.textContent = 'استخدام رابط صورة';
      });
    }
  }

  async function submit(){
    const name = q('#ei_name').value.trim();
    const price = Number(q('#ei_price').value);
    const desc = q('#ei_desc').value.trim();
    const catId = q('#ei_cat').value;
    const available = q('#ei_avail').value === 'true';
    const url = q('#ei_imgUrl').value.trim();
    const fileInput = q('#ei_imgFile');
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if(!name || !price || !catId){ window.Modal.info('يرجى تعبئة الاسم والسعر والقسم','تنبيه'); return; }

    async function finalize(imgSrc){
      try{
        if(window.supabaseBridge?.updateMenuItemSB){
          await window.supabaseBridge.updateMenuItemSB(it.id, {
            name, price, desc, catId, available, img: imgSrc
          });
          await window.supabaseBridge.syncAdminDataToLocal();
        }else{
          it.name = name;
          it.price = price;
          it.desc = desc;
          it.catId = catId;
          it.available = available;
          it.img = imgSrc || it.img;
          LS.set('menuItems', items);
        }
        hideModal();
        renderItemsTable();
        const notifs = LS.get('notifications', []);
        notifs.unshift({
          id: crypto.randomUUID(),
          type:'inventory',
          title:'تعديل صنف',
          message: name,
          time: nowISO(),
          read:false,
        });
        LS.set('notifications', notifs);
        updateNotifCount(); updateOrderCounters(); updateReservationCounters();
      }catch(e){
        window.Modal.info('تعذّر حفظ التعديل في قاعدة البيانات','خطأ');
      }
    }

    // NEW: ارفع إلى Storage عند توفر uploadImageSB وإلا استخدم DataURL/الرابط
    if (file){
      if (window.supabaseBridge?.uploadImageSB) {
        try {
          const publicUrl = await window.supabaseBridge.uploadImageSB(file);
          await finalize(publicUrl);
        } catch(_) {
          // سقوط احتياطي: DataURL محلي أو رابط
          try { const dataUrl = await fileToDataURL(file); await finalize(dataUrl); }
          catch { await finalize(url || it.img || ''); }
        }
      } else {
        try { const dataUrl = await fileToDataURL(file); await finalize(dataUrl); }
        catch { await finalize(url || it.img || ''); }
      }
    } else {
      await finalize(url || it.img || '');
    }
  }

  showModal({
    title:'تعديل صنف',
    bodyHTML: body,
    actions:[
      {label:'إلغاء', className:'btn btn-ghost', onClick: hideModal},
      {label:'حفظ التعديلات', className:'btn btn-primary', onClick: submit},
    ],
  });
  wireImagePreview();
}

/* ======= Forms: Add Category & Item ======= */
const catForm = q('#catForm');
if (catForm) {
  catForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const id = name.replace(/\s+/g, '-').toLowerCase() + '-' + Math.floor(Math.random() * 9999);
    try {
      if (window.supabaseBridge?.createCategorySB) {
        await window.supabaseBridge.createCategorySB({ id, name, sort: 100 });
        // توحيد المصدر بعد الإضافة
        await window.supabaseBridge.syncAdminDataToLocal();
      } else {
        const cats = LS.get('categories', []);
        cats.push({ id, name });
        LS.set('categories', cats);
      }
      e.target.reset();
      setText('#catMsg', 'تمت إضافة القسم');
      fillCatSelect();
      renderCatsTable();

      const notifs = LS.get('notifications', []);
      notifs.unshift({
        id: crypto.randomUUID(),
        type: 'info',
        title: 'قسم جديد',
        message: name,
        time: nowISO(),
        read: false,
      });
      LS.set('notifications', notifs);
      updateNotifCount();
      updateOrderCounters();
      updateReservationCounters();
    } catch (err) {
      console.error(err);
      setText('#catMsg', 'تعذّر إضافة القسم');
    }
  });
}


/* ========= FIX: منع التكرار عند إضافة صنف ========= */
const itemForm = q('#itemForm');
let __addItemBusy = false; // قفل يمنع الطلبات المتكررة السريعة

if (itemForm) {
  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // تجاهل أي نقرات/إرسال إضافي أثناء التنفيذ
    if (__addItemBusy) return;
    __addItemBusy = true;

    const form = e.target;
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    const price = Number(fd.get('price'));
    const desc = (fd.get('desc') || '').toString().trim();
    const cat = fd.get('cat');
    const fresh = fd.get('fresh') === 'on';
    const urlField = (fd.get('img') || '').toString().trim();
    const fileInput = q('#imgFile');
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    // تعطيل زر الإرسال مؤقتاً + مؤشر مشغول
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.label = submitBtn.textContent;
      submitBtn.textContent = 'جاري الإضافة...';
      submitBtn.setAttribute('aria-busy', 'true');
    }

    if (!name || !price || !cat) {
      setText('#itemMsg', 'يرجى تعبئة الاسم والسعر والقسم');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.label || 'إضافة الطبق';
        submitBtn.removeAttribute('aria-busy');
      }
      __addItemBusy = false;
      return;
    }

    async function finalize(imgSrc) {
      try{
        if(window.supabaseBridge?.createMenuItemSB){
          await window.supabaseBridge.createMenuItemSB({
            name, desc, price, img: imgSrc, cat_id: cat, available: true, fresh
          });
          await window.supabaseBridge.syncAdminDataToLocal();
        }else{
          const items = LS.get('menuItems', []);
          items.unshift({
            id: crypto.randomUUID(),
            name,
            price,
            desc,
            img: imgSrc,
            catId: cat,
            fresh,
            rating: { avg: 0, count: 0 },
            available: true,
          });
          LS.set('menuItems', items);
        }
        form.reset();
        setText('#itemMsg', 'تمت إضافة الطبق بنجاح');
        renderItemsTable();
        const notifs = LS.get('notifications', []);
        notifs.unshift({
          id: crypto.randomUUID(),
          type: 'inventory',
          title: 'إضافة صنف',
          message: name,
          time: nowISO(),
          read: false,
        });
        LS.set('notifications', notifs);
        updateNotifCount();
        updateOrderCounters();
        updateReservationCounters();
        // clear preview
        const prevWrap = q('#imgPreviewWrap');
        if (prevWrap) prevWrap.style.display = 'none';
        const imgPrev = q('#imgPreview');
        if (imgPrev) imgPrev.removeAttribute('src');
      }catch(e){
        setText('#itemMsg', 'تعذّر إضافة الطبق إلى قاعدة البيانات');
      }
    }

    try {
      const defaultUrl = 'https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop';
      let imgSrc = urlField || defaultUrl;

      // NEW: ارفع إلى Storage إذا توفر uploadImageSB، وإلا استخدم DataURL/الرابط
      if (file) {
        if (window.supabaseBridge?.uploadImageSB) {
          try {
            imgSrc = await window.supabaseBridge.uploadImageSB(file);
          } catch(_) {
            try { imgSrc = await fileToDataURL(file); }
            catch { imgSrc = urlField || defaultUrl; }
          }
        } else {
          try { imgSrc = await fileToDataURL(file); }
          catch { imgSrc = urlField || defaultUrl; }
        }
      }

      await finalize(imgSrc);
    } finally {
      // إعادة تفعيل الزر وفتح القفل
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.label || 'إضافة الطبق';
        submitBtn.removeAttribute('aria-busy');
      }
      __addItemBusy = false;
    }
  });
}

/* ===== Image picker & preview (file + URL) ===== */
// 1) ربط الأزرار ليعملوا دائمًا (خارج change)
on('#btnPickFile', 'click', () => {
  const f = q('#imgFile');
  if (f) f.click();
});
on('#btnUseUrl', 'click', () => {
  const inp = q('input[name="img"]');
  if (inp) {
    inp.focus();
    inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

// 2) معاينة صورة الملف (File input)
(function () {
  const fileInput = q('#imgFile');
  const wrap = q('#imgPreviewWrap');
  const img  = q('#imgPreview');
  if (!fileInput || !wrap || !img) return;

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      wrap.style.display = 'none';
      img.removeAttribute('src');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; wrap.style.display = 'block'; };
    reader.readAsDataURL(f);
  });
})();

// 3) معاينة فورية عند إدخال "رابط صورة (URL)"
(function () {
  const urlInput = q('input[name="img"]');
  const wrap = q('#imgPreviewWrap');
  const img  = q('#imgPreview');
  if (!urlInput || !wrap || !img) return;

  urlInput.addEventListener('input', () => {
    const url = (urlInput.value || '').trim();
    if (url) {
      img.src = url;
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
      img.removeAttribute('src');
    }
  });
})();

/* ============== Ratings list ============== */
function renderRatings() {
  const list = q('#ratingsList');
  if (!list) return;
  const rs = LS.get('ratings', []);
  if (rs.length === 0) {
    list.textContent = 'لا يوجد تقييمات بعد';
    return;
  }
  list.innerHTML = rs
    .slice(0, 20)
    .map(
      (r) => `<div class="small" style="padding:8px 0;border-bottom:1px dashed #eee">
    ${r.name} — ${'★'.repeat(Number(r.stars) || 0)} <span style="color:var(--muted)">(${r.time ? new Date(r.time).toLocaleString('ar-EG') : '-'})</span>
  </div>`
    )
    .join('');
}

/* ====== Expose functions used by inline onclick ====== */
window.advanceStatusInline = advanceStatusInline;
window.deleteOrderInline = deleteOrderInline;
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;
window.deleteCat = deleteCat;
window.editCat = editCat;
window.editItem = editItem;

/* Init */
function updateAll() {
  updateKPIs();
  renderOrdersTable();
  updateNotifCount();
  updateOrderCounters();
  updateReservationCounters(); // NEW
  renderNotifs();
  fillCatSelect();
  renderItemsTable();
  renderCatsTable();
  renderRatings();
}
updateAll();
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
