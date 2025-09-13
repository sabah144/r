// ============= supabase-bridge.js (CLEAN EDITION — SAFE, FAST, NO BEHAVIOR CHANGE) =============
// Requires: a Supabase client at window.supabase (create it in <head> as type="module").
// Exposes ESM exports AND window.supabaseBridge for non-module pages.

(() => {
  if (!window.supabase) {
    console.warn('Supabase client is missing. Add it in <head> first.');
  }
})();

/* =========================
   Utilities & Constants
========================= */
const isBase64DataUri = (v) => typeof v === 'string' && v.startsWith('data:');
const sanitizeDesc = (v) => String(v || '').slice(0, 160);
const toNumber = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);

const MS_DAY = 86_400_000;
const ORDERS_DAYS_BACK = 30;
const ORDERS_LIMIT = 500;

const RESERVATIONS_DAYS_BACK = 7;
const RESERVATIONS_DAYS_FWD = 60;
const RESERVATIONS_LIMIT = 1000;

const RATINGS_LIMIT = 5000;

/* =========================
   localStorage Helper (with memory fallback)
========================= */
const __MEM = Object.create(null);
const LS = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return JSON.parse(v);
    } catch {}
    return key in __MEM ? __MEM[key] : def;
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      __MEM[key] = val;
    }
  },
};

/* =========================
   Broadcast helper (instant admin ping)
========================= */
async function pingAdmins(event = 'admin-refresh', payload = {}) {
  try {
    const sb = window.supabase;
    if (!sb?.channel) return;
    if (!window.__SB_BC) {
      window.__SB_BC = sb.channel('live', { config: { broadcast: { self: true } } });
      try { await window.__SB_BC.subscribe(); } catch {}
    }
    try {
      await window.__SB_BC.send({ type: 'broadcast', event, payload });
    } catch {}
  } catch {}
}

/* =========================
   Public: Categories + Visible Menu → localStorage
========================= */
export async function syncPublicCatalogToLocal() {
  const sb = window.supabase;

  const [cats, items] = await Promise.all([
    sb.from('categories').select('id,name,sort').order('sort', { ascending: true }),
    sb
      .from('menu_items')
      .select('id,name,"desc",price,img,cat_id,available,fresh,rating_avg,rating_count,created_at')
      .eq('available', true)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (cats.error) throw cats.error;
  if (items.error) throw items.error;

  const mapped = (items.data || []).map((it) => ({
    id: it.id,
    name: it.name,
    desc: sanitizeDesc(it['desc']),
    price: toNumber(it.price),
    img: it.img || '',
    catId: it.cat_id,
    fresh: !!it.fresh,
    rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
    available: !!it.available,
  }));

  LS.set('categories', cats.data || []);
  LS.set('menuItems', mapped);

  try {
    document.dispatchEvent(new CustomEvent('sb:public-synced', { detail: { at: Date.now() } }));
  } catch {}

  // Background hydration (paging) without blocking UI
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
          img: it.img || '',
          catId: it.cat_id,
          fresh: !!it.fresh,
          rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
          available: !!it.available,
        }));

        LS.set('menuItems', LS.get('menuItems', []).concat(extra));
        offset += batch.length;

        try {
          document.dispatchEvent(new CustomEvent('sb:public-synced', { detail: { at: Date.now(), partial: true } }));
        } catch {}

        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      console.warn('Background hydration failed', e);
    }
  })();

  return { categories: cats.data || [], items: mapped };
}

/* =========================
   Orders
========================= */
export async function createOrderSB({ order_name, phone, table_no, notes, items }) {
  const sb = window.supabase;

  const itemsNorm = (items || []).map((it) => ({
    id: it.id || null,
    name: String(it.name || ''),
    price: toNumber(it.price),
    qty: toNumber(it.qty, 1),
  }));

  const { data: order_id, error } = await sb.rpc('create_order_with_items', {
    _order_name: order_name || '',
    _phone: phone || '',
    _table_no: table_no || '',
    _notes: notes || '',
    _items: itemsNorm,
  });
  if (error) throw error;

  const total = itemsNorm.reduce((s, it) => s + it.price * it.qty, 0);
  const itemCount = itemsNorm.reduce((s, it) => s + it.qty, 0);
  const nowISO = new Date().toISOString();

  const orders = LS.get('orders', []);
  orders.unshift({
    id: order_id,
    total,
    itemCount,
    time: nowISO,
    createdAt: nowISO,
    status: 'new',
    items: itemsNorm.map((it) => ({ id: it.id, name: it.name, price: it.price, qty: it.qty })),
    table: table_no || '',
    orderName: order_name || '',
    notes: notes || '',
  });
  LS.set('orders', orders);

  try { pingAdmins('new-order', { id: order_id }).catch(() => {}); } catch {}
  return { id: order_id };
}

