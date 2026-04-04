import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

// ── Leaflet Setup ─────────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function LocationPicker({ position, setPosition }) {
  useMapEvents({ click(e) { setPosition(e.latlng) } })
  return position === null ? null : <Marker position={position}></Marker>
}

// ── Config ────────────────────────────────────────────────────────────────────
const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL
const SLOT_LABELS = { slot1: 'Slot 1 — Morning', slot2: 'Slot 2 — Afternoon' }
const STATUS = {
  new:        { label: 'New',              text: '#3B6D11', bg: '#EAF3DE' },
  confirmed:  { label: 'Confirmed',        text: '#185FA5', bg: '#E6F1FB' },
  dispatched: { label: 'Out for Delivery', text: '#854F0B', bg: '#FAEEDA' },
  delivered:  { label: 'Delivered',        text: '#0F6E56', bg: '#E1F5EE' },
  cancelled:  { label: 'Cancelled',        text: '#A32D2D', bg: '#FCEBEB' },
}

const DEFAULT_MENU = [
  'Dal Tadka + Rice', 'Rajma Chawal', 'Chole + Puri',
  'Paneer Butter Masala + Roti', 'Mix Veg + Chapati',
  'Special Thali', 'Biryani (Veg)', 'Aloo Gobhi + Roti',
]

const AMB      = '#BA7517'
const AMB_BG   = '#FAEEDA'
const AMB_DARK = '#633806'

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtDate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }
function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

async function apiGet(params) {
  const qs  = new URLSearchParams(params).toString()
  const res = await fetch(`${SCRIPT_URL}?${qs}`, { redirect: 'follow' })
  return res.json()
}
async function apiPost(action, payload = {}) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }), redirect: 'follow',
  })
  return res.json()
}

