# Template Performance Cache

Fast print path ต้องเร็ว โดยเฉพาะ label printer เช่น Zebra/POSTEK

## Cache ที่ใช้ใน MVP

- template compile cache by `template_code + version`
- paper profile cache ผ่าน repository lifetime
- printer/template binding cache ผ่าน repository lifetime
- route policy cache ผ่าน repository lifetime

## Timing ที่เก็บ

- `intake_received_at`
- `route_resolved_at`
- `template_resolved_at`
- `rendered_at`
- `queued_at`
- `route_resolve_ms`
- `render_ms`

## Fast Path Rules

- intake endpoint ไม่ render preview
- preview sandbox แยกจาก print path
- render print payload ใช้ lightweight renderer
- audit/trace เก็บแบบพอเพียงและไม่ log raw sensitive payload

## ข้อจำกัด

- Cache ยังเป็น in-memory ต่อ process
- ต้องเพิ่ม invalidation strategy เมื่อใช้ Postgres/หลาย API instance
