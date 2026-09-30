# PrintOps — สรุปความสามารถและฟีเจอร์ทั้งหมด

เอกสารนี้สรุปความสามารถของโปรแกรม PrintOps จาก source code และเอกสารใน repository ณ วันที่ 2026-08-10

PrintOps คือ **print gateway สำหรับระบบโรงพยาบาล/เครือข่าย on-premise** ทำหน้าที่รับคำสั่งพิมพ์จากระบบภายนอก จัดคิว ตรวจสอบข้อมูล เลือก printer/template แล้วส่งงานไปยังเครื่องพิมพ์ผ่าน worker ที่อยู่ในเครือข่ายเดียวกัน พร้อมติดตามผลและแจ้งผลกลับไปยังระบบต้นทาง

## สถานะที่ใช้ในเอกสาร

| สัญลักษณ์ | ความหมาย |
|---|---|
| ✅ | มี implementation และเป็นความสามารถหลักของระบบ |
| 🟡 | มีโค้ดหรือมีในโหมด dev/ทางเลือก แต่ยังต้องตั้งค่า ทดสอบกับอุปกรณ์จริง หรือยังไม่ใช่ production path หลัก |
| ⛔ | ยังไม่รองรับใน production boundary ปัจจุบัน หรืออยู่ในแผนงานภายหลัง |

## 1. ภาพรวมการทำงาน

~~~text
ระบบต้นทาง / HIS integration
          │  HTTP API หรือ NATS JetStream
          ▼
PrintOps API
  ├─ authenticate / authorize
  ├─ idempotency / validate / route
  ├─ render template
  ├─ queue และจัดลำดับตาม printer
  └─ trace / audit / callback
          ▼
Local print worker หรือ runner
          ▼
Windows printer driver / Windows spooler
          ▼
เครื่องพิมพ์จริง
          │
          └─ device-side evidence / SNMP / IPP correlation
                         ▼
              SUCCESS / UNVERIFIED / FAILED / TIMEOUT
~~~

PrintOps **ไม่เชื่อมต่อ HIS หรือระบบคลินิกโดยตรง** ระบบ integration ภายนอกต้องอ่านข้อมูลจาก HIS แล้วเรียก PrintOps API เอง จุดนี้ทำให้ PrintOps แยกจาก business logic ของ HIS และนำไปใช้กับหลายระบบต้นทางได้

## 2. ความสามารถหลักแบบสรุป

| ด้าน | ความสามารถ |
|---|---|
| รับงานพิมพ์ | รับงานผ่าน HTTP API, dynamic endpoint และ NATS JetStream |
| ความถูกต้องของคำสั่ง | ตรวจ API key, printer/template/profile/binding, ขนาด payload, จำนวนสำเนา และข้อมูลจำเป็น |
| ป้องกันพิมพ์ซ้ำ | idempotency จาก source system + request ID, คืนผลเดิมเมื่อเป็น duplicate |
| งานและคิว | สถานะครบตั้งแต่รับงานจนถึงผลพิมพ์, priority, queue, per-printer serial ordering, ยกเลิกก่อน dispatch |
| การแสดงผล | template, paper profile, ตัวแปร, barcode, QR code, preview และ sandbox |
| เครื่องพิมพ์ | ลงทะเบียนเอง, ค้นหา printer จากเครื่อง runner, ดูสถานะ, test print, ดู queue และยกเลิกงานบน Windows |
| หลักฐานการพิมพ์ | ตรวจ spooler acceptance และพยายามยืนยันจาก device-side page counter หรือ printer-side IPP job |
| แจ้งผล | HTTP/NATS callback, HMAC signing, durable delivery, retry และ crash recovery |
| Routing | route policy แบบ field matching และ mapping ไปยัง printer/template/payload/priority |
| ผู้ใช้งาน | OWNER, ADMIN, OPERATOR, VIEWER พร้อม JWT และ server-side RBAC |
| ระบบปฏิบัติการ | Windows desktop package แบบ Tauri พร้อม local API, local worker, Go runner และ C# print helper |
| ตรวจสอบย้อนหลัง | trace รายขั้นตอน, audit log, callback delivery log, export และ support bundle |
| ภาษาและ UI | English/Thai, responsive dashboard, keyboard navigation, reduced motion และ high contrast |

## 3. โครงสร้างโปรแกรม

ระบบเป็น monorepo ที่แบ่งเป็นส่วนหลักดังนี้

| ส่วนประกอบ | หน้าที่ |
|---|---|
| apps/api | Fastify TypeScript API, authentication, job intake, queue, local executor, templates, webhooks, callbacks, audit และ static SPA serving |
| apps/web | React + Vite dashboard สำหรับ operator/admin |
| apps/desktop | Tauri v2 Windows shell, sidecar supervisor, secure local settings และ native file operations |
| apps/runner-go | runner สำหรับ register, heartbeat, printer discovery และโหมด execute ที่เป็นทางเลือก |
| apps/windows-print-helper | C# WebView2 helper สำหรับพิมพ์ HTML ผ่าน Windows print dialog/driver rendering |
| packages/domain | domain model, statuses, permissions, validation และ contract |
| packages/shared | shared types/utilities ระหว่าง API, web และ runner |
| packages/adapters | printer adapter และ abstraction ของการเชื่อมต่ออุปกรณ์ |

