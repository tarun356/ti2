import { useState, useEffect, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

// ── Config ────────────────────────────────────────────────────────────────────
const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL
const POLL_INTERVAL = 30_000 // admin refreshes every 30s
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
          {['Deploy apps-script/Code.gs to your Google Sheet (see README)','Copy the deployment URL from Apps Script','In Vercel → Settings → Environment Variables, add VITE_SCRIPT_URL = your URL','Redeploy the project'].map((step,i)=>(
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

// ── Order Tracker (customer-side, Swiggy-style) ───────────────────────────────
function OrderTracker({orderId, initialStatus, slot, date, onNewOrder}) {
  const [status, setStatus]   = useState(initialStatus || 'new')
  const [lastPoll, setLastPoll] = useState(null)
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

      <button onClick={onNewOrder} style={{...btnS,width:'100%',textAlign:'center'}}>
        {done?'Place another order':'Place a new order'}
      </button>
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
  const [coords,setCoords]=useState(null)

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
        setCoords({lat:latitude,lng:longitude})
        try {
          const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`)
          const data=await res.json()
          upd('address',data.display_name||`${latitude}, ${longitude}`); clr('address')
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
    const gpsTag=coords?` [GPS: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]`:''
    const notes=form.notes.trim()+gpsTag
    const order = await onSubmit({...form,name,phone,address,notes})
    // Save active order to localStorage for tracker
    const active = {id:order.id, status:'new', slot:form.slot, date:form.date}
    try { localStorage.setItem('tiffinbox_active_order', JSON.stringify(active)) } catch {}
    setActiveOrder(active)
    setBusy(false)
  }

  function handleNewOrder() {
    try { localStorage.removeItem('tiffinbox_active_order') } catch {}
    setActiveOrder(null)
    setForm(f=>({...f,items:{},notes:'',date:todayStr()}))
    setCoords(null); setErrors({})
  }

  // Show tracker if there's an active order
  if(activeOrder) {
    return <OrderTracker
      orderId={activeOrder.id}
      initialStatus={activeOrder.status}
      slot={activeOrder.slot}
      date={activeOrder.date}
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

      <button onClick={handleSubmit} disabled={busy}
        style={{...btnP,width:'100%',padding:'12px',fontSize:'15px',opacity:busy?0.7:1,cursor:busy?'not-allowed':'pointer'}}>
        {busy?'Placing order…':'Place order'}
      </button>
    </div>
  )
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

  async function manualRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
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
        {[['orders','Orders'],['settings','Menu & Settings']].map(([k,lbl])=>(
          <button key={k} onClick={()=>setTab(k)}
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

      {tab==='orders'?(
        <>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:'1rem'}}>
            <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={sel}/>
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
                    {filtered.map((o,i)=>(
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
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <select value={o.status} onChange={e=>updateStatus(o.id,e.target.value)}
                            style={{fontSize:'12px',padding:'4px 7px',borderRadius:5,border:'0.5px solid var(--border)',background:STATUS[o.status]?.bg||'var(--bg-secondary)',color:STATUS[o.status]?.text||'var(--text-primary)',cursor:'pointer',outline:'none',fontFamily:'inherit',fontWeight:500}}>
                            {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <select value={o.payment||'pending'} onChange={e=>updatePayment(o.id,e.target.value)}
                            style={{fontSize:'12px',padding:'4px 7px',borderRadius:5,border:'0.5px solid var(--border)',background:o.payment==='paid'?'#d1fae5':'var(--bg-secondary)',color:o.payment==='paid'?'#065f46':'var(--text-secondary)',cursor:'pointer',outline:'none',fontFamily:'inherit',fontWeight:o.payment==='paid'?500:400}}>
                            <option value="pending">Pending</option><option value="paid">Paid</option>
                          </select>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',gap:5}}>
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
