const pages = [
  { id: 'dashboard', group: 'operations', icon: '⌂', en: ['Dashboard', 'Operator overview'], th: ['ภาพรวม', 'สถานะการทำงานสำหรับเจ้าหน้าที่'] },
  { id: 'printers', group: 'operations', icon: '▣', en: ['Printers', 'Registered device fleet'], th: ['เครื่องพิมพ์', 'อุปกรณ์ที่ลงทะเบียนแล้ว'] },
  { id: 'printer-detail', group: 'operations', icon: '▤', en: ['Printer Detail', 'Device state and evidence'], th: ['รายละเอียดเครื่องพิมพ์', 'สถานะอุปกรณ์และหลักฐาน'] },
  { id: 'job-queue', group: 'operations', icon: '≡', en: ['Job Queue', 'Live print workload'], th: ['คิวงานพิมพ์', 'งานพิมพ์ที่กำลังดำเนินการ'] },
  { id: 'job-detail', group: 'operations', icon: '↳', en: ['Job Detail', 'Verdict and trace'], th: ['รายละเอียดงาน', 'ผลลัพธ์และเส้นทางเหตุการณ์'] },
  { id: 'runners', group: 'operations', icon: '◉', en: ['Runners', 'Local execution agents'], th: ['รันเนอร์', 'ตัวประมวลผลงานภายในเครื่อง'] },
  { id: 'templates', group: 'operations', icon: '▧', en: ['Templates', 'Printable content definitions'], th: ['เทมเพลต', 'รูปแบบเนื้อหาสำหรับพิมพ์'] },
  { id: 'paper-profiles', group: 'operations', icon: '▯', en: ['Paper Profiles', 'Paper geometry and fields'], th: ['โปรไฟล์กระดาษ', 'ขนาดกระดาษและตำแหน่งฟิลด์'] },
  { id: 'discovered-printers', group: 'admin', icon: '⌁', en: ['Discovered Printers', 'Review devices found by runners'], th: ['เครื่องพิมพ์ที่ค้นพบ', 'ตรวจสอบอุปกรณ์ที่รันเนอร์ค้นพบ'] },
  { id: 'diagnostics', group: 'admin', icon: '⌘', en: ['Local Diagnostics', 'Connectivity and dependency checks'], th: ['การวินิจฉัยภายในเครื่อง', 'ตรวจสอบการเชื่อมต่อและบริการที่เกี่ยวข้อง'] },
  { id: 'template-sandbox', group: 'admin', icon: '◇', en: ['Template Sandbox', 'Proof before physical output'], th: ['พื้นที่ทดสอบเทมเพลต', 'ตรวจหลักฐานก่อนพิมพ์จริง'] },
  { id: 'webhooks', group: 'admin', icon: '↗', en: ['Webhooks', 'Result callback endpoints'], th: ['เว็บฮุก', 'ปลายทางแจ้งผลกลับ'] },
  { id: 'route-policies', group: 'admin', icon: '⑂', en: ['Route Policies', 'Select the correct destination'], th: ['นโยบายการส่งงาน', 'เลือกปลายทางที่ถูกต้อง'] },
  { id: 'printer-bindings', group: 'admin', icon: '⇄', en: ['Printer Bindings', 'Bind logical names to devices'], th: ['การผูกเครื่องพิมพ์', 'เชื่อมชื่อเชิงตรรกะกับอุปกรณ์'] },
  { id: 'print-flow', group: 'admin', icon: '⤳', en: ['Print Flow Bindings', 'End-to-end routing map'], th: ['การผูกโฟลว์งานพิมพ์', 'แผนผังเส้นทางตั้งแต่ต้นจนจบ'] },
  { id: 'audit-logs', group: 'admin', icon: '☷', en: ['Audit Logs', 'Reconstruct operator and system actions'], th: ['บันทึกตรวจสอบ', 'ย้อนดูการกระทำของผู้ใช้และระบบ'] },
  { id: 'export', group: 'admin', icon: '⇩', en: ['Export Center', 'Controlled operational exports'], th: ['ศูนย์ส่งออก', 'ส่งออกข้อมูลการปฏิบัติงานอย่างควบคุม'] },
  { id: 'users', group: 'admin', icon: '♙', en: ['Users & Roles', 'Access and page permissions'], th: ['ผู้ใช้และบทบาท', 'สิทธิ์การเข้าถึงและหน้าที่อนุญาต'] },
  { id: 'settings', group: 'admin', icon: '⚙', en: ['Settings', 'Site-level configuration'], th: ['การตั้งค่า', 'ค่ากำหนดระดับไซต์'] },
];

const copy = {
  en: {
    operations: 'Operations', admin: 'Settings & Admin', refresh: 'Refresh', create: 'Create', edit: 'Edit', save: 'Save changes', cancel: 'Cancel',
    active: 'Active', inactive: 'Inactive', online: 'Online', offline: 'Offline', warning: 'Needs attention', search: 'Search', status: 'Status', actions: 'Actions',
    updated: 'Updated 18 seconds ago', noData: 'No data', view: 'Open', test: 'Run test', evidence: 'Evidence', ownerOnly: 'Owner only',
  },
  th: {
    operations: 'การปฏิบัติงาน', admin: 'การตั้งค่าและผู้ดูแล', refresh: 'รีเฟรช', create: 'สร้าง', edit: 'แก้ไข', save: 'บันทึกการเปลี่ยนแปลง', cancel: 'ยกเลิก',
    active: 'ใช้งาน', inactive: 'ไม่ใช้งาน', online: 'ออนไลน์', offline: 'ออฟไลน์', warning: 'ต้องตรวจสอบ', search: 'ค้นหา', status: 'สถานะ', actions: 'การทำงาน',
    updated: 'อัปเดตเมื่อ 18 วินาทีที่แล้ว', noData: 'ไม่มีข้อมูล', view: 'เปิดดู', test: 'เริ่มตรวจสอบ', evidence: 'หลักฐาน', ownerOnly: 'เฉพาะเจ้าของระบบ',
  },
};

let locale = 'en';
let currentPage = 'dashboard';