ใน packaged desktop ปัจจุบัน API local worker เป็น executor หลัก ส่วน Go runner ทำ discovery และ heartbeat เป็นหลัก เพื่อบังคับให้มี **single executor** และป้องกันการพิมพ์ซ้ำจากหลาย executor

## 4. หน้าจอและฟีเจอร์ใน Dashboard

> สิทธิ์ด้านล่างเป็นสิทธิ์การเข้าถึงเมนูโดยทั่วไป การตรวจ permission จริงยังทำซ้ำที่ server ทุกครั้ง

| หน้า | ความสามารถ | สิทธิ์โดยทั่วไป |
|---|---|---|
| Dashboard | ดูจำนวนงานตามสถานะ, printer health, latency/queue summary, recent jobs และสถานะระบบแบบ polling | ทุก role |
| Printers | ดูรายการ printer, code, ชื่อ, location, protocol, status, max copies, active และ refresh สถานะ | ทุก role |
| Printer Detail | ดู configuration/connection URI, department/location, สถานะสด, refresh และ physical test print | ทุก role; การควบคุมตาม permission |
| Discovered Printers | ดู printer ที่ runner พบ, driver, port, connection type, default/shared, computer, OS, last seen และ registered state; ยืนยันการลงทะเบียน | OWNER/ADMIN |
| Local Diagnostics | ดูสุขภาพ runner และ discovered printers, ขอ discovery ทันที, ดู error/driver/port/default/last seen/registration และ polling | OWNER/ADMIN/OPERATOR |
| Templates | ค้นหา/กรอง/sort/paginate template, สร้าง/แก้ไข/duplicate, preview, publish, disable/archive และลบเมื่อไม่มี binding | ทุก role; เขียนข้อมูลตาม permission |
| Template Sandbox | validate template, render preview, run batch/sample, ทดลอง webhook และ test print แบบมี safety confirmation | OWNER |
| Paper Profiles | สร้าง/แก้ไข/ลบ paper profile, ตั้งขนาด/margin/DPI/orientation, import/export และกำหนด dynamic fields | ทุก role; เขียนข้อมูลตาม permission |
| Webhooks | สร้าง endpoint, ตั้ง auth/route/callback, draft/enabled, enable/disable, ทดสอบ callback, ดู callback log และ import/export JSON | OWNER/ADMIN |
| Route Policies | สร้างและดู policy ที่ match field แล้ว map ไปยัง printer/template/payload/priority | OWNER/ADMIN |
| Printer Bindings | ผูก printer กับ template และ paper profile, ตั้ง default/enabled และจัดการ binding ที่ใช้กับ dynamic print | OWNER/ADMIN |
| Print Flow Bindings | แสดง topology ของ HTTP/NATS, ตัวอย่าง payload, binding editor และ live intake log พร้อม filter rejected-only | OWNER |
| Job Queue | auto-refresh, ค้นหา/กรองทุกสถานะ, pagination, เลือกหลายรายการ, batch reprint และดูคิว | ทุก role |
| Job Detail | ดู verdict, trace, evidence, timeline, duration, callback intent/delivery, error และข้อมูล reprint; raw payload ถูก redacted | ทุก role |
| Runners | ดูชื่อ/hostname/protocol/status/last heartbeat/registered และ health ของ runner | ทุก role; การจัดการตาม permission |
| Audit Logs | ค้นหาและตรวจเหตุการณ์สำคัญ เช่น login, print, reprint, registration, key rotation, callback และ settings | OWNER/ADMIN |
| Export Center | export jobs, audit logs และ printers เป็น CSV/JSON | OWNER/ADMIN |
| Users & Roles | ดู users, เปลี่ยน password ของบัญชีระดับต่ำกว่า, activate/deactivate และกำหนด allowed pages | ทุก roleแบบจำกัด; การแก้ไขตามระดับสิทธิ์ |
| Settings | ภาษา, project/workspace, service accounts, runtime architecture, readiness, database backup, support bundle และ NATS settings บน desktop | OWNER/ADMIN; บางส่วน OWNER |
| Auth/Shell | bootstrap owner ครั้งแรก, login, splash ระหว่างรอ local API, session expiry และ error boundary | ตามสถานะ session |

ฟังก์ชัน UI ที่ทำงานข้ามหลายหน้าประกอบด้วย loading/error/empty states, confirmation dialog สำหรับ action ที่มีความเสี่ยง, responsive table-to-card layout, keyboard focus, aria labels, toast feedback, polling indicator และการแสดงเวลาหรือ freshness ของข้อมูล

## 5. การจัดการ Print Job

### 5.1 Lifecycle

~~~text
ACCEPTED → VALIDATED → QUEUED → DISPATCHED → PRINTING
                                                   ├→ SUCCESS
                                                   ├→ UNVERIFIED
                                                   ├→ FAILED
                                                   └→ TIMEOUT

ACCEPTED / VALIDATED / QUEUED ─→ CANCELLED
~~~

สถานะ DUPLICATE_RETURNED ใช้เป็นผลตอบกลับของ intake เมื่อพบ request เดิม ไม่ใช่สถานะ terminal ที่เปลี่ยนใน job เดิม

