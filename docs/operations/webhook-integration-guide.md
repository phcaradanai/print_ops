# Webhook Integration Guide

PrintOps ไม่ต่อ HIS โดยตรง External integration program ต้อง webhook/API เข้ามาที่ PrintOps

## Endpoint Dev Default

```
POST /api/v1/intake/dev-intake
```

Sample payload:

```json
{
  "request_id": "REQ-001",
  "type": "lab_label",
  "label": "Tube A",
  "barcode": "ABC123",
  "hn": "HN001"
}
```

## Route Policy Default

`lab-label-static` map:

- `type == lab_label`
- printer: `LAB_LABEL_01`
- template: `LAB_LABEL_DEFAULT`
- payload fields: `barcode`, `label`, `hn_masked`

## Expected Response

```json
{
  "accepted": true,
  "print_job_id": "...",
  "request_id": "REQ-001",
  "trace_id": "...",
  "resolved_printer_code": "LAB_LABEL_01",
  "resolved_template_code": "LAB_LABEL_DEFAULT",
  "status": "QUEUED"
}
```

## Duplicate Request

ถ้าส่ง `request_id` เดิมจาก `source_system` เดิม ระบบจะคืน job เดิมและไม่พิมพ์ซ้ำ

## Security Notes

- Production ต้องใช้ endpoint auth จริง
- ห้ามส่ง secret ใน payload
- ห้ามใช้ raw JavaScript ใน route policy
- ต้องยืนยัน payload masking ก่อนรับ PHI จริง
