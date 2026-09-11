# Template Safety Boundary

ระบบ template/webhook ต้องปลอดภัยเพราะทำงานใน local network และอาจรับข้อมูลจากระบบภายนอก

## ทำแล้วใน MVP

- request size limit สำหรับ dynamic intake
- copies limit ยัง enforced ผ่าน printer/job path เดิม
- template allowlist ผ่าน printer `allowedTemplates`
- printer allowlist ผ่าน service account และ route resolution
- endpoint auth รองรับ `NONE` สำหรับ dev และ `API_KEY` skeleton
- payload snapshot เก็บเฉพาะ keys/length ไม่เก็บ raw payload
- Fastify logger redact auth headers และ payload
- sandbox เห็นเฉพาะ Owner/Sysadmin
- generated print payload ไม่ expose ผ่าน job detail/export ปกติ
- template/paper/webhook/test-print actions มี audit log
- route policy reject raw JS eval pattern

## ต้องยืนยันก่อน production

- hash/rotate webhook endpoint secret
- real password hashing
- persistent audit store
- field-level PHI masking policy
- printer allowlist ต่อ endpoint/source system
