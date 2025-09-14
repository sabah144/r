// ============= supabase-bridge.js (SAFE PACK, FIXED + LIVE SYNC, FAST) =============
// Requires: a Supabase client at window.supabase (create it in <head> as type="module").

(() => {
  if (!window.supabase) {
    console.warn('Supabase client is missing. Add it in <head> first.');
  }
})();

// ---------- Utils ----------
const isBase64DataUri = (v) => typeof v === 'string' && v.startsWith('data:');
// قلّلنا الوصف أكثر لتقليص حجم الردود الأولية
const sanitizeDesc = (v) => String(v || '').slice(0, 160);
const toNumber = (n, d = 0) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
};

// نافذة مزامنة أولية لتقليل الحمولة على صفحات الأدمن (يمكن تعديلها حسب الحاجة)
// الطلبات: آخر 30 يومًا وحد أعلى 500
// الحجوزات: من آخر 7 أيام حتى 60 يومًا قادمة وحد أعلى 1000
const MS_DAY = 86_400_000;           // ثابت لليوم بالمللي ثانية
const ORDERS_DAYS_BACK = 30;
const ORDERS_LIMIT = 500;
const RESERVATIONS_DAYS_BACK = 7;
const RESERVATIONS_DAYS_FWD = 60;
const RESERVATIONS_LIMIT = 1000;
const RATINGS_LIMIT = 5000;          // حد أعلى اختياري لتقليص الحمولة عند البدايات الباردة

// LocalStorage helpers with in-memory fallback to avoid blank pages on quota errors
const __MEM = Object.create(null);
const LS = {
  get(k, def) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) return JSON.parse(v);
    } catch {}
    return k in __MEM ? __MEM[k] : def;
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      // QuotaExceededError or JSON/string issues -> fall back to memory
      __MEM[k] = v;
    }
  }
};

/* ---------- NEW: ultra-fast admin ping via broadcast ---------- */
/* قناة موحّدة لإرسال إشعار سريع إلى لوحات الأدمن بلا اعتماد على المؤقّتات */
async function pingAdmins(event = 'admin-refresh', payload = {}) {
  try {
    const sb = window.supabase;
    if (!sb?.channel) return;
    if (!window.__SB_BC) {
      // نستخدم نفس اسم القناة "live" المتوقّع من صفحات الأدمن/العامة
      window.__SB_BC = sb.channel('live', { config: { broadcast: { self: true } } });
      try { await window.__SB_BC.subscribe(); } catch {}
    }
    try {
      await window.__SB_BC.send({ type: 'broadcast', event, payload });
    } catch {}
  } catch {}
}

// ---------- Public: fetch categories & visible menu ----------
export async function syncPublicCatalogToLocal() {
  const sb = window.supabase;

  // جلب متوازٍ + تقليل الحقول + دفعة أولى محدودة لعناصر القائمة
  const [cats, items] = await Promise.all([
    sb.from('categories').select('id,name,sort').order('sort', { ascending: true }),
    sb
      .from('menu_items')
      .select('id,name,"desc",price,img,cat_id,available,fresh,rating_avg,rating_count,created_at')
      .eq('available', true)
      .order('created_at', { ascending: false })
      .limit(200) // دفعة أولى سريعة تكفي للرسم الفوري
  ]);

  if (cats.error) throw cats.error;
  if (items.error) throw items.error;

  const adapted = (items.data || []).map((it) => ({
    id: it.id,
    name: it.name,
    desc: sanitizeDesc(it['desc']),
    price: toNumber(it.price),
    // ✅ إصلاح: لا تفرّغ الصور Base64 — اعرض أي قيمة مخزّنة
    img: normalizeImg(it.img),
    catId: it.cat_id,
    fresh: !!it.fresh,
    rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) }
  }));

  LS.set('categories', cats.data || []);
  LS.set('menuItems', adapted);

  // إعادة رسم فورية
  try {
    document.dispatchEvent(new CustomEvent('sb:public-synced', { detail: { at: Date.now() } }));
  } catch {}

  // تحميل خلفي تدريجي لبقية العناصر بدون حجب الواجهة
  (async () => {
    try {
      const PAGE = 400;
      let offset = (items.data || []).length;
      for (;;) {
        const more = await sb
          .from('menu_items')
          .select('id,name,"desc",price,img,cat_id,available,fresh,rating_avg,rating_count,created_at')
          .eq('available', true)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (more.error) throw more.error;
        const batch = more.data || [];
        if (batch.length === 0) break;

        const extra = batch.map((it) => ({
          id: it.id,
          name: it.name,
          desc: sanitizeDesc(it['desc']),
          price: toNumber(it.price),
          // ✅ إصلاح: لا تفرّغ الصور Base64
          img: normalizeImg(it.img),
          catId: it.cat_id,
          fresh: !!it.fresh,
          rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) }
        }));

        const cur = LS.get('menuItems', []);
        LS.set('menuItems', cur.concat(extra));
        offset += batch.length;

        // إشعار بإضافة جزئية تدريجية
        try {
          document.dispatchEvent(
            new CustomEvent('sb:public-synced', {
              detail: { at: Date.now(), partial: true }
            })
          );
        } catch {}

        // إفساح دورة حدث للواجهة
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      console.warn('bg hydrate failed', e);
    }
  })();

  return { categories: cats.data, items: adapted };
}

