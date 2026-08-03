# Template Setup Guide

คู่มือนี้สำหรับ Admin ขึ้นไป

## สร้าง Paper Profile

1. เข้าเมนู `Paper Profiles`
2. กำหนด `code`, ชื่อ, width/height mm, margins และ dpi
3. ใช้ preset เช่น 100x50 mm หรือ 80x50 mm เป็น baseline ได้
4. บันทึกแล้วนำไปใช้กับ template หรือ binding

## สร้าง Template

1. เข้าเมนู `Templates`
2. เลือก engine เช่น `RAW_TEXT`, `ZPL`, `TSPL`
3. ใส่ content โดยใช้ placeholder แบบ `{{field}}`
4. เลือก paper profile
5. กด preview เพื่อตรวจ missing field
6. Publish เมื่อพร้อมใช้งาน

## ผูก Printer กับ Template

1. เข้าเมนู `Bindings`
2. เลือก `printer_code`
3. เลือก `template_code`
4. เลือก paper profile
5. ตั้ง `is_default` ถ้าเป็น template หลักของ printer นั้น

## สิ่งที่ต้องยืนยัน

- ขนาด label จริงตรงกับ paper profile
- template code อยู่ใน printer allowlist
- printer code เป็น printer ที่ runner/register แล้ว
