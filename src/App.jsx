import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

// ── Leaflet Icon Fix ──────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function LocationPicker({ position, setPosition }) {
  useMapEvents({
    click(e) { setPosition(e.latlng) },
  })
  return position === null ? null : <Marker position={position}></Marker>
}

// ── Config & Styles ───────────────────────────────────────────────────────────
const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL
const SLOT_LABELS = { slot1: 'Slot 1 — Morning', slot2: 'Slot 2 — Afternoon' }
const STATUS = {
  new: { label: 'New', text: '#3B6D11', bg: '#EAF3DE' },
  confirmed: { label: 'Confirmed', text: '#185FA5', bg: '#E6F1FB' },
  dispatched: { label: 'Out for Delivery', text: '#854F0B', bg: '#FAEEDA' },
  delivered: { label: 'Delivered', text: '#0F6E56', bg: '#E1F5EE' },
  cancelled: { label: 'Cancelled', text: '#A32D2D', bg: '#FCEBEB' },
}
const DEFAULT_MENU = ['Dal Tadka + Rice', 'Rajma Chawal', 'Chole + Puri', 'Paneer Butter Masala + Roti', 'Mix Veg + Chapati', 'Special Thali', 'Biryani (Veg)', 'Aloo Gobhi + Roti']
const AMB = '#BA7517', AMB_BG = '#FAEEDA', AMB_DARK = '#633806'

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtDate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }
function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