const navRoot = document.querySelector('#page-navigation');
const screen = document.querySelector('#screen');
const toolbarTitle = document.querySelector('#toolbar-title');
const toolbarSubtitle = document.querySelector('#toolbar-subtitle');
const frame = document.querySelector('.preview-frame');
const rail = document.querySelector('.blueprint-rail');
const railToggle = document.querySelector('#rail-toggle');
const railScrim = document.querySelector('#rail-scrim');

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function status(label, tone = 'neutral') {
  return `<span class="status status-${tone}">${esc(label)}</span>`;
}

function button(label, variant = 'secondary', extra = '') {
  return `<button type="button" class="btn btn-${variant} ${extra}">${esc(label)}</button>`;
}

function pageHeader(title, description, actions = '') {
  return `<header class="page-header">
    <div class="page-heading"><p class="eyebrow">PrintOps</p><h1>${esc(title)}</h1><p class="page-description">${esc(description)}</p></div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

function metric(label, value, note, tone = 'blue') {
  return `<article class="metric" data-tone="${tone}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}

function alertBox(title, body, tone = 'info') {
  return `<div class="alert alert-${tone}" role="status"><div><strong>${esc(title)}</strong><div>${esc(body)}</div></div></div>`;
}

function card(title, body, actions = '', className = '') {
  return `<section class="card ${className}"><div class="card-header"><div><h2>${esc(title)}</h2></div>${actions ? `<div class="inline-actions">${actions}</div>` : ''}</div>${body}</section>`;
}

function details(items) {
  return `<dl class="detail-list">${items.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function table(headers, rows) {
  return `<div class="table-frame"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${esc(headers[index])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function field(label, value, type = 'input') {
  const control = type === 'textarea'
    ? `<textarea class="textarea">${esc(value)}</textarea>`
    : type === 'select'
      ? `<select class="select"><option>${esc(value)}</option></select>`
      : `<input class="input" value="${esc(value)}" />`;
  return `<div class="field"><label>${esc(label)}</label>${control}</div>`;
}

function commonHeader(page, primaryAction = '') {
  const [title, subtitle] = page[locale];
  const actions = `<span class="cell-note">${copy[locale].updated}</span>${button(copy[locale].refresh, 'secondary')}${primaryAction}`;
  return pageHeader(title, subtitle, actions);
}

function renderDashboard(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page)}
    ${alertBox(th ? 'มีงานที่ยังยืนยันไม่ได้ 2 รายการ' : '2 jobs need an operator verdict', th ? 'อาจมีฉลากถูกพิมพ์ออกมาแล้ว ห้ามสั่งพิมพ์ซ้ำโดยไม่ตรวจสอบ' : 'Paper may already exist. Check the device before reprinting.', 'warning')}
    <section class="grid grid-4">
      ${metric(th ? 'เครื่องพิมพ์ที่ใช้งาน' : 'Active printers', '12', th ? 'จากทั้งหมด 14 เครื่อง' : 'of 14 registered', 'blue')}
      ${metric(th ? 'รันเนอร์ออนไลน์' : 'Runners online', '3', th ? 'ทุกไซต์พร้อมใช้งาน' : 'all sites ready', 'green')}
      ${metric(th ? 'งานในคิว' : 'Jobs queued', '8', th ? 'งานด่วน 2 รายการ' : '2 urgent', 'blue')}
      ${metric(th ? 'ยังยืนยันไม่ได้' : 'Unverified', '2', th ? 'ต้องตรวจสอบก่อนพิมพ์ซ้ำ' : 'operator review required', 'amber')}
    </section>
    ${card(th ? 'งานล่าสุด' : 'Recent jobs', table(
      th ? ['งาน', 'สถานะ', 'เครื่องพิมพ์', 'เวลา'] : ['Job', 'Status', 'Printer', 'Time'],
      [
        ['<a class="link mono">JOB-91A72C</a>', status('SUCCESS', 'success'), 'WARD-3-ZEBRA', '00:42'],
        ['<a class="link mono">JOB-91A71F</a>', status('UNVERIFIED', 'warning'), 'PHARMACY-01', '01:18'],
        ['<a class="link mono">JOB-91A706</a>', status('PRINTING', 'progress'), 'LAB-02', '00:08'],
      ]
    ))}
  </article>`;
}

function renderPrinters(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'เพิ่มเครื่องพิมพ์' : 'Register printer', 'primary'))}
    <div class="toolbar">${field(th ? 'ค้นหา' : 'Search', th ? 'ชื่อ รหัส หรือที่อยู่' : 'Name, code, or address')} ${field(th ? 'สถานะ' : 'Status', th ? 'ทุกสถานะ' : 'All statuses', 'select')} ${field(th ? 'โปรโตคอล' : 'Protocol', 'All protocols', 'select')}</div>
    ${table(
      th ? ['เครื่องพิมพ์', 'การเชื่อมต่อ', 'โปรโตคอล', 'รันเนอร์', 'งานล่าสุด', 'การทำงาน'] : ['Printer', 'Reachability', 'Protocol', 'Runner', 'Last job', 'Actions'],
      [
        ['<div class="cell-title">WARD-3-ZEBRA</div><div class="cell-note mono">10.20.3.44</div>', status(th ? 'พร้อมใช้งาน' : 'Ready', 'success'), 'ZPL / TCP 9100', 'runner-win-01', '18 sec', button(copy[locale].view, 'secondary', 'btn-small')],
        ['<div class="cell-title">PHARMACY-01</div><div class="cell-note mono">\\\\PHARMACY\\ZDesigner</div>', status(th ? 'ไม่ตอบสนอง' : 'No response', 'warning'), 'Windows spooler', 'runner-win-02', '4 min', button(copy[locale].view, 'secondary', 'btn-small')],
        ['<div class="cell-title">LAB-02</div><div class="cell-note mono">ipp://10.20.8.15</div>', status(th ? 'ปิดใช้งาน' : 'Disabled', 'neutral'), 'IPP', 'runner-linux-01', 'Yesterday', button(copy[locale].view, 'secondary', 'btn-small')],
      ]
    )}
  </article>`;
}

function renderPrinterDetail(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1], `${button(th ? 'ทดสอบการพิมพ์' : 'Test print', 'primary')}${button(copy[locale].edit, 'secondary')}`)}
    ${alertBox(th ? 'สถานะอุปกรณ์ล่าสุด' : 'Device truth', th ? 'รันเนอร์ยืนยันการเชื่อมต่อเมื่อ 18 วินาทีที่แล้ว แต่ยังไม่ยืนยันว่ากระดาษพร้อม' : 'The runner confirmed connectivity 18 seconds ago; paper readiness is not verified.', 'info')}
    <div class="split">
      <div class="stack">
        ${card(th ? 'ข้อมูลเครื่องพิมพ์' : 'Printer identity', details([
          [th ? 'รหัส' : 'Code', '<span class="mono">WARD-3-ZEBRA</span>'],
          [th ? 'สถานะ' : 'Status', status(th ? 'พร้อมใช้งาน' : 'Ready', 'success')],
          [th ? 'โปรโตคอล' : 'Protocol', 'ZPL / TCP 9100'],
          [th ? 'ที่อยู่' : 'Address', '<span class="mono">10.20.3.44:9100</span>'],
          [th ? 'รันเนอร์' : 'Runner', '<a class="link mono">runner-win-01</a>'],
          [th ? 'โปรไฟล์กระดาษ' : 'Paper profile', '<a class="link">Label 50 × 30 mm</a>'],
        ]))}
        ${card(th ? 'ประวัติงานล่าสุด' : 'Recent output', table(th ? ['งาน', 'ผลลัพธ์', 'เวลา'] : ['Job', 'Outcome', 'Time'], [
          ['<span class="mono">JOB-91A72C</span>', status('SUCCESS', 'success'), '00:42'],
          ['<span class="mono">JOB-91A71F</span>', status('UNVERIFIED', 'warning'), '01:18'],
        ]))}
      </div>
      <div class="stack">
        ${card(th ? 'สัญญาณอุปกรณ์' : 'Device signals', `<div class="stack-tight">
          <div>${status(th ? 'เครือข่ายเชื่อมต่อ' : 'Network reachable', 'success')}</div>
          <div>${status(th ? 'คิวระบบพร้อม' : 'Spooler ready', 'success')}</div>
          <div>${status(th ? 'กระดาษไม่ทราบสถานะ' : 'Paper state unknown', 'warning')}</div>
        </div>`)}
        ${card(th ? 'การทำงานที่มีผลต่อกระดาษจริง' : 'Physical-output actions', `<p>${th ? 'ทุกการทดสอบต้องระบุจำนวนสำเนาและยืนยันปลายทางก่อนส่งงาน' : 'Every test requires copies and destination confirmation before submission.'}</p><div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${button(th ? 'เปิดพื้นที่ทดสอบ' : 'Open sandbox', 'secondary')}</div>`)}
      </div>
    </div>
  </article>`;
}

function renderDiscoveredPrinters(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'สแกนอีกครั้ง' : 'Scan again', 'primary'))}
    ${alertBox(th ? 'ตรวจสอบก่อนลงทะเบียน' : 'Review before registration', th ? 'ชื่อจากระบบปฏิบัติการอาจไม่ตรงกับตำแหน่งจริง ต้องกำหนดรหัสที่เจ้าหน้าที่เข้าใจ' : 'Operating-system names may not match the physical location. Assign an operator-friendly code.', 'info')}
    ${table(th ? ['อุปกรณ์ที่พบ', 'แหล่งค้นพบ', 'ที่อยู่', 'สถานะ', 'การทำงาน'] : ['Discovered device', 'Source', 'Address', 'State', 'Actions'], [
      ['<div class="cell-title">ZDesigner ZD421-203dpi</div><div class="cell-note">Windows spooler</div>', 'runner-win-01', '<span class="mono">WARD3-ZD421</span>', status(th ? 'ยังไม่ลงทะเบียน' : 'Not registered', 'info'), button(th ? 'ลงทะเบียน' : 'Register', 'primary', 'btn-small')],
      ['<div class="cell-title">Brother QL-820NWB</div><div class="cell-note">SNMP discovery</div>', 'runner-linux-01', '<span class="mono">10.20.8.27</span>', status(th ? 'มีอยู่แล้ว' : 'Already registered', 'neutral'), button(copy[locale].view, 'secondary', 'btn-small')],
    ])}
  </article>`;
}

