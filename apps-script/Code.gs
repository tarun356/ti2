// ════════════════════════════════════════════════════════════════════════════
// TiffinBox — Google Apps Script Backend
// Paste this entire file into your Apps Script editor, then:
//   Deploy → New deployment → Web app
//   Execute as: Me
//   Who has access: Anyone
//   Click Deploy and copy the URL → paste as VITE_SCRIPT_URL in Vercel
// ════════════════════════════════════════════════════════════════════════════

const ss = SpreadsheetApp.getActiveSpreadsheet()

// ── Sheet helpers ─────────────────────────────────────────────────────────────
function getSheet(name, headers) {
  let sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name)
    if (headers) sheet.appendRow(headers)
  }
  return sheet
}

// ── CORS wrapper ──────────────────────────────────────────────────────────────
function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}

// ── Router: GET ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const p = e.parameter
    switch (p.action) {
      case 'getOrders':   return json(getOrders())
      case 'getMenu':     return json(getMenu())
      case 'searchNames': return json(searchNames(p.q || ''))
      case 'getCustomer': return json(getCustomer(p.name || ''))
      case 'checkPin':    return json(checkPin(p.pin || ''))
      default:            return json({ error: 'Unknown GET action: ' + p.action })
    }
  } catch (err) {
    return json({ error: err.toString() })
  }
}

// ── Router: POST ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents)
    switch (body.action) {
      case 'submitOrder':  return json(submitOrder(body.order))
      case 'updateOrder':  return json(updateOrder(body.order))
      case 'updateField':  return json(updateField(body.id, body.field, body.value))
      case 'deleteOrder':  return json(deleteOrder(body.id))
      case 'bulkStatus':   return json(bulkStatus(body.ids, body.status))
      case 'updateMenu':   return json(updateMenu(body.menu))
      case 'updatePin':    return json(updatePin(body.currentPin, body.newPin))
      default:             return json({ error: 'Unknown POST action: ' + body.action })
    }
  } catch (err) {
    return json({ error: err.toString() })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ORDERS
// Columns: id | date | slot | name | phone | address | items | notes | status | payment | createdAt
// ════════════════════════════════════════════════════════════════════════════

const ORDER_COLS = ['id','date','slot','name','phone','address','items','notes','status','payment','createdAt']

function rowToOrder(row) {
  return {
    id:        row[0]  ? row[0].toString()  : '',
    date:      row[1]  ? row[1].toString()  : '',
    slot:      row[2]  ? row[2].toString()  : '',
    name:      row[3]  ? row[3].toString()  : '',
    phone:     row[4]  ? row[4].toString()  : '',
    address:   row[5]  ? row[5].toString()  : '',
    items:     row[6]  ? JSON.parse(row[6]) : {},
    notes:     row[7]  ? row[7].toString()  : '',
    status:    row[8]  ? row[8].toString()  : 'new',
    payment:   row[9]  ? row[9].toString()  : 'pending',
    createdAt: row[10] ? row[10].toString() : '',
  }
}

function orderToRow(o) {
  return [
    o.id, o.date, o.slot, o.name, o.phone, o.address,
    JSON.stringify(o.items || {}), o.notes || '',
    o.status, o.payment, o.createdAt,
  ]
}

function getOrders() {
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  if (vals.length <= 1) return []
  return vals.slice(1).map(rowToOrder).filter(o => o.id)
}

function submitOrder(order) {
  const sheet = getSheet('Orders', ORDER_COLS)
  sheet.appendRow(orderToRow(order))
  return { ok: true }
}

function updateOrder(order) {
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0].toString() === order.id.toString()) {
      sheet.getRange(i + 1, 1, 1, ORDER_COLS.length).setValues([orderToRow(order)])
      return { ok: true }
    }
  }
  return { error: 'Order not found' }
}

// Update a single field (status or payment) — faster than full row update
const FIELD_COL = { status: 9, payment: 10 }  // 1-indexed

function updateField(id, field, value) {
  const col = FIELD_COL[field]
  if (!col) return { error: 'Unknown field: ' + field }
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0].toString() === id.toString()) {
      sheet.getRange(i + 1, col).setValue(value)
      return { ok: true }
    }
  }
  return { error: 'Order not found' }
}

