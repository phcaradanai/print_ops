# วิเคราะห์โปรแกรม PrintOps โดยละเอียด

_รายงานนี้จัดทำจากการตรวจสอบซอร์สโค้ดจริงทั้งหมด (backend, frontend, desktop shell) ประกอบกับสิ่งที่แก้ไขไปแล้วในช่วงที่ผ่านมาของโปรเจกต์ (intake log, barcode/QR real-size preview, webhook callback log, การแก้บั๊ก NATS restart race)_

## 1. ภาพรวมสถาปัตยกรรม

PrintOps เป็น print gateway แบบ monorepo (npm workspaces) วางสถาปัตยกรรมตาม Clean Architecture/DDD จริงตามที่เอกสารระบุ: `packages/domain` เก็บ model และ port ล้วนๆ ไม่มีการอิมพอร์ตจาก adapters หรือ apps เลย, service ใน `apps/api/src/services/` รับ dependency ผ่าน constructor เป็น domain port ทั้งหมด ไม่มีการอ้างอิงคลาส infra ที่เป็นรูปธรรมโดยตรง (ยกเว้นจุดเดียวคือ `ExecuteJobService` ที่รับ `AdapterRegistry` ตรงๆ ซึ่งเป็นจุดเล็กน้อยไม่ถือเป็นความเสี่ยง) การประกอบระบบ (เลือก in-memory หรือ sqlite repo) ทำที่ `apps/api/src/app.ts` เพียงจุดเดียวตามแบบแผน composition root ที่ถูกต้อง

จุดที่เอกสาร CLAUDE.md ล้าสมัยและควรแก้ไข: อ้างว่ามี `apps/runner` (TypeScript runner) อยู่ในโปรเจกต์ แต่ในความเป็นจริง workspace นี้ไม่มีอยู่แล้ว ถูกแทนที่ด้วย `apps/runner-go` เต็มรูปแบบ ไม่ใช่แค่ "อยู่ระหว่างพัฒนา" ตามที่เอกสารบอก ใครที่ทำตามคำสั่งใน CLAUDE.md ตรงตัว (เช่น `npm run dev -w apps/runner`) จะเจอ error ทันที นอกจากนี้ยังมีการอ้างว่ามีแค่ adapter `fake` ที่พร้อมใช้งานจริง แต่จากการตรวจสอบพบว่า `WindowsSpoolerAdapter` (~2000 บรรทัด) สมบูรณ์กว่าที่เอกสารบอกมาก มีการยืนยันผลพิมพ์จริงผ่าน SNMP page-counter และ IPP job-status ไม่ใช่แค่ยิงคำสั่งแล้วถือว่าสำเร็จ

## 2. ความพร้อมของ Printer Adapter

จากทั้งหมด 7 adapter ที่มีในระบบ มีเพียง 2 ตัวที่ใช้งานได้จริงในระดับ production: `WindowsSpoolerAdapter` (ตัวที่ใช้งานจริงกับเครื่องพิมพ์ Windows ผ่าน PowerShell/WebView2 พร้อมกลไกยืนยันผลพิมพ์) และ `FakePrinterAdapter` (ตัวจำลองสำหรับทดสอบ ไม่ใช่ของจริงแต่ทำงานสมบูรณ์ตามที่ออกแบบ) ส่วน `SnmpPrinterStatusAdapter` ใช้ได้เฉพาะเช็คสถานะเครื่องพิมพ์ ไม่ใช่ตัวส่งงานพิมพ์

ที่ยังเป็นเพียงโครงร่าง (stub) และโยน error ทุกเมธอด: `IppPrinterAdapter` และ `CupsPrinterAdapter` ส่วน `RawTcp9100Adapter` มี TODO ค้างอยู่และใช้งานได้แค่บางเมธอด ตัวช่วยสร้างคำสั่ง `ZplBuilder`/`TsplBuilder` แม้เขียนคอมเมนต์ว่าเป็น "skeleton" แต่จริงๆ ใช้งานได้ครบ ไม่ใช่ของปลอม

สรุปคือระบบพร้อมใช้กับเครื่องพิมพ์ Windows ผ่าน spooler เป็นหลักในตอนนี้ ส่วน IPP/CUPS/raw-TCP ยังไม่พร้อมใช้งานจริงหากมีลูกค้าที่ใช้เครื่องพิมพ์เครือข่ายแบบ Linux/IPP โดยตรง

## 3. การเก็บข้อมูลและความเสี่ยงข้อมูลหาย