function renderDiagnostics(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(copy[locale].test, 'primary'))}
    <section class="grid grid-3">
      ${metric('API', th ? 'พร้อม' : 'Ready', '18 ms', 'green')}
      ${metric('NATS / JetStream', th ? 'เสื่อมสภาพ' : 'Degraded', th ? 'consumer ต้องตรวจสอบ' : 'consumer check required', 'amber')}
      ${metric(th ? 'ฐานข้อมูล' : 'Database', th ? 'พร้อม' : 'Ready', 'SQLite / sql.js', 'green')}
    </section>
    <div class="split">
      ${card(th ? 'ผลการตรวจสอบ' : 'Diagnostic checks', table(th ? ['รายการ', 'ผลลัพธ์', 'รายละเอียด'] : ['Check', 'Result', 'Detail'], [
        ['API health', status('PASS', 'success'), '<span class="mono">http://127.0.0.1:3000/health</span>'],
        ['NATS connection', status('PASS', 'success'), '<span class="mono">nats://122.155.164.15:4222</span>'],
        ['JetStream durable consumer', status('WARN', 'warning'), th ? 'consumer มีอยู่ แต่ ack ล่าช้า' : 'Consumer exists; acknowledgement is delayed'],
        ['Runner callback', status('PASS', 'success'), th ? 'ได้รับผลล่าสุด 26 วินาทีที่แล้ว' : 'Last result received 26 seconds ago'],
      ]))}
      ${card(th ? 'หลักฐานล่าสุด' : 'Latest evidence', `<pre class="mono" style="white-space:pre-wrap;margin:0;color:var(--text)">NATS: DEGRADED
server: nats://122.155.164.15:4222
intake: ready
consumer: printops-intake
pending_acks: 2</pre>`)}
    </div>
  </article>`;
}

function renderTemplates(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'สร้างเทมเพลต' : 'Create template', 'primary'))}
    <div class="toolbar">${field(copy[locale].search, th ? 'ค้นหารหัสหรือชื่อเทมเพลต' : 'Search code or name')} ${field(copy[locale].status, th ? 'ทุกสถานะ' : 'All statuses', 'select')}</div>
    <section class="grid grid-3">
      ${card('MED_LABEL_50X30', `<p>${th ? 'ฉลากยาทั่วไป 50 × 30 มม.' : 'General medication label, 50 × 30 mm'}</p><div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${status(th ? 'เผยแพร่แล้ว' : 'Published', 'success')}${status('v12', 'neutral')}</div>`, button(copy[locale].edit, 'secondary', 'btn-small'))}
      ${card('LAB_SAMPLE_QR', `<p>${th ? 'ฉลากตัวอย่างตรวจพร้อม QR' : 'Specimen label with QR evidence'}</p><div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${status(th ? 'ฉบับร่าง' : 'Draft', 'warning')}${status('v4', 'neutral')}</div>`, button(copy[locale].edit, 'secondary', 'btn-small'))}
      ${card('WRISTBAND_ADULT', `<p>${th ? 'สายรัดข้อมือผู้ใหญ่' : 'Adult wristband layout'}</p><div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${status(th ? 'ปิดใช้งาน' : 'Disabled', 'neutral')}${status('v7', 'neutral')}</div>`, button(copy[locale].view, 'secondary', 'btn-small'))}
    </section>
  </article>`;
}

