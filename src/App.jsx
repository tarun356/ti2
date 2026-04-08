import { useState, useEffect, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

// ── Config ────────────────────────────────────────────────────────────────────
const SCRIPT_URL   = import.meta.env.VITE_SCRIPT_URL
const MAPPLS_KEY   = import.meta.env.VITE_MAPPLS_KEY
const POLL_INTERVAL = 30_000 // admin refreshes every 30s
const UPI_ID       = import.meta.env.VITE_UPI_ID        // e.g. yourname@upi
const UPI_NAME     = import.meta.env.VITE_UPI_NAME || 'TiffinBox' // display name
const WA_NUMBER    = import.meta.env.VITE_WA_NUMBER     // e.g. 919876543210 (with country code, no +)
const ORDER_POLL_INTERVAL = 15_000 // customer order tracker polls every 15s

const SLOT_LABELS = { slot1: 'Slot 1 — Morning', slot2: 'Slot 2 — Afternoon' }
const STATUS = {
  new:        { label: 'New',              text: '#3B6D11', bg: '#EAF3DE' },
  confirmed:  { label: 'Confirmed',        text: '#185FA5', bg: '#E6F1FB' },
  dispatched: { label: 'Out for Delivery', text: '#854F0B', bg: '#FAEEDA' },
  delivered:  { label: 'Delivered',        text: '#0F6E56', bg: '#E1F5EE' },
  cancelled:  { label: 'Cancelled',        text: '#A32D2D', bg: '#FCEBEB' },
}
const STATUS_STEPS = ['new','confirmed','dispatched','delivered']
const STATUS_ICONS = {
  new:        '🕐',
  confirmed:  '✅',
  dispatched: '🛵',
  delivered:  '🎉',
  cancelled:  '❌',
}

const DEFAULT_MENU = [
  'Dal Tadka + Rice','Rajma Chawal','Chole + Puri',
  'Paneer Butter Masala + Roti','Mix Veg + Chapati',
  'Special Thali','Biryani (Veg)','Aloo Gobhi + Roti',
]

// All accent colors as CSS custom properties so dark mode works properly
const CSS = `
  :root {
    --amb: #BA7517;
    --amb-bg: rgba(186,117,23,0.12);
    --amb-dark: #7a4a0a;
    --amb-text: #854d0e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --amb: #e09a2b;
      --amb-bg: rgba(186,117,23,0.18);
      --amb-dark: #f5c87a;
      --amb-text: #f5c87a;
    }
  }
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes tbox-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
  @keyframes tbox-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  @keyframes tbox-slide-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
`

function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6) }
function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtDate(d) {
  try { return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }
  catch { return d }
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) }
  catch { return '' }
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet(params) {
  const res = await fetch(`${SCRIPT_URL}?${new URLSearchParams(params)}`,{redirect:'follow'})
  return res.json()
}
async function apiPost(action, payload={}) {
  const res = await fetch(SCRIPT_URL,{
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action,...payload}), redirect:'follow',
  })
  return res.json()
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
const inp = {
  width:'100%',fontSize:'14px',padding:'9px 11px',borderRadius:'8px',
  border:'0.5px solid var(--border)',boxSizing:'border-box',
  background:'var(--bg-primary)',color:'var(--text-primary)',
  outline:'none',fontFamily:'inherit',
}
const btnP = {padding:'9px 18px',borderRadius:'8px',border:'none',background:'var(--amb)',color:'white',cursor:'pointer',fontSize:'14px',fontWeight:500,fontFamily:'inherit'}
const btnS = {padding:'8px 14px',borderRadius:'8px',border:'0.5px solid var(--border-med)',background:'var(--bg-primary)',color:'var(--text-primary)',cursor:'pointer',fontSize:'13px',fontFamily:'inherit'}

