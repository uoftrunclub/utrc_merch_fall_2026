/**
 * UofT Run Club Merch — order receiver
 * Paste this into the Apps Script editor that opens from your Google Sheet
 * (Extensions ▸ Apps Script), then Deploy ▸ New deployment ▸ Web app.
 * Deploy settings:  Execute as = Me   |   Who has access = Anyone
 * Copy the resulting /exec URL into ORDER_ENDPOINT in index.html.
 *
 * It finds the order table by its header row (any tab, header in the first 10 rows),
 * writes each field into the column with the matching header name, and fills the first
 * empty row inside the table. Columns it doesn't know (Considered, Paid, Received,
 * Given Away, …) are never touched, so your checkboxes stay intact.
 *
 * After saving, it emails a confirmation to the buyer and an order notice to ADMIN_EMAIL.
 * Emails send from the Google account that deployed the script. Run testEmails() once from
 * the editor to grant the "send email" permission and preview both emails in your inbox.
 */

// ---------- Email settings (keep these in sync with index.html) ----------
var ADMIN_EMAIL     = 'chenalec47@gmail.com';                  // gets a notice for every order
var ETRANSFER_EMAIL = 'chenalec47@gmail.com';                  // where buyers send the e-transfer
var REPLY_TO        = 'universityoftorontorunclub@gmail.com';  // where buyer replies go
var ORDER_DEADLINE  = 'Fri, Nov 6';
var SENDER_NAME     = 'UofT Run Club Merch';
var TIMEZONE        = 'America/Toronto';

// Header text in your sheet → field from the website. Matching ignores case, "($)" and "?".
var FIELDS = {
  'timestamp':   function (d, it, ts) { return ts; },
  'order ref':   function (d) { return d.ref || ''; },
  'name':        function (d) { return d.name || ''; },
  'email':       function (d) { return d.email || ''; },
  'phone':       function (d) { return d.phone || ''; },
  'item':        function (d, it) { return it.name || ''; },
  'colour':      function (d, it) { return it.color || ''; },
  'size':        function (d, it) { return it.size || ''; },
  'qty':         function (d, it) { return it.qty || 0; },
  'item price':  function (d, it) { return it.price || 0; },
  'line total':  function (d, it) { return lineTotal(it); },
  'order total': function (d) { return d.total || 0; },
  'notes':       function (d) { return d.notes || ''; }
};
var CHECKBOX_HEADERS = ['considered', 'paid'];   // given checkboxes on any rows the script has to add

function norm(h) { return String(h).toLowerCase().replace(/\(\$\)|\?/g, '').trim(); }
function lineTotal(it) { return Math.round((it.qty || 0) * (it.price || 0) * 100) / 100; }
function money(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Returns { sh, headerRow, cols: {normalisedHeader: columnNumber} } for the tab holding the order table.
function findTable() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    var lastCol = sh.getLastColumn();
    if (!lastCol) continue;
    var top = sh.getRange(1, 1, Math.min(10, sh.getMaxRows()), lastCol).getValues();
    for (var r = 0; r < top.length; r++) {
      var cols = {};
      top[r].forEach(function (h, c) { if (h !== '') cols[norm(h)] = c + 1; });
      if (cols['order ref'] && cols['timestamp']) return { sh: sh, headerRow: r + 1, cols: cols };
    }
  }
  throw new Error('No tab has a header row with "Timestamp" and "Order Ref".');
}

// Writes one row per item into the table; returns the first row number used.
function saveOrder(data, ts) {
  var items = data.items || [];
  var t = findTable(), sh = t.sh, cols = t.cols;

  // First empty row = first row below the header with no Order Ref and no Timestamp.
  var firstData = t.headerRow + 1;
  var maxRows = sh.getMaxRows();
  var start = maxRows + 1;
  if (maxRows >= firstData) {
    var n = maxRows - firstData + 1;
    var refs = sh.getRange(firstData, cols['order ref'], n, 1).getValues();
    var stamps = sh.getRange(firstData, cols['timestamp'], n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (refs[i][0] === '' && stamps[i][0] === '') { start = firstData + i; break; }
    }
  }
  // Keep going until all items fit; add rows (with checkboxes) if the table is full.
  var needed = start + items.length - 1 - maxRows;
  if (needed > 0) {
    sh.insertRowsAfter(maxRows, needed);
    CHECKBOX_HEADERS.forEach(function (h) {
      if (cols[h]) sh.getRange(maxRows + 1, cols[h], needed, 1).insertCheckboxes();
    });
  }

  // Write each known field into its own column; contiguous columns go in one call.
  var keys = Object.keys(FIELDS).filter(function (k) { return cols[k]; })
                   .sort(function (a, b) { return cols[a] - cols[b]; });
  var runs = [];
  keys.forEach(function (k) {
    var last = runs[runs.length - 1];
    if (last && cols[k] === last.col + last.keys.length) last.keys.push(k);
    else runs.push({ col: cols[k], keys: [k] });
  });

  runs.forEach(function (run) {
    var block = items.map(function (it) {
      return run.keys.map(function (k) { return FIELDS[k](data, it, ts); });
    });
    if (block.length) sh.getRange(start, run.col, block.length, run.keys.length).setValues(block);
  });
  SpreadsheetApp.flush();
  return start;
}