function renderSandbox(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1], button(th ? 'บันทึกหลักฐาน' : 'Save proof', 'secondary'))}
    ${alertBox(th ? 'การแสดงตัวอย่างไม่ใช่หลักฐานว่าพิมพ์สำเร็จ' : 'Preview is not proof of physical output', th ? 'ทดสอบการพิมพ์ได้เฉพาะเมื่อเครื่องพิมพ์พร้อม และต้องยืนยันเครื่อง เทมเพลต และจำนวนสำเนา' : 'Test print is available only when the printer is ready and requires confirmation of printer, template, and copies.', 'warning')}
    <div class="editor-split">
      <section class="card stack">
        <div class="card-header"><h2>${th ? 'การตั้งค่าหลักฐาน' : 'Proof configuration'}</h2></div>
        ${field(th ? 'เทมเพลต' : 'Template', 'MED_LABEL_50X30', 'select')}
        ${field(th ? 'โปรไฟล์กระดาษ' : 'Paper profile', 'Label 50 × 30 mm', 'select')}
        ${field(th ? 'เครื่องพิมพ์ทดสอบ' : 'Test printer', 'WARD-3-ZEBRA — Ready', 'select')}
        ${field(th ? 'จำนวนสำเนา' : 'Copies', '1')}
        ${field(th ? 'ข้อมูลตัวอย่าง JSON' : 'Sample JSON', '{\n  "document_no": "RX-10482",\n  "display_name": "Sample item"\n}', 'textarea')}
        <label class="check"><input type="checkbox" /><span>${th ? 'ฉันเข้าใจว่าจะมีกระดาษจริงออกจากเครื่องพิมพ์' : 'I understand that physical paper will be produced'}</span></label>
        <div class="inline-actions">${button(th ? 'สร้างตัวอย่างใหม่' : 'Refresh preview', 'secondary')}${button(th ? 'ยืนยันและทดสอบพิมพ์' : 'Confirm test print', 'danger')}</div>
      </section>
      <section class="paper-stage" aria-label="Proof preview"><div class="paper"><strong style="font-size:.8rem">Sample label</strong><div class="paper-field selected" style="left:18px;top:52px">display_name</div><div class="paper-field" style="left:18px;top:106px">document_no</div><div class="paper-field paper-barcode" style="left:18px;right:18px;bottom:24px"></div></div></section>
    </div>
  </article>`;
}

function renderPaperProfiles(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1], `${button(th ? 'นำเข้า' : 'Import', 'secondary')}${button(th ? 'สร้างโปรไฟล์' : 'Create profile', 'primary')}`)}
    <div class="editor-split">
      <section class="panel"><div class="panel-title"><h2>${th ? 'คลังโปรไฟล์' : 'Profile library'}</h2></div><div class="panel-body stack-tight">
        <button class="btn btn-secondary" style="justify-content:flex-start;border-color:#93c5fd;background:var(--info-surface)"><span><strong>Label 50 × 30 mm</strong><br><span class="cell-note">4 fields · 300 dpi</span></span></button>
        <button class="btn btn-secondary" style="justify-content:flex-start"><span><strong>Wristband 25 × 250 mm</strong><br><span class="cell-note">6 fields · 203 dpi</span></span></button>
        <button class="btn btn-secondary" style="justify-content:flex-start"><span><strong>A4 portrait</strong><br><span class="cell-note">2 fields · 300 dpi</span></span></button>
      </div></section>
      <div class="stack">
        ${card(th ? 'Label 50 × 30 mm' : 'Label 50 × 30 mm', `<div class="grid grid-3">${field(th ? 'ความกว้าง (มม.)' : 'Width (mm)', '50')}${field(th ? 'ความสูง (มม.)' : 'Height (mm)', '30')}${field('DPI', '300')}</div>`, `${button(th ? 'ลบ' : 'Delete', 'danger', 'btn-small')}${button(copy[locale].save, 'primary', 'btn-small')}`)}
        <div class="editor-split">
          ${card(th ? 'ฟิลด์ที่พิมพ์' : 'Printable fields', table(th ? ['ฟิลด์', 'ชนิด', 'ตำแหน่ง'] : ['Field', 'Type', 'Position'], [
            ['display_name', 'text', '<span class="mono">x 3 / y 4</span>'],
            ['document_no', 'text', '<span class="mono">x 3 / y 11</span>'],
            ['barcode', 'CODE128', '<span class="mono">x 3 / y 18</span>'],
            ['qr', 'QR', '<span class="mono">x 39 / y 3</span>'],
          ]))}
          <section class="paper-stage" style="min-height:330px"><div class="paper"><div class="paper-field selected" style="left:18px;top:40px">display_name</div><div class="paper-field" style="left:18px;top:92px">document_no</div><div class="paper-field paper-barcode" style="left:18px;right:18px;bottom:28px"></div><div class="paper-field paper-qr" style="right:18px;top:18px"></div></div></section>
        </div>
      </div>
    </div>
  </article>`;
}