// ---------- Orders ----------
// آمن: إنشاء الطلب + العناصر عبر RPC بصلاحية SECURITY DEFINER
export async function createOrderSB({ order_name, phone, table_no, notes, items }) {
  const sb = window.supabase;

  // توحيد/تنظيف عناصر السلة قبل إرسالها للـ RPC
  const itemsNorm = (items || []).map((it) => ({
    id: it.id || null,
    name: String(it.name || ''),
    price: toNumber(it.price),
    qty: toNumber(it.qty, 1)
  }));

  // استدعاء الدالة المعرفة في القاعدة: public.create_order_with_items
  const { data: order_id, error } = await sb.rpc('create_order_with_items', {
    _order_name: order_name || '',
    _phone: phone || '',
    _table_no: table_no || '',
    _notes: notes || '',
    _items: itemsNorm
  });
  if (error) throw error;

  // تحديث واجهة العميل محلياً (KDS/لوحة الأدمن) بدون انتظار قراءة من القاعدة
  const total = itemsNorm.reduce((s, it) => s + it.price * it.qty, 0);
  const old = LS.get('orders', []);
  const itemCount = itemsNorm.reduce((s, it) => s + it.qty, 0);
  const nowISO = new Date().toISOString();

  old.unshift({
    id: order_id,
    total,
    itemCount,
    time: nowISO, // مهم للفلاتر والمؤقّت
    createdAt: nowISO, // مستخدم بالإشعارات
    status: 'new', // يبدأ كجديد
    items: itemsNorm.map((it) => ({ id: it.id, name: it.name, price: it.price, qty: it.qty })),
    table: table_no || '',
    orderName: order_name || '',
    notes: notes || ''
  });
  LS.set('orders', old);

  /* NEW: نبه لوحات الأدمن فورًا بلا انتظار المؤقتات/Realtime */
  try { pingAdmins('new-order', { id: order_id }).catch(() => {}); } catch {}

  return { id: order_id };
}