function Badge({status}) {
  const s=STATUS[status]||STATUS.new
  return <span style={{fontSize:'11px',padding:'3px 8px',borderRadius:4,background:s.bg,color:s.text,fontWeight:500,whiteSpace:'nowrap'}}>{s.label}</span>
}
function Sec({title,children,optional}) {
  return (
    <div style={{marginBottom:'1.5rem'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:10}}>
        <p style={{fontWeight:500,fontSize:'11px',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.07em',margin:0}}>{title}</p>
        {optional&&<span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>optional</span>}
      </div>
      {children}
    </div>
  )
}
function Fld({label,children,error}) {
  return (
    <div style={{marginBottom:10}}>
      <label style={{display:'block',fontSize:'13px',color:'var(--text-secondary)',marginBottom:5}}>{label}</label>
      {children}
      {error&&<p style={{color:'#e05555',fontSize:'12px',margin:'4px 0 0'}}>{error}</p>}
    </div>
  )
}
function Spinner() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh'}}>
      <div style={{width:28,height:28,border:'3px solid var(--amb-bg)',borderTopColor:'var(--amb)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
    </div>
  )
}
function ErrorBanner({message,onRetry}) {
  return (
    <div style={{maxWidth:480,margin:'4rem auto',padding:'0 1rem',textAlign:'center'}}>
      <div style={{background:'var(--bg-primary)',border:'0.5px solid var(--border)',borderRadius:16,padding:'2rem'}}>
        <p style={{fontWeight:500,marginBottom:8,color:'var(--text-primary)'}}>Could not connect</p>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'1.25rem',lineHeight:1.6}}>{message}</p>
        <button onClick={onRetry} style={btnP}>Try again</button>
      </div>
    </div>
  )
}
function SetupScreen() {
  return (
    <div style={{maxWidth:560,margin:'4rem auto',padding:'0 1.5rem'}}>
      <div style={{background:'var(--bg-primary)',border:'0.5px solid var(--border)',borderRadius:16,padding:'2rem'}}>
        <div style={{width:48,height:48,borderRadius:10,background:'var(--amb)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'1.25rem'}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <h2 style={{fontSize:'18px',fontWeight:500,marginBottom:8,color:'var(--text-primary)'}}>One more step</h2>
        <p style={{fontSize:'14px',color:'var(--text-secondary)',marginBottom:'1.5rem',lineHeight:1.7}}>Add your Google Apps Script URL to connect the app to your Google Sheet database.</p>
        <div style={{background:'var(--bg-secondary)',borderRadius:10,padding:'1rem 1.25rem',marginBottom:'1.5rem'}}>
          {['Deploy apps-script/Code.gs to your Google Sheet (see README)','Copy the deployment URL from Apps Script','In Vercel → Environment Variables, add VITE_SCRIPT_URL = your Apps Script URL','Also add VITE_MAPPLS_KEY = your Mappls REST key','Add VITE_UPI_ID (e.g. yourname@upi), VITE_UPI_NAME, VITE_WA_NUMBER (country code + number)','Redeploy the project'].map((step,i)=>(
            <div key={i} style={{display:'flex',gap:10,marginBottom:8,fontSize:'13px'}}>
              <span style={{width:20,height:20,borderRadius:'50%',background:'var(--amb-bg)',color:'var(--amb-text)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:500,flexShrink:0}}>{i+1}</span>
              <span style={{color:'var(--text-primary)',lineHeight:1.5}}>{step}</span>
            </div>
          ))}
        </div>
        <p style={{fontSize:'12px',color:'var(--text-tertiary)'}}>See README.md for detailed instructions.</p>
      </div>
    </div>
  )
}

// ── Mappls map SDK loader ─────────────────────────────────────────────────────
let mapplsScriptPromise = null
function loadMapplsSDK() {
  if (mapplsScriptPromise) return mapplsScriptPromise
  mapplsScriptPromise = new Promise((resolve, reject) => {
    if (window.mappls) { resolve(window.mappls); return }
    // Inject required Mappls CSS stylesheet
    if (!document.getElementById('mappls-css')) {
      const link = document.createElement('link')
      link.id = 'mappls-css'
      link.rel = 'stylesheet'
      link.href = 'https://apis.mappls.com/advancedmaps/api/map_sdk_plugins/v3.0.0/map.css'
      document.head.appendChild(link)
    }
    const s = document.createElement('script')
    // v3 SDK: key passed as access_token query param, not in URL path
    s.src = `https://apis.mappls.com/advancedmaps/api/map_sdk_plugins/v3.0.0/map.js?access_token=${MAPPLS_KEY}&libraries=`
    s.async = true
    s.onload = () => {
      const wait = setInterval(() => {
        if (window.mappls) { clearInterval(wait); resolve(window.mappls) }
      }, 150)
      setTimeout(() => { clearInterval(wait); reject(new Error('Mappls SDK timeout')) }, 10000)
    }
    s.onerror = () => reject(new Error('Mappls SDK failed to load'))
    document.head.appendChild(s)
  })
  return mapplsScriptPromise
}

// ── Customer: Map Pin Picker Modal ────────────────────────────────────────────
function MapPickerModal({ initialPin, onConfirm, onClose }) {
  const mapRef    = useRef(null)
  const markerRef = useRef(null)
  const [pin, setPin]         = useState(initialPin || null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!MAPPLS_KEY) { setError('Mappls key not configured.'); setLoading(false); return }
    loadMapplsSDK().then(mappls => {
      if (cancelled || !mapRef.current) return
      const defaultCenter = initialPin ? [initialPin.lat, initialPin.lng] : [28.6139, 77.2090]
      const map = new mappls.Map(mapRef.current, {
        center: defaultCenter, zoom: initialPin ? 16 : 12, search: false,
      })
      map.on('load', () => {
        if (cancelled) return
        setLoading(false)
        const startLat = initialPin ? initialPin.lat : 28.6139
        const startLng = initialPin ? initialPin.lng : 77.2090
        const marker = new mappls.Marker({ map, position: { lat: startLat, lng: startLng }, draggable: true })
        markerRef.current = marker
        if (initialPin) setPin(initialPin)
        marker.on('dragend', () => {
          const pos = marker.getPosition()
          setPin({ lat: pos.lat, lng: pos.lng })
        })
        map.on('click', e => {
          const lat = e.lngLat ? e.lngLat.lat : e.lat
          const lng = e.lngLat ? e.lngLat.lng : e.lng
          marker.setPosition({ lat, lng })
          setPin({ lat, lng })
        })
      })
    }).catch(() => { setError('Could not load map. Check your Mappls key.'); setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'1rem'}}>
      <div style={{background:'var(--bg-primary)',borderRadius:16,border:'0.5px solid var(--border)',width:'100%',maxWidth:540,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1rem 1.25rem',borderBottom:'0.5px solid var(--border)'}}>
          <div>
            <p style={{fontWeight:500,fontSize:'15px',margin:0,color:'var(--text-primary)'}}>Pin your delivery location</p>
            <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:'3px 0 0'}}>Drag the pin or tap the map to place it exactly</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'var(--text-secondary)',padding:'0 4px',lineHeight:1}}>×</button>
        </div>
        <div style={{position:'relative',height:360}}>
          {loading && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-secondary)',zIndex:1}}>
              <div style={{width:24,height:24,border:'3px solid var(--amb-bg)',borderTopColor:'var(--amb)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
            </div>
          )}
          {error && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-secondary)',zIndex:1}}>
              <p style={{fontSize:'13px',color:'#e05555',textAlign:'center',padding:'1rem'}}>{error}</p>
            </div>
          )}
          <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
        </div>
        <div style={{padding:'0.875rem 1.25rem',borderTop:'0.5px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0,flex:1}}>
            {pin
              ? <span style={{color:'var(--amb-text)',fontWeight:500}}>📍 Pin set ({pin.lat.toFixed(5)}, {pin.lng.toFixed(5)})</span>
              : 'No pin placed yet — tap the map'}
          </p>
          <div style={{display:'flex',gap:8}}>
            <button onClick={onClose} style={btnS}>Cancel</button>
            <button onClick={()=>pin&&onConfirm(pin)} disabled={!pin}
              style={{...btnP,opacity:pin?1:0.5,cursor:pin?'pointer':'not-allowed'}}>
              Confirm pin
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Admin: View Pin Modal ─────────────────────────────────────────────────────
function AdminMapModal({ pin, customerName, onClose }) {
  const mapRef              = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!MAPPLS_KEY) { setError('Mappls key not configured.'); setLoading(false); return }
    loadMapplsSDK().then(mappls => {
      if (cancelled || !mapRef.current) return
      const map = new mappls.Map(mapRef.current, { center: [pin.lat, pin.lng], zoom: 16, search: false })
      map.on('load', () => {
        if (cancelled) return
        setLoading(false)
        new mappls.Marker({ map, position: { lat: pin.lat, lng: pin.lng } })
      })
    }).catch(() => { setError('Could not load map.'); setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,padding:'1rem'}}>
      <div style={{background:'var(--bg-primary)',borderRadius:16,border:'0.5px solid var(--border)',width:'100%',maxWidth:500,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1rem 1.25rem',borderBottom:'0.5px solid var(--border)'}}>
          <div>
            <p style={{fontWeight:500,fontSize:'15px',margin:0,color:'var(--text-primary)'}}>Delivery pin — {customerName}</p>
            <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:'3px 0 0'}}>{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'var(--text-secondary)',padding:'0 4px',lineHeight:1}}>×</button>
        </div>
        <div style={{position:'relative',height:340}}>
          {loading && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-secondary)',zIndex:1}}>
              <div style={{width:24,height:24,border:'3px solid var(--amb-bg)',borderTopColor:'var(--amb)',borderRadius:'50%',animation:'spin 0.7s linear infinite'}}/>
            </div>
          )}
          {error && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-secondary)',zIndex:1}}>
              <p style={{fontSize:'13px',color:'#e05555',padding:'1rem',textAlign:'center'}}>{error}</p>
            </div>
          )}
          <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
        </div>
        <div style={{padding:'0.875rem 1.25rem',borderTop:'0.5px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <a href={`https://maps.google.com/?q=${pin.lat},${pin.lng}`} target="_blank" rel="noopener noreferrer"
            style={{fontSize:'12px',color:'var(--amb)',textDecoration:'none',display:'flex',alignItems:'center',gap:4}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open in Google Maps
          </a>
          <button onClick={onClose} style={btnS}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── UPI QR code rendered on canvas (no external request, no CORS issues) ────
// Tiny QR encoder using the qrcodegen library loaded from CDN once
let qrLib = null
function loadQrLib() {
  if (qrLib) return Promise.resolve(qrLib)
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    s.onload = () => { qrLib = window.QRCode; res(qrLib) }
    s.onerror = rej
    document.head.appendChild(s)
  })
}
function UpiQR({ upiId, upiName, orderId }) {
  const divRef = useRef(null)
  const upiLink = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&tn=TiffinBox+${orderId}&cu=INR`
  useEffect(() => {
    if (!divRef.current) return
    divRef.current.innerHTML = ''
    loadQrLib().then(QRCode => {
      new QRCode(divRef.current, {
        text: upiLink, width: 140, height: 140,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      })
    }).catch(() => {
      if (divRef.current) divRef.current.innerHTML = '<p style="font-size:11px;color:#999;text-align:center">QR unavailable</p>'
    })
  }, [upiLink])
  return (
    <div style={{display:'flex',justifyContent:'center'}}>
      <div ref={divRef} style={{borderRadius:8,overflow:'hidden',border:'0.5px solid var(--border)',display:'inline-block'}}/>
    </div>
  )
}

// ── Order Tracker (customer-side, Swiggy-style) ───────────────────────────────
function OrderTracker({orderId, initialStatus, slot, date, amount, onNewOrder}) {
  const [status, setStatus]   = useState(initialStatus || 'new')
  const [lastPoll, setLastPoll] = useState(null)
  const [payRedirected, setPayRedirected] = useState(false)
  const cancelled = status === 'cancelled'
  const delivered = status === 'delivered'
  const done      = cancelled || delivered

  // Poll the sheet every 15s until delivered or cancelled
  useEffect(()=>{
    if(done) return
    async function poll() {
      try {
        const res = await apiGet({action:'getOrderStatus', id: orderId})
        if(res.status) setStatus(res.status)
        setLastPoll(new Date())
      } catch {}
    }
    poll()
    const t = setInterval(poll, ORDER_POLL_INTERVAL)
    return ()=>clearInterval(t)
  },[orderId, done])

  // Persist latest known status to localStorage
  useEffect(()=>{
    try {
      const saved = JSON.parse(localStorage.getItem('tiffinbox_active_order')||'{}')
      if(saved.id===orderId) {
        localStorage.setItem('tiffinbox_active_order', JSON.stringify({...saved, status}))
      }
    } catch {}
  },[orderId, status])

  const steps = STATUS_STEPS
  const currentIdx = steps.indexOf(status)

  return (
    <div style={{maxWidth:480,margin:'3rem auto',padding:'0 1rem',animation:'tbox-slide-in 0.3s ease'}}>
      {/* Header card */}
      <div style={{background:'var(--bg-primary)',border:'0.5px solid var(--border)',borderRadius:16,padding:'1.75rem 1.5rem',marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.5rem'}}>
          <div>
            <p style={{fontWeight:500,fontSize:'18px',margin:'0 0 4px',color:'var(--text-primary)'}}>
              {cancelled ? 'Order cancelled' : delivered ? 'Delivered!' : 'Order placed!'}
            </p>
            <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:0}}>
              {SLOT_LABELS[slot]} · {fmtDate(date)}
            </p>
          </div>
          <span style={{fontSize:'28px'}}>{STATUS_ICONS[status]}</span>
        </div>

        {/* Progress steps */}
        {!cancelled && (
          <div style={{position:'relative'}}>
            {/* Connecting line */}
            <div style={{position:'absolute',top:14,left:14,right:14,height:2,background:'var(--border)',borderRadius:2}}/>
            <div style={{
              position:'absolute',top:14,left:14,height:2,borderRadius:2,
              background:'var(--amb)',
              width: currentIdx<=0?0:`${(currentIdx/(steps.length-1))*100}%`,
              transition:'width 0.6s ease',
            }}/>
            <div style={{display:'flex',justifyContent:'space-between',position:'relative'}}>
              {steps.map((step,i)=>{
                const done_step = i<=currentIdx
                const active    = i===currentIdx
                return (
                  <div key={step} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,flex:1}}>
                    <div style={{
                      width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                      background: done_step?'var(--amb)':'var(--bg-secondary)',
                      border: `2px solid ${done_step?'var(--amb)':'var(--border)'}`,
                      transition:'all 0.4s ease',
                      animation: active&&!delivered?'tbox-pulse 2s ease infinite':'none',
                    }}>
                      {done_step
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        : <div style={{width:8,height:8,borderRadius:'50%',background:'var(--border)'}}/>
                      }
                    </div>
                    <span style={{fontSize:'10px',textAlign:'center',color:done_step?'var(--amb-text)':'var(--text-tertiary)',fontWeight:done_step?500:400,lineHeight:1.2}}>
                      {STATUS[step].label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {cancelled && (
          <div style={{background:'#fcebeb',borderRadius:8,padding:'10px 14px'}}>
            <p style={{fontSize:'13px',color:'#A32D2D',margin:0}}>Your order was cancelled. Please contact us if you have any questions.</p>
          </div>
        )}
      </div>

      {/* Status message */}
      {!done && (
        <div style={{background:'var(--bg-primary)',border:'0.5px solid var(--border)',borderRadius:12,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'var(--amb)',flexShrink:0,animation:'tbox-pulse 2s ease infinite'}}/>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:0}}>
            {status==='new' && 'Waiting for confirmation…'}
            {status==='confirmed' && 'Your order is confirmed and being prepared.'}
            {status==='dispatched' && 'Your food is on its way!'}
          </p>
          {lastPoll && <span style={{fontSize:'11px',color:'var(--text-tertiary)',marginLeft:'auto',flexShrink:0}}>Updated {fmtTime(lastPoll.toISOString())}</span>}
        </div>
      )}

      {/* ── UPI Payment Panel ── */}
      {!cancelled && UPI_ID && (
        <div style={{background:'var(--bg-primary)',border:`0.5px solid ${payRedirected?'#86efac':'var(--border)'}`,borderRadius:12,padding:'1rem 1.25rem',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div>
              <p style={{fontWeight:500,fontSize:'13px',margin:'0 0 2px',color:'var(--text-primary)'}}>Pay via UPI</p>
              <p style={{fontSize:'11px',color:'var(--text-tertiary)',margin:0,fontFamily:'monospace'}}>{UPI_ID}</p>
            </div>
            {payRedirected && <span style={{fontSize:'11px',color:'#059669',fontWeight:500}}>✓ Recorded</span>}
          </div>
          {/* QR — rendered on a canvas using a tiny inline QR library so no external image request */}
          <UpiQR upiId={UPI_ID} upiName={UPI_NAME} orderId={orderId}/>
          <p style={{fontSize:'11px',color:'var(--text-secondary)',margin:'10px 0 10px',textAlign:'center'}}>
            Scan above, or open your UPI app directly:
          </p>
          {/* Per-app deep link buttons — no amount so customer types it in their app */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              {name:'Google Pay',  color:'#4285F4', scheme:`gpay://upi/pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`,      fallback:`tez://upi/pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`},
              {name:'PhonePe',     color:'#5F259F', scheme:`phonepe://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`,        fallback:null},
              {name:'Paytm',       color:'#00BAF2', scheme:`paytmmp://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`,        fallback:`paytm://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`},
              {name:'BHIM / Other',color:'#FF6600', scheme:`upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&tn=TiffinBox+${orderId}&cu=INR`,            fallback:null},
            ].map(app=>(
              <button key={app.name}
                onClick={async()=>{
                  try { await apiPost('logPaymentRedirect',{orderId, timestamp:new Date().toISOString(), app:app.name}) } catch {}
                  setPayRedirected(true)
                  window.location.href = app.scheme
                  // Fallback after 1.5s if app not installed
                  if(app.fallback) setTimeout(()=>{ window.location.href=app.fallback },1500)
                }}
                style={{padding:'10px 8px',borderRadius:8,border:`1.5px solid ${app.color}22`,
                  background:`${app.color}11`,cursor:'pointer',fontFamily:'inherit',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:6,
                  fontSize:'12px',fontWeight:500,color:app.color}}>
                <span style={{width:8,height:8,borderRadius:'50%',background:app.color,flexShrink:0}}/>
                {app.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button onClick={onNewOrder} style={{...btnS,width:'100%',textAlign:'center'}}>
        {done?'Place another order':'Place a new order'}
      </button>

      {/* ── WhatsApp FAB ── */}
      {WA_NUMBER && (
        <a href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hi! I have a query about my TiffinBox order #'+orderId)}`}
          target="_blank" rel="noopener noreferrer"
          style={{position:'fixed',bottom:24,right:20,width:52,height:52,borderRadius:'50%',
            background:'#25D366',display:'flex',alignItems:'center',justifyContent:'center',
            boxShadow:'0 4px 16px rgba(0,0,0,0.22)',zIndex:500,textDecoration:'none'}}>
          <svg width="26" height="26" viewBox="0 0 32 32" fill="white">
            <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.832 4.584 2.22 6.34L4.06 28l6.82-2.14A11.94 11.94 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3zm0 2c5.523 0 10 4.477 10 10S21.523 25 16 25c-1.87 0-3.62-.516-5.11-1.41l-.37-.22-3.84 1.2 1.23-3.73-.25-.39A9.953 9.953 0 016 15c0-5.523 4.477-10 10-10zm-3.15 5.5c-.22 0-.57.08-.87.4-.3.32-1.14 1.11-1.14 2.71s1.17 3.15 1.33 3.37c.16.21 2.27 3.6 5.6 4.9 2.78 1.09 3.34.87 3.94.82.6-.05 1.94-.79 2.21-1.56.28-.77.28-1.43.2-1.57-.08-.13-.3-.21-.63-.37-.33-.16-1.94-.96-2.24-1.07-.3-.11-.51-.16-.73.16-.21.32-.83 1.07-1.02 1.29-.19.21-.38.24-.71.08-.33-.16-1.39-.51-2.65-1.63-.98-.87-1.64-1.94-1.83-2.27-.19-.33-.02-.51.14-.67.15-.15.33-.38.5-.57.16-.19.21-.32.32-.54.1-.21.05-.4-.03-.57-.08-.16-.72-1.77-.99-2.42-.26-.63-.53-.55-.73-.56-.19-.01-.4-.01-.62-.01z"/>
          </svg>
        </a>
      )}
    </div>
  )
}

// ── PIN Gate ──────────────────────────────────────────────────────────────────
function PinGate({onUnlock}) {
  const [digits,setDigits]=useState(['','','',''])
  const [shake,setShake]=useState(false)
  const [busy,setBusy]=useState(false)
  const r0=useRef(),r1=useRef(),r2=useRef(),r3=useRef()
  const refs=[r0,r1,r2,r3]

  function onDigit(i,val) {
    if(!/^\d?$/.test(val)) return
    const next=[...digits];next[i]=val;setDigits(next)
    if(val&&i<3) refs[i+1].current?.focus()
    if(next.every(d=>d!=='')) submit(next.join(''))
  }
  function onKey(i,e) { if(e.key==='Backspace'&&!digits[i]&&i>0) refs[i-1].current?.focus() }
  async function submit(pin) {
    setBusy(true)
    try { const res=await apiGet({action:'checkPin',pin}); if(res.valid){onUnlock();return} } catch {}
    setShake(true);setDigits(['','','',''])
    setTimeout(()=>{setShake(false);setBusy(false);refs[0].current?.focus()},600)
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'72vh'}}>
      <div style={{textAlign:'center',maxWidth:300,padding:'0 1rem'}}>
        <div style={{width:56,height:56,borderRadius:'50%',background:'var(--amb-bg)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 1.25rem'}}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--amb)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <p style={{fontWeight:500,fontSize:'17px',margin:'0 0 6px',color:'var(--text-primary)'}}>Admin access</p>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:'0 0 1.75rem'}}>Enter your 4-digit PIN to continue</p>
        <div style={{display:'flex',gap:12,justifyContent:'center',marginBottom:'1rem',animation:shake?'tbox-shake 0.5s ease':'none',opacity:busy?0.6:1}}>
          {digits.map((d,i)=>(
            <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1} value={d} disabled={busy}
              onChange={e=>onDigit(i,e.target.value)} onKeyDown={e=>onKey(i,e)}
              style={{width:54,height:58,textAlign:'center',fontSize:'24px',borderRadius:10,
                border:`1.5px solid ${d?'var(--amb)':'var(--border)'}`,
                background:d?'var(--amb-bg)':'var(--bg-primary)',
                color:'var(--text-primary)',outline:'none',fontFamily:'inherit',caretColor:'transparent'}}/>
          ))}
        </div>
        {shake&&<p style={{fontSize:'12px',color:'#e05555',margin:'0 0 8px'}}>Incorrect PIN. Try again.</p>}
        <p style={{fontSize:'11px',color:'var(--text-tertiary)',marginTop:'1.5rem'}}>Default PIN is 1234 — change it in Admin → Settings</p>
      </div>
    </div>
  )
}