async function apiGet(params) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${SCRIPT_URL}?${qs}`, { redirect: 'follow' })
  return res.json()
}
async function apiPost(action, payload = {}) {
  const res = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...payload }), redirect: 'follow' })
  return res.json()
}

const inpStyle = { width: '100%', fontSize: '14px', padding: '9px 11px', borderRadius: '8px', border: '0.5px solid var(--border)', boxSizing: 'border-box', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }
const btnPrimary = { padding: '9px 18px', borderRadius: '8px', border: 'none', background: AMB, color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 500, fontFamily: 'inherit' }
const btnSecondary = { padding: '8px 14px', borderRadius: '8px', border: '0.5px solid var(--border-med)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }

function Badge({ status }) { const s = STATUS[status] || STATUS.new; return <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{s.label}</span> }
function Sec({ title, children, optional }) { return <div style={{ marginBottom: '1.5rem' }}><div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}><p style={{ fontWeight: 500, fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{title}</p>{optional && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>optional</span>}</div>{children}</div> }
function Fld({ label, children, error }) { return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 5 }}>{label}</label>{children}{error && <p style={{ color: '#A32D2D', fontSize: '12px', margin: '4px 0 0' }}>{error}</p>}</div> }
function Spinner() { return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}><div style={{ width: 28, height: 28, border: `3px solid ${AMB_BG}`, borderTopColor: AMB, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /><style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style></div> }
function ErrorBanner({ message, onRetry }) { return <div style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}><div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '2rem' }}><p style={{ fontWeight: 500, marginBottom: 8 }}>Could not connect</p><p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.6 }}>{message}</p><button onClick={onRetry} style={btnPrimary}>Try again</button></div></div> }

function SetupScreen() {
  return (
    <div style={{ maxWidth: 560, margin: '4rem auto', padding: '0 1.5rem' }}>
      <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)', borderRadius: 16, padding: '2rem' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 500, marginBottom: 8 }}>Setup required</h2>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Add your VITE_SCRIPT_URL in Vercel to connect your Google Sheet.</p>
      </div>
    </div>
  )
}

function PinGate({ onUnlock }) {
  const [digits, setDigits] = useState(['', '', '', '']); const [shake, setShake] = useState(false); const [busy, setBusy] = useState(false);
  const r0 = useRef(), r1 = useRef(), r2 = useRef(), r3 = useRef(); const refs = [r0, r1, r2, r3]
  function onDigit(i, val) { if (!/^\d?$/.test(val)) return; const next = [...digits]; next[i] = val; setDigits(next); if (val && i < 3) refs[i + 1].current?.focus(); if (next.every(d => d !== '')) submit(next.join('')) }
  async function submit(pin) { setBusy(true); try { const res = await apiGet({ action: 'checkPin', pin }); if (res.valid) { onUnlock(); return } } catch {} setShake(true); setDigits(['', '', '', '']); setTimeout(() => { setShake(false); setBusy(false); refs[0].current?.focus() }, 600) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '72vh' }}>
      <style>{`@keyframes tbox-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
      <div style={{ textAlign: 'center', maxWidth: 300, animation: shake ? 'tbox-shake 0.5s ease' : 'none' }}>
        <p style={{ fontWeight: 500, marginBottom: '1.5rem' }}>Admin access</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {digits.map((d, i) => (
            <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1} value={d} onChange={e => onDigit(i, e.target.value)} style={{ width: 50, height: 55, textAlign: 'center', fontSize: '20px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-primary)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Customer Form (WITH PRIVATE CACHE) ────────────────────────────────────────
function CustomerForm({ menu, onSubmit }) {
  const [form, setForm] = useState({ name: '', phone: '', address: '', slot: 'slot1', date: todayStr(), items: {}, notes: '' })
  const [submitted, setSubmitted] = useState(false); const [busy, setBusy] = useState(false); const [errors, setErrors] = useState({});
  const [locLoading, setLocLoading] = useState(false); const [coords, setCoords] = useState(null)

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const clr = k => setErrors(e => ({ ...e, [k]: '' }))

  // LOAD CACHE: Only looks at THIS specific phone/browser
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
    }, () => { alert('Location denied'); setLocLoading(false) })
  }

  function updateQty(item, delta) {
    setForm(f => {
      const items = { ...f.items }; const next = Math.max(0, (items[item] || 0) + delta)
      if (next === 0) delete items[item]; else items[item] = next
      return { ...f, items }
    }); clr('items')
  }

  async function handleSubmit() {
    const e = {}; 
    if (!form.name.trim()) e.name = 'Required'; 
    if (!/^[6-9]\d{9}$/.test(form.phone)) e.phone = 'Invalid phone'; 
    if (!form.address.trim()) e.address = 'Required'; 
    if (!Object.keys(form.items).length) e.items = 'Select items';
    if (Object.keys(e).length) { setErrors(e); return }

    setBusy(true)
    const orderData = { ...form, notes: coords ? `${form.notes} [GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]` : form.notes }

    // SAVE CACHE: Store details ONLY on this browser
    localStorage.setItem('tiffinbox_user', JSON.stringify({ name: form.name, phone: form.phone, address: form.address }))

    await onSubmit(orderData)
    setSubmitted(true); setBusy(false)
  }

  if (submitted) return <div style={{ textAlign: 'center', padding: '5rem 1rem' }}><h2>Order placed!</h2><button onClick={() => setSubmitted(false)} style={btnSecondary}>New Order</button></div>

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <Sec title="Your details">
        <Fld label="Full name" error={errors.name}>
          <input style={inpStyle} value={form.name} onChange={e => { upd('name', e.target.value); clr('name') }} />
        </Fld>
        <Fld label="Mobile" error={errors.phone}>
          <input style={inpStyle} value={form.phone} maxLength={10} onChange={e => { upd('phone', e.target.value.replace(/\D/g, '')); clr('phone') }} />
        </Fld>
        <Fld label="Address" error={errors.address}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <textarea style={inpStyle} rows={2} value={form.address} onChange={e => { upd('address', e.target.value); clr('address') }} />
            <button onClick={handleDetectLocation} style={{ position: 'absolute', right: 8, top: 8, background: 'none', border: 'none', cursor: 'pointer' }}>{locLoading ? '…' : '📍'}</button>
          </div>
          <div style={{ height: 200, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MapContainer center={[26.9124, 75.7873]} zoom={12} style={{ height: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <LocationPicker position={coords} setPosition={setCoords} />
            </MapContainer>
          </div>
        </Fld>
      </Sec>
      
      <Sec title="Menu">
        {menu.map(item => (
          <div key={item} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
            <span>{item}</span>
            <div>
              <button onClick={() => updateQty(item, -1)} style={{ width: 30 }}>-</button>
              <span style={{ margin: '0 10px' }}>{form.items[item] || 0}</span>
              <button onClick={() => updateQty(item, 1)} style={{ width: 30 }}>+</button>
            </div>
          </div>
        ))}
      </Sec>

      <button onClick={handleSubmit} disabled={busy} style={{ ...btnPrimary, width: '100%', marginTop: 20 }}>{busy ? 'Placing...' : 'Place Order'}</button>
    </div>
  )
}

// ── Admin & Rest of Code ──────────────────────────────────────────────────────
// (Simplified for space, ensure your AdminView and SettingsTab remain as they were)
function AdminView({ orders, menu, setOrders, onLock }) { return <div style={{ padding: 20 }}>Admin Dashboard (Orders: {orders.length}) <button onClick={onLock}>Lock</button></div> }

export default function App() {
  const [view, setView] = useState('customer'); const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [orders, setOrders] = useState([]); const [menu, setMenu] = useState(DEFAULT_MENU)
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null)

  useEffect(() => { loadData() }, [])
  async function loadData() {
    if (!SCRIPT_URL) { setLoading(false); return }
    try {
      const [o, m] = await Promise.all([apiGet({ action: 'getOrders' }), apiGet({ action: 'getMenu' })])
      setOrders(o || []); setMenu(m || DEFAULT_MENU)
    } catch { setError('Connection failed') }
    setLoading(false)
  }

  async function handleNewOrder(order) {
    const newOrder = { ...order, id: genId(), createdAt: new Date().toISOString(), status: 'new' }
    setOrders(prev => [...prev, newOrder])
    await apiPost('submitOrder', { order: newOrder })
  }

  if (!SCRIPT_URL) return <SetupScreen />
  if (loading) return <Spinner />
  if (error) return <ErrorBanner message={error} onRetry={loadData} />

  return (
    <div style={{ background: 'var(--bg-secondary)', minHeight: '100vh' }}>
      <Header view={view} onSwitch={setView} adminUnlocked={adminUnlocked} />
      {view === 'customer' ? <CustomerForm menu={menu} onSubmit={handleNewOrder} /> : !adminUnlocked ? <PinGate onUnlock={() => setAdminUnlocked(true)} /> : <AdminView orders={orders} menu={menu} setOrders={setOrders} onLock={() => setAdminUnlocked(false)} />}
    </div>
  )
}

function Header({ view, onSwitch, adminUnlocked }) {
  return (
    <div style={{ background: 'var(--bg-primary)', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontWeight: 700 }}>TiffinBox</span>
      <div>
        <button onClick={() => onSwitch('customer')} style={{ marginRight: 10 }}>Order</button>
        <button onClick={() => onSwitch('admin')}>Admin</button>
      </div>
    </div>
  )
}