// ---------- Orders: update & delete ----------
export async function deleteOrderSB(orderId) {
  const sb = window.supabase;
  const id = Number(orderId);
  const del = await sb.from('orders').delete().eq('id', id);
  if (del.error) throw del.error;

  // عكس التغيير في التخزين المحلي
  const orders = LS.get('orders', []);
  LS.set('orders', orders.filter((o) => Number(o.id) !== id));

  // تنظيف إشعارات الطلب إن وُجدت (اعتمد على معرّف الإشعار بدل العنوان)
  const ns = (LS.get('notifications', []) || []).filter((n) => n.id !== `ord-${id}`);
  LS.set('notifications', ns);

  try {
    document.dispatchEvent(new CustomEvent('sb:admin-synced', { detail: { at: Date.now() } }));
  } catch {}
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'order', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

export async function updateOrderSB(
  orderId,
  { order_name, table_no, notes, total, status, additions, discount_pct, discount }
) {
  const sb = window.supabase;
  const id = Number(orderId);
  const payload = {};
  if (typeof status !== 'undefined') payload.status = status;
  if (typeof additions !== 'undefined') payload.additions = additions;
  if (typeof discount_pct !== 'undefined') payload.discount_pct = toNumber(discount_pct);
  if (typeof discount !== 'undefined') payload.discount = toNumber(discount);

  const upd = await sb.from('orders').update(payload).eq('id', id).select().single();
  if (upd.error) throw upd.error;

  // تحديث الكاش المحلي
  const orders = LS.get('orders', []);
  const o = orders.find((x) => Number(x.id) === id);
  if (o) {
    if ('status' in payload) o.status = payload.status;
    if ('additions' in payload) o.additions = payload.additions;
    if ('discount' in payload) o.discount = payload.discount;
    if ('discount_pct' in payload) o.discountPct = payload.discount_pct;

    LS.set('orders', orders);
  }
  try {
    document.dispatchEvent(new CustomEvent('sb:admin-synced', { detail: { at: Date.now() } }));
  } catch {}
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'order', op: 'update', id }).catch(() => {}); } catch {}
  return upd.data;
}

// ---------- Reservations ----------
export async function createReservationSB({
  name,
  phone,
  iso,
  people,
  kind = 'table',
  table = '',
  notes,
  duration_minutes = 90
}) {
  const sb = window.supabase;

  // إدراج بدون select لتوافق صلاحيات anon (insert فقط)
  const insOnly = await sb.from('reservations').insert([
    {
      name,
      phone,
      date: iso,
      people,
      kind,
      notes,
      duration_minutes,
      table_no: table
    }
  ]);
  if (insOnly.error) throw insOnly.error;

  // سجل محلي لواجهة المستخدم
  const r = {
    id: crypto?.randomUUID?.() ? crypto.randomUUID() : `tmp-${Date.now()}`,
    name,
    phone,
    date: iso,
    people,
    kind,
    table_no: table || '',
    duration_minutes: duration_minutes || 90,
    notes: notes || '',
    status: 'new'
  };

  const list = LS.get('reservations', []);
  list.unshift({
    id: r.id,
    name: r.name,
    phone: r.phone,
    date: r.date,
    people: r.people,
    kind: r.kind,
    table: r.table_no || '',
    duration: r.duration_minutes || 90,
    notes: r.notes || '',
    status: r.status || 'new',
    createdAt: new Date().toISOString()
  });

  LS.set('reservations', list);

  /* NEW: الحجوزات كانت سبب التأخير — ابعث إشارة فورية */
  try {
    // حدث خاص بالحجوزات + واحد عام لضمان التوافق مع صفحات تسمع new-order فقط
    pingAdmins('new-reservation', { name, phone, date: iso, people }).catch(() => {});
    pingAdmins('new-order', { kind: 'reservation' }).catch(() => {});
  } catch {}

  return true;
}