// ── Customer Form ─────────────────────────────────────────────────────────────
function CustomerForm({menu,onSubmit}) {
  const [form,setForm]=useState({name:'',phone:'',address:'',slot:'slot1',date:todayStr(),items:{},notes:''})
  // activeOrder: { id, status, slot, date } — shown after submit, persisted in localStorage
  const [activeOrder,setActiveOrder]=useState(null)
  const [busy,setBusy]=useState(false)
  const [errors,setErrors]=useState({})
  const [locLoading,setLocLoading]=useState(false)
  const [mapPin,setMapPin]=useState(null)       // { lat, lng } — independent of text address
  const [showMapPicker,setShowMapPicker]=useState(false)
  const [repeatCount,setRepeatCount]=useState(1)

  const upd=(k,v)=>setForm(f=>({...f,[k]:v}))
  const clr=k=>setErrors(e=>({...e,[k]:''}))

  // Restore profile and any active order from localStorage
  useEffect(()=>{
    try {
      const saved=localStorage.getItem('tiffinbox_user')
      if(saved) {
        const {name,phone,address}=JSON.parse(saved)
        setForm(f=>({...f,name:name||'',phone:phone||'',address:address||''}))
      }
    } catch {}
    try {
      const saved=JSON.parse(localStorage.getItem('tiffinbox_active_order')||'null')
      // Only restore if not delivered/cancelled and placed today or future
      if(saved&&saved.id&&saved.date>=todayStr()&&saved.status!=='delivered'&&saved.status!=='cancelled') {
        setActiveOrder(saved)
      }
    } catch {}
  },[])

  function handleDetectLocation() {
    if(!navigator.geolocation){alert('Geolocation not supported');return}
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(
      async({coords:{latitude,longitude}})=>{
        try {
          let addr=`${latitude}, ${longitude}` // fallback
          if(MAPPLS_KEY) {
            // Correct Mappls REST reverse geocoding endpoint — key goes in the URL path, not as a query param
            const url=`https://apis.mapmyindia.com/advancedmaps/v1/${MAPPLS_KEY}/rev_geocode?lat=${latitude}&lng=${longitude}`
            const res=await fetch(url)
            const data=await res.json()
            const r=data?.results?.[0]
            if(r) {
              // Build address from individual fields for clean Indian address formatting
              addr=[r.houseNumber,r.houseName,r.street,r.subLocality,r.locality,r.city,r.state,r.pincode]
                .filter(Boolean).join(', ')
            }
          } else {
            // Fallback: Nominatim (OpenStreetMap) when no Mappls key is configured
            const url=`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
            const res=await fetch(url)
            const data=await res.json()
            addr=data.display_name||addr
          }
          upd('address',addr); clr('address')
        } catch { upd('address',`${latitude}, ${longitude}`) }
        setLocLoading(false)
      },
      ()=>{alert('Location access denied');setLocLoading(false)}
    )
  }

  function updateQty(item,delta) {
    setForm(f=>{
      const items={...f.items}
      const next=Math.max(0,(items[item]||0)+delta)
      if(next===0) delete items[item]; else items[item]=next
      return {...f,items}
    }); clr('items')
  }

  function validate() {
    const e={}
    if(!form.name.trim())                        e.name='Name is required'
    if(!/^[6-9]\d{9}$/.test(form.phone.trim())) e.phone='Enter a valid 10-digit mobile number'
    if(!form.address.trim())                     e.address='Delivery address is required'
    if(!Object.keys(form.items).length)          e.items='Please select at least one item'
    return e
  }

  async function handleSubmit() {
    const e=validate(); if(Object.keys(e).length){setErrors(e);return}
    setBusy(true)
    const name=form.name.trim(), phone=form.phone.trim(), address=form.address.trim()
    try { localStorage.setItem('tiffinbox_user',JSON.stringify({name,phone,address})) } catch {}
    const notes=form.notes.trim()
    // Place repeatCount identical orders; track only the last one in the tracker
    let lastOrder = null
    for(let i=0;i<repeatCount;i++){
      const suffix = repeatCount>1 ? ` (${i+1}/${repeatCount})` : ''
      lastOrder = await onSubmit({...form,name,phone,address,notes:notes+suffix,mapPin:mapPin||null})
    }
    const active = {id:lastOrder.id, status:'new', slot:form.slot, date:form.date, amount:lastOrder.amount||null}
    try { localStorage.setItem('tiffinbox_active_order', JSON.stringify(active)) } catch {}
    setActiveOrder(active)
    setBusy(false)
  }

  function handleNewOrder() {
    try { localStorage.removeItem('tiffinbox_active_order') } catch {}
    setActiveOrder(null)
    setForm(f=>({...f,items:{},notes:'',date:todayStr()}))
    setMapPin(null); setRepeatCount(1); setErrors({})
  }

  // Show tracker if there's an active order
  if(activeOrder) {
    return <OrderTracker
      orderId={activeOrder.id}
      initialStatus={activeOrder.status}
      slot={activeOrder.slot}
      date={activeOrder.date}
      amount={activeOrder.amount}
      onNewOrder={handleNewOrder}
    />
  }

  const totalItems=Object.values(form.items).reduce((a,b)=>a+b,0)

  return (
    <div style={{maxWidth:520,margin:'0 auto',padding:'1.5rem 1rem 4rem'}}>
      <div style={{marginBottom:'1.5rem'}}>
        <h2 style={{fontSize:'20px',fontWeight:500,margin:'0 0 4px',color:'var(--text-primary)'}}>Place your order</h2>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:0}}>We deliver twice daily — morning and afternoon</p>
      </div>

      <Sec title="Your details">
        <Fld label="Full name" error={errors.name}>
          <input style={inp} placeholder="e.g. Priya Sharma" value={form.name}
            onChange={e=>{upd('name',e.target.value);clr('name')}}/>
        </Fld>
        <Fld label="Mobile number" error={errors.phone}>
          <input style={inp} placeholder="10-digit number" value={form.phone} maxLength={10}
            onChange={e=>{upd('phone',e.target.value.replace(/\D/g,''));clr('phone')}}/>
        </Fld>
        <Fld label="Delivery address" error={errors.address}>
          <div style={{position:'relative'}}>
            <textarea style={{...inp,resize:'none',paddingRight:38}} placeholder="House no., street, area, landmark" rows={2}
              value={form.address} onChange={e=>{upd('address',e.target.value);clr('address')}}/>
            <button onClick={handleDetectLocation} title="Use my current location"
              style={{position:'absolute',right:8,top:8,background:'none',border:'none',cursor:'pointer',fontSize:'16px',lineHeight:1,padding:2,color:locLoading?'var(--text-tertiary)':'var(--amb)'}}>
              {locLoading?'…':'📍'}
            </button>
          </div>
        </Fld>
        {/* Map pin picker — independent of text address */}
        <div style={{marginTop:6}}>
          <button onClick={()=>setShowMapPicker(true)}
            style={{display:'flex',alignItems:'center',gap:7,padding:'8px 12px',borderRadius:8,
              border:`0.5px solid ${mapPin?'var(--amb)':'var(--border-med)'}`,
              background:mapPin?'var(--amb-bg)':'var(--bg-primary)',
              cursor:'pointer',fontSize:'13px',color:mapPin?'var(--amb-text)':'var(--text-secondary)',fontFamily:'inherit'}}>
            <span style={{fontSize:'15px'}}>🗺️</span>
            {mapPin ? `Pin set (${mapPin.lat.toFixed(4)}, ${mapPin.lng.toFixed(4)})` : 'Pick exact location on map'}
            {mapPin && (
              <span onClick={e=>{e.stopPropagation();setMapPin(null)}}
                style={{marginLeft:4,color:'var(--text-tertiary)',fontSize:'12px',lineHeight:1,cursor:'pointer'}}>✕</span>
            )}
          </button>
          <p style={{fontSize:'11px',color:'var(--text-tertiary)',margin:'4px 0 0'}}>
            Optional — separate from the written address above
          </p>
        </div>
      </Sec>

      <Sec title="Delivery details">
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          {['slot1','slot2'].map(s=>{
            const sel=form.slot===s
            return (
              <button key={s} onClick={()=>upd('slot',s)}
                style={{padding:'12px',borderRadius:8,
                  border:`${sel?'2px':'0.5px'} solid ${sel?'var(--amb)':'var(--border)'}`,
                  background:sel?'var(--amb-bg)':'var(--bg-primary)',cursor:'pointer',textAlign:'left'}}>
                <div style={{fontSize:'13px',fontWeight:500,color:sel?'var(--amb-text)':'var(--text-primary)'}}>{s==='slot1'?'Slot 1':'Slot 2'}</div>
                <div style={{fontSize:'12px',color:sel?'var(--amb)':'var(--text-secondary)',marginTop:2}}>{s==='slot1'?'Morning delivery':'Afternoon delivery'}</div>
              </button>
            )
          })}
        </div>
        <Fld label="Delivery date">
          <input style={inp} type="date" value={form.date} min={todayStr()} onChange={e=>upd('date',e.target.value)}/>
        </Fld>
      </Sec>

      <Sec title={`Choose items${totalItems>0?` · ${totalItems} selected`:''}`}>
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {menu.map(item=>{
            const qty=form.items[item]||0
            return (
              <div key={item} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderRadius:8,
                border:`0.5px solid ${qty>0?'var(--amb)':'var(--border)'}`,
                background:qty>0?'var(--amb-bg)':'var(--bg-primary)'}}>
                <span style={{fontSize:'14px',color:qty>0?'var(--amb-text)':'var(--text-primary)',fontWeight:qty>0?500:400}}>{item}</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {qty>0&&<>
                    <button onClick={()=>updateQty(item,-1)} style={{width:28,height:28,borderRadius:'50%',border:'0.5px solid var(--border-med)',background:'var(--bg-primary)',cursor:'pointer',fontSize:'16px',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-primary)'}}>−</button>
                    <span style={{fontWeight:500,minWidth:18,textAlign:'center',fontSize:'14px',color:'var(--amb-text)'}}>{qty}</span>
                  </>}
                  <button onClick={()=>updateQty(item,1)} style={{width:28,height:28,borderRadius:'50%',
                    border:`0.5px solid ${qty>0?'var(--amb)':'var(--border-med)'}`,
                    background:qty>0?'var(--amb)':'var(--bg-primary)',
                    cursor:'pointer',fontSize:'16px',display:'flex',alignItems:'center',justifyContent:'center',
                    color:qty>0?'white':'var(--text-primary)'}}>+</button>
                </div>
              </div>
            )
          })}
        </div>
        {errors.items&&<p style={{color:'#e05555',fontSize:'12px',margin:'6px 0 0'}}>{errors.items}</p>}
      </Sec>

      <Sec title="Special instructions" optional>
        <textarea style={{...inp,resize:'none'}} placeholder="Allergies, spice level, any requests…" rows={2}
          value={form.notes} onChange={e=>upd('notes',e.target.value)}/>
      </Sec>

      {/* Repeat order stepper */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:0,flex:1}}>How many orders?</p>
        <div style={{display:'flex',alignItems:'center',gap:8,background:'var(--bg-primary)',border:'0.5px solid var(--border)',borderRadius:8,padding:'4px 8px'}}>
          <button onClick={()=>setRepeatCount(c=>Math.max(1,c-1))}
            style={{width:26,height:26,borderRadius:'50%',border:'0.5px solid var(--border-med)',background:'var(--bg-secondary)',cursor:'pointer',fontSize:'16px',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-primary)',fontFamily:'inherit'}}>−</button>
          <span style={{fontWeight:500,minWidth:24,textAlign:'center',fontSize:'15px',color:'var(--text-primary)'}}>{repeatCount}</span>
          <button onClick={()=>setRepeatCount(c=>Math.min(10,c+1))}
            style={{width:26,height:26,borderRadius:'50%',border:'0.5px solid var(--amb)',background:'var(--amb)',cursor:'pointer',fontSize:'16px',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontFamily:'inherit'}}>+</button>
        </div>
      </div>
      <button onClick={handleSubmit} disabled={busy}
        style={{...btnP,width:'100%',padding:'12px',fontSize:'15px',opacity:busy?0.7:1,cursor:busy?'not-allowed':'pointer'}}>
        {busy?`Placing ${repeatCount>1?repeatCount+' orders':'order'}…`:`Place ${repeatCount>1?repeatCount+' orders':'order'}`}
      </button>

      {showMapPicker && (
        <MapPickerModal
          initialPin={mapPin}
          onConfirm={pin=>{setMapPin(pin);setShowMapPicker(false)}}
          onClose={()=>setShowMapPicker(false)}
        />
      )}
    </div>
  )
}


// ── Inline Date Picker ────────────────────────────────────────────────────────
function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const d = value ? new Date(value + 'T00:00:00') : new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const today = todayStr()
  const { year, month } = view
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']

  function selectDay(d) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    onChange(`${year}-${mm}-${dd}`)
    setOpen(false)
  }

  function prevMonth() {
    setView(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 })
  }
  function nextMonth() {
    setView(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 })
  }

  const displayLabel = value ? fmtDate(value) : 'All dates'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: '7px 10px', borderRadius: 8, border: `0.5px solid ${value ? 'var(--amb)' : 'var(--border)'}`,
          background: value ? 'var(--amb-bg)' : 'var(--bg-primary)', color: value ? 'var(--amb-text)' : 'var(--text-primary)',
          fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontWeight: value ? 500 : 400 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {displayLabel}
        {value && (
          <span onClick={e => { e.stopPropagation(); onChange('') }}
            style={{ marginLeft: 2, color: 'var(--text-tertiary)', fontSize: '12px', lineHeight: 1 }}>✕</span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 300,
          background: 'var(--bg-primary)', border: '0.5px solid var(--border)', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '12px', width: 240 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', padding: '2px 6px' }}>‹</button>
            <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', padding: '2px 6px' }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 500, padding: '2px 0' }}>{d}</div>)}
          </div>
          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {Array.from({ length: firstDay }).map((_, i) => <div key={'e' + i} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1
              const mm = String(month + 1).padStart(2, '0')
              const dd = String(d).padStart(2, '0')
              const dateStr = `${year}-${mm}-${dd}`
              const isSelected = dateStr === value
              const isToday    = dateStr === today
              return (
                <button key={d} onClick={() => selectDay(d)}
                  style={{ padding: '5px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '12px', textAlign: 'center',
                    background: isSelected ? 'var(--amb)' : isToday ? 'var(--amb-bg)' : 'transparent',
                    color: isSelected ? 'white' : isToday ? 'var(--amb-text)' : 'var(--text-primary)',
                    fontWeight: isSelected || isToday ? 500 : 400, fontFamily: 'inherit' }}>
                  {d}
                </button>
              )
            })}
          </div>
          {/* Today shortcut */}
          <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 8, paddingTop: 8, display: 'flex', gap: 6 }}>
            <button onClick={() => { onChange(today); setOpen(false) }}
              style={{ flex: 1, padding: '5px', borderRadius: 6, border: '0.5px solid var(--border-med)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>Today</button>
            <button onClick={() => { onChange(''); setOpen(false) }}
              style={{ flex: 1, padding: '5px', borderRadius: 6, border: '0.5px solid var(--border-med)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}>All dates</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Group repeat orders (same customer+items+slot+date within 60s) ───────────
function groupOrders(orders) {
  const groups = []
  const used = new Set()
  for (let i = 0; i < orders.length; i++) {
    if (used.has(orders[i].id)) continue
    const base = orders[i]
    const baseItems = JSON.stringify(base.items)
    const matches = [base]
    for (let j = i + 1; j < orders.length; j++) {
      if (used.has(orders[j].id)) continue
      const o = orders[j]
      const sameCustomer = o.name === base.name && o.phone === base.phone
      const sameItems    = JSON.stringify(o.items) === baseItems
      const sameSlot     = o.slot === base.slot && o.date === base.date
      const within60s    = Math.abs(new Date(o.createdAt) - new Date(base.createdAt)) < 60000
      if (sameCustomer && sameItems && sameSlot && within60s) { matches.push(o); used.add(o.id) }
    }
    used.add(base.id)
    groups.push({ ...base, _count: matches.length, _ids: matches.map(m => m.id) })
  }
  return groups
}

// ── Admin View ────────────────────────────────────────────────────────────────
function AdminView({orders,menu,setOrders,setMenu,onLock,onRefresh}) {
  const [tab,setTab]=useState('orders')
  const [filterDate,setFilterDate]=useState(todayStr())
  const [filterSlot,setFilterSlot]=useState('all')
  const [filterStatus,setFilterStatus]=useState('all')
  const [search,setSearch]=useState('')
  const [editOrder,setEditOrder]=useState(null)
  const [exporting,setExporting]=useState(false)
  const [selected,setSelected]=useState(new Set())
  const [saving,setSaving]=useState(null)
  const [refreshing,setRefreshing]=useState(false)
  const [viewPinOrder,setViewPinOrder]=useState(null)
  const [payLogs,setPayLogs]=useState([])
  const [payLogsLoaded,setPayLogsLoaded]=useState(false)

  async function manualRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }
  async function loadPayLogs() {
    if(payLogsLoaded) return
    try {
      const res = await apiGet({action:'getPaymentRedirects'})
      setPayLogs(Array.isArray(res)?res:[])
    } catch {}
    setPayLogsLoaded(true)
  }

  const filtered=orders.filter(o=>{
    if(filterDate&&o.date!==filterDate) return false
    if(filterSlot!=='all'&&o.slot!==filterSlot) return false
    if(filterStatus!=='all'&&o.status!==filterStatus) return false
    if(search){
      const s=search.toLowerCase()
      if(!o.name.toLowerCase().includes(s)&&!o.phone.includes(s)&&!o.address.toLowerCase().includes(s)) return false
    }
    return true
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))

  const tod=orders.filter(o=>o.date===todayStr())
  const stats=[
    {label:"Today's orders",val:tod.length},
    {label:'Slot 1',val:tod.filter(o=>o.slot==='slot1').length},
    {label:'Slot 2',val:tod.filter(o=>o.slot==='slot2').length},
    {label:'Active',val:tod.filter(o=>o.status!=='delivered'&&o.status!=='cancelled').length},
    {label:'Delivered',val:tod.filter(o=>o.status==='delivered').length},
  ]

  async function updateStatus(id,status){
    setOrders(p=>p.map(o=>o.id===id?{...o,status}:o))
    setSaving(id)
    try{await apiPost('updateField',{id,field:'status',value:status})}catch{}
    setSaving(null)
  }
  async function updatePayment(id,payment){
    setOrders(p=>p.map(o=>o.id===id?{...o,payment}:o))
    setSaving(id)
    try{await apiPost('updateField',{id,field:'payment',value:payment})}catch{}
    setSaving(null)
  }
  async function saveEdit(u){setOrders(p=>p.map(o=>o.id===u.id?u:o));setEditOrder(null);try{await apiPost('updateOrder',{order:u})}catch{}}
  async function deleteOrder(id){
    if(!confirm('Delete this order?'))return
    setOrders(p=>p.filter(o=>o.id!==id))
    setSelected(s=>{const n=new Set(s);n.delete(id);return n})
    try{await apiPost('deleteOrder',{id})}catch{}
  }
  async function bulkStatus(status){
    if(!selected.size)return
    const ids=[...selected]
    setOrders(p=>p.map(o=>ids.includes(o.id)?{...o,status}:o))
    setSelected(new Set())
    try{await apiPost('bulkStatus',{ids,status})}catch{}
  }
  async function bulkPayment(payment){
    if(!selected.size)return
    const ids=[...selected]
    setOrders(p=>p.map(o=>ids.includes(o.id)?{...o,payment}:o))
    setSelected(new Set())
    try{await Promise.all(ids.map(id=>apiPost('updateField',{id,field:'payment',value:payment})))}catch{}
  }

  function exportExcel(){
    setExporting(true)
    try {
      const rows=filtered.map(o=>({'Date':o.date,'Slot':SLOT_LABELS[o.slot],'Name':o.name,'Phone':`'${o.phone}`,'Address':o.address,'Items':Object.entries(o.items||{}).map(([k,v])=>`${k} x${v}`).join(', '),'Qty Total':Object.values(o.items||{}).reduce((a,b)=>a+b,0),'Notes':o.notes||'','Status':STATUS[o.status]?.label||o.status,'Payment':o.payment==='paid'?'Paid':'Pending','Ordered At':fmtTime(o.createdAt)}))
      const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[10,16,16,13,30,36,8,20,14,10,12].map(w=>({wch:w}))
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Orders');XLSX.writeFile(wb,`tiffinbox-${filterDate||'all'}.xlsx`)
    } catch {alert('Export failed')}
    setExporting(false)
  }

  const sel={padding:'7px 10px',borderRadius:8,border:'0.5px solid var(--border)',background:'var(--bg-primary)',color:'var(--text-primary)',fontSize:'13px',cursor:'pointer',outline:'none',fontFamily:'inherit'}
  const allSel=filtered.length>0&&filtered.every(o=>selected.has(o.id))
  function toggleAll(){
    if(allSel)setSelected(s=>{const n=new Set(s);filtered.forEach(o=>n.delete(o.id));return n})
    else setSelected(s=>{const n=new Set(s);filtered.forEach(o=>n.add(o.id));return n})
  }

  return (
    <div style={{maxWidth:1200,margin:'0 auto',padding:'1.5rem 1rem 4rem'}}>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:10,marginBottom:'1.5rem'}}>
        {stats.map(({label,val})=>(
          <div key={label} style={{background:'var(--bg-secondary)',borderRadius:8,padding:'12px 14px'}}>
            <div style={{fontSize:'11px',color:'var(--text-secondary)',marginBottom:5}}>{label}</div>
            <div style={{fontSize:'26px',fontWeight:500,color:'var(--text-primary)'}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Tabs + Lock + Refresh */}
      <div style={{display:'flex',alignItems:'center',borderBottom:'0.5px solid var(--border)',marginBottom:'1.25rem'}}>
        {[['orders','Orders'],['payments','Payment Redirects'],['settings','Menu & Settings']].map(([k,lbl])=>(
          <button key={k} onClick={()=>{setTab(k);if(k==='payments')loadPayLogs()}}
            style={{padding:'9px 16px',border:'none',background:'none',cursor:'pointer',fontSize:'14px',fontWeight:tab===k?500:400,color:tab===k?'var(--text-primary)':'var(--text-secondary)',borderBottom:tab===k?`2px solid var(--amb)`:'2px solid transparent',marginBottom:-1,fontFamily:'inherit'}}>
            {lbl}
          </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={manualRefresh} disabled={refreshing}
            style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-tertiary)',padding:'4px 8px',display:'flex',alignItems:'center',gap:5,fontSize:'12px',fontFamily:'inherit',opacity:refreshing?0.5:1}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{animation:refreshing?'spin 0.7s linear infinite':'none'}}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {refreshing?'Refreshing…':'Refresh'}
          </button>
          <button onClick={onLock} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-tertiary)',padding:'4px 8px',display:'flex',alignItems:'center',gap:5,fontSize:'12px',fontFamily:'inherit'}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Lock
          </button>
        </div>
      </div>

      {tab==='payments'?(
        <PaymentLogsTab logs={payLogs} loaded={payLogsLoaded} orders={orders} onReload={()=>{setPayLogsLoaded(false);loadPayLogs()}}/>
      ):tab==='orders'?(
        <>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:'1rem'}}>
            <DatePicker value={filterDate} onChange={setFilterDate}/>
            <select value={filterSlot} onChange={e=>setFilterSlot(e.target.value)} style={sel}>
              <option value="all">All slots</option><option value="slot1">Slot 1</option><option value="slot2">Slot 2</option>
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={sel}>
              <option value="all">All statuses</option>
              {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            <input placeholder="Search name, phone, address…" value={search} onChange={e=>setSearch(e.target.value)} style={{...sel,minWidth:200}}/>
            <div style={{marginLeft:'auto',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              {selected.size>0&&(
                <div style={{display:'flex',gap:5,alignItems:'center'}}>
                  <span style={{fontSize:'12px',color:'var(--text-secondary)'}}>{selected.size} selected</span>
                  {Object.entries(STATUS).map(([k,v])=>(
                    <button key={k} onClick={()=>bulkStatus(k)} style={{padding:'4px 8px',borderRadius:5,border:`0.5px solid ${v.text}`,background:v.bg,color:v.text,cursor:'pointer',fontSize:'11px',fontWeight:500,fontFamily:'inherit'}}>{v.label}</button>
                  ))}
                  <span style={{width:1,height:16,background:'var(--border)',display:'inline-block'}}/>
                  <button onClick={()=>bulkPayment('paid')} style={{padding:'4px 8px',borderRadius:5,border:'0.5px solid #6ee7b7',background:'#d1fae5',color:'#065f46',cursor:'pointer',fontSize:'11px',fontWeight:500,fontFamily:'inherit'}}>✓ Mark paid</button>
                  <button onClick={()=>bulkPayment('pending')} style={{padding:'4px 8px',borderRadius:5,border:'0.5px solid var(--border-med)',background:'var(--bg-secondary)',color:'var(--text-secondary)',cursor:'pointer',fontSize:'11px',fontFamily:'inherit'}}>Mark pending</button>
                </div>
              )}
              <button onClick={exportExcel} disabled={exporting} style={{...btnS,display:'flex',alignItems:'center',gap:6}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {exporting?'Exporting…':'Export Excel'}
              </button>
            </div>
          </div>

          {filtered.length===0?(
            <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--text-secondary)',background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)'}}>No orders match the selected filters</div>
          ):(
            <div style={{background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)',overflow:'hidden'}}>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                  <thead>
                    <tr style={{borderBottom:'0.5px solid var(--border)',background:'var(--bg-secondary)'}}>
                      <th style={{padding:'10px 12px',textAlign:'left'}}><input type="checkbox" checked={allSel} onChange={toggleAll} style={{cursor:'pointer'}}/></th>
                      {['Date / Time','Slot','Customer','Items','Status','Payment','Actions'].map(h=>(
                        <th key={h} style={{padding:'10px 12px',textAlign:'left',fontWeight:500,color:'var(--text-secondary)',whiteSpace:'nowrap',fontSize:'12px'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupOrders(filtered).map((o,i)=>(
                      <tr key={o.id} style={{borderBottom:i<filtered.length-1?'0.5px solid var(--border)':'none',background:selected.has(o.id)?'var(--amb-bg)':'transparent',opacity:saving===o.id?0.6:1,transition:'opacity 0.15s'}}>
                        <td style={{padding:'10px 12px'}}><input type="checkbox" checked={selected.has(o.id)} onChange={()=>setSelected(s=>{const n=new Set(s);n.has(o.id)?n.delete(o.id):n.add(o.id);return n})} style={{cursor:'pointer'}}/></td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                          <div style={{color:'var(--text-primary)'}}>{fmtDate(o.date)}</div>
                          <div style={{fontSize:'11px',color:'var(--text-tertiary)'}}>{fmtTime(o.createdAt)}</div>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <Badge status={o.slot==='slot1'?'confirmed':'dispatched'}/>
                          <div style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:3}}>{o.slot==='slot1'?'Morning':'Afternoon'}</div>
                        </td>
                        <td style={{padding:'10px 12px',minWidth:140}}>
                          <div style={{fontWeight:500,color:'var(--text-primary)'}}>{o.name}</div>
                          <div style={{color:'var(--text-secondary)',fontSize:'12px'}}>{o.phone}</div>
                          <div style={{color:'var(--text-tertiary)',fontSize:'11px',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.address}>{o.address}</div>
                        </td>
                        <td style={{padding:'10px 12px',minWidth:160}}>
                          {Object.entries(o.items||{}).map(([item,qty])=>(
                            <div key={item} style={{whiteSpace:'nowrap',fontSize:'12px',color:'var(--text-primary)'}}>{item} <span style={{color:'var(--text-secondary)'}}>×{qty}</span></div>
                          ))}
                          {o.notes&&<div style={{color:'var(--text-tertiary)',fontStyle:'italic',fontSize:'11px',marginTop:2}}>{o.notes}</div>}
                          {o._count>1&&<div style={{marginTop:4,display:'inline-flex',alignItems:'center',gap:4,background:'var(--amb-bg)',color:'var(--amb-text)',fontSize:'10px',fontWeight:600,padding:'2px 6px',borderRadius:4}}>×{o._count} orders</div>}
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <select value={o.status} onChange={e=>updateStatus(o.id,e.target.value)}
                            style={{fontSize:'12px',padding:'4px 7px',borderRadius:5,border:'0.5px solid var(--border)',background:STATUS[o.status]?.bg||'var(--bg-secondary)',color:STATUS[o.status]?.text||'var(--text-primary)',cursor:'pointer',outline:'none',fontFamily:'inherit',fontWeight:500}}>
                            {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <button onClick={()=>updatePayment(o.id,o.payment==='paid'?'pending':'paid')}
                            style={{padding:'4px 10px',borderRadius:6,border:`0.5px solid ${o.payment==='paid'?'#6ee7b7':'var(--border-med)'}`,background:o.payment==='paid'?'#d1fae5':'var(--bg-secondary)',color:o.payment==='paid'?'#065f46':'var(--text-secondary)',cursor:'pointer',fontSize:'12px',fontWeight:o.payment==='paid'?500:400,fontFamily:'inherit',whiteSpace:'nowrap'}}>
                            {o.payment==='paid'?'✓ Paid':'Pending'}
                          </button>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',gap:5}}>
                            {o.mapPin&&<button onClick={()=>setViewPinOrder(o)} style={{padding:'4px 10px',borderRadius:6,border:'0.5px solid var(--amb)',background:'var(--amb-bg)',cursor:'pointer',fontSize:'12px',fontFamily:'inherit',color:'var(--amb-text)'}}>📍 Pin</button>}
                            <button onClick={()=>setEditOrder({...o})} style={{padding:'4px 10px',borderRadius:6,border:'0.5px solid var(--border-med)',background:'transparent',cursor:'pointer',fontSize:'12px',fontFamily:'inherit',color:'var(--text-primary)'}}>Edit</button>
                            <button onClick={()=>deleteOrder(o.id)} style={{padding:'4px 10px',borderRadius:6,border:'0.5px solid #fca5a5',background:'transparent',cursor:'pointer',fontSize:'12px',color:'#dc2626',fontFamily:'inherit'}}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:'8px 12px',borderTop:'0.5px solid var(--border)',fontSize:'12px',color:'var(--text-secondary)'}}>
                {filtered.length} order{filtered.length!==1?'s':''} · {filtered.reduce((a,o)=>a+Object.values(o.items||{}).reduce((x,y)=>x+y,0),0)} total items
              </div>
            </div>
          )}
        </>
      ):(
        <SettingsTab menu={menu} setMenu={setMenu}/>
      )}
      {editOrder&&<EditModal order={editOrder} menu={menu} onSave={saveEdit} onClose={()=>setEditOrder(null)}/>}
      {viewPinOrder&&<AdminMapModal pin={viewPinOrder.mapPin} customerName={viewPinOrder.name} onClose={()=>setViewPinOrder(null)}/>}
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({order,menu,onSave,onClose}) {
  const [form,setForm]=useState({...order})
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}))
  function updateQty(item,delta){setForm(f=>{const items={...f.items};const next=Math.max(0,(items[item]||0)+delta);if(next===0)delete items[item];else items[item]=next;return{...f,items}})}
  const allItems=[...new Set([...menu,...Object.keys(order.items||{})])]
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'1rem'}}>
      <div style={{background:'var(--bg-primary)',borderRadius:16,border:'0.5px solid var(--border)',width:'100%',maxWidth:540,maxHeight:'90vh',overflow:'auto',padding:'1.5rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
          <p style={{fontWeight:500,fontSize:'16px',margin:0,color:'var(--text-primary)'}}>Edit order</p>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'var(--text-secondary)',padding:'0 4px',lineHeight:1}}>×</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          <Fld label="Name"><input style={inp} value={form.name} onChange={e=>upd('name',e.target.value)}/></Fld>
          <Fld label="Phone"><input style={inp} value={form.phone} onChange={e=>upd('phone',e.target.value)}/></Fld>
        </div>
        <div style={{marginBottom:10}}><Fld label="Address"><textarea style={{...inp,resize:'none'}} rows={2} value={form.address} onChange={e=>upd('address',e.target.value)}/></Fld></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10}}>
          <Fld label="Date"><input style={inp} type="date" value={form.date} onChange={e=>upd('date',e.target.value)}/></Fld>
          <Fld label="Slot"><select style={{...inp,cursor:'pointer'}} value={form.slot} onChange={e=>upd('slot',e.target.value)}><option value="slot1">Slot 1 (Morning)</option><option value="slot2">Slot 2 (Afternoon)</option></select></Fld>
          <Fld label="Status"><select style={{...inp,cursor:'pointer'}} value={form.status} onChange={e=>upd('status',e.target.value)}>{Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></Fld>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:'13px',color:'var(--text-secondary)',marginBottom:8}}>Items</label>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {allItems.map(item=>{
              const qty=form.items[item]||0
              return (
                <div key={item} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 10px',borderRadius:8,
                  border:`0.5px solid ${qty>0?'var(--amb)':'var(--border)'}`,
                  background:qty>0?'var(--amb-bg)':'var(--bg-secondary)'}}>
                  <span style={{fontSize:'13px',color:qty>0?'var(--amb-text)':'var(--text-primary)'}}>{item}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <button onClick={()=>updateQty(item,-1)} style={{width:26,height:26,borderRadius:'50%',border:'0.5px solid var(--border-med)',background:'var(--bg-primary)',cursor:'pointer',fontSize:'15px',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-primary)'}}>−</button>
                    <span style={{fontWeight:500,minWidth:18,textAlign:'center',fontSize:'13px',color:'var(--text-primary)'}}>{qty}</span>
                    <button onClick={()=>updateQty(item,1)} style={{width:26,height:26,borderRadius:'50%',border:`0.5px solid ${qty>0?'var(--amb)':'var(--border-med)'}`,background:qty>0?'var(--amb)':'var(--bg-primary)',cursor:'pointer',fontSize:'15px',display:'flex',alignItems:'center',justifyContent:'center',color:qty>0?'white':'var(--text-primary)'}}>+</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:'1.25rem'}}>
          <Fld label="Notes"><input style={inp} value={form.notes||''} onChange={e=>upd('notes',e.target.value)} placeholder="Special instructions"/></Fld>
          <Fld label="Payment"><select style={{...inp,cursor:'pointer'}} value={form.payment||'pending'} onChange={e=>upd('payment',e.target.value)}><option value="pending">Pending</option><option value="paid">Paid</option></select></Fld>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={btnS}>Cancel</button>
          <button onClick={()=>onSave(form)} style={btnP}>Save changes</button>
        </div>
      </div>
    </div>
  )
}

// ── Payment Redirects Tab ────────────────────────────────────────────────────
function PaymentLogsTab({ logs, loaded, orders, onReload }) {
  const [filterDate, setFilterDate] = useState(todayStr())
  const orderMap = Object.fromEntries((orders||[]).map(o=>[o.id,o]))

  const filtered = logs.filter(l => !filterDate || (l.date||l.timestamp||'').startsWith(filterDate))
    .sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))

  const redirectCount = {}
  logs.forEach(l => { redirectCount[l.orderId] = (redirectCount[l.orderId]||0)+1 })

  return (
    <div>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:'1rem',flexWrap:'wrap'}}>
        <DatePicker value={filterDate} onChange={setFilterDate}/>
        <span style={{fontSize:'12px',color:'var(--text-secondary)'}}>{filtered.length} redirect{filtered.length!==1?'s':''}</span>
        <button onClick={onReload} style={{...btnS,marginLeft:'auto',display:'flex',alignItems:'center',gap:5,fontSize:'12px'}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Reload
        </button>
      </div>
      {!loaded ? (
        <div style={{textAlign:'center',padding:'3rem',color:'var(--text-secondary)',fontSize:'13px'}}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--text-secondary)',background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)'}}>No payment redirects for this date</div>
      ) : (
        <div style={{background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)',overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{borderBottom:'0.5px solid var(--border)',background:'var(--bg-secondary)'}}>
                  {['Time','Order ID','Customer','Phone','Amount','App','Payment','# Taps'].map(h=>(
                    <th key={h} style={{padding:'10px 12px',textAlign:'left',fontWeight:500,color:'var(--text-secondary)',whiteSpace:'nowrap',fontSize:'12px'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l,i)=>{
                  const o = orderMap[l.orderId]
                  const isPaid = o?.payment==='paid'
                  return (
                    <tr key={i} style={{borderBottom:i<filtered.length-1?'0.5px solid var(--border)':'none'}}>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap',color:'var(--text-secondary)',fontSize:'12px'}}>{fmtTime(l.timestamp)}</td>
                      <td style={{padding:'10px 12px',fontFamily:'monospace',fontSize:'11px',color:'var(--text-tertiary)'}}>{l.orderId}</td>
                      <td style={{padding:'10px 12px',color:'var(--text-primary)',fontWeight:500}}>{o?.name||'—'}</td>
                      <td style={{padding:'10px 12px',color:'var(--text-secondary)',fontSize:'12px'}}>{o?.phone||'—'}</td>
                      <td style={{padding:'10px 12px',color:'var(--text-primary)'}}>{o?.amount?`₹${o.amount}`:'—'}</td>
                      <td style={{padding:'10px 12px',fontSize:'11px',color:'var(--text-secondary)'}}>{l.app||'—'}</td>
                      <td style={{padding:'10px 12px'}}>
                        <span style={{fontSize:'11px',padding:'3px 8px',borderRadius:4,background:isPaid?'#d1fae5':'#fef3c7',color:isPaid?'#065f46':'#92400e',fontWeight:500}}>
                          {isPaid?'✓ Paid':'Pending'}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px',textAlign:'center'}}>
                        <span style={{fontSize:'12px',fontWeight:500,color:redirectCount[l.orderId]>1?'#e05555':'var(--text-secondary)'}}>
                          {redirectCount[l.orderId]}{redirectCount[l.orderId]>1&&<span style={{fontSize:'10px',marginLeft:3}}>⚠</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{padding:'8px 12px',borderTop:'0.5px solid var(--border)',fontSize:'12px',color:'var(--text-secondary)',display:'flex',gap:'1.5rem'}}>
            <span>{filtered.length} redirect{filtered.length!==1?'s':''}</span>
            <span>{filtered.filter(l=>orderMap[l.orderId]?.payment==='paid').length} confirmed paid</span>
            <span style={{color:'#e05555'}}>{Object.values(redirectCount).filter(c=>c>1).length} with multiple taps</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function SettingsTab({menu,setMenu}) {
  const [newItem,setNewItem]=useState('')
  const [dragIdx,setDragIdx]=useState(null)
  const [overIdx,setOverIdx]=useState(null)
  const [savingMenu,setSavingMenu]=useState(false)
  const [pinCur,setPinCur]=useState('')
  const [pinNew1,setPinNew1]=useState('')
  const [pinNew2,setPinNew2]=useState('')
  const [pinMsg,setPinMsg]=useState(null)

  async function saveMenu(m){setMenu(m);setSavingMenu(true);try{await apiPost('updateMenu',{menu:m})}catch{};setSavingMenu(false)}
  async function addItem(){const t=newItem.trim();if(!t||menu.includes(t))return;await saveMenu([...menu,t]);setNewItem('')}
  async function removeItem(item){await saveMenu(menu.filter(m=>m!==item))}
  function handleDrop(idx){if(dragIdx===null||dragIdx===idx)return;const next=[...menu];const[moved]=next.splice(dragIdx,1);next.splice(idx,0,moved);saveMenu(next);setDragIdx(null);setOverIdx(null)}

  async function changePin(){
    setPinMsg(null)
    if(!/^\d{4}$/.test(pinNew1)){setPinMsg({err:true,text:'New PIN must be exactly 4 digits'});return}
    if(pinNew1!==pinNew2){setPinMsg({err:true,text:'PINs do not match'});return}
    try {
      const res=await apiPost('updatePin',{currentPin:pinCur,newPin:pinNew1})
      if(res.error){setPinMsg({err:true,text:res.error});return}
      setPinCur('');setPinNew1('');setPinNew2('');setPinMsg({err:false,text:'PIN updated successfully'})
    } catch {setPinMsg({err:true,text:'Could not update PIN. Check your connection.'})}
  }

  const pinInp={...inp,letterSpacing:'0.25em'}
  return (
    <div style={{maxWidth:480,display:'flex',flexDirection:'column',gap:'1rem'}}>
      <div style={{background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)',padding:'1.25rem'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
          <p style={{fontWeight:500,fontSize:'14px',margin:0,color:'var(--text-primary)'}}>Menu items</p>
          {savingMenu&&<span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>Saving…</span>}
        </div>
        <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:'0 0 1rem'}}>Drag to reorder. Updates the customer form instantly.</p>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:'1rem'}}>
          {menu.map((item,i)=>(
            <div key={item} draggable onDragStart={()=>setDragIdx(i)} onDragOver={e=>{e.preventDefault();setOverIdx(i)}} onDrop={()=>handleDrop(i)} onDragEnd={()=>{setDragIdx(null);setOverIdx(null)}}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 12px',
                background:overIdx===i?'var(--amb-bg)':'var(--bg-secondary)',borderRadius:8,
                border:`0.5px solid ${overIdx===i?'var(--amb)':'var(--border)'}`,cursor:'grab'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{color:'var(--text-tertiary)',fontSize:'12px',userSelect:'none'}}>⠿</span>
                <span style={{fontSize:'14px',color:'var(--text-primary)'}}>{item}</span>
              </div>
              <button onClick={()=>removeItem(item)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:'12px',padding:'2px 6px',fontFamily:'inherit'}}>Remove</button>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <input placeholder="Add new dish…" value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addItem()} style={{...inp,flex:1}}/>
          <button onClick={addItem} style={btnP}>Add</button>
        </div>
      </div>
      <div style={{background:'var(--bg-primary)',borderRadius:12,border:'0.5px solid var(--border)',padding:'1.25rem'}}>
        <p style={{fontWeight:500,fontSize:'14px',margin:'0 0 1rem',color:'var(--text-primary)'}}>Change admin PIN</p>
        <Fld label="Current PIN"><input style={pinInp} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinCur} onChange={e=>setPinCur(e.target.value.replace(/\D/g,''))}/></Fld>
        <Fld label="New PIN (4 digits)"><input style={pinInp} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinNew1} onChange={e=>setPinNew1(e.target.value.replace(/\D/g,''))}/></Fld>
        <Fld label="Confirm new PIN"><input style={pinInp} type="password" inputMode="numeric" maxLength={4} placeholder="••••" value={pinNew2} onChange={e=>setPinNew2(e.target.value.replace(/\D/g,''))}/></Fld>
        {pinMsg&&<p style={{fontSize:'12px',color:pinMsg.err?'#dc2626':'#059669',margin:'0 0 10px'}}>{pinMsg.text}</p>}
        <button onClick={changePin} style={btnP}>Update PIN</button>
      </div>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view,setView]=useState('customer')
  const [adminUnlocked,setAdminUnlocked]=useState(false)
  const [orders,setOrders]=useState([])
  const [menu,setMenu]=useState(DEFAULT_MENU)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState(null)

  const fetchOrders = useCallback(async()=>{
    const data = await apiGet({action:'getOrders'})
    setOrders(Array.isArray(data)?data:[])
  },[])

  useEffect(()=>{loadData()},[])

  // Auto-refresh orders every 30s while admin is open
  useEffect(()=>{
    if(view!=='admin'||!adminUnlocked) return
    const t=setInterval(()=>fetchOrders().catch(()=>{}), POLL_INTERVAL)
    return ()=>clearInterval(t)
  },[view,adminUnlocked,fetchOrders])

  async function loadData(){
    if(!SCRIPT_URL){setLoading(false);return}
    setError(null);setLoading(true)
    try {
      const [ordersData,menuData]=await Promise.all([apiGet({action:'getOrders'}),apiGet({action:'getMenu'})])
      setOrders(Array.isArray(ordersData)?ordersData:[])
      setMenu(Array.isArray(menuData)&&menuData.length?menuData:DEFAULT_MENU)
    } catch { setError('Could not reach the server. Check your Apps Script URL and make sure it is deployed and accessible.') }
    setLoading(false)
  }

  // Returns the new order object so CustomerForm can save it for tracking
  async function handleNewOrder(order){
    const newOrder={...order,id:genId(),createdAt:new Date().toISOString(),status:'new',payment:'pending'}
    setOrders(prev=>[...prev,newOrder])
    try{await apiPost('submitOrder',{order:newOrder})}catch{}
    return newOrder
  }

  function switchView(v){
    if(v==='customer') setAdminUnlocked(false)
    // Refresh order list when switching to admin
    if(v==='admin') fetchOrders().catch(()=>{})
    setView(v)
  }

  if(!SCRIPT_URL) return <div style={{background:'var(--bg-secondary)',minHeight:'100vh'}}><style>{CSS}</style><Header view={view} onSwitch={switchView} adminUnlocked={adminUnlocked}/><SetupScreen/></div>
  if(loading)     return <div style={{background:'var(--bg-secondary)',minHeight:'100vh'}}><style>{CSS}</style><Header view={view} onSwitch={switchView} adminUnlocked={adminUnlocked}/><Spinner/></div>
  if(error)       return <div style={{background:'var(--bg-secondary)',minHeight:'100vh'}}><style>{CSS}</style><Header view={view} onSwitch={switchView} adminUnlocked={adminUnlocked}/><ErrorBanner message={error} onRetry={loadData}/></div>

  return (
    <div style={{background:'var(--bg-secondary)',minHeight:'100vh'}}>
      <style>{CSS}</style>
      <Header view={view} onSwitch={switchView} adminUnlocked={adminUnlocked}/>
      {view==='customer'
        ?<CustomerForm menu={menu} onSubmit={handleNewOrder}/>
        :!adminUnlocked
          ?<PinGate onUnlock={()=>setAdminUnlocked(true)}/>
          :<AdminView orders={orders} menu={menu} setOrders={setOrders} setMenu={setMenu} onLock={()=>setAdminUnlocked(false)} onRefresh={fetchOrders}/>
      }
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({view,onSwitch,adminUnlocked}) {
  return (
    <div style={{background:'var(--bg-primary)',borderBottom:'0.5px solid var(--border)',position:'sticky',top:0,zIndex:100}}>
      <div style={{maxWidth:1200,margin:'0 auto',padding:'0 1rem',display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
        <div style={{display:'flex',alignItems:'center',gap:9}}>
          <div style={{width:30,height:30,borderRadius:7,background:'var(--amb)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-3.5-5.92-5-8.52-5-2.62 0-8.51 1.5-8.51 5v1h17.03v-1z"/></svg>
          </div>
          <span style={{fontWeight:500,fontSize:'15px',color:'var(--text-primary)'}}>TiffinBox</span>
          {view==='admin'&&adminUnlocked&&<span style={{fontSize:'11px',padding:'2px 8px',borderRadius:4,background:'var(--amb-bg)',color:'var(--amb-text)',fontWeight:500}}>Admin</span>}
        </div>
        <div style={{display:'flex',gap:3,background:'var(--bg-secondary)',padding:3,borderRadius:9}}>
          {[['customer','Order Form'],['admin','Admin Dashboard']].map(([v,lbl])=>(
            <button key={v} onClick={()=>onSwitch(v)}
              style={{padding:'5px 14px',borderRadius:7,border:'none',cursor:'pointer',background:view===v?'var(--bg-primary)':'transparent',color:view===v?'var(--text-primary)':'var(--text-secondary)',fontWeight:view===v?500:400,fontSize:'13px',fontFamily:'inherit'}}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
