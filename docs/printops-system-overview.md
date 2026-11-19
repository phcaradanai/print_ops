# เอกสารอธิบายระบบ PrintOps (Printer Operations)

> **เอกสารฉบับนี้ออกแบบมาสำหรับทุกบทบาทในทีม** — ทั้ง **Sale / Presales**, **PM (Project Manager)**, **SA (System Architect)** และ **Programmer / Maintainer** เพื่อใช้ทำความเข้าใจภาพรวมระบบ วัตถุประสงค์ ฟีเจอร์หลัก เงื่อนไข ข้อจำกัด ตลอดจนแนวทางการนำไปใช้งาน พัฒนาต่อ และดูแลรักษาระบบในระยะยาว

---

## สารบัญ

1. [บทนำ: PrintOps คืออะไร และสร้างขึ้นมาเพื่ออะไร](#1-บทนำ-printops-คืออะไร-และสร้างขึ้นมาเพื่ออะไร)
2. [ภาพรวมสถาปัตยกรรมและส่วนประกอบของระบบ](#2-ภาพรวมสถาปัตยกรรมและส่วนประกอบของระบบ)
3. [ฟีเจอร์หลักของระบบ (Core Features)](#3-ฟีเจอร์หลักของระบบ-core-features)
4. [วงจรชีวิตของงานพิมพ์และการรับประกันผล (Job Lifecycle & Verification)](#4-วงจรชีวิตของงานพิมพ์และการรับประกันผล-job-lifecycle--verification)
5. [เงื่อนไข ข้อจำกัด และความจำเป็นของระบบ (Conditions & Constraints)](#5-เงื่อนไข-ข้อจำกัด-และความจำเป็นของระบบ-conditions--constraints)
6. [คู่มือใช้งานและแนวทางสำหรับแต่ละบทบาท (SA / PM / Sale / Programmer)](#6-คู่มือใช้งานและแนวทางสำหรับแต่ละบทบาท-sa--pm--sale--programmer)
7. [แผนที่เอกสารอ้างอิงในระบบ](#7-แผนที่เอกสารอ้างอิงในระบบ)

---

## 1. บทนำ: PrintOps คืออะไร และสร้างขึ้นมาเพื่ออะไร

### 1.1 ปัญหาที่ระบบถูกสร้างขึ้นมาแก้ไข
ในระบบโรงพยาบาล (HIS), คลินิก, คลังสินค้า หรือระบบองค์กร (ERP/POS) การสั่งพิมพ์เอกสาร ใบเสร็จ หรือสติ๊กเกอร์ฉลากยา/สิ่งส่งตรวจมักเจอปัญหาหลัก 5 ประการ:
1. **ระบบหลักไม่ควรผูกติดกับเครื่องพิมพ์หน้างาน**: เมื่อเปลี่ยนรุ่นเครื่องพิมพ์ เปลี่ยนขนาดสติ๊กเกอร์ หรือย้ายเคาน์เตอร์ ระบบหลัก (เช่น HIS) มักต้องแก้โค้ดใหม่ทั้งหมด
2. **ปัญหาพิมพ์ซ้ำโดยไม่ตั้งใจ (Duplicate Prints)**: เมื่อเน็ตสะดุด ระบบต้นทางยิงคำสั่งซ้ำ หรือผู้ใช้กดปุ่มซ้ำ หากเป็นสติ๊กเกอร์ยาหรือสิ่งส่งตรวจ การพิมพ์ซ้ำอาจทำให้เกิดความผิดพลาดทางการแพทย์ได้
3. **แยกไม่ออกว่า "ส่งเข้าคิว Windows แล้ว" กับ "กระดาษออกจริง"**: ระบบทั่วไปมองว่าส่งเข้า Spooler สำเร็จ = พิมพ์สำเร็จ ทั้งที่จริงเครื่องอาจกระดาษหมด ออฟไลน์ หรือหัวพิมพ์มีปัญหา
4. **สั่งพิมพ์ผ่าน Web Browser มีข้อจำกัด**: Web App บนคลาวด์ไม่สามารถคุยกับเครื่องพิมพ์ Thermal/USB/LAN ในวงแลนส่วนตัวของลูกค้าได้โดยตรง และติด popup ยืนยันการพิมพ์ของเบราว์เซอร์
5. **การดูแลเครื่องลูกข่ายจำนวนมากทำได้ยาก**: เมื่อติดตั้งโปรแกรมพิมพ์ตามเคาน์เตอร์หลายสิบหรือหลายร้อยจุด การอัปเดตเวอร์ชัน แก้แบบฟอร์ม หรือไล่ดูปัญหาว่าเครื่องไหนพิมพ์ไม่ออกทำได้ลำบาก

### 1.2 PrintOps คืออะไร
**PrintOps** คือ **ระบบตัวกลางจัดการงานพิมพ์ระดับองค์กรและสถานพยาบาล (Edge-Print Orchestration Gateway)** ที่ทำหน้าที่รับคำสั่งพิมพ์จากระบบภายนอก แปลงข้อมูลลงแบบฟอร์มตามขนาดกระดาษจริง จัดคิว ส่งพิมพ์ไปยังเครื่องพิมพ์ปลายทาง ตรวจสอบสถานะจากตัวเครื่องจริง และแจ้งผลกลับไปยังระบบต้นทางอย่างแม่นยำ

> [!IMPORTANT]
> **ขอบเขตสำคัญ (System Boundary):** PrintOps เป็น **Generic Print Gateway** จึง **ไม่ได้เชื่อมต่อกับฐานข้อมูลหรือ Business Logic ของ HIS/ERP โดยตรง** ระบบภายนอก (หรือ Integration Service) จะเป็นผู้ดึงข้อมูลทางธุรกิจแล้วส่งคำสั่งมายัง PrintOps ผ่าน API หรือ Message Queue (NATS)

### 1.3 คุณค่าหลักของระบบ (Core Value Propositions)
- **Zero Duplicate Prints**: ป้องกันการพิมพ์ซ้ำด้วย Idempotency Key (`request_id` + `source_system`) และล็อกการรับงานแบบ Single-Flight
- **Hardware-Verified Truth**: แยกสถานะ `SUCCESS` (อุปกรณ์ยืนยันผลจริง) ออกจาก `UNVERIFIED` / `TIMEOUT` (ส่งไปแล้วแต่ยืนยันไม่ได้ว่ากระดาษออกหรือไม่) เพื่อไม่ให้ระบบต้นทางสั่งพิมพ์ซ้ำอัตโนมัติ
- **Decoupled Template & Paper Profile**: แยก "ข้อมูลที่ต้องการพิมพ์" ออกจาก "แบบฟอร์มและขนาดสติ๊กเกอร์" ทำให้ปรับระยะขอบ ขนาดบาร์โค้ด หรือเปลี่ยนเครื่องพิมพ์ได้จากหน้า UI โดยไม่ต้องแก้โค้ดระบบหลัก
- **Two-Tier Operations (Local Edge + Central Fleet)**: ทำงานได้ทั้งแบบติดตั้งที่หน้างาน (Windows Desktop App) และควบคุม/อัปเดต/กระจายแบบฟอร์มจากส่วนกลาง (Web Control Plane) ผ่านเครือข่ายที่มี NAT หรือ Firewall ได้

---

## 2. ภาพรวมสถาปัตยกรรมและส่วนประกอบของระบบ

ระบบ PrintOps แบ่งการทำงานออกเป็น 2 ฝั่งหลัก คือ **ฝั่งจุดพิมพ์หน้างาน (PrintOps Station)** และ **ฝั่งศูนย์ควบคุมส่วนกลาง (Web Control Plane)**

```text
+-----------------------------------------------------------------------+
|  ระบบภายนอก / HIS / ERP / Integration Service                        |
+------------------------+------------------------------+---------------+
                         | HTTP REST (X-Api-Key)        | NATS JetStream
                         v                              v
+-----------------------------------------------------------------------+
|  PrintOps Station (หน้างาน - ปัจจุบันหลักคือ Windows Desktop App)      |
|                                                                       |
|  +------------------------+      +---------------------------------+  |
|  | Tauri Desktop Shell    | ---> | PrintOps API + Web UI (local)   |  |
|  | (ควบคุม Sidecars/Secrets)|      | - รับงาน/จัดคิว/แปลงเทมเพลต     |  |
|  +------------------------+      | - เก็บ SQLite + Audit + Trace   |  |
|               |                  | - Local Worker สั่งพิมพ์ลงเครื่อง |  |
|               v                  +----------------+----------------+  |
|  +------------------------+                       |                   |
|  | Go Runner (Agent)      |                       v                   |
|  | - ค้นหาเครื่องพิมพ์      |      +---------------------------------+  |
|  | - ส่ง Heartbeat        |      | Windows Print Helper (WebView2) |  |
|  +------------------------+      | & Printer Adapters / SNMP / IPP |  |
|                                  +----------------+----------------+  |
+---------------------------------------------------|-------------------+
                                                    |
                                                    v
                                    [ เครื่องพิมพ์จริงหน้างาน ]
                                    (Thermal Label / Receipt / Document)

=========================================================================
                   เชื่อมต่อผ่าน NATS / HTTPS (ถ้าลงทะเบียน Fleet)
=========================================================================

+-----------------------------------------------------------------------+
|  Web Control Plane (ศูนย์ควบคุมส่วนกลาง - Docker Stack)               |
|  - ดูสถานะออนไลน์ของทุกจุดพิมพ์ (Devices & Heartbeat)                 |
|  - Mirror ประวัติงานพิมพ์จากทุกเครื่องลูกข่าย (Incoming Jobs)          |
|  - ดึง/แก้ไข/แจกจ่าย Paper Profiles & Templates (Content Sync)        |
|  - สั่งอัปเดตซอฟต์แวร์ระยะไกล (OTA Releases + Auto Rollback)          |
+-----------------------------------------------------------------------+
```

### ส่วนประกอบทั้งหมดใน Monorepo

| ส่วนประกอบ | เทคโนโลยี | หน้าที่หลักในระบบ |
|---|---|---|
| `apps/api` | TypeScript (Fastify + sql.js SQLite) | แกนกลางของระบบ: ให้บริการ REST API, รับงานจาก NATS, แปลงเทมเพลต, จัดคิวงาน, สั่งพิมพ์ผ่าน Local Worker, ตรวจสอบฮาร์ดแวร์, ส่ง Callback, บันทึก Audit/Trace และจัดการ OTA |
| `apps/web` | TypeScript (React + Vite + UnoCSS) | **UI เดียวของทั้งระบบ (Single Source of Truth)** ใช้ทั้งหน้า Dashboard ประจำจุดพิมพ์ และโหมด Web Control Plane รองรับภาษาไทย (`th`) และอังกฤษ (`en`) |
| `apps/desktop` | Rust (Tauri v2) | โปรแกรมติดตั้งบน Windows ที่ห่อหุ้มหน้าเว็บและดูแล Process ลูก (`server.exe`, `printops-runner.exe`) จัดการ Secret ประจำเครื่อง และหยุดการทำงานลูกทั้งหมดเมื่อปิดโปรแกรม |
| `apps/runner-go` | Go | เอเจนต์ประจำเครื่องสำหรับค้นหาเครื่องพิมพ์ (Discovery) และส่งสัญญาณชีพ (Heartbeat) รวมถึงสามารถทำหน้าที่เป็น Poller/Executor ในโหมดกระจาย |
| `apps/windows-print-helper` | C# (.NET 8 + WebView2) | ตัวช่วยพิมพ์เอกสาร HTML ผ่านไดรเวอร์ Windows จริง เพื่อให้จัดหน้าและฟอนต์ตรงตามโปรไฟล์กระดาษ |
| `apps/updater-go` | Go | ตัวอัปเดตแบบแยกตัวอิสระ (Breakaway Updater) สำหรับสลับไฟล์เวอร์ชันใหม่ระหว่างที่ Desktop ปิดตัว พร้อมระบบ Rollback อัตโนมัติหากเปิดไม่ขึ้น |
| `apps/printops-mcp` | TypeScript (MCP Server) | ช่องทางให้ AI Agent ภายนอกเรียกดูเครื่องพิมพ์ เช็กสถานะงาน หรือสั่งทดสอบ Datamax validation batch ภายใต้การยืนยันตัวตน |
| `packages/domain` | TypeScript | นิยามโมเดลธุรกิจหลัก (Job, Printer, Template, PaperProfile, Control, OTA) และ Ports/Interfaces |
| `packages/shared` | TypeScript | ยูทิลิตี้กลาง เช่น การคำนวณหน่วยวัดจริง (`mm` / `inch` / `dots`), Error Tree, Text Fit, ID Generator |
| `packages/adapters` | TypeScript | ไดรเวอร์เชื่อมต่อเครื่องพิมพ์ (`windows_spooler`, `cups`, `ipp`, `raw_tcp_9100`, `snmp`, `zpl`, `tspl`, `fake`) |

---

## 3. ฟีเจอร์หลักของระบบ (Core Features)

### 3.1 การรับคำสั่งพิมพ์และป้องกันงานซ้ำ (Print Intake & Idempotency)
1. **รองรับหลายช่องทางรับคำสั่ง (Multi-Transport Intake)**:
   - **Direct Print API** (`POST /api/v1/print-jobs`): ระบุ `printer_code` และ `template_code` โดยตรง
   - **Dynamic Print API** (`POST /api/v1/printer/:code_template/:code_profile`): ระบุเฉพาะรหัสเทมเพลตและรหัสกระดาษ แล้วให้ PrintOps ค้นหาเครื่องพิมพ์ที่ผูกไว้ให้อัตโนมัติ (หรือระบุ `printer_code` ทับได้)
   - **Dynamic Webhook Intake** (`POST /api/v1/intake/:endpointCode`): รับ Payload รูปแบบเฉพาะของระบบภายนอก แล้วใช้ **Route Policy** แปลงข้อมูลและเลือกเครื่องพิมพ์/เทมเพลตอัตโนมัติ
   - **NATS JetStream Intake** (`medisync.print.intake.<clientId>`): รับข้อความสั่งพิมพ์แบบ Event-Driven แยกตาม `clientId` ของแต่ละเครื่อง พร้อม Dead-Letter Queue (`DLQ`) สำหรับข้อความที่ผิดรูปแบบ
2. **Idempotency (กันพิมพ์ซ้ำ 100%)**:
   - ใช้คู่ `(request_id, source_system)` เป็นกุญแจอ้างอิง หากส่งคำสั่งเดิมซ้ำ ระบบจะคืนงานเดิมพร้อมสถานะ `DUPLICATE_RETURNED` โดยไม่สร้างคิวหรือพิมพ์ซ้ำ
3. **Priority Queue**:
   - จัดลำดับความสำคัญของงานได้ 4 ระดับ: `urgent` (100), `high` (75), `normal` (50), `low` (25)

### 3.2 ระบบออกแบบแบบฟอร์มและโปรไฟล์กระดาษ (Paper Profiles, Templates & Calibration)
1. **Paper Profile & Visual Designer**:
   - กำหนดขนาดกระดาษจริงเป็น `mm` หรือ `inch`, ความละเอียด `DPI`, ระยะขอบ (Margins), ช่องว่างระหว่างฉลาก (`gapMm`), ทิศทางการวาง (`portrait`/`landscape`), การหมุน/พลิกภาพ (`rotation`, `flipHorizontal`, `flipVertical`)
   - รองรับฉลากแบบหลายคอลัมน์ต่อแถว (`layout`: columns, cellWidth/Height, columnGap, rowPitch)
   - วางองค์ประกอบบนหน้ากระดาษแบบ Visual Editor ได้ 7 ประเภท: `text`, `barcode` (`code128`, `code39`, `ean13`, `datamatrix`), `qrcode`, `date` (รองรับรูปแบบปี พ.ศ. `BBBB`), `number` (ทศนิยมและเครื่องหมายหลักพัน), `shape` (กล่อง/เส้น), `image` (โลโก้ PNG/JPEG)
   - รองรับการจัดแนว (`left`/`center`/`right`), ตัดกรอบ, ขึ้นบรรทัดใหม่ (`maxLines`), และย่อฟอนต์อัตโนมัติ (`shrinkToFit`)
   - นำเข้าภาพ Raster (PNG/JPEG) เพื่อวิเคราะห์ขนาดและ DPI มาสร้างเป็น Paper Profile ตั้งต้นได้
2. **Template Engine & Lifecycle**:
   - เก็บเวอร์ชันและสถานะของแบบฟอร์ม: `DRAFT` -> `PUBLISHED` -> `DISABLED` / `ARCHIVED` (งานพิมพ์จริงจาก API จะใช้ได้เฉพาะเทมเพลตที่ `PUBLISHED` แล้วเท่านั้น)
   - รองรับ Engine ตามโมเดลระบบ ได้แก่ `RAW_TEXT`, `HTML`, `ZPL`, `TSPL`, `DPL`, `EPL`, `PDF_LIKE_PREVIEW`, `JSON_LAYOUT`
3. **การผูกความสัมพันธ์ (Bindings)**:
   - **Printer-Template Binding**: ผูก `templateCode` + `paperProfileId` เข้ากับ `printerCode` และตั้งเป็นค่าเริ่มต้น (`isDefault`) สำหรับ Dynamic Print
   - **Location-Printer Binding**: ผูก `locationCode` (เช่น รหัสจุดบริการ/วอร์ด) เข้ากับ `printerIp` เพื่อให้ระบบเรียกพิมพ์ตาม Location ได้โดยไม่ต้องจำชื่อเครื่องพิมพ์
4. **Template Sandbox & Printer Calibration**:
   - หน้า **Sandbox** สำหรับ Owner ทดลอง Render ข้อมูลจำลอง ตรวจสอบความพร้อมของเครื่องพิมพ์ และสั่งทดสอบพิมพ์
   - หน้า **Calibration** สำหรับปรับจูนระยะและทดสอบพิมพ์จริงให้ตรงขอบสติ๊กเกอร์ก่อนนำไปใช้งานจริง

### 3.3 การค้นหาเครื่องพิมพ์ เชื่อมต่อ และตรวจสอบฮาร์ดแวร์
1. **Discovery & Registration**:
   - Go Runner ค้นหาเครื่องพิมพ์ที่ติดตั้งในเครื่อง/เครือข่าย (เช่น ผ่าน PowerShell `Get-Printer` บน Windows หรือ `lpstat` บน macOS/Linux) แล้วส่งขึ้น API เพื่อให้อนุมัติลงทะเบียนเป็น Printer ในระบบ
   - รองรับ **Network Printer Search** และ **CUPS Provisioning** (สร้างและตรวจความพร้อมของคิว CUPS อัตโนมัติ)
2. **Printer Adapters**:
   - รองรับโปรโตคอล `windows_spooler` (ใช้งานหลักใน Windows Production), `cups`, `ipp`, `raw_tcp_9100`, `snmp` และ `fake` (สำหรับจำลองทดสอบ)
3. **Hardware Verification (การตรวจยืนยันจากเครื่องจริง)**:
   - ไม่เชื่อถือเพียงแค่การส่งเข้า Spooler ของ OS แต่พยายามตรวจสอบหลักฐานจากตัวเครื่องพิมพ์จริง (เช่น SNMP Page Counter หรือผลลัพธ์ของ Job ใน IPP) หากตรวจยืนยันไม่ได้ ระบบจะบันทึกเป็น `UNVERIFIED`

### 3.4 ระบบแจ้งผลกลับ (Webhooks & Result Callbacks)
- แยกการแจ้งเตือนเป็น 2 จังหวะชัดเจน:
  1. `print.job.accepted`: แจ้งว่างานเข้าคิวแล้ว (ส่งแบบยิงครั้งเดียวเมื่อไม่ได้เปิดโหมด `callbackOnPrintResult`)
  2. `print.job.completed`: แจ้งผลลัพธ์สุดท้ายจริง (`SUCCESS`, `FAILED`, `UNVERIFIED`, `TIMEOUT`, `CANCELLED`) พร้อมรายละเอียด `data_quality` และ `missing_fields` (กรณีข้อมูลบางฟิลด์ว่าง)
- มีความทนทานในการส่ง: บันทึก `CallbackDelivery` ลงฐานข้อมูล, ลองส่งใหม่แบบมีขอบเขต (Bounded Retry Sweep ทุก 5 วินาที), รองรับการเซ็นลายเซ็น **HMAC-SHA256** และมี **SSRF Guard** ป้องกันการยิง Callback ไปยังปลายทางที่ไม่ปลอดภัย

### 3.5 ความปลอดภัย การตรวจสอบ และความเสถียร (Security, Audit & Storage)
1. **RBAC (Role-Based Access Control)** 4 ระดับ:
   - `OWNER`: สิทธิ์สูงสุด (จัดการผู้ใช้, Sandbox, Print Flow/NATS, Publish เทมเพลต, ตั้งค่าระบบ)
   - `ADMIN`: จัดการการปฏิบัติงานหลัก (เครื่องพิมพ์, ค้นหาเครื่องพิมพ์, เทมเพลต, โปรไฟล์, เว็บฮุก, Bindings, Audit, Export, Settings)
   - `OPERATOR`: ทำงานประจำวัน (ดูแดชบอร์ด, เครื่องพิมพ์, คิวงาน, สั่งยกเลิก/พิมพ์ซ้ำแบบยืนยันความเสี่ยง, Diagnostics)
   - `VIEWER`: ดูข้อมูลอย่างเดียว (Read-only)
   - รองรับการกำหนด **Per-page Access** รายบุคคลเพิ่มเติมจาก Role ได้
2. **Service Account Authentication**:
   - ระบบภายนอกใช้ `X-Api-Key` โดยสามารถจำกัดสิทธิ์รายบัญชีได้ (Allowlist ของ `printer_code`, `template_code`, จำนวน `maxCopiesPerJob` และขนาด `maxPayloadBytes`)
3. **Data Redaction & Traceability**:
   - ทุกงานมี `traceId` และ `correlationId` เก็บ **Trace Timeline** และ **Latency Breakdown** (เวลาที่ใช้ในแต่ละขั้นเป็น ms)
   - ไม่เก็บหรือเปิดเผย Payload ข้อมูลดิบที่มีข้อมูลส่วนบุคคล (เช่น ข้อมูลผู้ป่วย) ใน API ตอบกลับ จะเก็บเฉพาะ `payloadSnapshot` (สรุปชื่อ keys และความยาว)
4. **SQLite Persistence, Lock & Retention**:
   - ใช้ SQLite ผ่าน WebAssembly (`sql.js`) ในโหมด Production พร้อม Process File Lock (ห้ามเปิดทับกัน), Atomic Replace เมื่อบันทึก, สำรองข้อมูลก่อน Migrate และมี **Retention Sweep** ที่ Archive ข้อมูลเก่าเกินกำหนด (ค่าเริ่มต้น 14 วัน) ออกเป็นไฟล์ก่อนลบออกจาก DB หลัก
   - มีหน้า **Export Center** (ส่งออก Jobs / Audit เป็น CSV หรือ JSON), **Database Backup/Restore** และ **Diagnostics / Readiness** (ตรวจสุขภาพ NATS, SQLite, Printers, Disk, Support Bundle ที่กรองข้อมูลลับออกแล้ว)

### 3.6 การควบคุมจากส่วนกลางและอัปเดตอัตโนมัติ (Web Control Plane & OTA)
เมื่อ Deploy ระบบ **Web Control Plane** (ผ่าน Docker Stack) ร่วมกับจุดพิมพ์หน้างาน:
1. **Device Enrollment & Presence**: เครื่องลูกข่ายลงทะเบียนด้วย **One-Time Enrollment Token** จากนั้นส่ง Heartbeat ผ่าน NATS เพื่อแสดงสถานะ `ONLINE` / `STALE` (30 วินาที) / `OFFLINE` (90 วินาที)
2. **Incoming Job Mirror**: ศูนย์กลางรวบรวมประวัติงานพิมพ์ของทุกจุดพิมพ์อัตโนมัติ (ทั้งแบบ Heartbeat Push ที่ทะลุ NAT/Firewall ได้ และแบบ Background Pull ทุก 30 วินาที)
3. **Content Sync (กระจายข้อมูล)**: แอดมินส่วนกลางสามารถ **Read catalog / Pull for review / Import copy** ของ Paper Profile หรือ Template จากเครื่องลูกข่ายมาปรับปรุงที่ส่วนกลาง แล้วสั่ง **Publish** กระจายกลับไปยังเครื่องลูกข่ายทั้งหมดที่รองรับ `content-sync-v1`
4. **Supervised Breakaway OTA**:
   - อัปเดตเวอร์ชันโปรแกรมหน้างานจากระยะไกลผ่าน `printops-updater`
   - ตรวจสอบความถูกต้องของไฟล์อัปเดตด้วย **Ed25519 Signature** และ SHA-256
   - รอให้ Desktop ปิดตัวประสานงานอย่างปลอดภัยผ่าน Windows Shutdown Event, สำรองข้อมูลก่อนอัปเกรด และ **Rollback อัตโนมัติ** หาก Health Check หลังอัปเดตไม่ผ่าน

---

## 4. วงจรชีวิตของงานพิมพ์และการรับประกันผล (Job Lifecycle & Verification)

### 4.1 ผังสถานะงานพิมพ์ (State Machine)

```text
  [รับคำสั่ง] --> ACCEPTED --> VALIDATED --> QUEUED
                                               |
                     (ถ้าถูกยกเลิกก่อนส่งออก)    +--> CANCELLED
                                               |
                                       (Claim งานสำเร็จ)
                                               v
                                           DISPATCHED
                                               |
                                   (Spooler รับเอกสารแล้ว)
                                               v
                                            PRINTING
                                               |
                 +--------------+--------------+--------------+
                 v              v              v              v
              SUCCESS      UNVERIFIED       TIMEOUT        FAILED
```
*(หมายเหตุ: `DUPLICATE_RETURNED` เป็นผลลัพธ์ตอนรับงานกรณีส่ง `request_id` ซ้ำ ไม่ใช่สถานะในคิว)*

### 4.2 ตารางความหมายของสถานะสุดท้าย (Terminal Statuses)

| สถานะ | ความหมาย | ระบบต้นทางหรือ Operator สั่งพิมพ์ซ้ำอัตโนมัติได้หรือไม่? |
|---|---|---|
| `SUCCESS` | อุปกรณ์ยืนยันแล้วว่าพิมพ์สำเร็จจริง | ไม่จำเป็น (จบงานแล้ว) |
| `UNVERIFIED` | ส่งงานเข้า Spooler แล้วและไม่พบ Error แต่ไม่สามารถผูกหลักฐานจากตัวเครื่องพิมพ์มายืนยันกับงานนี้ได้ | **ห้ามสั่งซ้ำอัตโนมัติ** (กระดาษอาจออกมาแล้ว ต้องให้คนตรวจหน้างานก่อนกด Reprint) |
| `TIMEOUT` | ส่งเข้า Spooler แล้ว แต่เงียบหายจนครบเวลา Watchdog (`PRINTOPS_EXECUTE_TIMEOUT_MS` ค่าเริ่มต้น 180 วินาที) | **ห้ามสั่งซ้ำอัตโนมัติ** (กระดาษอาจออกมาแล้ว) |
| `FAILED` | ล้มเหลวก่อนถึงขั้นพิมพ์ หรือมีข้อผิดพลาดที่ระบุได้ชัดเจนว่าไม่พิมพ์ออก | **ปลอดภัย** สามารถแก้ไขสาเหตุแล้วสั่งใหม่ได้ |
| `CANCELLED` | ถูกยกเลิกสำเร็จก่อนถูกส่งไปยัง Executor | **ปลอดภัย** ไม่มีการพิมพ์เกิดขึ้นแน่นอน |

> [!CAUTION]
> **การกู้คืนหลังโปรแกรมปิดกะทันหัน (Restart Recovery):** หากเครื่องดับหรือรีสตาร์ทขณะที่งานอยู่ในสถานะ `DISPATCHED` หรือ `PRINTING` เมื่อเปิดใหม่ระบบจะ **ปิดงานนั้นเป็น `UNVERIFIED` ทันที และไม่สั่งพิมพ์ซ้ำอัตโนมัติ** เพื่อป้องกันสติ๊กเกอร์ออกซ้ำซ้อน

---

## 5. เงื่อนไข ข้อจำกัด และความจำเป็นของระบบ (Conditions & Constraints)

### 5.1 ขอบเขตที่รองรับใน Production ปัจจุบัน (Supported Boundary)
อ้างอิงจากสถานะระบบและเกณฑ์การผลิตล่าสุด:
- **แพลตฟอร์ม Production หลัก**: **Windows Desktop Package (x64)** ที่รัน Local API (`server.exe`) + Local Worker (`PRINTOPS_LOCAL_WORKER=true`) เป็นตัวสั่งพิมพ์หลัก และใช้ Go Runner สำหรับ Discovery + Heartbeat เท่านั้น (เพื่อป้องกัน 2 ตัวแย่งคิวจนพิมพ์ซ้ำ)
- **ช่องทางพิมพ์ที่รองรับเป็นหลักใน Production Pilot**: เครื่องพิมพ์ที่ติดตั้งผ่าน **Windows Printer Driver** (`windows_spooler` + WebView2 HTML Helper)
- **ส่วนที่ยังเป็นข้อจำกัดหรือยังไม่เปิดเป็น Production เต็มรูปแบบ (Deferred / Outstanding)**:
  - แพ็กเกจ Production สำหรับ macOS และ Linux ยังไม่เปิดเป็นช่องทาง Production หลัก (ใช้สำหรับพัฒนา/ทดสอบ CUPS)
  - การยิงตรง Raw TCP 9100 / Direct ZPL & TSPL / Remote Headless Runner และ PostgreSQL/Redis ยังไม่ได้ใช้งานเป็นแกนหลักใน Production ปัจจุบัน
  - การใช้งาน 1 ฐานข้อมูล SQLite ต้องรันเพียง 1 Desktop Process ต่อเครื่อง (ห้ามเปิดหลาย Process แย่งไฟล์ `printops.db` เดียวกัน)

### 5.2 ความจำเป็นด้านโครงสร้างพื้นฐาน (Prerequisites)
1. **เครื่องจุดพิมพ์ (Windows Station)**:
   - Windows x64 ที่มี Microsoft Edge WebView2 Runtime (ใช้สำหรับ `windows-print-helper`)
   - ติดตั้งไดรเวอร์เครื่องพิมพ์ใน Windows ให้พร้อมใช้งาน (และควรรองรับ SNMP / IPP หากต้องการสถานะยืนยัน `SUCCESS` แทน `UNVERIFIED`)
2. **เครื่องเซิร์ฟเวอร์ Web Control Plane (กรณีใช้ควบคุมส่วนกลาง)**:
   - Linux Server ที่รัน Docker Compose v2
   - พื้นที่เก็บไฟล์ Release (Local Volume หรือ MinIO / S3)
   - **ความปลอดภัยเครือข่าย (สำคัญมาก)**: พอร์ต NATS (`4222`) ของ Control Plane ไม่ได้เปิด TLS/Auth ในตัว Compose เริ่มต้น จึง **ห้ามเปิดพอร์ต 4222 สู่ Public Internet เด็ดขาด** ต้องใช้ผ่าน VPN หรือ Private Subnet และต้องวาง Web UI (`8080`) ไว้หลัง HTTPS Reverse Proxy
3. **สภาพแวดล้อมสำหรับนักพัฒนา (Developer Machine)**:
   - Node.js `>= 20.0.0`, npm `>= 10.0.0`, Go `>= 1.21.0`
   - สำหรับ Build ตัวติดตั้ง Windows Desktop: ต้องทำบน **Windows x64** พร้อม Rust + Visual Studio Build Tools (C++ workload) + .NET 8 SDK

### 5.3 กฎความปลอดภัยและเงื่อนไขทางธุรกิจที่ห้ามละเมิด
- **ห้ามใช้ Raw JavaScript หรือ `eval()`** ใน Template Expression และ Route Policy เพื่อป้องกันการรันโค้ดอันตราย
- **การตั้งค่าระบบครั้งแรก (Owner Setup)**: ในโหมด Production (`PRINTOPS_DEV_SEED=false`) ต้องสร้างบัญชี `OWNER` แรกผ่านหน้า Setup และเก็บรักษา Recovery Code ให้ดี (ไม่มี Backdoor รีเซ็ตรหัสผ่าน)
- **API Key และ DB Backup**: Service Account Key จะแสดงครั้งเดียวตอนสร้าง/Rotate และไฟล์ Backup ฐานข้อมูลอาจมี Secret ประจำเครื่อง จึงต้องจัดเก็บแบบเข้ารหัสและจำกัดสิทธิ์เข้าถึง

---

## 6. คู่มือใช้งานและแนวทางสำหรับแต่ละบทบาท (SA / PM / Sale / Programmer)

### 6.1 สำหรับ Sale / Presales
- **ประเด็นที่ใช้ขายและสร้างความต่าง**:
  - *"ระบบทั่วไปส่งเข้าคิว Windows แล้วก็จบ แต่ PrintOps ตรวจสอบไปถึงระดับฮาร์ดแวร์และแยกรายงาน `UNVERIFIED` เพื่อป้องกันการพิมพ์สติ๊กเกอร์ซ้ำในงานที่ผิดพลาดไม่ได้"*
  - *"เปลี่ยนแบบฟอร์ม เปลี่ยนขนาดกระดาษ หรือเปลี่ยนเครื่องพิมพ์ที่จุดให้บริการได้เองผ่านหน้าจอ Visual Editor โดยไม่ต้องเสียเวลาและงบประมาณแก้โค้ดระบบ HIS/ERP เดิม"*
  - *"รองรับการกระจายแบบฟอร์มและอัปเดตโปรแกรมแบบ OTA จากส่วนกลาง พร้อม Rollback อัตโนมัติ แม้เครื่องหน้างานจะอยู่หลัง Firewall/NAT"*
- **คำถามที่ต้องเก็บข้อมูลจากลูกค้า (Discovery Checklist)**:
  1. ระบบต้นทางส่งคำสั่งพิมพ์มาทางไหน? (REST API หรือ NATS Message Broker)
  2. จุดพิมพ์หน้างานเป็น Windows กี่จุด? ใช้เครื่องพิมพ์ยี่ห้อ/รุ่นใดบ้าง (Thermal Label / Slip / A4) และเชื่อมต่อแบบใด (USB / LAN)?
  3. ต้องการการยืนยันการพิมพ์จริงระดับฮาร์ดแวร์ (SNMP/IPP) หรือไม่? (เครื่องพิมพ์รองรับ Network/SNMP หรือต่อผ่าน USB อย่างเดียว?)
  4. ต้องการระบบศูนย์กลาง (Web Control Plane) เพื่อดูงานรวมและอัปเดต OTA จากระยะไกลด้วยหรือไม่?

### 6.2 สำหรับ PM (Project Manager)
- **ขั้นตอนการวางระบบขึ้นใช้งานจริง (Implementation Roadmap)**:
  1. **Prepare & Infrastructure**: เตรียมเครื่อง Windows หน้างาน + ลงไดรเวอร์เครื่องพิมพ์ (และเตรียม Server/VPN หากใช้ Web Control Plane)
  2. **Install & Enroll**: ติดตั้ง PrintOps Desktop, ตั้งค่าบัญชี `OWNER`, และนำเครื่องเข้า Fleet (Enroll ผ่าน Token) หากใช้ Control Plane
  3. **Discovery & Register Printers**: ตรวจสอบเครื่องพิมพ์ที่ Runner ค้นพบ และลงทะเบียนตั้งรหัส `printer_code`
  4. **Design Paper Profiles & Templates**: สร้าง Paper Profile (ขนาด mm/DPI/ช่องข้อมูล) และสร้าง/Publish Template พร้อมผูก Binding (หรือ Location Binding)
  5. **Calibration & Sandbox Test**: ทดสอบพิมพ์จากหน้า Sandbox และ Calibration จนระยะพิมพ์ตรงสติ๊กเกอร์จริง
  6. **Integration & UAT**: ให้ทีม Integration เชื่อมต่อ API Key หรือ NATS ทดสอบกรณีปกติ งานซ้ำ (`DUPLICATE_RETURNED`) ยกเลิกงาน และ Callback ปลายทาง
  7. **Readiness & Go-Live**: ตรวจหน้า Diagnostics / Readiness ให้ผ่านทั้งหมดและกำหนดผู้ดูแลตามสิทธิ์ RBAC
- **ความเสี่ยงที่ต้องบริหาร**:
  - เครื่องพิมพ์ USB หรือรุ่นที่ไม่รองรับ SNMP/IPP จะได้ผลลัพธ์เป็น `UNVERIFIED` ต้องสื่อสารกับลูกค้าและทีม Integration ให้เข้าใจความหมายและแนวทางปฏิบัติของหน้างานตั้งแต่ต้น

### 6.3 สำหรับ SA (System Architect)
- **Integration Design**:
  - เลือกรูปแบบการส่งงาน:
    - **HTTP Sync/Async**: เรียก `POST /api/v1/printer/:code_template/:code_profile` พร้อม `X-Api-Key` และ `request_id` ที่ไม่ซ้ำต่อหนึ่งคำสั่งงาน
    - **Event-Driven (NATS JetStream)**: Publish เข้า Subject `medisync.print.intake.<clientId>` โดยแนบ `target_client_id` ตรงกับเครื่องปลายทาง
  - **การจัดการ Idempotency & Retry ฝั่งผู้เรียก**:
    - ถ้ายิงซ้ำด้วย `request_id` เดิม ระบบจะตอบ `200 OK` (`DUPLICATE_RETURNED`) ให้ถือว่าสำเร็จและรอผลจากงานเดิม
    - เมื่อรับ Callback `print.job.completed` ต้องรองรับสถานะ 5 แบบ (`SUCCESS`, `FAILED`, `UNVERIFIED`, `TIMEOUT`, `CANCELLED`) โดยห้ามเขียน logic ให้ Auto-Retry เมื่อเจอ `UNVERIFIED` หรือ `TIMEOUT`
    - ตรวจสอบลายเซ็น `HMAC-SHA256` บน Callback เพื่อความปลอดภัย และตรวจฟิลด์ `data_quality` / `missing_fields` เผื่อกรณีข้อมูลไม่ครบ
- **Architecture Pattern**:
  - ระบบออกแบบตาม **Clean Architecture / Hexagonal (Ports & Adapters)** แยก `packages/domain` ออกจากโครงสร้างพื้นฐาน (`apps/api/src/infra`, `packages/adapters`) ทำให้ง่ายต่อการสลับ Database (เช่น ย้ายจาก SQLite ไป PostgreSQL ในอนาคตผ่าน `infra/migrations`) หรือเพิ่ม Protocol ใหม่โดยไม่กระทบ Business Logic

### 6.4 สำหรับ Programmer / Maintainer
- **โครงสร้างโค้ดและการเริ่มต้นพัฒนา**:
  - คำสั่งหลักจาก Root ของโปรเจกต์:
    - ติดตั้ง dependencies: `npm install`
    - รันโหมดพัฒนาครบชุด (API `:31415`, Web `:3000`, Go Runner): `npm run dev`
    - ตรวจสอบ TypeScript & Go: `npm run typecheck`
    - รันชุดทดสอบทั้งหมด (Vitest + Go test): `npm test`
    - รันทดสอบหน้าเว็บ E2E (Playwright): `npx playwright test` (หลังจาก Build `apps/web`)
    - Build ตัวติดตั้ง Windows: `npm run desktop:bundle`
- **จุดเริ่มต้นสำคัญในการไล่โค้ด (Key Entry Points)**:
  - **API Composition Root**: [`apps/api/src/app.ts`](file:///d:/Projects/adm-chura3inter/print_ops/apps/api/src/app.ts) (ผูก Repositories, Services และ Routes ทั้งหมด)
  - **External Print & Intake Services**: [`accept-external-job.service.ts`](file:///d:/Projects/adm-chura3inter/print_ops/apps/api/src/services/accept-external-job.service.ts), [`dynamic-print.service.ts`](file:///d:/Projects/adm-chura3inter/print_ops/apps/api/src/services/dynamic-print.service.ts), [`execute-job.service.ts`](file:///d:/Projects/adm-chura3inter/print_ops/apps/api/src/services/execute-job.service.ts)
  - **Domain Models & Ports**: [`packages/domain/src/models/`](file:///d:/Projects/adm-chura3inter/print_ops/packages/domain/src/models) และ [`packages/domain/src/ports/`](file:///d:/Projects/adm-chura3inter/print_ops/packages/domain/src/ports)
  - **Printer Adapters**: [`packages/adapters/src/registry/adapter-registry.ts`](file:///d:/Projects/adm-chura3inter/print_ops/packages/adapters/src/registry/adapter-registry.ts)
  - **Web UI & Navigation**: [`apps/web/src/App.tsx`](file:///d:/Projects/adm-chura3inter/print_ops/apps/web/src/App.tsx) (ควบคุมทั้งหน้า Local Dashboard และ `/control/*` ของ Web Control Plane) และไฟล์แปลภาษา [`apps/web/src/i18n/translations.ts`](file:///d:/Projects/adm-chura3inter/print_ops/apps/web/src/i18n/translations.ts)
  - **Desktop Supervisor**: [`apps/desktop/src-tauri/src/lib.rs`](file:///d:/Projects/adm-chura3inter/print_ops/apps/desktop/src-tauri/src/lib.rs)
- **แนวทางเมื่อต้องการเพิ่มฟีเจอร์หรือแก้ไขโค้ด (Maintenance Rules)**:
  1. **เพิ่ม API Endpoint / Service**: นิยาม Port ใน `packages/domain` -> สร้าง Service ใน `apps/api/src/services/` (`*.service.ts`) -> ผูก Route ใน `apps/api/src/routes/v1/` (`*.routes.ts`) -> ใส่ Permission Guard (`requirePermission(...)`) และบันทึก Audit/Trace เสมอ
  2. **แก้ไขหน้าจอ UI**: แก้เฉพาะใน `apps/web/src` (ห้ามแก้ไฟล์ใน `dist/` หรือ `resources/static/`) ใช้ Design Tokens ตาม [`DESIGN.md`](file:///d:/Projects/adm-chura3inter/print_ops/DESIGN.md), อัปเดตคำแปลทั้งภาษาไทยและอังกฤษใน `i18n/`, และทดสอบด้วย `npm run test -w apps/web` + Playwright
  3. **การทดสอบ (Testing)**: ใช้ `InMemory*Repository` และ `FakePrinterAdapter` สำหรับ Unit Test ที่รวดเร็ว และใช้ `mkdtempSync` + `closeDatabase()` เมื่อทดสอบ SQLite
  4. **อัปเดต Code Graph**: หลังเปลี่ยนแปลงโค้ดขนาดใหญ่ ให้รัน `trail build` เพื่อให้แผนผังโค้ดใน `.trail/` ทันสมัยอยู่เสมอ

---

## 7. แผนที่เอกสารอ้างอิงในระบบ

หากต้องการเจาะลึกเฉพาะทาง สามารถอ่านต่อได้จากเอกสารเหล่านี้ในคลังโค้ด:

| หัวข้อ | เอกสารอ้างอิง |
|---|---|
| สถาปัตยกรรมภาพรวม | [`docs/architecture/overview.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/overview.md) |
| สถานะปัจจุบันของทุกโมดูล | [`docs/status/current-status.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/status/current-status.md) |
| สเปก API สำหรับเชื่อมต่อระบบภายนอก | [`docs/architecture/external-print-api.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/external-print-api.md) |
| การสั่งพิมพ์แบบ Dynamic (HTTP & NATS) | [`docs/architecture/dynamic-print-invocation.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/dynamic-print-invocation.md) |
| วงจรชีวิตงานพิมพ์และการกู้คืน | [`docs/architecture/job-lifecycle.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/job-lifecycle.md) |
| ระบบ Result Callbacks และความปลอดภัย | [`docs/architecture/result-callbacks.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/result-callbacks.md) |
| โมเดลสิทธิ์ RBAC | [`docs/architecture/permission-model.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/permission-model.md) |
| การติดตั้ง Web Control Plane (Docker) | [`docs/operations/deploy-web-control-plane.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/operations/deploy-web-control-plane.md) |
| สถาปัตยกรรม OTA Control Plane | [`docs/architecture/ota-control-plane-architecture.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/architecture/ota-control-plane-architecture.md) |
| ข้อจำกัดและขอบเขต Production ปัจจุบัน | [`docs/production/PROD-01-known-limitations.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/production/PROD-01-known-limitations.md) |
| คู่มือพัฒนาในเครื่อง (Local Dev) | [`docs/operations/local-dev.md`](file:///d:/Projects/adm-chura3inter/print_ops/docs/operations/local-dev.md) |