function renderWebhooks(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'เพิ่มเว็บฮุก' : 'Add webhook', 'primary'))}
    ${table(th ? ['ปลายทาง', 'เหตุการณ์', 'สถานะ', 'การส่งล่าสุด', 'การทำงาน'] : ['Endpoint', 'Events', 'State', 'Last delivery', 'Actions'], [
      ['<div class="cell-title">Medication result callback</div><div class="cell-note mono">https://integration.local/print/result</div>', 'terminal job results', status(th ? 'ใช้งาน' : 'Active', 'success'), status('DELIVERED', 'success'), button(copy[locale].edit, 'secondary', 'btn-small')],
      ['<div class="cell-title">Lab legacy callback</div><div class="cell-note mono">nats://medisync.print.callback</div>', 'SUCCESS / FAILED', status(th ? 'หยุดชั่วคราว' : 'Paused', 'neutral'), status('RETRYING', 'warning'), button(copy[locale].edit, 'secondary', 'btn-small')],
    ])}
    ${card(th ? 'การส่งที่ต้องตรวจสอบ' : 'Delivery requiring attention', `<div class="alert alert-warning"><div><strong>HTTP 503 · attempt 4/5</strong><div class="mono">callback/job/JOB-91A71F</div><div>${th ? 'การพิมพ์อาจสำเร็จแล้ว ความล้มเหลวนี้เป็นเฉพาะการแจ้งผลกลับ' : 'Printing may already have completed; this failure is callback-only.'}</div></div></div>`)}
  </article>`;
}

function renderRoutePolicies(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'สร้างนโยบาย' : 'Create policy', 'primary'))}
    ${alertBox(th ? 'ลำดับมีผลต่อการเลือกปลายทาง' : 'Order affects destination selection', th ? 'ระบบใช้กฎแรกที่ตรงเงื่อนไข ควรเก็บกฎเฉพาะไว้เหนือกฎทั่วไป' : 'The first matching rule wins. Keep specific rules above general fallbacks.', 'info')}
    <section class="stack">
      ${card('01 · Urgent ward labels', `<div class="diagram"><div class="flow-row"><div class="flow-node"><strong>When</strong><span>source_system = ward-3<br>priority = urgent</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Route to</strong><span>WARD-3-ZEBRA</span></div></div></div>`, button(copy[locale].edit, 'secondary', 'btn-small'))}
      ${card('02 · Pharmacy labels', `<div class="diagram"><div class="flow-row"><div class="flow-node"><strong>When</strong><span>template starts MED_</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Route to</strong><span>PHARMACY-01</span></div></div></div>`, button(copy[locale].edit, 'secondary', 'btn-small'))}
      ${card('99 · Site fallback', `<div class="diagram"><div class="flow-row"><div class="flow-node"><strong>When</strong><span>all other jobs</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Route to</strong><span>DEFAULT-LABEL</span></div></div></div>`, button(copy[locale].edit, 'secondary', 'btn-small'))}
    </section>
  </article>`;
}

function renderBindings(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'เพิ่มการผูก' : 'Add binding', 'primary'))}
    ${table(th ? ['ชื่อเชิงตรรกะ', 'เครื่องพิมพ์จริง', 'โปรไฟล์กระดาษ', 'สถานะ', 'การทำงาน'] : ['Logical destination', 'Physical printer', 'Paper profile', 'State', 'Actions'], [
      ['<div class="cell-title">WARD_LABEL</div><div class="cell-note">Used by 3 policies</div>', 'WARD-3-ZEBRA', 'Label 50 × 30 mm', status(th ? 'ใช้งาน' : 'Active', 'success'), button(copy[locale].edit, 'secondary', 'btn-small')],
      ['<div class="cell-title">PHARMACY_LABEL</div><div class="cell-note">Used by 5 policies</div>', 'PHARMACY-01', 'Label 50 × 30 mm', status(th ? 'ใช้งาน' : 'Active', 'success'), button(copy[locale].edit, 'secondary', 'btn-small')],
      ['<div class="cell-title">LAB_LABEL</div><div class="cell-note">Fallback disabled</div>', 'LAB-02', 'Lab 40 × 25 mm', status(th ? 'ต้องตรวจสอบ' : 'Needs review', 'warning'), button(copy[locale].edit, 'secondary', 'btn-small')],
    ])}
  </article>`;
}

function renderPrintFlow(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'ตรวจสอบโฟลว์' : 'Validate flow', 'primary'))}
    ${alertBox(copy[locale].ownerOnly, th ? 'การเปลี่ยนแปลงหน้านี้มีผลกับเส้นทางงานทั้งหมด ควรบันทึกเป็นเวอร์ชันและตรวจสอบก่อนเผยแพร่' : 'Changes affect the full routing chain. Version and validate before publishing.', 'warning')}
    ${card(th ? 'เส้นทางงานปัจจุบัน' : 'Current print flow', `<div class="diagram">
      <div class="flow-row"><div class="flow-node"><strong>External integration</strong><span>POST /api/v1/print-jobs</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Route policy</strong><span>Urgent ward labels</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Binding</strong><span>WARD_LABEL</span></div></div>
      <div class="flow-row" style="justify-content:flex-end"><span class="flow-arrow">↓</span></div>
      <div class="flow-row" style="justify-content:flex-end"><div class="flow-node"><strong>Runner</strong><span>runner-win-01</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Printer</strong><span>WARD-3-ZEBRA</span></div><span class="flow-arrow">→</span><div class="flow-node"><strong>Callback</strong><span>Medication result</span></div></div>
    </div>`)}
    <section class="grid grid-3">${metric(th ? 'เส้นทางที่ใช้งาน' : 'Active routes', '8', th ? 'ผ่านการตรวจสอบทั้งหมด' : 'all validated', 'green')}${metric(th ? 'คำเตือน' : 'Warnings', '1', th ? 'LAB_LABEL ไม่มี fallback' : 'LAB_LABEL has no fallback', 'amber')}${metric(th ? 'เวอร์ชัน' : 'Version', '24', th ? 'เผยแพร่เมื่อ 09:18' : 'published 09:18', 'blue')}</section>
  </article>`;
}