export async function updateReservationSB(id, fields) {
  const f = fields || {};
  const patch = {};
  if ('name' in f) patch.name = f.name;
  if ('phone' in f) patch.phone = f.phone;
  if ('date' in f) patch.date = f.date;
  if ('people' in f) patch.people = f.people;
  if ('status' in f) patch.status = f.status;
  if ('notes' in f) patch.notes = f.notes;
  if ('table_no' in f) patch.table = f.table_no;
  if ('duration_minutes' in f) patch.duration = f.duration_minutes;

  const isTmp = String(id).startsWith('tmp-') || Number.isNaN(Number(id));
  if (isTmp) {
    // تعديل محلي فقط للحجوزات ذات المعرّف المؤقّت
    const list = LS.get('reservations', []);
    const i = list.findIndex((r) => String(r.id) === String(id));
    if (i >= 0) {
      list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
      LS.set('reservations', list);
    }
    return true;
  }

  const sb = window.supabase;
  // مطابقة نوع id مع bigint في القاعدة
  const up = await sb.from('reservations').update(fields).eq('id', Number(id)).select().single();
  if (up.error) throw up.error;

  const list = LS.get('reservations', []);
  const i = list.findIndex((r) => String(r.id) === String(id));
  if (i >= 0) {
    list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
    LS.set('reservations', list);
  }
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'update', id: Number(id) }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteReservationSB(id) {
  const isTmp = String(id).startsWith('tmp-') || Number.isNaN(Number(id));
  if (isTmp) {
    // حذف محلي فقط للحجوزات ذات المعرّف المؤقّت
    const list = (LS.get('reservations', []) || []).filter((r) => String(r.id) !== String(id));
    LS.set('reservations', list);
    /* NEW */ try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'delete', id }).catch(() => {}); } catch {}
    return true;
  }

  const sb = window.supabase;
  // مطابقة نوع id مع bigint في القاعدة
  const del = await sb.from('reservations').delete().eq('id', Number(id));
  if (del.error) throw del.error;

  const list = (LS.get('reservations', []) || []).filter((r) => String(r.id) !== String(id));
  LS.set('reservations', list);
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'delete', id: Number(id) }).catch(() => {}); } catch {}
  return true;
}

// ---------- Categories ----------
export async function createCategorySB({ id, name, sort = 100 }) {
  const sb = window.supabase;
  const ins = await sb.from('categories').insert([{ id, name, sort }]).select().single();
  if (ins.error) throw ins.error;
  // تحديث الكاش المحلي مباشرة لظهور القسم فورًا
  const cats = LS.get('categories', []);
  cats.push({ id: ins.data.id, name: ins.data.name, sort: ins.data.sort });
  LS.set('categories', cats);
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'category', op: 'create', id: ins.data.id }).catch(() => {}); } catch {}
  return ins.data;
}

// ---------- Categories (update & delete) ----------
export async function updateCategorySB(id, fields = {}) {
  const sb = window.supabase;
  const payload = {};
  if (typeof fields.name !== 'undefined') payload.name = fields.name;
  if (typeof fields.sort !== 'undefined') payload.sort = fields.sort;
  const up = await sb.from('categories').update(payload).eq('id', id).select().single();
  if (up.error) throw up.error;

  // Update LS cache for immediate UI feedback
  const cats = LS.get('categories', []);
  const i = cats.findIndex((c) => c.id === id);
  if (i >= 0) {
    cats[i] = { ...cats[i], ...up.data };
    LS.set('categories', cats);
  }
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'category', op: 'update', id }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteCategorySB(id) {
  const sb = window.supabase;
  const del = await sb.from('categories').delete().eq('id', id);
  if (del.error) throw del.error;

  // Reflect locally: remove cat + unlink items
  const cats = LS.get('categories', []).filter((c) => c.id !== id);
  LS.set('categories', cats);
  const items = LS.get('menuItems', []);
  items.forEach((it) => {
    if (it.catId === id) it.catId = null;
  });
  LS.set('menuItems', items);
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'category', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

// ---------- Menu Items (create / update / delete) ----------
export async function createMenuItemSB({
  name,
  desc = '',
  price = 0,
  img = '',
  cat_id = null,
  available = true,
  fresh = false
}) {
  const sb = window.supabase;
  const ins = await sb
    .from('menu_items')
    .insert([{ name, desc, price, img, cat_id, available, fresh }])
    .select()
    .single();
  if (ins.error) throw ins.error;

  // حدّث الكاش المحلي لظهور الصنف فورًا
  const items = LS.get('menuItems', []);
  const it = ins.data;
  items.unshift({
    id: it.id,
    name: it.name,
    desc: sanitizeDesc(it['desc']),
    price: toNumber(it.price),
    // ✅ إصلاح: لا تفرّغ الصور Base64
    img: normalizeImg(it.img),
    catId: it.cat_id,
    fresh: !!it.fresh,
    rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
    available: !!it.available
  });
  LS.set('menuItems', items);
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'item', op: 'create', id: it.id }).catch(() => {}); } catch {}
  return it;
}