export async function updateOrderSB(orderId, { status, additions, discount_pct, discount }) {
  const sb = window.supabase;
  const id = Number(orderId);

  const payload = {};
  if (typeof status !== 'undefined') payload.status = status;
  if (typeof additions !== 'undefined') payload.additions = additions;
  if (typeof discount_pct !== 'undefined') payload.discount_pct = toNumber(discount_pct);
  if (typeof discount !== 'undefined') payload.discount = toNumber(discount);

  const upd = await sb.from('orders').update(payload).eq('id', id).select().single();
  if (upd.error) throw upd.error;

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
  try { pingAdmins('admin-refresh', { kind: 'order', op: 'update', id }).catch(() => {}); } catch {}
  return upd.data;
}

export async function deleteOrderSB(orderId) {
  const sb = window.supabase;
  const id = Number(orderId);

  const del = await sb.from('orders').delete().eq('id', id);
  if (del.error) throw del.error;

  LS.set('orders', (LS.get('orders', []) || []).filter((o) => Number(o.id) !== id));
  LS.set('notifications', (LS.get('notifications', []) || []).filter((n) => n.id !== `ord-${id}`));

  try {
    document.dispatchEvent(new CustomEvent('sb:admin-synced', { detail: { at: Date.now() } }));
  } catch {}
  try { pingAdmins('admin-refresh', { kind: 'order', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

/* =========================
   Reservations
========================= */
export async function createReservationSB({ name, phone, iso, people, kind = 'table', table = '', notes, duration_minutes = 90 }) {
  const sb = window.supabase;

  const ins = await sb.from('reservations').insert([
    { name, phone, date: iso, people, kind, notes, duration_minutes, table_no: table },
  ]);
  if (ins.error) throw ins.error;

  const local = {
    id: crypto?.randomUUID?.() ? crypto.randomUUID() : `tmp-${Date.now()}`,
    name,
    phone,
    date: iso,
    people,
    kind,
    table: table || '',
    duration: duration_minutes,
    notes: notes || '',
    status: 'new',
    createdAt: new Date().toISOString(),
  };

  const list = LS.get('reservations', []);
  list.unshift(local);
  LS.set('reservations', list);

  try {
    pingAdmins('new-reservation', { name, phone, date: iso, people }).catch(() => {});
    pingAdmins('new-order', { kind: 'reservation' }).catch(() => {});
  } catch {}

  return true;
}

export async function updateReservationSB(id, fields = {}) {
  const patch = {};
  if ('name' in fields) patch.name = fields.name;
  if ('phone' in fields) patch.phone = fields.phone;
  if ('date' in fields) patch.date = fields.date;
  if ('people' in fields) patch.people = fields.people;
  if ('status' in fields) patch.status = fields.status;
  if ('notes' in fields) patch.notes = fields.notes;
  if ('table_no' in fields) patch.table = fields.table_no;
  if ('duration_minutes' in fields) patch.duration = fields.duration_minutes;

  const isTmp = String(id).startsWith('tmp-') || Number.isNaN(Number(id));
  if (isTmp) {
    const list = LS.get('reservations', []);
    const i = list.findIndex((r) => String(r.id) === String(id));
    if (i >= 0) {
      list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
      LS.set('reservations', list);
    }
    return true;
  }

  const sb = window.supabase;
  const up = await sb.from('reservations').update(fields).eq('id', Number(id)).select().single();
  if (up.error) throw up.error;

  const list = LS.get('reservations', []);
  const i = list.findIndex((r) => String(r.id) === String(id));
  if (i >= 0) {
    list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
    LS.set('reservations', list);
  }

  try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'update', id: Number(id) }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteReservationSB(id) {
  const isTmp = String(id).startsWith('tmp-') || Number.isNaN(Number(id));
  if (isTmp) {
    LS.set('reservations', (LS.get('reservations', []) || []).filter((r) => String(r.id) !== String(id)));
    try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'delete', id }).catch(() => {}); } catch {}
    return true;
  }

  const sb = window.supabase;
  const del = await sb.from('reservations').delete().eq('id', Number(id));
  if (del.error) throw del.error;

  LS.set('reservations', (LS.get('reservations', []) || []).filter((r) => String(r.id) !== String(id)));
  try { pingAdmins('admin-refresh', { kind: 'reservation', op: 'delete', id: Number(id) }).catch(() => {}); } catch {}
  return true;
}

/* =========================
   Categories
========================= */
export async function createCategorySB({ id, name, sort = 0 }) {
  const sb = window.supabase;
  const row = { id, name, sort };
  const { data, error } = await sb.from('categories').insert([row]).select().single();
  if (error) throw error;

  const cats = LS.get('categories', []);
  cats.push(data);
  cats.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  LS.set('categories', cats);

  try { pingAdmins('admin-refresh', { kind: 'category', op: 'create', id: data.id }).catch(() => {}); } catch {}
  return data;
}

export async function updateCategorySB(id, fields = {}) {
  const sb = window.supabase;
  const up = await sb.from('categories').update(fields).eq('id', id).select().single();
  if (up.error) throw up.error;

  const cats = LS.get('categories', []);
  const i = cats.findIndex((c) => c.id === id);
  if (i >= 0) {
    cats[i] = { ...cats[i], ...fields };
    LS.set('categories', cats);
  }

  try { pingAdmins('admin-refresh', { kind: 'category', op: 'update', id }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteCategorySB(id) {
  const sb = window.supabase;
  const del = await sb.from('categories').delete().eq('id', id);
  if (del.error) throw del.error;

  LS.set('categories', (LS.get('categories', []) || []).filter((c) => c.id !== id));
  try { pingAdmins('admin-refresh', { kind: 'category', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

/* =========================
   Menu Items (+ image)
========================= */
export async function uploadImageSB(fileOrDataUrl) {
  // Keeping simple: store base64 data URLs directly in DB (fits current schema: menu_items.img text)
  if (!fileOrDataUrl) return '';
  if (typeof fileOrDataUrl === 'string') return fileOrDataUrl;
  if (fileOrDataUrl instanceof File) {
    const buf = await fileOrDataUrl.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const mime = fileOrDataUrl.type || 'image/png';
    return `data:${mime};base64,${b64}`;
  }
  return '';
}

export async function createMenuItemSB({ name, desc = '', price = 0, img = '', catId = null, available = true, fresh = false }) {
  const sb = window.supabase;
  const row = {
    name,
    desc,
    price: toNumber(price),
    img,
    cat_id: catId,
    available: !!available,
    fresh: !!fresh,
  };

  const { data, error } = await sb.from('menu_items').insert([row]).select().single();
  if (error) throw error;

  const items = LS.get('menuItems', []);
  const it = data;
  items.unshift({
    id: it.id,
    name: it.name,
    desc: sanitizeDesc(it['desc']),
    price: toNumber(it.price),
    img: it.img || '',
    catId: it.cat_id,
    fresh: !!it.fresh,
    rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
    available: !!it.available,
  });
  LS.set('menuItems', items);

  try { pingAdmins('admin-refresh', { kind: 'item', op: 'create', id: it.id }).catch(() => {}); } catch {}
  return it;
}

export async function updateMenuItemSB(id, fields = {}) {
  const sb = window.supabase;
  const payload = {};
  if ('name' in fields) payload.name = fields.name;
  if ('desc' in fields) payload['desc'] = fields.desc;
  if ('price' in fields) payload.price = toNumber(fields.price);
  if ('img' in fields) payload.img = fields.img;
  if ('catId' in fields) payload.cat_id = fields.catId;
  if ('available' in fields) payload.available = !!fields.available;
  if ('fresh' in fields) payload.fresh = !!fields.fresh;

  const up = await sb.from('menu_items').update(payload).eq('id', id).select().single();
  if (up.error) throw up.error;

  const items = LS.get('menuItems', []);
  const i = items.findIndex((x) => x.id === id);
  if (i >= 0) {
    const it = up.data;
    items[i] = {
      id: it.id,
      name: it.name,
      desc: sanitizeDesc(it['desc']),
      price: toNumber(it.price),
      img: it.img || '',
      catId: it.cat_id,
      fresh: !!it.fresh,
      rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
      available: !!it.available,
    };
    LS.set('menuItems', items);
  }

  try { pingAdmins('admin-refresh', { kind: 'item', op: 'update', id }).catch(() => {}); } catch {}
  return up.data;
}

export async function deleteMenuItemSB(id) {
  const sb = window.supabase;
  const del = await sb.from('menu_items').delete().eq('id', id);
  if (del.error) throw del.error;

  LS.set('menuItems', (LS.get('menuItems', []) || []).filter((x) => x.id !== id));
  try { pingAdmins('admin-refresh', { kind: 'item', op: 'delete', id }).catch(() => {}); } catch {}
  return true;
}

/* =========================
   Ratings (simple insert)
========================= */
export async function createRatingSB(itemId, stars) {
  const sb = window.supabase;
  const st = Math.max(1, Math.min(5, Number(stars) || 0));
  const ins = await sb.from('ratings').insert([{ item_id: itemId, stars: st }]).select().single();
  if (ins.error) throw ins.error;

  // Best effort local update (approx)
  const items = LS.get('menuItems', []);
  const it = items.find((x) => x.id === itemId);
  if (it) {
    const c = Number(it.rating?.count || 0) + 1;
    const avg = Number(it.rating?.avg || 0);
    const newAvg = (avg * (c - 1) + st) / c;
    it.rating = { avg: Number(newAvg.toFixed(2)), count: c };
    LS.set('menuItems', items);
  }
  return true;
}

/* =========================
   Admin Sync → localStorage
========================= */
export async function syncAdminDataToLocal() {
  const sb = window.supabase;

  const sinceOrdersISO = new Date(Date.now() - ORDERS_DAYS_BACK * MS_DAY).toISOString();
  const resFromISO = new Date(Date.now() - RESERVATIONS_DAYS_BACK * MS_DAY).toISOString();
  const resToISO = new Date(Date.now() + RESERVATIONS_DAYS_FWD * MS_DAY).toISOString();

  const cats = await sb.from('categories').select('id,name,sort').order('sort', { ascending: true });
  if (cats.error) throw cats.error;

  const items = await sb
    .from('menu_items')
    .select('id,name,"desc",price,img,cat_id,available,fresh,rating_avg,rating_count,created_at')
    .order('created_at', { ascending: false });
  if (items.error) throw items.error;

  const orders = await sb
    .from('orders')
    .select('id,order_name,phone,table_no,notes,total,status,discount_pct,discount,additions,created_at')
    .gte('created_at', sinceOrdersISO)
    .order('created_at', { ascending: false })
    .limit(ORDERS_LIMIT);
  if (orders.error) throw orders.error;

  // Fetch order_items in chunks to avoid super-long IN(...)
  const orderIds = (orders.data || []).map((o) => o.id);
  let orderItems = [];
  if (orderIds.length) {
    const CHUNK = 1000;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const slice = orderIds.slice(i, i + CHUNK);
      const oi = await sb.from('order_items').select('order_id,item_id,name,price,qty').in('order_id', slice);
      if (oi.error) throw oi.error;
      if (oi.data?.length) orderItems = orderItems.concat(oi.data);
    }
  }

  const ratings = await sb
    .from('ratings')
    .select('item_id,stars,created_at')
    .order('created_at', { ascending: false })
    .limit(RATINGS_LIMIT);
  if (ratings.error) throw ratings.error;

  const reservations = await sb
    .from('reservations')
    .select('*')
    .gte('date', resFromISO)
    .lte('date', resToISO)
    .order('date', { ascending: true })
    .limit(RESERVATIONS_LIMIT);
  if (reservations.error) throw reservations.error;

  // Adapt into LS shapes
  LS.set('categories', cats.data || []);
  LS.set(
    'menuItems',
    (items.data || []).map((it) => ({
      id: it.id,
      name: it.name,
      desc: sanitizeDesc(it['desc']),
      price: toNumber(it.price),
      img: it.img || '',
      catId: it.cat_id,
      fresh: !!it.fresh,
      rating: { avg: toNumber(it.rating_avg), count: toNumber(it.rating_count) },
      available: !!it.available,
    })),
  );

  const adminOrders = (orders.data || []).map((o) => {
    const its = orderItems
      .filter((oi) => oi.order_id === o.id)
      .map((oi) => ({ id: oi.item_id, name: oi.name, price: toNumber(oi.price), qty: toNumber(oi.qty, 1) }));
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
      items: its,
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
      status: r.status || 'new',
    })),
  );

  // Merge notifications: keep read flags for old entries, regenerate order notifications
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
      read: old ? !!old.read : false,
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

/* =========================
   Session guard
========================= */
export async function requireAdminOrRedirect(loginPath = 'login.html') {
  const sb = window.supabase;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    try { location.replace(loginPath); } catch {}
    throw new Error('NO_SESSION');
  }
  return session;
}

/* =========================
   Auto Bootstrap (admin & public)
========================= */
// Locks to avoid overlapping syncs
const withLock = async (flagKey, fn) => {
  if (window[flagKey]) return;
  window[flagKey] = true;
  try { await fn(); } finally { window[flagKey] = false; }
};

function attachAdminInstantTriggers() {
  try {
    const sb = window.supabase;
    if (!sb?.channel) return;

    if (!window.__SB_ADMIN_BC) {
      window.__SB_ADMIN_BC = sb.channel('live', { config: { broadcast: { self: true } } })
        .on('broadcast', { event: 'new-order' }, async () => {
          try { await syncAdminDataToLocal(); } catch (e) { console.error(e); }
          try { window.updateAll?.(); } catch {}
        });
      window.__SB_ADMIN_BC.subscribe().catch(() => {});
    }
  } catch {}
}

// Start a polling interval on public pages (exported as global)
function _startPublicIntervalInternal() {
  const INTERVAL = 3000;
  if (window.__SB_PUBLIC_SYNC_TIMER) return;
  window.__SB_PUBLIC_SYNC_TIMER = setInterval(() => {
    withLock('__SB_PUBLIC_SYNC_BUSY', () => syncPublicCatalogToLocal()).catch((e) => console.error('public sync error', e));
  }, INTERVAL);
}
export function startPublicInterval() { _startPublicIntervalInternal(); }
export function stopPublicInterval() {
  if (window.__SB_PUBLIC_SYNC_TIMER) {
    clearInterval(window.__SB_PUBLIC_SYNC_TIMER);
    window.__SB_PUBLIC_SYNC_TIMER = null;
  }
}

// Auto-detect admin pages and start admin sync + triggers
(() => {
  try {
    const path = (location.pathname || '').toLowerCase();
    const isAdminPage =
      /(admin|dashboard|kds)/.test(path) ||
      !!document.querySelector('script[src*="admin.js"]');

    const SYNC_INTERVAL_MS = 3000;

    if (isAdminPage) {
      const runAdmin = async () => {
        try { await requireAdminOrRedirect('login.html'); } catch { return; }
        await withLock('__SB_ADMIN_SYNC_BUSY', async () => { await syncAdminDataToLocal(); });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          runAdmin();
          attachAdminInstantTriggers();
        }, { once: true });
      } else {
        runAdmin();
        attachAdminInstantTriggers();
      }

      if (!window.__SB_ADMIN_SYNC_TIMER) {
        window.__SB_ADMIN_SYNC_TIMER = setInterval(() => {
          withLock('__SB_ADMIN_SYNC_BUSY', () => syncAdminDataToLocal())
            .catch((e) => console.error('admin sync error', e));
        }, SYNC_INTERVAL_MS);
      }

      window.addEventListener('beforeunload', () => {
        if (window.__SB_ADMIN_SYNC_TIMER) {
          clearInterval(window.__SB_ADMIN_SYNC_TIMER);
          window.__SB_ADMIN_SYNC_TIMER = null;
        }
        try { window.__SB_ADMIN_BC?.unsubscribe?.(); } catch {}
      });

      // Do not start public interval on admin pages
      return;
    }

    // Public pages: expose start/stop on window for convenience
    window.startPublicInterval = startPublicInterval;
    window.stopPublicInterval = stopPublicInterval;
  } catch {}
})();

/* =========================
   Global bridge (for non-module pages)
========================= */
window.supabaseBridge = {
  // Public
  syncPublicCatalogToLocal,

  // Orders
  createOrderSB,
  updateOrderSB,
  deleteOrderSB,

  // Reservations
  createReservationSB,
  updateReservationSB,
  deleteReservationSB,

  // Categories
  createCategorySB,
  updateCategorySB,
  deleteCategorySB,

  // Menu Items
  createMenuItemSB,
  updateMenuItemSB,
  deleteMenuItemSB,
  uploadImageSB,

  // Ratings
  createRatingSB,

  // Admin
  syncAdminDataToLocal,
  requireAdminOrRedirect,

  // Public polling helpers
  startPublicInterval,
  stopPublicInterval,
};
