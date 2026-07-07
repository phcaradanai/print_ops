# Preview Sandbox

Template Preview Sandbox เป็นพื้นที่ทดสอบสำหรับ Sysadmin/Owner เท่านั้น ไม่แสดงให้ user ทั่วไปเห็น

## สิ่งที่ทำได้

- เลือก template
- เลือก paper profile
- ใส่ sample payload
- render visual preview ตามขนาด label/paper
- ดู missing field warning
- ดู render time
- ดู generated print payload เฉพาะ sandbox role
- ส่ง test print ไปยัง registered printer

## Safety Boundary

- Admin แก้ template/paper ได้ แต่เข้า sandbox ไม่ได้
- Operator/Viewer ไม่เห็น sandbox
- Preview sandbox แยกจาก fast print path
- Generated print payload ไม่ถูกส่งออกผ่าน job detail/export ปกติ

## สิ่งที่ต้องยืนยัน

- ต้องยืนยัน real printer target ก่อนเปิด test print กับเครื่องจริง
- ต้องยืนยัน template content สำหรับ ZPL/TSPL กับ printer model จริง
