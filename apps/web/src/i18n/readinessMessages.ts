import type { Locale } from './translations.js';

/**
 * Thai renderings of the readiness sentences built in
 * apps/api/src/routes/v1/readiness.routes.ts. The API stays English (it is
 * also read by logs and support bundles); the UI translates what it knows
 * and shows anything unrecognised verbatim, so a new server sentence is
 * never hidden — it just appears in English until it is added here.
 */
const THAI: Array<[RegExp, string]> = [
  [/^Packaged desktop runtime is active\.$/, 'แอปเดสก์ท็อปแบบแพ็กเกจกำลังทำงาน'],
  [/^The API is running outside the packaged desktop shell\.$/, 'API ทำงานอยู่นอกแอปเดสก์ท็อปแบบแพ็กเกจ'],
  [/^Use the Windows installer for pilot acceptance\.$/, 'ใช้ตัวติดตั้ง Windows สำหรับการทดสอบรับมอบงาน'],
  [/^The local API is responding\.$/, 'API ภายในเครื่องตอบสนองปกติ'],
  [/^SQLite opened and passed its startup integrity check\.$/, 'เปิด SQLite และผ่านการตรวจความสมบูรณ์ตอนเริ่มระบบแล้ว'],
  [/^In-memory persistence is active\.$/, 'กำลังเก็บข้อมูลไว้ในหน่วยความจำเท่านั้น'],
  [/^Use DB_MODE=sqlite for production\.$/, 'ใช้ DB_MODE=sqlite สำหรับการใช้งานจริง'],
  [/^The single configured print executor is active\.$/, 'ตัวดำเนินการพิมพ์ที่ตั้งค่าไว้กำลังทำงาน'],
  [/^No print executor is active\.$/, 'ไม่มีตัวดำเนินการพิมพ์ที่ทำงานอยู่'],
  [/^Enable the API local worker before accepting work\.$/, 'เปิดใช้ตัวทำงานภายในของ API ก่อนรับงาน'],
  [/^(\d+) discovery runner\(s\) reported recently\.$/, 'ตัวค้นหาเครื่องพิมพ์ $1 ตัวรายงานเข้ามาเมื่อเร็วๆ นี้'],
  [/^No discovery runner heartbeat was received in the last 90 seconds\.$/, 'ไม่ได้รับสัญญาณจากตัวค้นหาเครื่องพิมพ์ในช่วง 90 วินาทีที่ผ่านมา'],
  [/^Check desktop-runner\.log and restart the desktop app\.$/, 'ตรวจสอบ desktop-runner.log แล้วเปิดแอปเดสก์ท็อปใหม่'],
  [/^(\d+) active Windows installed printer\(s\) are registered\.$/, 'ลงทะเบียนเครื่องพิมพ์ Windows ที่ใช้งานอยู่แล้ว $1 เครื่อง'],
  [/^No active Windows installed printer is registered\.$/, 'ยังไม่ได้ลงทะเบียนเครื่องพิมพ์ Windows ที่ใช้งานอยู่'],
  [/^Run discovery, then register and select a Windows printer\.$/, 'ค้นหาเครื่องพิมพ์ แล้วลงทะเบียนและเลือกเครื่องพิมพ์ Windows'],
  [/^NATS is disabled\.$/, 'ปิดใช้งาน NATS อยู่'],
  [/^NATS core connection is ready\.$/, 'การเชื่อมต่อ NATS core พร้อมใช้งาน'],
  [/^NATS core is not connected\.$/, 'NATS core ยังไม่ได้เชื่อมต่อ'],
  [/^JetStream intake is disabled with NATS\.$/, 'การรับงานผ่าน JetStream ปิดอยู่พร้อมกับ NATS'],
  [/^JetStream is reachable\.$/, 'เชื่อมต่อ JetStream ได้'],
  [/^JetStream intake is not ready\.$/, 'การรับงานผ่าน JetStream ยังไม่พร้อม'],
  [/^No intake stream is configured\.$/, 'ยังไม่ได้ตั้งค่าสตรีมรับงาน'],
  [/^Stream (.*) is ready\.$/, 'สตรีม $1 พร้อมใช้งาน'],
  [/^Stream (.*) is not ready\.$/, 'สตรีม $1 ยังไม่พร้อม'],
  [/^No durable intake consumer is configured\.$/, 'ยังไม่ได้ตั้งค่า durable consumer สำหรับรับงาน'],
  [/^Durable consumer (.*) is consuming\.$/, 'durable consumer $1 กำลังรับงาน'],
  [/^Durable consumer (.*) is not consuming\.$/, 'durable consumer $1 ไม่ได้รับงาน'],
  [/^No enabled HTTP callback endpoint is configured\.$/, 'ยังไม่มีจุดรับ HTTP callback ที่เปิดใช้งาน'],
  [/^Configure an endpoint only when the caller requires HTTP results\.$/, 'ตั้งค่าจุดรับเฉพาะเมื่อระบบต้นทางต้องการผลลัพธ์ผ่าน HTTP'],
  [/^(\d+) enabled endpoint\(s\); the most recent HTTP callback succeeded\.$/, 'จุดรับที่เปิดใช้งาน $1 จุด HTTP callback ล่าสุดสำเร็จ'],
  [/^(\d+) endpoint\(s\) configured; the most recent HTTP callback did not succeed\.$/, 'ตั้งค่าจุดรับไว้ $1 จุด แต่ HTTP callback ล่าสุดไม่สำเร็จ'],
  [/^(\d+) endpoint\(s\) configured, but no successful HTTP callback is recorded in this process\.$/, 'ตั้งค่าจุดรับไว้ $1 จุด แต่ยังไม่มี HTTP callback ที่สำเร็จในการทำงานรอบนี้'],
  [/^Run a callback test and verify the receiver, DNS, firewall, and signing-secret environment reference\.$/, 'ทดสอบ callback และตรวจสอบปลายทาง DNS ไฟร์วอลล์ และค่าอ้างอิงของ signing secret'],
  [/^No enabled NATS callback endpoint is configured\.$/, 'ยังไม่มีจุดรับ NATS callback ที่เปิดใช้งาน'],
  [/^Configure an endpoint only when the caller requires NATS results\.$/, 'ตั้งค่าจุดรับเฉพาะเมื่อระบบต้นทางต้องการผลลัพธ์ผ่าน NATS'],
  [/^(\d+) NATS callback endpoint\(s\) can publish\.$/, 'จุดรับ NATS callback $1 จุดส่งข้อมูลได้'],
  [/^NATS callbacks are configured but publishing is unavailable\.$/, 'ตั้งค่า NATS callback ไว้แล้ว แต่ยังส่งข้อมูลไม่ได้'],
  [/^No callback deliveries are waiting for retry\.$/, 'ไม่มี callback ที่รอส่งซ้ำ'],
  [/^(\d+) callback delivery record\(s\) are pending or scheduled for retry\.$/, 'มี callback $1 รายการที่รอส่งหรือรอส่งซ้ำ'],
  [/^Review callback attempts and receiver availability\.$/, 'ตรวจสอบประวัติการส่ง callback และสถานะของปลายทาง'],
  [/^Enable NATS in Settings only when remote intake or NATS callbacks are required\.$/, 'เปิด NATS ในการตั้งค่าเฉพาะเมื่อต้องรับงานจากระยะไกลหรือใช้ NATS callback'],
  [/^Verify the sanitized broker address, credentials, firewall, and broker availability\.$/, 'ตรวจสอบที่อยู่ broker ข้อมูลรับรอง ไฟร์วอลล์ และสถานะของ broker'],
  [/^Create or grant access to stream (.*)\.$/, 'สร้างสตรีม $1 หรือให้สิทธิ์เข้าถึง'],
  [/^Resolve durable consumer (.*) configuration\.$/, 'แก้ไขการตั้งค่า durable consumer $1'],
  [/^Log directory is not exposed in this runtime\.$/, 'การทำงานรูปแบบนี้ไม่เปิดให้เข้าถึงโฟลเดอร์ log'],
  [/^Log file does not exist\.$/, 'ไม่พบไฟล์ log'],
  [/^Log file could not be read\.$/, 'อ่านไฟล์ log ไม่ได้'],
];

export function localizeReadinessText(text: string | undefined, locale: Locale): string | undefined {
  if (text == null || locale !== 'th') return text;
  for (const [pattern, thai] of THAI) {
    if (pattern.test(text)) return text.replace(pattern, thai);
  }
  return text;
}