| สถานะ | ความหมาย |
|---|---|
| ACCEPTED | API รับคำสั่งและสร้างงานแล้ว |
| VALIDATED | ผ่านการตรวจข้อมูล/สิทธิ์/target แล้ว |
| QUEUED | รอ scheduler ของ printer เป้าหมาย |
| DISPATCHED | ส่งเข้าสู่ executor/runner แล้ว |
| PRINTING | spooler รับงานหรือเริ่มมี execution evidence |
| SUCCESS | มีหลักฐานระดับอุปกรณ์ที่ยืนยันงานนี้สำเร็จ |
| UNVERIFIED | ส่งถึงเส้นทางพิมพ์แล้วแต่ยังไม่มีหลักฐานที่ผูกกับ job นี้อย่างเพียงพอ |
| FAILED | ระบบระบุสาเหตุล้มเหลวได้และงานยังไม่ถือว่าสำเร็จ |
| TIMEOUT | หมด watchdog โดยยังไม่มี verdict; กระดาษอาจถูกพิมพ์แล้ว |
| CANCELLED | ยกเลิกได้ก่อน dispatch จึงไม่ควรมีการส่งไปเครื่องพิมพ์ |

### 5.2 ข้อมูลและ trace ที่เก็บ

แต่ละงานมีข้อมูลสำคัญ เช่น

- request ID, source system, source reference, endpoint code, job ID, trace ID และ correlation ID
- printer code, template code, paper profile, route policy, priority, copies, duplex, color mode, media และ resolution
- timestamp ของ received, validated, queued, dispatched, runner, spooler, started, finished และ completed
- latency ของ total, validation, queue wait, dispatch, runner execution, spooler, printer acknowledgement และ template rendering
- trace steps ที่ระบุ timestamp, duration, status, error, adapter, runner, printer และ evidence
- redacted payload snapshot สำหรับการตรวจสอบ โดยไม่เปิด raw document ใน job detail/log
- render warnings, missing fields, error code และ callback intent

### 5.3 Queue และการป้องกันพิมพ์ซ้ำ

- รองรับ priority: urgent, high, normal, low
- งานของ printer เดียวกันถูก execute แบบเรียงลำดับ งานคนละ printer ทำพร้อมกันได้
- scheduler ลด idle gap ระหว่างงานที่รออยู่บน printer เดียวกัน
- มี conditional atomic claim ป้องกัน executor สองตัวหยิบ job เดียวกัน
- ใช้ idempotency จาก source system + request ID; duplicate จะคืน job เดิมโดยไม่พิมพ์ซ้ำ
- reprint เป็นการสร้าง job ใหม่ มีเหตุผล, จำนวนสำเนา, request identity และ duplicate-risk acknowledgement
- batch reprint ทำได้จาก Job Queue ตาม permission

### 5.4 Recovery, cancellation และความไม่แน่นอน

- งานที่ค้างใน ACCEPTED/VALIDATED หลัง restart สามารถ recover กลับเข้า queue ได้
- งานที่อยู่ DISPATCHED/PRINTING ตอน restart จะถูกเปลี่ยนเป็น UNVERIFIED และไม่ถูก replay อัตโนมัติ
- cancellation ก่อน dispatch ยกเลิกได้; หลัง dispatch API ตอบ CANCEL_REQUESTED และผลทางกายภาพเป็นผู้ชี้ขาด
- UNVERIFIED และ TIMEOUT ไม่ถูก auto-retry เพราะอาจพิมพ์ออกไปแล้ว
- timeout ของ execution มีค่าเริ่มต้น 180 วินาทีและปรับผ่าน configuration ได้

## 6. ช่องทางรับงานและการเชื่อมต่อระบบภายนอก

### 6.1 HTTP Print API

เส้นทางหลักคือ POST /api/v1/print-jobs

รองรับข้อมูลหลัก ได้แก่

- request ID และ source system
- printer code
- template code (ถ้าต้องการให้ระบบเลือก template)
- payload สำหรับแทนค่าลง template
- copies, priority, metadata และ endpoint code
- ตัวเลือกการพิมพ์ เช่น duplex, color mode, media และ resolution ตาม printer capability/policy

ความสามารถของ endpoint:

- บังคับ API key ของ service account
- ตรวจ allowlist ของ printer/template และ max copies/max payload
- ตรวจ request ID, printer, template, paper profile และ binding
- คืน 201 สำหรับงานใหม่และ 200 พร้อมข้อมูล job เดิมเมื่อเป็น duplicate
- คืน trace ID และข้อมูลติดตามงาน
- query ด้วย job ID หรือ request ID
- cancel ก่อน dispatch
- อ่าน job trace และสถานะล่าสุด

API key ของ service account จะถูกตรวจด้วย hash และ timing-safe comparison ไม่ส่ง key กลับมาในรายการ และ key ที่สร้าง/rotate จะแสดงให้เห็นเพียงครั้งเดียว

### 6.2 Dynamic Print Endpoint

เส้นทาง POST /api/v1/printer/:code_template/:code_profile รองรับกรณีที่ระบบต้นทางระบุ template และ paper profile ด้วย code

- resolve template และ paper profile จาก code
- ค้นหา enabled binding ของ template + profile กับ printer
- ถ้ามี default binding จะเลือกก่อน ถ้าไม่มีจะเลือก binding ที่ใช้ได้รายการแรก
- รองรับ printer_code override ตาม policy
- ใช้ validation, idempotency, trace, audit และ callback flow เดียวกับ print job ปกติ

### 6.3 Webhook Intake และ Route Policy