function renderJobQueue(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page)}
    <div class="chips"><button class="chip selected">${th ? 'ทั้งหมด 42' : 'All 42'}</button><button class="chip">QUEUED 8</button><button class="chip">PRINTING 2</button><button class="chip">UNVERIFIED 2</button><button class="chip">FAILED 1</button></div>
    <div class="toolbar">${field(copy[locale].search, th ? 'ค้นหา Job ID, เอกสาร, เครื่องพิมพ์' : 'Job ID, document, printer')} ${field(th ? 'ช่วงเวลา' : 'Time range', th ? '24 ชั่วโมงล่าสุด' : 'Last 24 hours', 'select')}</div>
    ${table(th ? ['เลือก', 'สถานะ', 'เอกสาร', 'เครื่องพิมพ์', 'ต้นทาง', 'สำเนา', 'สร้างเมื่อ', 'การทำงาน'] : ['Select', 'Status', 'Document', 'Printer', 'Source', 'Copies', 'Created', 'Actions'], [
      ['<input type="checkbox" aria-label="Select job JOB-91A71F">', status('UNVERIFIED', 'warning'), '<div class="cell-title">MED_LABEL_50X30</div><div class="cell-note mono">RX-10482 · JOB-91A71F</div>', 'PHARMACY-01', 'medisync', '1', '00:44', button(th ? 'พิมพ์ซ้ำ' : 'Reprint', 'danger', 'btn-small')],
      ['<input type="checkbox" aria-label="Select job JOB-91A706">', status('PRINTING', 'progress'), '<div class="cell-title">LAB_SAMPLE_QR</div><div class="cell-note mono">LAB-8821 · JOB-91A706</div>', 'LAB-02', 'lab-bridge', '2', '00:19', ''],
      ['<input type="checkbox" aria-label="Select job JOB-91A72C">', status('SUCCESS', 'success'), '<div class="cell-title">MED_LABEL_50X30</div><div class="cell-note mono">RX-10481 · JOB-91A72C</div>', 'WARD-3-ZEBRA', 'medisync', '1', '00:08', button(copy[locale].view, 'secondary', 'btn-small')],
    ])}
    <div class="alert alert-info" style="position:sticky;bottom:.75rem;align-items:center;justify-content:space-between"><div><strong>${th ? 'เลือกแล้ว 1 งาน' : '1 job selected'}</strong><div>${th ? 'ตรวจสอบสถานะที่อาจพิมพ์ออกมาแล้วก่อนดำเนินการ' : 'Review outcomes that may already be on paper.'}</div></div><div class="inline-actions">${button(th ? 'ล้างการเลือก' : 'Clear', 'secondary')}${button(th ? 'พิมพ์ซ้ำ 1 งาน' : 'Reprint 1 job', 'danger')}</div></div>
  </article>`;
}

function renderJobDetail(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1], `${button(th ? 'คัดลอกข้อมูลดีบัก' : 'Copy debug JSON', 'secondary')}${button(th ? 'พิมพ์ซ้ำ' : 'Reprint', 'danger')}`)}
    <div class="alert alert-warning"><div><strong>${th ? 'อาจพิมพ์ออกมาแล้ว' : 'May have printed'}</strong><div>${th ? 'รันเนอร์ส่งข้อมูลไปยังเครื่องพิมพ์ แต่ไม่มีช่องทางยืนยันว่ากระดาษออกจริง ตรวจสอบที่เครื่องก่อนพิมพ์ซ้ำ' : 'The runner sent data to the printer but no device channel confirmed physical output. Check the printer before reprinting.'}</div></div></div>
    <div class="split">
      <div class="stack">
        ${card(th ? 'สรุปคำตัดสิน' : 'Verdict summary', details([
          [th ? 'สถานะ' : 'Status', status('UNVERIFIED', 'warning')],
          ['Job ID', '<span class="mono">JOB-91A71F</span>'],
          [th ? 'เอกสาร' : 'Document', 'MED_LABEL_50X30 · RX-10482'],
          [th ? 'ปลายทาง' : 'Destination', '<a class="link">PHARMACY-01</a>'],
          [th ? 'จำนวนสำเนา' : 'Copies', '1'],
          [th ? 'ระยะเวลารวม' : 'Total latency', '1.18 s'],
        ]))}
        ${card(th ? 'เส้นทางเหตุการณ์' : 'Trace timeline', `<ol class="timeline">
          <li><span class="timeline-dot">✓</span><div class="timeline-copy"><strong>ACCEPTED</strong><span>00:00.000 · request idempotency checked</span></div></li>
          <li><span class="timeline-dot">✓</span><div class="timeline-copy"><strong>VALIDATED</strong><span>00:00.021 · template and profile resolved</span></div></li>
          <li><span class="timeline-dot">✓</span><div class="timeline-copy"><strong>DISPATCHED</strong><span>00:00.284 · runner-win-02 claimed job</span></div></li>
          <li><span class="timeline-dot">!</span><div class="timeline-copy"><strong>UNVERIFIED</strong><span>00:01.180 · bytes sent, no device confirmation channel</span></div></li>
        </ol>`)}
      </div>
      <div class="stack">
        ${card(copy[locale].evidence, `<div class="stack-tight"><div><span class="cell-note">traceId</span><div class="mono">trc_01J9E7DPC7</div></div><div><span class="cell-note">correlationId</span><div class="mono">cor_rx_10482</div></div><div><span class="cell-note">runner</span><div class="mono">runner-win-02</div></div><div><span class="cell-note">adapter</span><div class="mono">windows-spooler</div></div></div>`)}
        ${card(th ? 'ความเสี่ยงการพิมพ์ซ้ำ' : 'Duplicate risk', `<p>${th ? 'งานนี้ยังไม่มีงานพิมพ์ซ้ำที่เชื่อมโยง แต่สถานะปัจจุบันไม่ยืนยันว่ากระดาษไม่มีอยู่' : 'No linked reprint exists, but the current outcome does not prove that paper is absent.'}</p>`)}
      </div>
    </div>
  </article>`;
}