// ── Shared UI Styles ──────────────────────────────────────────────────────────
const inpStyle = { width: '100%', fontSize: '14px', padding: '9px 11px', borderRadius: '8px', border: '0.5px solid var(--border)', boxSizing: 'border-box', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }
const btnPrimary = { padding: '9px 18px', borderRadius: '8px', border: 'none', background: AMB, color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 500, fontFamily: 'inherit' }
const btnSecondary = { padding: '8px 14px', borderRadius: '8px', border: '0.5px solid var(--border-med)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }

function Badge({ status }) { const s = STATUS[status] || STATUS.new; return <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</span> }
function Sec({ title, children, optional }) { return <div style={{ marginBottom: '1.5rem' }}><div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}><p style={{ fontWeight: 500, fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{title}</p>{optional && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>optional</span>}</div>{children}</div> }
function Fld({ label, children, error }) { return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</label>{children}{error && <p style={{ color: '#A32D2D', fontSize: '12px', margin: '4px 0 0' }}>{error}</p>}</div> }
function Spinner() { return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><div style={{ width: 28, height: 28, border: `3px solid ${AMB_BG}`, borderTopColor: AMB, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /><style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style></div> }

// ── Customer Form ─────────────────────────────────────────────────────────────
function CustomerForm({ menu, onSubmit }) {
  const [form, setForm] = useState({ name: '', phone: '', address: '', slot: 'slot1', date: todayStr(), items: {}, notes: '' })
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})
  const [locLoading, setLocLoading] = useState(false)
  const [coords, setCoords] = useState(null)

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const clr = k => setErrors(e => ({ ...e, [k]: '' }))

  // Load Private Cache (Browser only)
  useEffect(() => {
    const saved = localStorage.getItem('tiffinbox_user')
    if (saved) {
      try {
        const { name, phone, address } = JSON.parse(saved)
        setForm(f => ({ ...f, name: name || '', phone: phone || '', address: address || '' }))
      } catch (e) {}
    }
  }, [])

  function handleDetectLocation() {
    if (!navigator.geolocation) { alert('Geolocation not supported'); return }
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(async ({ coords: { latitude, longitude } }) => {
      setCoords({ lat: latitude, lng: longitude })
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`)
        const data = await res.json()
        upd('address', data.display_name || `${latitude}, ${longitude}`); clr('address')
      } catch { upd('address', `${latitude}, ${longitude}`) }
      setLocLoading(false)
    }, () => { alert('Location access denied'); setLocLoading(false) }, { enableHighAccuracy: true })
  }

  function updateQty(item, delta) {
    setForm(f => {
      const items = { ...f.items }; const next = Math.max(0, (items[item] || 0) + delta)
      if (next === 0) delete items[item]; else items[item] = next
      return { ...f, items }
    }); clr('items')
  }

  async function handleSubmit() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!/^[6-9]\d{9}$/.test(form.phone.trim())) e.phone = 'Valid 10-digit number required'
    if (!form.address.trim()) e.address = 'Address is required'
    if (!Object.keys(form.items).length) e.items = 'Please select at least one item'
    if (Object.keys(e).length) { setErrors(e); return }

    setBusy(true)
    const finalNotes = coords ? `${form.notes}\n[GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]` : form.notes
    
    // Save to Private Cache
    localStorage.setItem('tiffinbox_user', JSON.stringify({ name: form.name, phone: form.phone, address: form.address }))

    await onSubmit({ ...form, notes: finalNotes })
    setSubmitted(true); setBusy(false)
  }

  if (submitted) return (
    <div style={{ maxWidth: 480, margin: '5rem auto', padding: '0 1rem' }}>
      <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '2.5rem 2rem', textAlign: 'center' }}>
        <p style={{ fontWeight: 500, fontSize: '18px', margin: '0 0 8px' }}>Order placed!</p>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>We've received your order and will confirm it shortly.</p>
        <button onClick={() => setSubmitted(false)} style={btnSecondary}>Place another order</button>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 500, margin: '0 0 4px' }}>TiffinBox Jaipur</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Quality home-cooked meals delivered to your door.</p>
      </div>

      <Sec title="Your details">
        <Fld label="Full name" error={errors.name}>
          <input style={inpStyle} placeholder="Your name" value={form.name} onChange={e => { upd('name', e.target.value); clr('name') }} />
        </Fld>
        <Fld label="Mobile number" error={errors.phone}>
          <input style={inpStyle} placeholder="10-digit mobile number" value={form.phone} maxLength={10} onChange={e => { upd('phone', e.target.value.replace(/\D/g, '')); clr('phone') }} />
        </Fld>
        <Fld label="Delivery address" error={errors.address}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <textarea style={{ ...inpStyle, resize: 'none', paddingRight: 40 }} rows={2} placeholder="House no., street, area..." value={form.address} onChange={e => { upd('address', e.target.value); clr('address') }} />
            <button onClick={handleDetectLocation} style={{ position: 'absolute', right: 8, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>{locLoading ? '…' : '📍'}</button>
          </div>
          <div style={{ height: '220px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '0.5px solid var(--border)', zIndex: 0 }}>
            <MapContainer center={[26.9124, 75.7873]} zoom={12} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
              <LocationPicker position={coords} setPosition={setCoords} />
            </MapContainer>
          </div>
        </Fld>
      </Sec>

      <Sec title="Delivery slot">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {['slot1', 'slot2'].map(s => (
            <button key={s} onClick={() => upd('slot', s)} style={{ padding: '12px', borderRadius: 8, border: `1px solid ${form.slot === s ? AMB : 'var(--border)'}`, background: form.slot === s ? AMB_BG : 'var(--bg-primary)', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: form.slot === s ? AMB_DARK : 'var(--text-primary)' }}>{s === 'slot1' ? 'Slot 1' : 'Slot 2'}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{s === 'slot1' ? 'Morning' : 'Afternoon'}</div>
            </button>
          ))}
        </div>
        <Fld label="Delivery date">
          <input style={inpStyle} type="date" value={form.date} min={todayStr()} onChange={e => upd('date', e.target.value)} />
        </Fld>
      </Sec>

      <Sec title="Menu items">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {menu.map(item => {
            const qty = form.items[item] || 0
            return (
              <div key={item} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, border: `0.5px solid ${qty > 0 ? AMB : 'var(--border)'}`, background: qty > 0 ? AMB_BG : 'var(--bg-primary)' }}>
                <span style={{ fontSize: '14px', fontWeight: qty > 0 ? 500 : 400 }}>{item}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {qty > 0 && <button onClick={() => updateQty(item, -1)} style={{ width: 28, height: 28, borderRadius: '50%', border: '0.5px solid var(--border-med)', background: 'white', cursor: 'pointer' }}>−</button>}
                  {qty > 0 && <span style={{ fontWeight: 500, fontSize: '14px' }}>{qty}</span>}
                  <button onClick={() => updateQty(item, 1)} style={{ width: 28, height: 28, borderRadius: '50%', border: `0.5px solid ${qty > 0 ? AMB : 'var(--border-med)'}`, background: qty > 0 ? AMB : 'white', color: qty > 0 ? 'white' : 'black', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            )
          })}
        </div>
        {errors.items && <p style={{ color: '#A32D2D', fontSize: '12px', marginTop: 5 }}>{errors.items}</p>}
      </Sec>

      <Sec title="Special instructions" optional>
        <textarea style={{ ...inpStyle, resize: 'none' }} placeholder="Any special requests?" rows={2} value={form.notes} onChange={e => upd('notes', e.target.value)} />
      </Sec>

      <button onClick={handleSubmit} disabled={busy} style={{ ...btnPrimary, width: '100%', padding: '12px', fontSize: '15px' }}>
        {busy ? 'Placing order...' : 'Place Order'}
      </button>
    </div>
  )
}

// ── Admin View (Simplified for UI consistency) ────────────────────────────────
function AdminView({ orders, menu, setOrders, setMenu, onLock }) {
  const [tab, setTab] = useState('orders')
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <button onClick={() => setTab('orders')} style={{ padding: '10px 0', border: 'none', borderBottom: tab === 'orders' ? `2px solid ${AMB}` : 'none', background: 'none', cursor: 'pointer', fontWeight: tab === 'orders' ? 500 : 400 }}>Orders ({orders.length})</button>
        <button onClick={onLock} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>Lock Dashboard</button>
      </div>
      {tab === 'orders' ? <p>Check your Google Sheet for detailed order management.</p> : null}
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('customer')
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [orders, setOrders] = useState([])
  const [menu, setMenu] = useState(DEFAULT_MENU)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadData() }, [])
  async function loadData() {
    if (!SCRIPT_URL) { setLoading(false); return }
    try {
      const [o, m] = await Promise.all([apiGet({ action: 'getOrders' }), apiGet({ action: 'getMenu' })])
      setOrders(Array.isArray(o) ? o : [])
      setMenu(Array.isArray(m) && m.length ? m : DEFAULT_MENU)
    } catch { setError('Connection failed. Check VITE_SCRIPT_URL.') }
    setLoading(false)
  }

  async function handleNewOrder(order) {
    const newOrder = { ...order, id: genId(), createdAt: new Date().toISOString(), status: 'new' }
    setOrders(prev => [...prev, newOrder])
    await apiPost('submitOrder', { order: newOrder })
  }

  if (loading) return <Spinner />
  return (
    <div style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
      <header style={{ background: 'var(--bg-primary)', borderBottom: '0.5px solid var(--border)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ fontWeight: 600, color: AMB }}>TiffinBox</span>
        <div style={{ display: 'flex', gap: 5, background: 'var(--bg-secondary)', padding: 3, borderRadius: 8 }}>
          <button onClick={() => setView('customer')} style={{ padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: view === 'customer' ? 'white' : 'transparent', fontSize: '13px' }}>Order</button>
          <button onClick={() => setView('admin')} style={{ padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: view === 'admin' ? 'white' : 'transparent', fontSize: '13px' }}>Admin</button>
        </div>
      </header>
      {view === 'customer' ? <CustomerForm menu={menu} onSubmit={handleNewOrder} /> : (adminUnlocked ? <AdminView orders={orders} menu={menu} setOrders={setOrders} onLock={() => setAdminUnlocked(false)} /> : <p style={{ textAlign: 'center', marginTop: 50 }}>Enter PIN to unlock admin view.</p>)}
    </div>
  )
}