เส้นทาง POST /api/v1/intake/:endpointCode รับ payload จาก endpoint ที่ตั้งค่าไว้ในหน้า Webhooks

ตั้งค่าได้:

- endpoint code/name/source system
- auth mode: none หรือ API key
- enabled/draft
- route policy
- callback transport: none, HTTP, NATS หรือทั้งสองแบบ
- callback URL หรือ NATS subject
- callback payload template
- callback on print result

Route policy รองรับการ match แบบ field equals value แล้ว map ไปยัง:

- printer
- template
- payload
- priority

ระบบรองรับ field syntax ใน callback/template เช่น $.field สำหรับค่าจาก intake และ $$.field สำหรับ system/callback fields พร้อมปฏิเสธ policy ที่ใช้ raw JavaScript, eval, function หรือ arrow function

บนหน้า Webhooks ผู้ดูแลสามารถ:

- สร้าง/แก้ไข endpoint และ save เป็น draft หรือ enabled
- enable/disable/delete ทีละรายการหรือแบบ batch
- import/export configuration JSON ทั้งหมด, ตาม filter หรือรายการที่เลือก
- ทดสอบ endpoint และดูผลจริงแยกตาม transport, HTTP status, error และ duration
- ดู callback log โดยกรอง failed-only, transport, endpoint และ trigger

### 6.4 NATS JetStream Intake

NATS เป็นช่องทางรับงานแบบ asynchronous สำหรับ client ที่กำหนด scope ไว้

- subject หลักตามรูปแบบ medisync.print.intake.<client-id>
- client-scoped durable consumer
- envelope มี target client ID ซ้ำเพื่อป้องกันส่งข้าม workstation
- ACK เมื่อรับและประมวลผลสำเร็จ
- payload ที่ผิดถาวร เช่น template/profile/binding/missing field ที่ไม่ผ่าน policy จะส่ง DLQ และ terminate
- transient failure จะ NAK และ retry จนถึง max delivery
- intake attempt และ outcome ถูกบันทึก
- invalid NATS configuration จะ fail closed โดยยังไม่ทำลาย HTTP intake
- มี status, reconnect, readiness และ test connection
- ตั้งค่า URL, client ID, subject prefix และดู subject preview ได้ใน Settings ของ desktop

NATS intake ใช้ trust boundary ของ network ภายใน ไม่รับ authentication header แบบ HTTP และไม่ควร expose NATS port ออกอินเทอร์เน็ต

### 6.5 Idempotency และการตรวจข้อมูล

- request ID เป็นค่าบังคับสำหรับ external intake
- duplicate request จะคืนผลของ job เดิมและไม่สร้างการพิมพ์ใหม่
- payload ที่มี field หายสามารถพิมพ์ได้พร้อม data_quality=WITH_WARNINGS และ missing_fields ตาม policy
- render failure ที่ทำให้สร้างเอกสารไม่ได้จะถูก reject ก่อนเข้าคิว
- payload snapshot ที่เก็บใน job และ log เป็นข้อมูล redacted

## 7. Result Callback และ Webhook Delivery

ระบบส่งผลกลับไปยังระบบต้นทางได้ทั้ง HTTP และ NATS

### 7.1 Callback payload

canonical v2 envelope มีข้อมูล เช่น

- version, event ID, event type, occurred at, request ID, job ID
- source system, client ID, status, duplicate
- data quality, missing fields และ render warnings
- printer code, runner ID, trace ID และ error
- timeline และ delivery metadata

callback ไม่ใส่ raw print payload เพื่อจำกัดการรั่วไหลของข้อมูล

รองรับ callback สองลักษณะ:

- acceptance notification เมื่อรับงาน
- terminal print result เมื่อมีผลลัพธ์สุดท้ายตามการตั้งค่า callbackOnPrintResult

### 7.2 ความทนทานและความปลอดภัย

- เก็บ delivery record ใน SQLite: PENDING, DELIVERING, DELIVERED, RETRY_SCHEDULED, FAILED
- retry สำหรับ network error, timeout, 408, 429 และ 5xx
- ไม่ retry error 4xx ที่เป็น permanent หรือ URL ที่ไม่ผ่าน SSRF guard
- มี bounded retry schedule โดยค่าเริ่มต้นประมาณทันที, 5 วินาที, 30 วินาที, 2 นาที และ 10 นาที พร้อม jitter
- recover delivery ที่ค้างในสถานะ in-flight หลัง process crash
- callback failure ไม่เปลี่ยน print result ของ job
- HTTP callback ใช้ HMAC signing ได้เมื่อกำหนด secret reference
- ส่ง event headers เช่น event ID และ trace/request identity
- SSRF guard ปฏิเสธ non-http(s), URL ที่ฝัง credential, metadata/link-local/multicast/0.0.0.0 และรองรับ allowlist host/CIDR
- NATS result callback ใช้ JetStream เป็นค่าเริ่มต้น หรือ Core NATS แบบ best-effort ได้

Job Detail แยกให้เห็นชัดว่า **งานพิมพ์สำเร็จหรือไม่** กับ **callback ส่งสำเร็จหรือไม่** เป็นคนละผลลัพธ์

## 8. Printer และการเชื่อมต่ออุปกรณ์

### 8.1 Printer model และสถานะ

Printer มีข้อมูล code, name, location, department, protocol, connection URI, capabilities, allowed templates, max copies, metadata และ active state