ทุก repository ที่เก็บข้อมูลธุรกิจจริง (printer, job, trace, runner, audit, user, template, paper-profile, webhook-endpoint ฯลฯ) มีทั้งเวอร์ชัน in-memory และ sqlite คู่กันครบ ไม่มี repository ข้อมูลธุรกิจตัวไหนที่เก็บเฉพาะ in-memory โดยไม่ตั้งใจ — มีแค่ 2 ตัวที่ตั้งใจให้เป็น in-memory-only คือ intake-attempt log กับ webhook-callback-attempt log ซึ่งเป็น diagnostic ring buffer (จำกัด 500 รายการ) ตามที่ออกแบบไว้แล้ว จุดนี้ถือว่าปลอดภัย

แต่พบความเสี่ยงใหม่ที่สำคัญเรื่อง **queue recovery**: ระบบ rehydrate งานที่ค้างจาก sqlite กลับเข้า in-memory queue ตอน restart จะทำงานเฉพาะเมื่อรันในโหมด desktop (`PRINTOPS_LOCAL_WORKER=true`) เท่านั้น หากใครรัน API แยกกับ runner แบบ standalone (ไม่ใช่ผ่านแอป desktop) แล้ว process ของ API ล่มหรือ restart งานที่สถานะ `QUEUED` จะยังอยู่ใน sqlite แต่หายไปจาก queue ในหน่วยความจำ ไม่มีกลไกใดดึงกลับเข้าคิวอัตโนมัติ ต้องรอ intervention ด้วยมือ — สำหรับ deployment แบบเดสก์ท็อป (ซึ่งเป็นโหมดที่ตั้งใจใช้งานจริง) จุดนี้ไม่กระทบเพราะมีการ recovery แล้ว

อีกจุดที่ควรทราบ: sqlite layer ใช้ `sql.js` (WASM SQLite) ที่เก็บฐานข้อมูลทั้งก้อนไว้ในหน่วยความจำ และทุกครั้งที่มีการเขียน (ทุก job, ทุก audit log) จะ export ฐานข้อมูลทั้งไฟล์ใหม่และเขียนทับดิสก์ทั้งไฟล์ ไม่ใช่แบบ incremental เมื่อใช้งานสะสมหลายเดือน ไฟล์ฐานข้อมูลใหญ่ขึ้น การเขียนต่อ 1 job จะช้าลงเรื่อยๆ ตามขนาดประวัติสะสม (ไม่ใช่แค่การ query ช้าลง) และยังไม่มี retention/cleanup policy ใดๆ ลบข้อมูลเก่าออกจาก jobs/audit/trace เลย เป็นความเสี่ยงระยะยาวสำหรับการติดตั้งที่ใช้พิมพ์ทุกวันต่อเนื่องหลายเดือน–ปี

## 4. Queue, Event Bus และ Concurrency

Queue และ event bus เป็น in-memory ล้วนตามที่เอกสารระบุ ไม่มี Redis/BullMQ จริง ส่วนความปลอดภัยจาก race condition ระหว่าง runner กับ desktop worker ที่แย่งงานจากคิวเดียวกัน ตรวจสอบแล้วว่าออกแบบดีมาก: การ claim งานเป็น atomic (เช็ค-แล้ว-เขียนในจังหวะเดียวไม่มี await คั่น) ฝ่ายที่แพ้การแย่งจะได้ ConflictError ไม่ใช่พิมพ์ซ้ำ และงานที่ค้างสถานะ DISPATCHED/PRINTING ตอน restart จะถูกย้ายไปสถานะ UNVERIFIED แทนที่จะ replay อัตโนมัติ เพื่อป้องกันพิมพ์ซ้ำโดยเจตนา จุดนี้ไม่มีความเสี่ยงเพิ่มเติม

## 5. ความปลอดภัย (Security)

พบจุดที่ควรแก้ไขก่อนใช้งานจริงจัง 2 จุด: (1) `JWT_SECRET` มีค่า fallback ที่ hardcode ไว้ในซอร์ส (`dev-secret-change-in-production`) หากลืมตั้งค่า env ตอน deploy จริง ใครก็สามารถปลอมโทเคนของ role ไหนก็ได้รวมถึง OWNER ได้ทันที ควรตรวจสอบให้แน่ใจว่าเครื่องที่ติดตั้งจริงตั้งค่า `JWT_SECRET` ไว้เสมอ (2) CORS เปิดกว้าง (`origin: true`) รับทุก origin — ความเสี่ยงต่ำเพราะ auth เป็นแบบ header-based ไม่ใช่ cookie แต่ควรจำกัดถ้ามีแผนเปิดออกอินเทอร์เน็ตในอนาคต ส่วนเรื่อง secret รั่วใน log ตรวจแล้วไม่พบ มีการกรองฟิลด์ secret/token/password ก่อน log อยู่แล้ว

