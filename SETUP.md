# UofT Run Club Merch — Setup & Go-Live Guide

Everything is in this `site/` folder:

```
site/
├─ index.html        ← the store (open it in a browser to preview right now)
├─ apps-script.gs    ← fallback backend (only if you get Apps Script working — see below)
├─ SETUP.md          ← this file
└─ img/              ← mockups + logo used by the store
```

You can **double-click `index.html` right now** to see the whole store working locally
(add items, watch the total, see the e-transfer box). Orders won't save until you do Part A.

---

## Part A — Make orders land in a Google Sheet, via SheetDB (~5 min, one time)

Skips Google Apps Script entirely (no Drive permissions step, works on any Google account
including school Workspace accounts that restrict Apps Script deployment).

1. Go to **sheets.new** → rename it e.g. `UTRC Orders`.
2. In **row 1**, type these exact column headers, one per cell (A1:O1):
   `Timestamp | Order Ref | Name | Email | Phone | Item | Fit | Colour | Size | Qty | Item Price | Line Total | Order Total | Notes | Paid`
3. Go to **sheetdb.io** → **Get API** (or "Create API") → sign in with Google → pick the
   sheet you just made → Authorize.
4. SheetDB gives you an API URL like `https://sheetdb.io/api/v1/abc123xyz`. Copy it.
5. Open `index.html` in a text editor. Near the top of the `<script>` find:
   ```js
   const ORDER_BACKEND = "sheetdb";
   const ORDER_ENDPOINT = "PASTE_YOUR_SHEETDB_URL_HERE";
   ```
   Replace the placeholder with your SheetDB URL. Save.

Every submitted order writes **one row per item** — someone ordering a tee and a cap gets two
rows, both sharing the same **Order Ref** so you can group/filter by it. Each row shows the
item, cut, colour, size, quantity, per-item price and line total, plus the order's grand total
repeated on every row and a blank **Paid** column you tick off by hand as e-transfers arrive.
Free tier covers 500 rows/month — plenty for a club run.

> **Already connected SheetDB before adding these columns?** SheetDB reads your sheet's
> column list once, when you first click "Get API" — it does **not** notice new columns you
> add afterward. If some columns are landing blank even though the header text looks right,
> this is almost always why. Fix: in your SheetDB dashboard, open this API and look for a way
> to re-sync/refresh its columns; if you don't see one, the reliable fix is to delete that API
> connection and click "Get API" again on the same sheet (now that all 15 headers already
> exist, it'll pick up the full set on the fresh scan). Then re-copy the URL — even if it looks
> identical, re-paste it into `ORDER_ENDPOINT` just in case a new API created a new ID.

> Tip: In the Sheet, **Data ▸ Create a filter** so you can sort/group by Order Ref or Paid,
> and **File ▸ Share** it with any exec who needs to see orders. To be notified of new
> orders, **Tools ▸ Notification settings ▸ any changes ▸ email**.

> The page also tells you if a save ever fails (SheetDB returns a real response, unlike
> Apps Script) — buyers see a warning telling them to download a backup and email it to you.

### Fallback — if you'd rather use Google Apps Script

Only try this if SheetDB doesn't work for some reason. It needs Drive/Apps Script access,
which some `@mail.utoronto.ca` / school Workspace accounts have restricted — that's the
"Sorry, unable to open the file" error if you hit it.

1. In your Sheet: **Extensions ▸ Apps Script** → delete the sample code → paste in all of
   `apps-script.gs` → Save.
2. **Deploy ▸ New deployment ▸ Web app** → Execute as **Me**, Access **Anyone** → Deploy →
   approve the permissions prompt.
3. Copy the `/exec` URL, then in `index.html` set:
   ```js
   const ORDER_BACKEND = "appsscript";
   const ORDER_ENDPOINT = "<your /exec URL>";
   ```
   Note: with this backend the page can't confirm the save succeeded (Apps Script blocks
   reading the response), so buyers never see the save-failure warning either way.

---

## Part B — Put the site online (~5 min)

Any static host works because the site is just files. Easiest first:

### Option 1 — Netlify Drop ⭐ recommended, no account juggling, no git

1. Go to **app.netlify.com/drop**.
2. Drag the **whole `site/` folder** onto the page.
3. You instantly get a live URL like `https://utrc-fw26.netlify.app`.
4. (Optional) Sign in with Google to keep it up & rename the site. Free tier easily
   covers a week of club traffic. To update, drag the folder again.

### Option 2 — Cloudflare Pages

Similar drag-and-drop at **pages.cloudflare.com** (needs a free account). Also free, fast.

### Option 3 — GitHub Pages (what you were thinking)

Works, just a couple more steps:

1. Create a repo, upload the **contents of `site/`** (so `index.html` is at the repo root).
2. **Settings ▸ Pages ▸** Source = `main` branch, `/root` → Save.
3. Live at `https://<you>.github.io/<repo>/` in ~1 min.
   > Note: keep the folder name `img` and the relative `img/...` paths — they're already correct.

**Recommendation:** For a "live tomorrow, up for a week" club store, use **Netlify Drop**.
It's the fastest, needs no git, and you can redeploy by dragging the folder again.

---

## Part C — Before you share the link (2-min checklist)

- [ ] Did Part A — placed a **test order yourself** (open `index.html` directly in a browser,
      not the sandboxed preview) and saw the row(s) appear in the Sheet.
- [ ] Order deadline in the hero looks right — search `Order deadline` in `index.html`
      (currently `Fri, Nov 6`).
- [ ] Confirmed the e-transfer email is right (it's set to `chenalec47@gmail.com`).
- [ ] Double-checked prices/sizes against the catalogue (`PRODUCTS` in `index.html`).

## Notes / things you may want next

- **Mockups:** every product has front + back photos in White and Blue (`img/metalvent-*`,
  `img/swiftly-*`, `img/hoodie-*`). Raw uploads live in `image import/` (not committed);
  re-export them into `img/` at ~900px wide JPEG and point `IMG` in `index.html` at them.
  A product with no photo falls back to a branded "mockup coming soon" tile.
- **Payment tracking is manual** by design (you tick "Paid?" as e-transfers arrive). That's
  standard for a club store and keeps it free. If you outgrow it, a paid tool like a Shopify
  or a Google Form + Stripe link is the next step — but not needed for this run.
- The site never stores card/bank info — it only records the order and tells buyers to
  e-transfer. Nothing sensitive is collected.