สถานะที่แสดงได้ ได้แก่ online, offline, error, busy, idle และ unknown พร้อมข้อมูลเวลา refresh/last seen

capability ที่ระบบใช้ตรวจประกอบด้วย:

- สีหรือขาวดำ
- duplex
- ขนาดกระดาษและ media
- resolution
- max copies

### 8.2 Windows Spooler Adapter

เป็น production print path หลักของ packaged Windows desktop

- ค้นหา printer ด้วย Windows Get-Printer
- อ่าน live printer status และ queue
- ส่ง text/plain ผ่าน Windows Out-Printer
- ส่ง HTML ผ่าน C# WebView2 helper และ PrintAsync ไปยังชื่อ printer ที่กำหนด
- ส่ง raw bytes ผ่าน Windows RawPrinterHelper เมื่อ flow ต้องใช้
- รองรับ copies, duplex, color, media และ resolution ตามที่อุปกรณ์/driver รองรับ
- ทดสอบพิมพ์และยกเลิกงานใน Windows queue
- serialize send + verify ต่อ printer เพื่อรักษาลำดับและลด race condition
- ทำ spooler progress tracking และบันทึก execution timing
- บน non-Windows จะไม่พยายามหลอกว่าใช้งานได้ แต่คืน error ตาม platform

### 8.3 การยืนยันผลพิมพ์

การที่ Windows spooler รับงานถือเป็นเพียง acceptance ไม่ใช่หลักฐานว่ากระดาษออกสำเร็จ ระบบจึงพยายามตรวจ:

- correlated printer-side IPP job และจำนวน impressions ที่ completed successfully
- SNMP page counter เช่น prtMarkerLifeCount ที่เพิ่มขึ้น
- evidence ของ local spooler delivery สำหรับกรณี WSD ที่ใช้ได้

ถ้าไม่มี evidence ที่ผูกกับ job นี้อย่างน่าเชื่อถือ ระบบใช้ UNVERIFIED แทน SUCCESS และแสดงหลักฐาน/เหตุผลใน trace

### 8.4 Adapter/protocol อื่น

| Adapter/protocol | สถานะ |
|---|---|
| Fake printer | ✅ ใช้จำลองใน dev/MVP/test |
| Windows spooler | ✅ production path ปัจจุบันบน Windows |
| SNMP | 🟡 ใช้ดู status/page counter verification ไม่ใช่เส้นทางส่งงานหลัก |
| IPP | 🟡 มี adapter/การ correlation บางส่วน แต่ไม่ใช่ production execution path หลัก |
| CUPS | ⛔ ยังไม่ใช่ production boundary |
| Raw TCP 9100 | ⛔ มีโครง/ตัวเลือก แต่ยังไม่เปิดเป็น production path |
| ZPL/TSPL direct execution | ⛔ ยัง deferred สำหรับ direct remote execution |

### 8.5 Printer discovery

Runner ค้นหา printer แบบ read-only จาก OS แล้ว sync เข้าระบบ

- Windows: PowerShell Get-Printer และ Get-PrinterPort
- macOS: lpstat -p, lpstat -v, lpstat -d ในโหมดที่มี runner
- Fake: printer ชุดจำลองสำหรับ lab
- แสดง driver, port, connection type, default/shared, computer, OS และ last seen
- deduplicate discovered printer ใน global view
- ผู้ดูแลยืนยัน discovered printer เพื่อสร้าง registered active printer
- ไม่ restart spooler และไม่แก้ driver/port configuration โดยอัตโนมัติ
- ขอ discovery ทันทีจากหน้า Diagnostics/Discovery ได้

## 9. Runner

Go runner รองรับ:

- register กับ API ด้วย runner secret
- heartbeat และ health status
- printer discovery และ discovery sync
- structured logs และ metrics
- job polling/execution/result reporting ในโหมดที่เปิดใช้งาน
- fake/windows-spooler/rawtcp/cups executor modes ในฐานะตัวเลือกทางเทคนิค

metrics สำคัญ ได้แก่ job_pickup_latency_ms, runner_exec_ms, result_report_ms, discovery_duration_ms, api_roundtrip_ms และ heartbeat_roundtrip_ms

ขอบเขต production ปัจจุบัน:

- runner ใน packaged desktop ทำ discovery + heartbeat
- local TypeScript worker เป็นผู้ execute งานพิมพ์เพียงตัวเดียว
- remote/headless runner และ runner job execution ยังไม่ใช่ supported pilot path
- CLI install-service/uninstall-service ยังเป็น stub สำหรับงานในอนาคต

## 10. Template และการสร้างเอกสาร

### 10.1 Template

Template มี code, name, description, engine, content, version, status และ paper profile

engine ที่ model/editor รองรับ:

- RAW_TEXT
- ZPL
- TSPL
- EPL
- HTML
- PDF_LIKE_PREVIEW
- JSON_LAYOUT

สถานะ template:

- DRAFT
- PUBLISHED
- DISABLED
- ARCHIVED

ฟีเจอร์ใน Template workspace:

- สร้าง/แก้ไข/duplicate template
- เลือก engine และ paper profile
- แก้ content และ insert variables
- insert label, barcode, date, time และ sequence token
- insert barcode/QR token
- local preview และ server preview
- sample mode: default, profile และ empty
- full-page preview
- แสดง missing fields และ warning
- publish, disable/archive และ delete เมื่อไม่มี printer binding
- import/export template configuration เป็น JSON
- search, status/engine filter, sort และ pagination