## 6. RBAC / สิทธิ์การใช้งาน

โมเดลสิทธิ์ออกแบบมาละเอียด (4 role, 31 สิทธิ์แยกย่อย) แต่**บังคับใช้ไม่ครบทุกเส้นทาง** — route รุ่นเก่า (`job.routes.ts`, `printer.routes.ts`, `runner.routes.ts`, `audit.routes.ts`) เช็คแค่ว่า login แล้วหรือยัง (JWT valid) แต่ไม่เช็คสิทธิ์ตาม role เลย หมายความว่า user role VIEWER (ตั้งใจให้ดูอย่างเดียว) สามารถสร้างเครื่องพิมพ์ใหม่ สั่งพิมพ์งาน หรือลงทะเบียน runner ผ่าน route เหล่านี้ได้ ในขณะที่ route รุ่นใหม่ (`webhook.routes.ts`, `template.routes.ts` ฯลฯ) เช็คสิทธิ์ถูกต้องครบถ้วน นี่คือช่องโหว่ RBAC ที่ควรปิดก่อนเปิดให้ผู้ใช้หลาย role ทำงานร่วมกันจริงจัง

## 7. หน้าเว็บ (Frontend) — โครงสร้างและขนาด

มีหน้าทั้งหมด 19 หน้า รวม 8,831 บรรทัด หน้าที่ใหญ่ที่สุดคือ PaperProfiles.tsx (2,935 บรรทัด) ตามด้วย Webhooks.tsx (1,440) และ Templates.tsx (1,101) — ทั้งสามหน้านี้ใหญ่กว่าหน้าอื่นๆ มากกว่าสิบเท่า ยังไม่มี component library กลางที่ใช้ร่วมกัน มีแค่ naming convention ของ CSS (`.ds-btn`, `.ds-modal`, `.ds-toast`) ที่เพิ่งเริ่มใช้ใน 3 หน้าใหญ่เท่านั้น อีก 16 หน้ายังเขียน `style={{}}` แบบ inline ของตัวเอง ทำให้ toast/modal/loading pattern ไม่สอดคล้องกันข้ามหน้า (แต่ละหน้ามี logic toast เป็นของตัวเอง 3 แบบต่างกัน)

## 8. i18n และความสอดคล้องของภาษา

รองรับ 2 ภาษา (EN/TH) มี 667 key ต่อภาษา และมี test ที่เข้มงวดจริง (เช็ค key ทั้งสองภาษาตรงกันเป๊ะ ไม่มี key ขาด) แต่จุดอ่อนที่พบและยืนยันแล้วว่าเกิดเฉพาะหน้าเดียว: **Webhooks.tsx มีข้อความภาษาไทย hardcode อยู่ 26 จุด** (เช่น ข้อความ error/success ต่างๆ) ที่ไม่ผ่านระบบ `t()` เลย ทำให้ผู้ใช้ที่ตั้งค่าเป็นภาษาอังกฤษจะเห็นข้อความ error เป็นภาษาไทยปนอยู่ในหน้านี้หน้าเดียว หน้าอื่นไม่มีปัญหานี้

## 9. Test Coverage

มี test 8 ไฟล์ ครอบคลุมดีที่สุดคือ PaperProfiles (210 test), i18n, navigation, webhooks, settings ส่วนที่**ไม่มี test เลย**: Dashboard, Runners, DiscoveredPrinters, ExportCenter, RoutePolicies, PrinterBindings, Printers, PrinterDetail, JobQueue, AuditLogs, UsersRoles, PrintFlowBindings, LocalDiagnostics และที่น่าสังเกตคือ **Templates.tsx (1,101 บรรทัด) เองก็ไม่มี test ไฟล์เฉพาะ** นอกจากนี้ test ของ webhooks และ settings ไม่ได้ import logic จริงจากหน้าเว็บ แต่เขียน logic จำลองซ้ำในไฟล์ test เอง — ถ้าหน้าเว็บจริงเปลี่ยนแปลง logic ไป test อาจยังผ่านอยู่ทั้งที่พฤติกรรมจริงเปลี่ยนไปแล้ว

