# Dynamic Webhook Intake

Dynamic intake ให้ external integration program ส่ง webhook/API เข้า PrintOps โดยไม่ต้อง hardcode printer/template ใน caller ทุกตัว

## Flow

```
External Service
→ POST /api/v1/intake/:endpointCode
→ authenticate endpoint
→ validate request size
→ apply route policy
→ map payload
→ resolve printer_code
→ resolve template_code
→ render print payload
→ create print job
→ queue
→ trace/audit
```

## Response

```json
{
  "accepted": true,
  "print_job_id": "...",
  "request_id": "...",
  "trace_id": "...",
  "resolved_printer_code": "LAB_LABEL_01",
  "resolved_template_code": "LAB_LABEL_DEFAULT",
  "status": "QUEUED"
}
```

## Idempotency

PrintOps ใช้ `source_system + request_id` เพื่อกันพิมพ์ซ้ำ ถ้า request เดิมเข้ามาอีก ระบบคืน job เดิมและไม่สร้าง queue ซ้ำ

## Acceptance callback

`POST /api/v1/intake/:endpointCode` ไม่ใช่ทางเดียวที่ยิง acceptance callback อีก
ต่อไป ทั้งสามทางนี้ยิง callback ตัวเดียวกัน ผ่าน `WebhookCallbackService` และใช้
`callbackPayloadTemplate` ชุดเดียวกัน (`$.field` = ข้อมูลที่ผู้เรียกส่งมา,
`$$.field` = ฟิลด์ของระบบ — ดู [`webhook-callback.md`](../webhook-callback.md)):

| ทาง | ระบุ endpoint ด้วย | บริการที่ยิง |
|---|---|---|
| `POST /api/v1/intake/:endpointCode` | path segment | `DynamicIntakeService` |
| `POST /api/v1/printer/:code_template/:code_profile` | `endpoint_code` ใน body | `DynamicPrintService` |
| NATS print-intake envelope | `endpoint_code` ใน envelope | `DynamicPrintService` |

สองทางล่างเพิ่งได้ acceptance callback — ก่อนหน้านี้ `endpoint_code` บนสองทางนั้น
ใช้สร้าง `JobCallbackIntent` สำหรับ **terminal** callback เท่านั้น

`POST /api/v1/print-jobs` ผ่าน `AcceptExternalJobService` โดยตรง ยังได้เฉพาะ
terminal callback

จะยิง acceptance หรือ terminal ขึ้นกับ `callbackOnPrintResult` ของ endpoint —
อย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่ ยกเว้น duplicate ที่ได้ acceptance เสมอ เพราะไม่มี
งานพิมพ์ใหม่ที่จะไปถึงสถานะสุดท้ายได้

## Route Policy

Mapping MVP รองรับ:

- match rule แบบ field equality
- printer mapping แบบ `static` หรือ `field`
- template mapping แบบ `static` หรือ `field`
- payload mapping แบบ simple JSON path เช่น `$.barcode`

ห้ามใช้ raw JavaScript, `eval`, `Function`, หรือ arrow function ใน policy