### 10.2 Rendering

Simple template renderer รองรับ placeholder เช่น {{field}} และ barcode renderer ที่ใช้ bwip-js สำหรับ barcode ที่ระบบรองรับ

barcode symbology ใน dynamic field ได้แก่:

- CODE128
- CODE39
- EAN13
- DataMatrix

รองรับ QR code และ dynamic value เช่น text, number, date รวมถึง default value

การ preview HTML มีการ sanitize ฝั่ง client และ sandbox มี validation ก่อนพิมพ์

### 10.3 Paper Profile

Paper profile กำหนด:

- code/name
- width/height เป็น mm
- margins
- DPI: 203, 300 หรือ 600
- orientation: portrait หรือ landscape
- unit
- dynamic fields และ default values

มี preset เช่น A4, A5, Letter, 100x50, 80x50, 60x40, 40x30 และ receipt 80x297

Visual label designer รองรับ:

- วางและเลือก field บน canvas
- ruler, grid และ alignment guide
- toggle dimensions และ full/expanded preview
- nudge field และ center แนวนอน/แนวตั้ง
- แสดงหน่วย mm/cm/px
- ตั้ง font family, font size, weight, color, background และ watermark preference สำหรับ preview
- field position ที่บันทึกเป็นหน่วยจริง mm
- field type text, barcode, qrcode, date และ number

### 10.4 Artwork/image import

Import design/artwork รองรับ workflow:

- วิเคราะห์ไฟล์ก่อน import
- ตรวจ SHA-256, MIME, pixel dimensions, DPI และ physical size ที่แนะนำ
- แจ้ง warning เรื่องขนาด/ความละเอียด
- เลือก fit mode: contain, cover หรือ stretch
- รองรับ PNG/JPEG ตาม image parser
- เก็บ artwork และนำไปใช้ใน paper profile/preview

### 10.5 Auto template และ binding

เมื่อสร้างหรือแก้ paper profile ระบบสามารถสร้าง/ปรับ companion HTML template อัตโนมัติ เช่น profile auto-template และ sync field/layout ให้สอดคล้องกัน

Binding ใช้กำหนดว่า:

- printer ใดใช้ template ใด
- paper profile ใด
- binding เปิดใช้งานหรือไม่
- default binding ของชุดนั้นคือรายการใด

ระบบป้องกันการลบ template ที่ยังถูก bind และป้องกันการลบ paper profile ที่มี custom template อ้างอิง

### 10.6 Sandbox และ test print

Sandbox รองรับ:

- validate template
- render preview
- run ตัวอย่าง/หลายรายการ
- ทดสอบ webhook callback
- connectivity check และ connectivity report
- physical test print ที่ต้องผ่าน confirmation เพื่อป้องกันพิมพ์ผิดเครื่อง

หมายเหตุ: route POST /api/v1/templates/:id/test-print ใช้บันทึก/รับรองคำขอ test-print ใน audit flow; การทดลองพิมพ์จริงที่มี safety flow อยู่ใน sandbox/physical printer test path

## 11. Webhook, Routing และ Print Flow UI

หน้า Print Flow แสดงภาพรวมการตั้งค่า runtime:

- HTTP intake endpoint
- NATS URL แบบ redacted
- client ID, subject และ durable consumer
- stream/consumer readiness
- callback transport
- single-executor topology

นอกจากนี้ยังมี:

- binding editor สำหรับ template/profile/printer/default/enabled
- ตัวอย่าง HTTP และ NATS payload
- live intake log
- filter rejected-only
- สถานะ accepted, duplicate, rejected และ error

## 12. Authentication, Roles และ Security

### 12.1 Human authentication

- first-run bootstrap สำหรับสร้าง OWNER
- login ด้วย email/password
- JWT สำหรับ dashboard/internal API
- runner login ด้วย runner secret ได้ JWT ที่จำกัด scope
- GET /api/me สำหรับอ่านตัวตนและสิทธิ์
- session expiry และ forced re-login ใน web UI
- password validation และ password confirmation ใน setup/change flow

### 12.2 Roles

| Role | ขอบเขตโดยสรุป |
|---|---|
| OWNER | ควบคุมทุกส่วน, bootstrap, users/roles, service accounts, settings และ destructive/admin operations |
| ADMIN | จัดการ printer, jobs, runners, templates, paper profiles, webhooks, audit และ export ตาม permission |
| OPERATOR | ดู/ควบคุม printer, สร้าง/ดู/cancel/retry job, ดู runner/trace และใช้ template/paper ที่อ่านได้ |
| VIEWER | อ่านข้อมูล printer, job, runner, trace, template และ paper profile แบบ read-only |

ระบบมี permission แยกตาม resource/action และตรวจซ้ำที่ server เช่น job read/create/cancel/retry, printer read/control, template CRUD/publish/delete, audit/export, user management และ settings

UI รองรับ per-user allowedPages; OWNER ได้ทุกหน้า และ direct URL ก็ผ่าน route guard อีกชั้นหนึ่ง

### 12.3 Service accounts

OWNER สร้าง machine credential สำหรับระบบต้นทางได้ โดยกำหนด:

- source system
- allowed printer codes
- allowed template codes
- max copies per job
- max payload bytes
- active/revoked state

รองรับ list metadata แบบปลอดภัย, rotate key, revoke key และ audit ทุก action