## 10. Code Health และ Error Handling

ภาพรวมสะอาดมาก — ไม่พบ TODO/FIXME/`@ts-ignore`/`console.log` ค้างเลยใน frontend และมี `ErrorBoundary` ครอบทั้งแอปแล้ว error จาก render จะไม่ทำให้จอขาว เรื่อง typecheck ที่ CLAUDE.md บอกว่า LocalDiagnostics.tsx fail อยู่ ตรวจสอบแล้วพบว่า**ปัจจุบัน typecheck ผ่านหมดไม่มี error** — เป็นข้อมูลเก่าที่ควรอัปเดตในเอกสาร ฝั่ง backend ก็ไม่พบ catch block ที่กลืน error เงียบๆ หรือ fire-and-forget ที่ไม่มีการจัดการ

## 11. เอกสารที่ไม่ตรงกับความเป็นจริง

นอกจากเรื่อง `apps/runner` ที่ไม่มีอยู่จริงแล้ว (ข้อ 1) ยังพบว่า `infra/docker/docker-compose.yml` อ้างถึง `Dockerfile.runner` ที่ไม่มีอยู่ (มีแต่ `Dockerfile.runner-go`) ทำให้ `docker-compose up` จะพังตอน build runner และ schema SQL ใน `infra/migrations/` เป็น PostgreSQL schema ที่ไม่ได้ถูกใช้งานจริงเลย ระบบจริงใช้ schema แยกต่างหากใน `sqlite.schema.ts` ที่เป็นคนละชุดกัน อาจ drift กันโดยไม่มีใครรู้

## 12. ความเปราะบางเฉพาะ Windows/Desktop

`WindowsSpoolerAdapter` ออกแบบดีในแง่ไม่รายงานสำเร็จง่ายๆ ต้องยืนยันด้วย SNMP หรือ IPP job-status แต่มีข้อจำกัดที่เอกสารในโค้ดเองก็ยอมรับ: การนับหน้ายืนยันผลพิมพ์สมมติว่า 1 เอกสาร = 1 หน้าต่อสำเนา หากมีเอกสารหลายหน้าแล้วเครื่องพิมพ์ติดกระดาษหลังพิมพ์หน้าแรก ระบบอาจรายงานว่า "สำเร็จ" ทั้งที่พิมพ์ไม่ครบ — ปัจจุบันยังไม่กระทบเพราะใช้งานแบบพิมพ์ label หน้าเดียวเป็นหลัก แต่จะเป็นปัญหาทันทีถ้าในอนาคตมีการพิมพ์เอกสารหลายหน้า อีกจุดคือสคริปต์ build ตัวติดตั้ง (`build-all.js`) จะแค่เตือน (ไม่ fail) หาก runner-go หรือ binary หายไป หมายความว่าตัวติดตั้งอาจถูกสร้างขึ้นโดยไม่มีความสามารถค้นหา/สั่งพิมพ์เครื่องพิมพ์เลยโดยไม่มีใครรู้จนกว่าจะทดสอบจริง

## สรุปสิ่งที่ควรทำต่อ เรียงตามความสำคัญ

ระดับสูง (ควรทำก่อนขยายผู้ใช้งาน): ตรวจสอบว่า `JWT_SECRET` ถูกตั้งค่าจริงในทุกเครื่องที่ติดตั้ง ไม่พึ่งค่า fallback, ปิดช่องโหว่ RBAC ใน route รุ่นเก่าให้เช็คสิทธิ์ตาม role เหมือน route ใหม่, วางแผน retention/cleanup สำหรับข้อมูล sqlite ระยะยาว, แก้ hardcode ภาษาไทยในหน้า Webhooks ให้ผ่านระบบ i18n

ระดับกลาง: อัปเดต CLAUDE.md ให้ตรงกับความเป็นจริง (ลบการอ้างถึง apps/runner, แก้ severity ของ adapter ที่พร้อมใช้จริง), แก้ docker-compose ให้ชี้ Dockerfile ที่มีอยู่จริงหรือถอด service ออก, เพิ่ม test ให้ Templates.tsx และหน้าที่ยังไม่มี test เลย, รวม toast/modal pattern ให้เป็นมาตรฐานเดียวกันทุกหน้า

ระดับต่ำ: จำกัด CORS ให้เจาะจง origin มากขึ้นเมื่อพร้อม, ลบ schema SQL ที่ไม่ได้ใช้งานออกหรือทำให้เป็นแหล่งความจริงเดียวกับ sqlite schema จริง