function doPost(e) {
  var data, row, ts = new Date();           // one real Date object, shared by every row in this order
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);                     // two people submitting at once must not claim the same empty row
  try {
    data = JSON.parse(e.postData.contents);
    row = saveOrder(data, ts);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }

  // The order is saved at this point — an email problem must never lose it.
  var emailed = { buyer: false, admin: false };
  if ((data.items || []).length) {
    try { sendBuyerEmail(data, ts); emailed.buyer = true; } catch (err) { console.error('Buyer email failed: ' + err); }
    try { sendAdminEmail(data, ts, row); emailed.admin = true; } catch (err) { console.error('Admin email failed: ' + err); }
  }
  return json({ ok: true, ref: data.ref, row: row, emailed: emailed });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Emails ----------

function itemsTableHtml(data) {
  var cell = 'padding:10px 8px;border-bottom:1px solid #E4DFD1;font-size:14px;vertical-align:top;';
  var head = 'padding:8px;border-bottom:2px solid #12181F;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5B6774;text-align:left;';
  var rows = (data.items || []).map(function (it) {
    return '<tr>' +
      '<td style="' + cell + '"><b>' + esc(it.name) + '</b><br><span style="color:#5B6774;font-size:13px;">' +
        esc([it.cut, it.color, 'Size ' + it.size].filter(Boolean).join(' · ')) + '</span></td>' +
      '<td style="' + cell + 'text-align:center;">' + esc(it.qty) + '</td>' +
      '<td style="' + cell + 'text-align:right;white-space:nowrap;">' + money(lineTotal(it)) + '</td></tr>';
  }).join('');
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 4px;">' +
    '<tr><th style="' + head + '">Item</th><th style="' + head + 'text-align:center;">Qty</th><th style="' + head + 'text-align:right;">Total</th></tr>' +
    rows +
    '<tr><td colspan="2" style="padding:14px 8px 0;font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:bold;">Order total</td>' +
    '<td style="padding:14px 8px 0;text-align:right;font-size:22px;font-weight:bold;color:#C23B1E;white-space:nowrap;">' + money(data.total) + '</td></tr>' +
    '</table>';
}

function itemsText(data) {
  return (data.items || []).map(function (it) {
    return '  ' + it.qty + ' × ' + it.name + ' (' + [it.cut, it.color, 'Size ' + it.size].filter(Boolean).join(', ') + ') = ' + money(lineTotal(it));
  }).join('\n');
}

function emailShell(title, inner) {
  return '<div style="background:#F3F1EA;padding:24px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#12181F;">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E4DFD1;border-radius:14px;overflow:hidden;">' +
    '<div style="background:#0B2A4A;border-bottom:4px solid #EA4924;padding:18px 22px;color:#fff;">' +
      '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9fc0e0;font-weight:bold;">UofT Run Club Merch</div>' +
      '<div style="font-size:22px;font-weight:bold;margin-top:4px;">' + title + '</div></div>' +
    '<div style="padding:20px 22px 24px;font-size:14.5px;line-height:1.55;">' + inner + '</div>' +
    '</div></div>';
}