### 12.4 Safety controls

- external intake ไม่เปิด anonymous access
- body limit ของ API v1 ประมาณ 12 MiB
- API key จำกัด printer/template/copies/payload ตาม service account
- idempotency ป้องกัน duplicate print
- raw payload ไม่ปรากฏใน trace/log/support bundle
- HMAC สำหรับ callback
- SSRF protection สำหรับ outbound HTTP callback
- no password reset backdoor
- database backup มี installation secrets จึงต้องเก็บ/ส่งต่อแบบเข้ารหัสและจำกัดสิทธิ์
- physical test print ใช้ confirmation และแสดง target printer ให้ตรวจสอบ
- uncertain physical outcome ไม่ถูก auto-replay

## 13. Audit, Export และ Diagnostics

### Audit

บันทึกเหตุการณ์สำคัญ เช่น:

- bootstrap/login
- รับงาน, duplicate, reject และ lifecycle transition
- print/reprint/cancel/test print
- printer/runner registration
- template/profile/binding changes
- webhook/callback delivery
- service-account create/rotate/revoke
- settings และ database/support bundle download

### Export Center

ดาวน์โหลดข้อมูลได้เป็น:

- jobs CSV
- jobs JSON
- audit CSV
- printers CSV

การดาวน์โหลดใช้ authenticated route และ export ตาม filter/selection ที่หน้าจอรองรับ

### Readiness

Readiness ตรวจ component เช่น:

- desktop shell
- local API
- database
- local print worker
- discovery runner
- selected printer
- NATS core
- JetStream/stream/durable consumer
- HTTP callback
- NATS callback
- callback retry queue

ผลลัพธ์มี READY, DEGRADED, NOT_CONFIGURED และ UNAVAILABLE พร้อมรายละเอียดเพื่อวินิจฉัยปัญหา

### Support bundle

ดาวน์โหลด support bundle แบบ sanitized ได้ โดยตัด credentials, sensitive URL fields และ raw payload ออก พร้อมรวมข้อมูลที่ช่วย support เช่น runtime/readiness, recent intake/callback attempts, delivery state, runner/printer discovery และ log tail ตามที่ระบบเปิดเผย

## 14. Persistence และความทนทาน

### SQLite ใน packaged desktop

- ใช้ sql.js/WASM จึงไม่ต้องพึ่ง native database module
- ใช้ process lock แบบ exclusive
- save แบบ atomic replace
- migration แบบมี version
- ทำ pre-migration backup
- retention sweep และ archive ก่อนลบข้อมูลที่หมดอายุ
- terminal jobs/audit rows และ callback/trace ที่สัมพันธ์กันสามารถถูก archive ตาม retention
- database backup ดาวน์โหลดได้จาก Settings

ค่าเริ่มต้นของ retention ใน production config คือ age-based ประมาณ 14 วัน และไม่จำกัดจำนวนแถวโดยอัตโนมัติ หากไม่ตั้งค่าอื่น

โหมด in-memory ยังมีไว้สำหรับ test/quick development

### Runtime reliability

- queue/job/callback state ถูกเก็บถาวรเพื่อกู้คืนหลัง restart
- callback worker กู้ delivery ที่ค้างหลัง crash
- local print scheduler แยก serial chain ต่อ printer
- API มี readiness/health endpoint
- packaged desktop มี sidecar supervision และ restart เมื่อ process ลูกหยุดผิดปกติ
- การเริ่มใช้งานหน้า UI รอ local API healthy ก่อน

PostgreSQL, Redis และ docker scaffolding มีใน repository เพื่อการขยาย/อนาคต แต่ application path ปัจจุบันใช้ SQLite และไม่สื่อสารกับ PostgreSQL/Redis เป็น production dependency

## 15. Windows Desktop Package

Tauri v2 desktop package มีความสามารถ:

- Windows-only packaged application
- single-instance; การเปิดซ้ำจะ focus instance เดิม
- bundle API server, Go runner, sql-wasm, static SPA และ C# print helper
- sidecar supervisor ตรวจและ restart server/runner ทุกช่วงเวลาที่กำหนด
- ใช้ Windows Job Object เพื่อ cleanup sidecar เมื่อ desktop ปิด
- splash/health-gated navigation จน local API พร้อม
- สร้าง JWT secret และ runner bootstrap secret แบบสุ่มแยกต่อ installation
- เก็บ DB ใน per-user app data นอก install folder
- settings NATS แบบ local file พร้อม apply-and-restart backend
- native save dialog สำหรับ export
- เตรียม Windows MSI และ NSIS target

Web dashboard รัน dev ผ่าน Vite ได้ แต่ packaged desktop โหลด SPA ที่ build แล้วผ่าน local API ไม่ใช่ Vite HMR

## 16. API surface ตามกลุ่มฟีเจอร์

รายการนี้เป็น path family สำคัญของระบบ ไม่รวม health/static assets และ route compatibility บางรายการ

