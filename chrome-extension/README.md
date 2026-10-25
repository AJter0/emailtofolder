# Email to Folder for Chrome (`v1.0.0`)

ส่วนขยาย Chrome (Manifest V3) สำหรับจัดเก็บและคัดแยกอีเมลจาก **Gmail (Gmail API)** และ **Microsoft Outlook / Office 365 (Microsoft Graph API)** ลงโฟลเดอร์ย่อยภายใต้โฟลเดอร์ `Downloads/EmailToFolder/...` บนเครื่องโดยอัตโนมัติ โดยใช้เอนจินกฎคัดแยก (Smart Rules Engine) เดียวกับโปรแกรม Desktop

---

## ✨ ฟีเจอร์หลัก (Key Features)

1. **เชื่อมต่อผ่าน Official API เสถียร 100%**
   - **Gmail API** (`gmail.readonly`) ผ่าน OAuth 2.0
   - **Microsoft Graph API** (`Mail.Read`, `offline_access`) ผ่าน OAuth 2.0 + PKCE
2. **Smart Content Rules (7 เงื่อนไขเหมือนเวอร์ชัน Desktop)**
   - หัวข้ออีเมล (`subject_contains`), ผู้ส่ง (`from_contains`), ผู้รับ To/CC (`to_contains`), เนื้อหา (`body_contains`), มีไฟล์แนบ (`has_attachment`), ชื่อไฟล์แนบ (`attachment_name_contains`), และอีเมลทั้งหมด (`all_emails`)
3. **โครงสร้างโฟลเดอร์ย่อยอัตโนมัติ (Subfolder Hierarchy)**
   - แยกตาม **ปี/เดือน (`YYYY/MM`)**, แยกตาม **ชื่อผู้ส่ง (`Sender Name`)**, แยกโฟลเดอร์ต่อ **1 อีเมล (`YYYY-MM-DD_Subject`)**, หรือบันทึกตรงในโฟลเดอร์ปลายทาง
4. **บันทึกครบทั้ง `.eml` และแยกไฟล์แนบแท้ (PDF, Excel, Word, ZIP ฯลฯ)**
   - มีตัวเลือกข้ามรูปภาพลายเซ็นขนาดเล็ก (Inline Signature Images) อัตโนมัติ
5. **3 โหมดการทำงาน**
   - **Background Auto-Sync**: ซิงก์อีเมลใหม่อัตโนมัติทุก N นาที
   - **ปุ่ม "Save to Folder" บนหน้าเว็บ Gmail & Outlook Web**: กดบันทึกอีเมลที่กำลังเปิดอ่านได้ทันทีในคลิกเดียว
   - **Drag & Drop `.eml` ในหน้า Popup**: ลากไฟล์ `.eml` มาวางใน Popup เพื่อคัดแยกตามกฎทันที
6. **Audit Trail + Export CSV (UTF-8 BOM)**
   - ค้นหา กรองตามกฎ และส่งออกไฟล์ `.csv` เปิดใน Microsoft Excel ภาษาไทยไม่เพี้ยน

---

## 🚀 วิธีติดตั้ง (Load Unpacked)

1. เปิดเบราว์เซอร์ Chrome / Edge / Brave แล้วไปที่ `chrome://extensions`
2. เปิดสวิตช์ **Developer mode (โหมดนักพัฒนา)** มุมขวาบน
3. คลิกปุ่ม **Load unpacked (โหลดส่วนขยายที่ยังไม่ได้แพ็ก)**
4. เลือกโฟลเดอร์ `chrome-extension` นี้
5. ปักหมุด (Pin) ไอคอน **Email to Folder** บนแถบด้านบนของเบราว์เซอร์

### ค่าคงที่สำหรับการตั้งค่า OAuth 2.0
- **Extension ID:** `cidokheholdhfghadmjihmmdfoibipoh`
- **OAuth Redirect URI:** `https://cidokheholdhfghadmjihmmdfoibipoh.chromiumapp.org/`

ดูคู่มือการสร้าง Google Client ID และ Microsoft Client ID แบบละเอียดได้ที่หน้าเว็บไซต์ [`extension.html`](../extension.html)