function deleteOrder(id) {
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  for (let i = vals.length - 1; i >= 1; i--) {
    if (vals[i][0].toString() === id.toString()) {
      sheet.deleteRow(i + 1)
      return { ok: true }
    }
  }
  return { error: 'Order not found' }
}

function bulkStatus(ids, status) {
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  const idSet = new Set(ids.map(String))
  let updated = 0
  for (let i = 1; i < vals.length; i++) {
    if (idSet.has(vals[i][0].toString())) {
      sheet.getRange(i + 1, FIELD_COL.status).setValue(status)
      updated++
    }
  }
  return { ok: true, updated }
}

// ════════════════════════════════════════════════════════════════════════════
// CUSTOMER SEARCH (autocomplete + auto-fill)
// ════════════════════════════════════════════════════════════════════════════

function searchNames(q) {
  if (!q || q.length < 2) return []
  const sheet   = getSheet('Orders', ORDER_COLS)
  const vals    = sheet.getDataRange().getValues()
  const q_lower = q.toLowerCase()
  const seen    = new Set()
  const results = []
  // Iterate in reverse so most recent customers appear first
  for (let i = vals.length - 1; i >= 1; i--) {
    const name = vals[i][3] ? vals[i][3].toString() : ''
    if (name && name.toLowerCase().includes(q_lower) && !seen.has(name)) {
      seen.add(name)
      results.push(name)
      if (results.length >= 8) break
    }
  }
  return results
}

function getCustomer(name) {
  const sheet = getSheet('Orders', ORDER_COLS)
  const vals  = sheet.getDataRange().getValues()
  // Find most recent order for this customer
  for (let i = vals.length - 1; i >= 1; i--) {
    if (vals[i][3] && vals[i][3].toString() === name) {
      return {
        phone:   vals[i][4] ? vals[i][4].toString() : '',
        address: vals[i][5] ? vals[i][5].toString() : '',
      }
    }
  }
  return {}
}

// ════════════════════════════════════════════════════════════════════════════
// MENU
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_MENU_ITEMS = [
  'Dal Tadka + Rice', 'Rajma Chawal', 'Chole + Puri',
  'Paneer Butter Masala + Roti', 'Mix Veg + Chapati',
  'Special Thali', 'Biryani (Veg)', 'Aloo Gobhi + Roti',
]

function getMenu() {
  const sheet = getSheet('Menu', ['item'])
  const vals  = sheet.getDataRange().getValues()
  if (vals.length <= 1) {
    // Seed with defaults on first run
    DEFAULT_MENU_ITEMS.forEach(item => sheet.appendRow([item]))
    return DEFAULT_MENU_ITEMS
  }
  return vals.slice(1).map(r => r[0] ? r[0].toString() : '').filter(Boolean)
}

function updateMenu(menu) {
  const sheet = getSheet('Menu', ['item'])
  // Clear and rewrite
  const lastRow = Math.max(sheet.getLastRow(), 1)
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 1).clearContent()
  menu.forEach((item, i) => sheet.getRange(i + 2, 1).setValue(item))
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// PIN  (stored in Config sheet: key | value)
// ════════════════════════════════════════════════════════════════════════════

function getConfigValue(key) {
  const sheet = getSheet('Config', ['key', 'value'])
  const vals  = sheet.getDataRange().getValues()
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] && vals[i][0].toString() === key) return vals[i][1].toString()
  }
  return null
}

function setConfigValue(key, value) {
  const sheet = getSheet('Config', ['key', 'value'])
  const vals  = sheet.getDataRange().getValues()
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] && vals[i][0].toString() === key) {
      sheet.getRange(i + 1, 2).setValue(value)
      return
    }
  }
  sheet.appendRow([key, value])
}

function checkPin(pin) {
  const stored = getConfigValue('pin') || '1234'
  return { valid: pin === stored }
}

function updatePin(currentPin, newPin) {
  const stored = getConfigValue('pin') || '1234'
  if (currentPin !== stored) return { error: 'Incorrect current PIN' }
  if (!/^\d{4}$/.test(newPin)) return { error: 'PIN must be 4 digits' }
  setConfigValue('pin', newPin)
  return { ok: true }
}