function sendBuyerEmail(data, ts) {
  var first = String(data.name || '').split(' ')[0] || 'there';
  var html = emailShell('Order confirmed ✓',
    '<p style="margin:0 0 12px;">Hi ' + esc(first) + ', thanks for ordering UTRC merch! Here\'s what we have down for you:</p>' +
    '<p style="margin:0 0 4px;font-size:13px;color:#5B6774;">Order <b style="color:#12181F;">' + esc(data.ref) + '</b> · ' +
      esc(Utilities.formatDate(ts, TIMEZONE, 'MMM d, yyyy h:mm a')) + '</p>' +
    itemsTableHtml(data) +
    '<div style="margin:22px 0 0;background:#EEF3FA;border:1px solid #D7E1F2;border-radius:10px;padding:14px 16px;">' +
      '<b>Haven\'t paid yet?</b> Send an Interac e-transfer for <b>' + money(data.total) + '</b> to <b>' + esc(ETRANSFER_EMAIL) + '</b> ' +
      'before the order deadline (<b>' + esc(ORDER_DEADLINE) + '</b>), with your <b>full name</b> in the message. ' +
      'Orders without a matching e-transfer won\'t be placed.</div>' +
    '<div style="margin:12px 0 0;background:#FFF6E3;border:1px solid #F2E1B4;border-radius:10px;padding:14px 16px;">' +
      '<b>Keep this email.</b> Show it to us when you pick up your merch so we can find your order quickly.</div>' +
    '<p style="margin:18px 0 0;font-size:13px;color:#5B6774;">We\'ll reach out with pickup details once the order arrives. ' +
      'Questions or changes? Just reply to this email.</p>');

  var text = 'Hi ' + first + ', thanks for ordering UTRC merch!\n\n' +
    'Order ' + data.ref + '\n' + itemsText(data) + '\n\nORDER TOTAL: ' + money(data.total) + '\n\n' +
    'Haven\'t paid yet? Send an Interac e-transfer for ' + money(data.total) + ' to ' + ETRANSFER_EMAIL +
    ' before ' + ORDER_DEADLINE + ', with your full name in the message.\n\n' +
    'KEEP THIS EMAIL and show it to us when you pick up your merch.\n\n' +
    'Questions or changes? Just reply to this email.';

  MailApp.sendEmail({
    to: data.email, replyTo: REPLY_TO, name: SENDER_NAME,
    subject: 'Your UTRC merch order ' + data.ref + ' — ' + money(data.total),
    body: text, htmlBody: html
  });
}

function sendAdminEmail(data, ts, row) {
  var url = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  var count = (data.items || []).reduce(function (t, it) { return t + (it.qty || 0); }, 0);
  var detail = function (k, v) {
    return '<tr><td style="padding:3px 12px 3px 0;color:#5B6774;font-size:13px;white-space:nowrap;">' + k + '</td><td style="padding:3px 0;font-size:14px;">' + v + '</td></tr>';
  };
  var html = emailShell('New order · ' + esc(data.ref),
    '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 10px;">' +
      detail('Name', '<b>' + esc(data.name) + '</b>') +
      detail('Email', esc(data.email)) +
      detail('Phone', esc(data.phone)) +
      detail('Placed', esc(Utilities.formatDate(ts, TIMEZONE, 'MMM d, yyyy h:mm a'))) +
      (data.notes ? detail('Notes', esc(data.notes)) : '') +
    '</table>' +
    itemsTableHtml(data) +
    '<p style="margin:18px 0 0;font-size:13px;color:#5B6774;">Saved to the order sheet starting at row ' + row +
      '. Watch for an e-transfer of <b>' + money(data.total) + '</b> from <b>' + esc(data.name) + '</b>.</p>' +
    '<p style="margin:14px 0 0;"><a href="' + esc(url) + '" style="display:inline-block;background:#0B2A4A;color:#fff;text-decoration:none;' +
      'padding:10px 16px;border-radius:8px;font-weight:bold;font-size:13px;">Open order sheet</a></p>');

  var text = 'New order ' + data.ref + '\n\n' +
    'Name: ' + data.name + '\nEmail: ' + data.email + '\nPhone: ' + data.phone + '\n' +
    (data.notes ? 'Notes: ' + data.notes + '\n' : '') + '\n' +
    itemsText(data) + '\n\nORDER TOTAL: ' + money(data.total) + '\n\nSheet: ' + url + ' (row ' + row + ')';

  MailApp.sendEmail({
    to: ADMIN_EMAIL, replyTo: data.email, name: SENDER_NAME,
    subject: 'New UTRC order ' + data.ref + ' — ' + data.name + ' — ' + money(data.total) + ' (' + count + (count === 1 ? ' item)' : ' items)'),
    body: text, htmlBody: html
  });
}

// Run this once from the Apps Script editor (select testEmails ▸ Run). It asks for the
// "send email" permission and sends both sample emails to ADMIN_EMAIL — nothing touches the sheet.
function testEmails() {
  var sample = {
    ref: 'UTRC-TEST01', name: 'Usain Bolt', email: ADMIN_EMAIL, phone: '(416) 555-0134', notes: 'Test order — ignore',
    total: 221.97,
    items: [
      { name: 'Lululemon Metal Vent Tech Long-Sleeve', cut: "Men's", color: 'Navy', size: 'M', qty: 1, price: 89.99 },
      { name: 'Lululemon Swiftly Tech Long-Sleeve 2.0', cut: "Women's", color: 'Sapphire', size: '6', qty: 1, price: 81.99 },
      { name: 'Oversize Fleeced Hoodie', cut: 'Unisex', color: 'White', size: 'L', qty: 1, price: 49.99 }
    ]
  };
  sendBuyerEmail(sample, new Date());
  sendAdminEmail(sample, new Date(), 2);
}

// Lets you open the URL in a browser to confirm it's live.
function doGet() {
  return ContentService.createTextOutput('UofT Run Club Merch order endpoint is live.');
}
