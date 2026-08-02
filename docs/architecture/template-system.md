# Template System

PrintOps ใช้ template เพื่อแปลง request จาก external integration program ให้เป็น payload สำหรับ printer โดยไม่ต่อ HIS โดยตรง

## ส่วนประกอบหลัก

- `PrintTemplate` เก็บ `template_code`, engine, content, version, status และ `paper_profile_id`
- `PaperProfile` เก็บขนาดกระดาษ/label เช่น 100x50 mm, dpi, margin และ orientation
- `PrinterTemplateBinding` ผูก `printer_code` กับ `template_code` และ paper profile
- `TemplateRendererPort` เป็น boundary ระหว่าง application layer กับ renderer จริง

## Engine ใน MVP

- `RAW_TEXT`: render ด้วย `{{field}}`
- `ZPL`: skeleton สำหรับ label printer เช่น Zebra
- `TSPL`: skeleton สำหรับ POSTEK/TSPL printer
- `HTML`: preview-oriented renderer
- `JSON_LAYOUT`: preview-oriented layout renderer

## Permission

- Viewer/Operator อ่าน template และ paper profile ได้
- Admin ขึ้นไปสร้าง/แก้ template, paper profile และ binding ได้
- Owner/Sysadmin publish และใช้ sandbox/test print ได้

## ข้อจำกัด

- Renderer ยังเป็น MVP simple renderer
- ยังไม่ execute ZPL/TSPL จริงกับ printer hardware
- Template expression ห้ามใช้ raw JavaScript หรือ `eval`
