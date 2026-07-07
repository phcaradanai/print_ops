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

## Route Policy

Mapping MVP รองรับ:

- match rule แบบ field equality
- printer mapping แบบ `static` หรือ `field`
- template mapping แบบ `static` หรือ `field`
- payload mapping แบบ simple JSON path เช่น `$.barcode`

ห้ามใช้ raw JavaScript, `eval`, `Function`, หรือ arrow function ใน policy