function renderRunners(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page)}
    <section class="grid grid-3">
      ${card('runner-win-01', `<div class="stack-tight">${status(th ? 'ออนไลน์' : 'Online', 'success')}<div class="cell-note">Windows 11 · v0.1.0-mvp</div><div class="mono">10.20.3.10</div><div>${th ? 'เครื่องพิมพ์ 6 เครื่อง' : '6 printers'}</div></div>`, button(copy[locale].view, 'secondary', 'btn-small'))}
      ${card('runner-win-02', `<div class="stack-tight">${status(th ? 'ออนไลน์' : 'Online', 'success')}<div class="cell-note">Windows Server · v0.1.0-mvp</div><div class="mono">10.20.4.11</div><div>${th ? 'เครื่องพิมพ์ 5 เครื่อง' : '5 printers'}</div></div>`, button(copy[locale].view, 'secondary', 'btn-small'))}
      ${card('runner-linux-01', `<div class="stack-tight">${status(th ? 'ต้องตรวจสอบ' : 'Needs attention', 'warning')}<div class="cell-note">Ubuntu 24.04 · v0.1.0-mvp</div><div class="mono">10.20.8.12</div><div>${th ? 'heartbeat ล่าสุด 2 นาที' : 'last heartbeat 2 min'}</div></div>`, button(copy[locale].view, 'secondary', 'btn-small'))}
    </section>
    ${card(th ? 'เหตุการณ์รันเนอร์ล่าสุด' : 'Recent runner events', table(th ? ['เวลา', 'รันเนอร์', 'เหตุการณ์', 'รายละเอียด'] : ['Time', 'Runner', 'Event', 'Detail'], [
      ['09:42:18', 'runner-win-01', status('HEARTBEAT', 'success'), th ? 'พร้อมรับงาน' : 'ready to claim jobs'],
      ['09:41:57', 'runner-linux-01', status('DISCOVERY_WARN', 'warning'), th ? 'lpstat ตอบช้า 2.8 วินาที' : 'lpstat responded in 2.8 s'],
    ]))}
  </article>`;
}

function renderAudit(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'ส่งออกผลลัพธ์' : 'Export results', 'secondary'))}
    <div class="toolbar">${field(copy[locale].search, th ? 'ผู้ใช้ งาน หรือเหตุการณ์' : 'User, job, or event')} ${field(th ? 'ประเภทเหตุการณ์' : 'Event type', th ? 'ทั้งหมด' : 'All events', 'select')} ${field(th ? 'ช่วงเวลา' : 'Time range', th ? 'วันนี้' : 'Today', 'select')}</div>
    ${table(th ? ['เวลา', 'ผู้กระทำ', 'การกระทำ', 'เป้าหมาย', 'ผลลัพธ์'] : ['Time', 'Actor', 'Action', 'Target', 'Result'], [
      ['09:44:02.188', 'operator@hospital.local', 'JOB_REPRINT_REQUESTED', '<span class="mono">JOB-91A71F</span>', status('ACCEPTED', 'info')],
      ['09:42:18.021', 'runner-win-01', 'RUNNER_HEARTBEAT', '<span class="mono">runner-win-01</span>', status('SUCCESS', 'success')],
      ['09:37:11.447', 'admin@hospital.local', 'PRINTER_UPDATED', '<span class="mono">WARD-3-ZEBRA</span>', status('SUCCESS', 'success')],
      ['09:31:40.012', 'system', 'CALLBACK_RETRY', '<span class="mono">JOB-91A6EE</span>', status('RETRYING', 'warning')],
    ])}
  </article>`;
}