| กลุ่ม | Endpoint หลัก |
|---|---|
| Health | /health, /api/health |
| Human auth | /api/auth/bootstrap, /api/auth/login, /api/auth/runner, /api/me |
| Jobs | /api/v1/print-jobs, /api/v1/print-jobs/:id, /api/v1/print-jobs/by-request-id/:requestId, /:id/cancel, /:id/trace |
| Dynamic print | /api/v1/printer/:code_template/:code_profile |
| Printers | /api/v1/printers, /api/v1/printers/:id/status |
| Templates | /api/v1/templates, /api/v1/templates/:id, /:id/preview, /:id/publish, /:id/test-print |
| Paper profiles | /api/v1/paper-profiles, /api/v1/paper-profiles/:id, export/import และ artwork routes |
| Bindings | /api/v1/printer-template-bindings และ /:id |
| Sandbox | /api/v1/sandbox/run, run-batch, validate-template, render-preview, test-webhook, test-print |
| Webhook intake | /api/v1/intake/:endpointCode |
| Webhook config | /api/v1/webhook-endpoints, /:id/test, /:id/callback-test, callback log และ callback deliveries |
| Route policies | /api/v1/webhook-route-policies |
| Discovery | /api/v1/discovered-printers, runner discovery request/sync และ /:id/register |
| Runners | register, heartbeat, poll และ runner job next/events/result routes |
| Print Flow | config, NATS status/test, runtime architecture และ intake log |
| Users | /api/v1/users, /:id/access, /:id/status, /:id/password |
| Service accounts | /api/v1/service-accounts, /:id/rotate, /:id/revoke |
| Exports | /api/v1/exports/jobs.csv, jobs.json, audit.csv และ internal printer export |
| System | /api/v1/system/database-backup, /readiness, /support-bundle |

Internal dashboard compatibility routes ใต้ /api ยังมี jobs, printers, runners, audit และ exports เพื่อให้ web UI ใช้ได้ทั้ง runtime แบบ server และ packaged desktop

## 17. ความสามารถที่รองรับใน production boundary ปัจจุบัน

ขอบเขตที่ระบุเป็น supported pilot/production path:

- Windows desktop package
- printer ที่ติดตั้งผ่าน Windows driver ที่ระบบรองรับ
- API local worker เป็น executor เดียว
- Go runner ใช้ discovery + heartbeat
- HTTP intake และ client-scoped NATS JetStream intake
- HTTP/NATS terminal callback เมื่อมีการตั้งค่า
- SQLite persistence
- Windows spooler print execution
- template/paper/binding/job/audit/export/diagnostics ตาม permission

## 18. ข้อจำกัดและสิ่งที่ยังไม่ใช่ production feature

รายการต่อไปนี้ไม่ควรสื่อสารว่าเป็นความสามารถที่พร้อมใช้งานใน production boundary ปัจจุบัน:

- packaged macOS/Linux desktop
- CUPS production execution
- raw TCP 9100 production execution
- remote/headless runner execution ใน supported pilot
- IPP execution เป็นเส้นทางหลักสำหรับส่งงาน
- direct ZPL/TSPL execution แบบ remote
- automatic replay ของงาน DISPATCHED/PRINTING ที่ผลทางกายภาพไม่แน่นอน
- เปิดหลาย desktop process ใช้ database เดียวกัน
- การ restart spooler หรือแก้ driver/port configuration อัตโนมัติ
- การเชื่อมต่อ HIS โดยตรง
- cloud multi-tenant control plane

ก่อนประกาศ production เต็มรูปแบบยังต้องมีหลักฐาน/acceptance gate สำหรับ:

- clean install และ first-run/migration/auth
- physical print ผ่าน printer ที่ติดตั้งจริง
- physical failure matrix และผล UNVERIFIED/TIMEOUT
- HTTP/NATS print, callback, reconnect และ duplicate-client matrix
- packaged backup/restore, upgrade/rollback/uninstall และ retention
- cross-machine deployment
- code signing และ distribution

## 19. เอกสารอ้างอิงภายใน repository

- [README.md](README.md) — วิธีรันและภาพรวมโปรเจกต์
- [PRODUCT.md](PRODUCT.md) — product scope และหน้าจอหลัก
- [docs/architecture/overview.md](docs/architecture/overview.md) — architecture
- [docs/architecture/job-lifecycle.md](docs/architecture/job-lifecycle.md) — lifecycle และ state semantics
- [docs/architecture/external-print-api.md](docs/architecture/external-print-api.md) — external API
- [docs/architecture/dynamic-print-invocation.md](docs/architecture/dynamic-print-invocation.md) — HTTP/NATS dynamic invocation
- [docs/architecture/result-callbacks.md](docs/architecture/result-callbacks.md) — callback delivery
- [docs/architecture/safety-boundary.md](docs/architecture/safety-boundary.md) — safety/security boundary
- [docs/architecture/fast-print-path.md](docs/architecture/fast-print-path.md) — scheduler และ latency
- [docs/operations/template-setup-guide.md](docs/operations/template-setup-guide.md) — template/paper setup
- [docs/status/current-status.md](docs/status/current-status.md) — implementation status ล่าสุดในเอกสารโครงการ
- [docs/production/PROD-01-known-limitations.md](docs/production/PROD-01-known-limitations.md) — supported boundary และ known limitations
- [apps/runner-go/README.md](apps/runner-go/README.md) — runner configuration และ metrics

> สรุปสั้น: PrintOps ครอบคลุมตั้งแต่รับคำสั่งพิมพ์, validate, route, render, queue, ส่งไป printer จริง, ตรวจ evidence, แจ้งผลกลับ, audit และดูแลระบบผ่าน desktop/dashboard โดย production path ปัจจุบันเน้น Windows + SQLite + local single executor