export async function updateMenuItemSB(id, fields = {}) {
  const sb = window.supabase;
  const payload = {};
  if ('name' in fields) payload.name = fields.name;
  if ('desc' in fields) payload['desc'] = fields.desc;
  if ('price' in fields) payload.price = fields.price;
  if ('img' in fields) payload.img = fields.img;
  if ('catId' in fields) payload.cat_id = fields.catId;
  if ('available' in fields) payload.available = fields.available;
  if ('fresh' in fields) payload.fresh = fields.fresh;

  const up = await sb.from('menu_items').update(payload).eq('id', id).select().single();
  if (up.error) throw up.error;

  // حدّث الكاش المحلي
  const items = LS.get('menuItems', []);
  const i = items.findIndex((x) => x.id === id);
  if (i >= 0) {
    const it = up.data;
    items[i] = {
      id: it.id,
      name: it.name,
      desc: sanitizeDesc(it['desc']),
      price: toNumber(it.price),
      // ✅ إصلاح: لا تفرّغ الصور Base64
      img: normalizeImg(it.img),
      catId: it.cat_id,
      fresh: !!it.fresh,
      rating: items[i].rating || { avg: 0, count: 0 },
      available: !!it.available
    };
    LS.set('menuItems', items);
  }
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'item', op: 'update', id }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteMenuItemSB(id) {
  const sb = window.supabase;
  const del = await sb.from('menu_items').delete().eq('id', id);
  if (del.error) throw del.error;
  const items = (LS.get('menuItems', []) || []).filter((x) => x.id !== id);
  LS.set('menuItems', items);
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'item', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

// ---------- Storage: upload image & return public URL ----------
export async function uploadImageSB(file) {
  const sb = window.supabase;
  if (!sb) throw new Error('Supabase client missing');

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `menu/${crypto.randomUUID()}.${ext}`;

  const { error } = await sb.storage
    .from('images')
    .upload(path, file, { upsert: false, contentType: file.type || 'image/*' });

  if (error) throw error;

  const { data } = sb.storage.from('images').getPublicUrl(path);
  return data.publicUrl;
}

// ---------- Ratings ----------
// آمن لزائر مجهول: إدراج فقط بدون select
export async function createRatingSB({ item_id, stars }) {
  const sb = window.supabase;
  const ins = await sb.from('ratings').insert([{ item_id, stars: toNumber(stars) }]);
  if (ins.error) throw ins.error;
  /* NEW */ try { pingAdmins('admin-refresh', { kind: 'rating', op: 'create', item_id }).catch(() => {}); } catch {}
  return true;
}

// ---------- Admin sync ----------
export async function syncAdminDataToLocal() {
  const sb = window.supabase;

  const cats = await sb.from('categories').select('id,name,sort').order('sort', { ascending: true });
  if (cats.error) throw cats.error;

  // لا نستخدم select('*') لتقليل الحمولة
  const items = await sb
    .from('menu_items')
    .select('id,name,"desc",price,img,cat_id,fresh,rating_avg,rating_count,available,created_at')
    .order('created_at', { ascending: false });
  if (items.error) throw items.error;

  // LIMIT INITIAL SYNC WINDOW to avoid huge cold-start payloads (orders/reservations)
  const sinceOrdersISO = new Date(Date.now() - ORDERS_DAYS_BACK * MS_DAY).toISOString();
  const resFromISO = new Date(Date.now() - RESERVATIONS_DAYS_BACK * MS_DAY).toISOString();
  const resToISO = new Date(Date.now() + RESERVATIONS_DAYS_FWD * MS_DAY).toISOString();

  // Orders joined with items (مفلترة زمنيًا + حد أعلى)
  const orders = await sb
    .from('orders')
    .select('id,order_name,phone,table_no,notes,total,status,discount_pct,discount,additions,created_at')
    .gte('created_at', sinceOrdersISO)
    .order('created_at', { ascending: false })
    .limit(ORDERS_LIMIT);
  if (orders.error) throw orders.error;

  const orderIds = (orders.data || []).map((o) => o.id);

  // -------- NEW: تجزئة جلب عناصر الطلبات لتفادي IN(...) ضخمة --------
  let orderItems = [];
  if (orderIds.length) {
    const CHUNK = 1000; // حجم آمن لقائمة IN
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const slice = orderIds.slice(i, i + CHUNK);
      const oi = await sb
        .from('order_items')
        .select('order_id,item_id,name,price,qty')
        .in('order_id', slice);
      if (oi.error) throw oi.error;
      if (oi.data?.length) orderItems = orderItems.concat(oi.data);
    }
  }

  // ratings (حقول ضرورية فقط) + حد أعلى اختياري لتقليل الحمولة
  const ratings = await sb
    .from('ratings')
    .select('item_id,stars,created_at')
    .order('created_at', { ascending: false })
    .limit(RATINGS_LIMIT);
  if (ratings.error) throw ratings.error;

  // Reservations (مفلترة زمنيًا + حد أعلى + نافذة مستقبلية)
  const reservations = await sb
    .from('reservations')
    .select('*')
    .gte('date', resFromISO)
    .lte('date', resToISO)
    .order('date', { ascending: true })
    .limit(RESERVATIONS_LIMIT);
  if (reservations.error) throw reservations.error;

  // adapt to your LS shapes
  LS.set('categories', cats.data || []);
  LS.set(
    'menuItems',
    (items.data || []).map((it) => ({
      id: it.id,
      name: it.name,
      desc: sanitizeDesc(it['desc']),
      price: toNumber(it.price),
      // ✅ إصلاح: لا تفرّغ الصور Base64
      img: normalizeImg(it.img),
      catId: it.cat_id,
      fresh: !!it.fresh,
      rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
      available: !!it.available
    }))
  );

  // join orders
  const adminOrders = (orders.data || []).map((o) => {
    const its = orderItems
      .filter((oi) => oi.order_id === o.id)
      .map((oi) => ({
        id: oi.item_id,
        name: oi.name,
        price: toNumber(oi.price),
        qty: toNumber(oi.qty, 1)
      }));
    const cnt = its.reduce((s, it) => s + (Number(it.qty) || 1), 0);
    return {
      id: o.id,
      total: toNumber(o.total),
      itemCount: cnt,
      time: o.created_at,
      createdAt: o.created_at,
      status: o.status || 'new',
      table: o.table_no || '',
      orderName: o.order_name || '',
      notes: o.notes || '',
      additions: o.additions || [],
      discount: toNumber(o.discount),
      discountPct: toNumber(o.discount_pct),
      items: its
    };
  });
  LS.set('orders', adminOrders);

  LS.set(
    'reservations',
    (reservations.data || []).map((r) => ({
      id: Number(r.id),
      name: r.name,
      phone: r.phone,
      date: r.date,
      people: r.people,
      kind: r.kind,
      table: r.table_no || '',
      duration: r.duration_minutes || 90,
      notes: r.notes || '',
      status: r.status || 'new'
    }))
  );

  // notifications: only orders for the admin drawer (حافظ على حالة read)
  const prev = LS.get('notifications', []);
  const prevMap = new Map((prev || []).map((n) => [n.id, n]));
  const notifOrders = adminOrders.map((o) => {
    const id = `ord-${o.id}`;
    const old = prevMap.get(id);
    return {
      id,
      type: 'order',
      title: `طلب جديد #${o.id}`,
      message: `عدد العناصر: ${o.itemCount} | الإجمالي: ${o.total}`,
      time: o.createdAt,
      read: old ? !!old.read : false
    };
  });
  const nonOrders = (prev || []).filter((n) => n.type !== 'order');
  const merged = [...nonOrders, ...notifOrders].sort((a, b) => new Date(b.time) - new Date(a.time));
  LS.set('notifications', merged);

  try {
    document.dispatchEvent(new CustomEvent('sb:admin-synced', { detail: { at: Date.now() } }));
  } catch {}

  return true;
}