function renderExport(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1])}
    ${alertBox(th ? 'ข้อมูลส่งออกอาจมีประวัติการปฏิบัติงานที่ละเอียดอ่อน' : 'Exports may contain sensitive operational history', th ? 'จัดเก็บไฟล์แบบเข้ารหัสและจำกัดผู้เข้าถึงตามนโยบายของโรงพยาบาล' : 'Store files encrypted and restrict access according to hospital policy.', 'warning')}
    <section class="grid grid-3">
      ${card(th ? 'ประวัติงานพิมพ์' : 'Print job history', `<p>${th ? 'สถานะ ระยะเวลา ปลายทาง และ trace identifier' : 'Status, timing, destination, and trace identifiers'}</p>${field(th ? 'ช่วงเวลา' : 'Date range', th ? '7 วันที่ผ่านมา' : 'Last 7 days', 'select')}<div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${button(th ? 'ส่งออก CSV' : 'Export CSV', 'primary')}</div>`)}
      ${card(th ? 'บันทึกตรวจสอบ' : 'Audit log', `<p>${th ? 'การกระทำของผู้ใช้ ระบบ และรันเนอร์' : 'User, system, and runner actions'}</p>${field(th ? 'ช่วงเวลา' : 'Date range', th ? 'วันนี้' : 'Today', 'select')}<div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${button(th ? 'ส่งออก JSONL' : 'Export JSONL', 'primary')}</div>`)}
      ${card(th ? 'สำรองฐานข้อมูล' : 'Database backup', `<p>${th ? 'สร้างสำเนา SQLite สำหรับกู้คืนเมื่อ PrintOps หยุดทำงาน' : 'Create a SQLite backup for restore while PrintOps is stopped'}</p><div class="inline-actions" style="justify-content:flex-start;margin-top:2.15rem">${button(th ? 'สร้างไฟล์สำรอง' : 'Create backup', 'danger')}</div>`)}
    </section>
    ${card(th ? 'ไฟล์ส่งออกล่าสุด' : 'Recent exports', table(th ? ['ไฟล์', 'ผู้สร้าง', 'เวลา', 'สถานะ'] : ['File', 'Created by', 'Time', 'Status'], [
      ['<span class="mono">jobs-2026-08-02.csv</span>', 'admin@hospital.local', '09:22', status(th ? 'พร้อมดาวน์โหลด' : 'Ready', 'success')],
      ['<span class="mono">audit-2026-08-01.jsonl</span>', 'owner@hospital.local', 'Yesterday', status(th ? 'หมดอายุแล้ว' : 'Expired', 'neutral')],
    ]))}
  </article>`;
}

function renderUsers(page) {
  const th = locale === 'th';
  return `<article class="page">${commonHeader(page, button(th ? 'เชิญผู้ใช้' : 'Invite user', 'primary'))}
    ${table(th ? ['ผู้ใช้', 'บทบาท', 'หน้าที่อนุญาต', 'เข้าสู่ระบบล่าสุด', 'สถานะ', 'การทำงาน'] : ['User', 'Role', 'Allowed pages', 'Last sign-in', 'State', 'Actions'], [
      ['<div class="cell-title">System Owner</div><div class="cell-note">owner@hospital.local</div>', status('OWNER', 'info'), th ? 'ทุกหน้า' : 'All pages', '09:04', status(th ? 'ใช้งาน' : 'Active', 'success'), button(copy[locale].edit, 'secondary', 'btn-small')],
      ['<div class="cell-title">Ward Operator</div><div class="cell-note">operator@hospital.local</div>', status('OPERATOR', 'neutral'), th ? '6 หน้าการปฏิบัติงาน' : '6 operations pages', '08:58', status(th ? 'ใช้งาน' : 'Active', 'success'), button(copy[locale].edit, 'secondary', 'btn-small')],
      ['<div class="cell-title">Audit Viewer</div><div class="cell-note">viewer@hospital.local</div>', status('VIEWER', 'neutral'), th ? 'ภาพรวมและคิวงาน' : 'Dashboard and queue', 'Jul 29', status(th ? 'ระงับ' : 'Suspended', 'warning'), button(copy[locale].edit, 'secondary', 'btn-small')],
    ])}
  </article>`;
}

function renderSettings(page) {
  const th = locale === 'th';
  return `<article class="page">${pageHeader(page[locale][0], page[locale][1], button(copy[locale].save, 'primary'))}
    <div class="split">
      <div class="stack">
        ${card(th ? 'ข้อมูลไซต์' : 'Site identity', `<div class="grid grid-2">${field(th ? 'ชื่อไซต์' : 'Site name', th ? 'โรงพยาบาลตัวอย่าง' : 'Example Hospital')}${field(th ? 'โซนเวลา' : 'Timezone', 'Asia/Bangkok', 'select')}${field(th ? 'ภาษาหลัก' : 'Default language', th ? 'ไทย' : 'English', 'select')}${field(th ? 'การเก็บประวัติ' : 'History retention', th ? '365 วัน' : '365 days', 'select')}</div>`)}
        ${card(th ? 'การเชื่อมต่อ NATS' : 'NATS connection', `<div class="grid grid-2">${field('Server URL', 'nats://122.155.164.15:4222')}${field('Client ID', 'printops-hospital-01')}${field('Stream', 'PRINTOPS')}${field('Durable consumer', 'printops-intake')}</div><div class="inline-actions" style="justify-content:flex-start;margin-top:.75rem">${button(th ? 'ทดสอบการเชื่อมต่อ' : 'Test connection', 'secondary')}</div>`)}
        ${card(th ? 'พฤติกรรมความปลอดภัย' : 'Safety behavior', `<div class="stack-tight"><label class="check"><input type="checkbox" checked><span>${th ? 'ต้องยืนยันก่อนทดสอบพิมพ์ทุกครั้ง' : 'Require confirmation before every test print'}</span></label><label class="check"><input type="checkbox" checked><span>${th ? 'ห้ามพิมพ์ซ้ำอัตโนมัติสำหรับ UNVERIFIED' : 'Never auto-retry UNVERIFIED jobs'}</span></label><label class="check"><input type="checkbox" checked><span>${th ? 'บันทึกเหตุผลสำหรับการพิมพ์ซ้ำ' : 'Require a reason for reprints'}</span></label></div>`)}
      </div>
      <div class="stack">
        ${card(th ? 'สุขภาพระบบ' : 'System health', `<div class="stack-tight"><div>${status('API READY', 'success')}</div><div>${status('DATABASE READY', 'success')}</div><div>${status('NATS DEGRADED', 'warning')}</div><div>${status('RUNNER 3/3 ONLINE', 'success')}</div></div>`)}
        ${card(th ? 'ข้อมูลเวอร์ชัน' : 'Version information', details([['Web', '<span class="mono">1.0.0-mvp</span>'], ['API', '<span class="mono">1.0.0-mvp</span>'], ['Runner', '<span class="mono">0.1.0-mvp</span>'], ['Schema', '<span class="mono">24</span>']]))}
      </div>
    </div>
  </article>`;
}

const renderers = {
  dashboard: renderDashboard,
  printers: renderPrinters,
  'printer-detail': renderPrinterDetail,
  'discovered-printers': renderDiscoveredPrinters,
  diagnostics: renderDiagnostics,
  templates: renderTemplates,
  'template-sandbox': renderSandbox,
  'paper-profiles': renderPaperProfiles,
  webhooks: renderWebhooks,
  'route-policies': renderRoutePolicies,
  'printer-bindings': renderBindings,
  'print-flow': renderPrintFlow,
  'job-queue': renderJobQueue,
  'job-detail': renderJobDetail,
  runners: renderRunners,
  'audit-logs': renderAudit,
  export: renderExport,
  users: renderUsers,
  settings: renderSettings,
};

function buildNavigation() {
  const c = copy[locale];
  navRoot.innerHTML = ['operations', 'admin'].map((group) => `
    <section class="nav-group">
      <h2>${esc(c[group])}</h2>
      <ul class="page-nav">
        ${pages.filter((page) => page.group === group).map((page) => `<li><button type="button" data-page="${page.id}" ${page.id === currentPage ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${page.icon}</span><span class="nav-label">${esc(page[locale][0])}</span></button></li>`).join('')}
      </ul>
    </section>`).join('');

  navRoot.querySelectorAll('[data-page]').forEach((control) => {
    control.addEventListener('click', () => {
      currentPage = control.dataset.page;
      closeRail();
      render();
      document.querySelector('#preview').focus({ preventScroll: true });
    });
  });
}

function render() {
  const page = pages.find((candidate) => candidate.id === currentPage) ?? pages[0];
  toolbarTitle.textContent = page[locale][0];
  toolbarSubtitle.textContent = page[locale][1];
  document.documentElement.lang = locale;
  screen.innerHTML = renderers[page.id](page);
  buildNavigation();
}

function openRail() {
  rail.classList.add('is-open');
  railScrim.hidden = false;
  railToggle.setAttribute('aria-expanded', 'true');
}

function closeRail() {
  rail.classList.remove('is-open');
  railScrim.hidden = true;
  railToggle.setAttribute('aria-expanded', 'false');
}

railToggle.addEventListener('click', () => rail.classList.contains('is-open') ? closeRail() : openRail());
railScrim.addEventListener('click', closeRail);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeRail(); });

document.querySelector('#viewport-select').addEventListener('change', (event) => {
  frame.dataset.viewport = event.target.value;
});

document.querySelectorAll('[data-locale]').forEach((control) => {
  control.addEventListener('click', () => {
    locale = control.dataset.locale;
    document.querySelectorAll('[data-locale]').forEach((item) => item.setAttribute('aria-pressed', String(item === control)));
    render();
  });
});

render();
