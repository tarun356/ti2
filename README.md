# TiffinBox — Deploy Guide

Free stack: React on Vercel + Google Apps Script + Google Sheets (your Drive).

---

## Step 1 — Set up the Google Sheet + Apps Script

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
   Name it anything (e.g. "TiffinBox Orders").

2. In the spreadsheet, click **Extensions → Apps Script**.

3. Delete any existing code in the editor.

4. Open `apps-script/Code.gs` from this project, copy the entire contents,
   and paste it into the Apps Script editor.

5. Click **Save** (disk icon).

6. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Description: TiffinBox
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**

7. Authorize the permissions when prompted (the script only accesses your own spreadsheet).

8. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
   Keep this URL safe — this is your backend.

> The script will automatically create the sheets (Orders, Menu, Config) the first time
> data is written. You don't need to create them manually.

---

## Step 2 — Deploy to Vercel

### Option A: GitHub (recommended)

1. Push this project folder to a new GitHub repository.

2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click **Add New Project**,
   and import your repository.

3. In the deployment settings:
   - Framework Preset: **Vite** (auto-detected)
   - Build Command: `npm run build`
   - Output Directory: `dist`

4. Under **Environment Variables**, add:
   ```
   Name:  VITE_SCRIPT_URL
   Value: https://script.google.com/macros/s/YOUR_ID/exec
   ```

5. Click **Deploy**. Done.

### Option B: Vercel CLI (no GitHub needed)

```bash
npm install -g vercel
cd tiffinbox
npm install
vercel
```

When prompted, follow the CLI steps. Then add the env variable:
```bash
vercel env add VITE_SCRIPT_URL
# paste your Apps Script URL when asked
vercel --prod
```

---

## Step 3 — Test it

1. Open your Vercel URL (e.g. `https://tiffinbox.vercel.app`).
2. Place a test order on the Order Form tab.
3. Check your Google Sheet — a new row should appear in the **Orders** sheet.
4. Open Admin Dashboard, enter PIN `1234` (change it in Admin → Settings).

---

## Local development

```bash
cp .env.example .env.local
# Edit .env.local and add your VITE_SCRIPT_URL

npm install
npm run dev
```

---

## Sharing with customers

Send your Vercel URL (e.g. `https://tiffinbox.vercel.app`) via WhatsApp.
Customers land on the Order Form by default.
The Admin Dashboard is PIN-protected so only you can access it.

---

## Re-deploying after Apps Script changes

If you ever change `Code.gs`:
- In Apps Script, go to **Deploy → Manage deployments**
- Click the pencil (edit) on your deployment
- Set Version to **New version**
- Click **Deploy**

The URL stays the same — no changes needed in Vercel.

---

## Sheets structure (auto-created)

| Sheet   | Columns |
|---------|---------|
| Orders  | id, date, slot, name, phone, address, items, notes, status, payment, createdAt |
| Menu    | item |
| Config  | key, value (stores PIN) |