export async function requireAdminOrRedirect(loginPath = 'login.html') {
  const sb = window.supabase;
  const {
    data: { session }
  } = await sb.auth.getSession();
  if (!session) {
    try {
      location.replace(loginPath);
    } catch {}
    // ارمِ خطأ ليوقف المتصلون أي مزامنة لاحقة على صفحات الأدمن
    throw new Error('NO_SESSION');
  }
  return session; // أي مستخدم مسجّل دخولًا مسموح
}

// ---------- Auto bootstrap on admin & public pages (now with live polling & locks) ----------
// نستخدم حواجز عالمية على window لمنع إنشاء مؤقّتات مكررة وتداخل الاستدعاءات.
(() => {
  try {
    const path = (location.pathname || '').toLowerCase();
    const isAdminPage = /(admin|dashboard|kds)/.test(path) || !!document.querySelector('script[src*="admin.js"]');
    const SYNC_INTERVAL_MS = 10000;

    // أدوات قفل بسيطة لمنع التداخل
    const withLock = async (flagKey, fn) => {
      if (window[flagKey]) return;
      window[flagKey] = true;
      try {
        await fn();
      } finally {
        window[flagKey] = false;
      }
    };

    // ---- ADMIN PAGES ----
    if (isAdminPage) {
      const immediateSyncAdmin = () =>
        withLock('__SB_ADMIN_SYNC_BUSY', async () => {
          await syncAdminDataToLocal();
        });

      const startAdminInterval = () => {
        if (window.__SB_ADMIN_SYNC_TIMER) return;
        // FIX: لا تعتمد على رؤية الصفحة (بعض المتصفحات تُبطئ المؤقّتات في الخلفية حتى 10 دقائق)
        window.__SB_ADMIN_SYNC_TIMER = setInterval(() => {
          immediateSyncAdmin().catch((e) => console.error('admin sync error', e));
        }, SYNC_INTERVAL_MS);
      };

      const startAdminRealtime = () => {
        try {
          if (window.__SB_ADMIN_RT || !window.supabase?.channel) return;
          // قناة لـ Postgres Changes
          const ch = window.supabase
            .channel('admin-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => immediateSyncAdmin())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => immediateSyncAdmin())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => immediateSyncAdmin())
            // اختياري: لجعل لوحة الأدمن تتحدّث فورًا عند تعديل القائمة/الأقسام/التقييمات
            .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => immediateSyncAdmin())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => immediateSyncAdmin())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => immediateSyncAdmin())
            .subscribe();
          window.__SB_ADMIN_RT = ch;

          // NEW: قناة broadcast "live" لاستقبال التنبيهات الفورية من الواجهة العامة
          if (!window.__SB_ADMIN_BC) {
            const bc = window.supabase
              .channel('live', { config: { broadcast: { self: true } } })
              .on('broadcast', { event: 'new-order' }, () => immediateSyncAdmin())
              .on('broadcast', { event: 'new-reservation' }, () => immediateSyncAdmin())
              .on('broadcast', { event: 'admin-refresh' }, () => immediateSyncAdmin());
            bc.subscribe().catch(() => {});
            window.__SB_ADMIN_BC = bc;
          }
        } catch (e) {
          console.warn('realtime init failed', e);
        }
      };

      const run = async () => {
        const ok = await requireAdminOrRedirect('login.html').then(() => true).catch(() => false);
        if (!ok) return;
        await immediateSyncAdmin().catch((e) => console.error('admin initial sync error', e));
        startAdminInterval();
        startAdminRealtime();
      };

      const attachAdminInstantTriggers = () => {
        const instant = () => {
          // FIX: نفّذ مزامنة فورية حتى لو كانت الصفحة في الخلفية
          immediateSyncAdmin().catch(() => {});
        };
        document.addEventListener('visibilitychange', instant);
        window.addEventListener('focus', instant);
        window.addEventListener('online', instant);
        window.addEventListener('pageshow', instant);
      };

      if (document.readyState === 'loading') {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            run();
            attachAdminInstantTriggers();
          },
          { once: true }
        );
      } else {
        run();
        attachAdminInstantTriggers();
      }

      // تنظيف عند إغلاق الصفحة
      window.addEventListener('beforeunload', () => {
        if (window.__SB_ADMIN_SYNC_TIMER) {
          clearInterval(window.__SB_ADMIN_SYNC_TIMER);
          window.__SB_ADMIN_SYNC_TIMER = null;
        }
        try {
          if (window.__SB_ADMIN_RT?.unsubscribe) window.__SB_ADMIN_RT.unsubscribe();
        } catch {}
        try {
          if (window.__SB_ADMIN_BC?.unsubscribe) window.__SB_ADMIN_BC.unsubscribe();
        } catch {}
      });

      return; // لا نُشغّل وضع الواجهة العامة على صفحات الأدمن
    }

    // ---- PUBLIC PAGES ----
    const immediateSyncPublic = () =>
      withLock('__SB_PUBLIC_SYNC_BUSY', async () => {
        await syncPublicCatalogToLocal();
      });

    const startPublicInterval = () => {
      if (window.__SB_PUBLIC_SYNC_TIMER) return;
      window.__SB_PUBLIC_SYNC_TIMER = setInterval(() => {
        if (document.visibilityState === 'visible') {
          immediateSyncPublic().catch((e) => console.error('public sync error', e));
        }
      }, SYNC_INTERVAL_MS);
    };

    const attachPublicInstantTriggers = () => {
      const instant = () => {
        if (document.visibilityState === 'visible') {
          immediateSyncPublic().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', instant);
      window.addEventListener('focus', instant);
      window.addEventListener('online', instant);
    };

    const runPublic = async () => {
      await immediateSyncPublic().catch((e) => console.error('public sync error (initial)', e));
      startPublicInterval();
    };

    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          runPublic();
          attachPublicInstantTriggers();
        },
        { once: true }
      );
    } else {
      runPublic();
      attachPublicInstantTriggers();
    }

    window.addEventListener('beforeunload', () => {
      if (window.__SB_PUBLIC_SYNC_TIMER) {
        clearInterval(window.__SB_PUBLIC_SYNC_TIMER);
        window.__SB_PUBLIC_SYNC_TIMER = null;
      }
    });
  } catch (e) {
    console.error(e);
  }
})();

// Expose to window for non-module scripts
window.supabaseBridge = {
  syncPublicCatalogToLocal,
  createOrderSB,
  deleteOrderSB,
  updateOrderSB,
  createCategorySB,
  updateCategorySB,
  deleteCategorySB,
  createMenuItemSB,
  updateMenuItemSB,
  deleteMenuItemSB,
  uploadImageSB,
  createReservationSB,
  updateReservationSB,
  deleteReservationSB,
  createRatingSB,
  syncAdminDataToLocal,
  requireAdminOrRedirect
};
// ======== Image normalization (fallback + relative -> public URL) ========
const DEFAULT_IMG =
  'https://images.unsplash.com/photo-1543352634-8730b1c3c34b?q=80&w=1200&auto=format&fit=crop';

export function normalizeImg(v){
  const s = String(v || '').trim();
  if (!s) return DEFAULT_IMG;
  // جاهز للعرض كما هو (رابط مباشر أو base64)
  if (/^(https?:\/\/|data:)/i.test(s)) return s;
  // مسار نسبي مخزّن سابقاً -> حوّله إلى رابط عام من Storage
  const path = s.replace(/^images\//i, '').replace(/^\/+/, '');
  try{
    const { data } = window.supabase?.storage.from('images').getPublicUrl(path) || {};
    return data?.publicUrl || DEFAULT_IMG;
  }catch(_){
    return DEFAULT_IMG;
  }
}
