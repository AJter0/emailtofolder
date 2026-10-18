# Email to Folder — Enterprise Desktop Application

ซอฟต์แวร์จัดเก็บและคัดแยกอีเมลลงโฟลเดอร์อัตโนมัติ สำหรับ **Microsoft Outlook**, **Gmail**, **Office 365** และเซิร์ฟเวอร์ **IMAP** โดยจำลองการทำงานเหมือนการลากเมาส์ (Drag & Drop) อีเมลจากโปรแกรมลงมาที่โฟลเดอร์บนเครื่องคอมพิวเตอร์หรือ Network Drive ทันทีที่มีอีเมลใหม่เข้ามา

หน้าตาโปรแกรมออกแบบตามเว็บไซต์ [emailtofolder.com](index.html) ในรูปแบบ Dark Luxury UI พร้อมระบบมอนิเตอร์แบบ 3 คอลัมน์แบบเรียลไทม์

---

## 📦 ตำแหน่งไฟล์ติดตั้งและโปรแกรมพร้อมใช้งาน

1. **ไฟล์ดาวน์โหลดบนเว็บไซต์ (Website Direct Download):**
   - [`downloads/EmailToFolder-Setup.exe`](file:///C:/Users/DELL/Downloads/emailtofolder-site/downloads/EmailToFolder-Setup.exe) (ขนาด ~82.9 MB)
   - ลิงก์บนเว็บไซต์: ให้ผู้เข้าชมเว็บไซต์สามารถกดดาวน์โหลดได้ทันทีจากหน้าเว็บ [index.html](file:///C:/Users/DELL/Downloads/emailtofolder-site/index.html) ในส่วน Hero และส่วน Download

2. **ไฟล์ติดตั้ง (Windows NSIS Setup Installer):**
   - [`app/dist/EmailToFolder-Setup-1.0.0.exe`](file:///C:/Users/DELL/Downloads/emailtofolder-site/app/dist/EmailToFolder-Setup-1.0.0.exe)
   - ดับเบิ้ลคลิกเพื่อติดตั้งลงใน Windows ได้ทันที พร้อมสร้างทางลัดบน Desktop, Start Menu และตัวถอนการติดตั้งใน Add/Remove Programs

3. **โปรแกรมแบบพกพา (Portable Unpacked Version):**
   - [`app/dist/win-unpacked/Email to Folder.exe`](file:///C:/Users/DELL/Downloads/emailtofolder-site/app/dist/win-unpacked/Email%20to%20Folder.exe)
   - ดับเบิ้ลคลิกเปิดใช้งานได้ทันทีโดยไม่ต้องติดตั้ง หรือกดที่ไฟล์สคริปต์ [`run-app.bat`](file:///C:/Users/DELL/Downloads/emailtofolder-site/run-app.bat)

---

## 🎁 ระบบทดลองใช้ฟรี 100 ฉบับ/เดือน (Free Trial Monthly Quota)

- **จำกัด 100 ฉบับต่อเดือน:** ตัวโปรแกรมในเวอร์ชันฟรีจะอนุญาตให้ดึงและจัดเก็บอีเมลอัตโนมัติได้สูงสุด **100 ฉบับต่อเดือน**
- **รีเซ็ตอัตโนมัติทุกเดือน:** เมื่อเข้าสู่วันที่ 1 ของเดือนถัดไป (เช่น 1 พฤศจิกายน, 1 ธันวาคม) ระบบจะตรวจจับเดือนใหม่และ**รีเซ็ตโควตากลับเป็น 0/100 ให้อัตโนมัติทันที**
- **แถบแสดงสถานะโควตาในโปรแกรม:** บนแถบเมนูด้านบนของโปรแกรมจะมี Badge แสดงจำนวนอีเมลที่ใช้ไปในเดือนนี้แบบเรียลไทม์ เช่น `🎁 ฟรี: 14/100 ฉบับ/เดือน` พร้อม Progress Bar
- **เมื่อครบ 100 ฉบับ:** โปรแกรมจะหยุดบันทึกอีเมลชั่วคราวและแจ้งเตือนผู้ใช้ โดยสามารถรอรอบรีเซ็ตในเดือนถัดไป หรือติดต่อขออัปเกรดเป็นเวอร์ชัน Enterprise (Unlimited) ได้ทันที

---

## 🌟 ฟีเจอร์หลัก (Key Features)

### 1. รองรับหลายระบบอีเมล (Multi-Provider Support)
- **Microsoft Outlook Desktop (Windows MAPI/COM):** เชื่อมกับโปรแกรม Outlook ที่เปิดใช้งานอยู่บนเครื่อง Windows ดึงอีเมลจาก Inbox และบันทึกไฟล์ `.msg` พร้อมไฟล์แนบได้โดยไม่ต้องกรอกรหัสผ่าน
- **Gmail / Google Workspace:** รองรับการเชื่อมต่อผ่าน IMAP ด้วย App Password ทำงานเบื้องหลังได้ตลอด 24 ชั่วโมง
- **Office 365 / Outlook.com / Exchange:** รองรับการเชื่อมต่อแบบ IMAP Secure
- **Custom IMAP Servers:** รองรับอีเมลบริษัท, cPanel, Webmail องค์กรทุกชนิด

### 2. บันทึกเหมือนการลากวาง (Drag & Drop Simulation)
- เมื่อมีอีเมลใหม่เข้ามาระบบจะ:
  1. บันทึกไฟล์อีเมลฉบับเต็ม (`.eml` หรือ `.msg`) ที่สามารถดับเบิ้ลคลิกเปิดดูใน Microsoft Outlook หรือโปรแกรมอีเมลอื่นๆ ได้ทันที
  2. สกัดไฟล์แนบทั้งหมด (เช่น `Invoice.pdf`, `Report.xlsx`, `Contract.docx`, รูปภาพ) ออกมาบันทึกไว้ในโฟลเดอร์ปลายทาง
  3. ตั้งชื่อไฟล์ตามวันที่และหัวข้ออย่างเป็นระเบียบ เช่น `2026-10-17_Invoice #INV-2026-0418.eml`
  4. เลือกได้ว่าจะให้สร้างโฟลเดอร์ย่อยตามวันที่และหัวข้อของอีเมลแต่ละฉบับหรือไม่

### 3. ระบบกฎอัตโนมัติ (Rule Engine)
- กำหนดเงื่อนไขการคัดแยกได้หลากหลาย:
  - หัวข้ออีเมลมีคำว่า (Subject contains) เช่น `"Invoice"`, `"Contract"`, `"Report"`
  - ส่งมาจากอีเมลหรือโดเมน (From / Domain) เช่น `"@projecta.co.th"`, `"accounting@vendor.com"`
  - มีไฟล์แนบใดๆ (Has any attachment)
  - ชื่อไฟล์แนบมีคำว่า (Attachment name contains) เช่น `".pdf"`, `"PO_"`
- กำหนดโฟลเดอร์ปลายทางได้ทั้ง **Local Drive (C:, D:)**, **Network Drive**, **NAS**, และ **File Server** (`\\server\share\...`)

### 4. หน้าตาโปรแกรมตามธีมเว็บไซต์ (UI Replica)
- Custom Windows Titlebar พร้อมปุ่มปิด ย่อ ขยายสไตล์ macOS (🔴🟡🟢)
- คอลัมน์ 1: **โฟลเดอร์ปลายทาง (Target Folders)** พร้อมจำนวนไฟล์ที่บันทึกแล้ว และปุ่มคลิกเพื่อเปิดโฟลเดอร์ใน Windows File Explorer ทันที
- คอลัมน์ 2: **Live Inbox Activity** แสดงอีเมลที่บันทึกแล้วล่าสุดแบบเคลื่อนไหว พร้อมแท็กชิปปลายทาง (เช่น `→ Finance / Invoices`) และคลิกเพื่อเปิดโฟลเดอร์ได้ทันที
- คอลัมน์ 3: **Auto Rules & Live Counter** แสดงกฎที่กำลังทำงาน และตัวเลขสถิติอีเมลที่บันทึกแล้ว (`✓ 1,284 ฉบับที่บันทึกแล้ว`)
- **Drag & Drop Test Zone:** มีโซนลากวางไฟล์บนหน้าจอ ให้ผู้ใช้สามารถลากไฟล์ `.eml` หรือ `.msg` จาก Desktop มาปล่อย เพื่อทดสอบว่าตรงกับกฎข้อใดและถูกคัดแยกถูกต้องหรือไม่

### 5. การทำงานเบื้องหลังและการตั้งค่า (System Tray & Background)
- ย่อเก็บใน System Tray (มุมขวาล่างข้างนาฬิกา) เพื่อทำงานเบื้องหลัง 24 ชั่วโมง
- แจ้งเตือนผ่าน Windows Native Notification เมื่อมีอีเมลถูกจัดเก็บ
- ตั้งค่าให้เปิดโปรแกรมอัตโนมัติเมื่อเปิดเครื่องคอมพิวเตอร์ (Start with Windows)

---

## 🛠️ โครงสร้างซอร์สโค้ด (Source Code Structure)

```
emailtofolder-site/
├── app/
│   ├── main.js                 # Electron Main Process, IPC Handlers & Tray Management
│   ├── preload.js              # Secure IPC Bridge
│   ├── file-processor.js       # Rule Engine, MIME Parser (.eml) & Attachment Extractor
│   ├── imap-worker.js          # IMAP Client (Gmail, O365, Custom IMAP) with IDLE push
│   ├── outlook-local.js        # Local Windows Outlook COM/MAPI automation connector
│   ├── test-processor.js       # Unit test for email parsing and rule matching
│   ├── make_icon.py            # Generates Windows icon.ico
│   ├── package.json            # Electron & electron-builder configuration
│   ├── renderer/
│   │   ├── index.html          # Dark Luxury Desktop UI (matching website)
│   │   ├── styles.css          # Styling & Animations matching emailtofolder-site
│   │   └── app.js              # Frontend UI logic, modals & live updates
│   └── dist/
│       ├── EmailToFolder-Setup-1.0.0.exe   # << ตัวติดตั้ง Windows NSIS Setup
│       └── win-unpacked/                   # << โปรแกรมแบบพกพาเปิดได้ทันที
├── run-app.bat                 # สคริปต์เปิดโปรแกรมแบบทันที
├── build-installer.bat         # สคริปต์สั่ง Rebuild setup.exe
├── index.html                  # Landing website (emailtofolder.com)
└── README_APP.md               # คู่มือการใช้งานฉบับนี้
```

---

## 🚀 วิธีการทดสอบและใช้งาน

1. **เปิดโปรแกรม:** ดับเบิ้ลคลิกที่ [`run-app.bat`](file:///C:/Users/DELL/Downloads/emailtofolder-site/run-app.bat) หรือเปิดจาก [`app/dist/win-unpacked/Email to Folder.exe`](file:///C:/Users/DELL/Downloads/emailtofolder-site/app/dist/win-unpacked/Email%20to%20Folder.exe)
2. **เชื่อมต่ออีเมล:**
   - คลิกที่ปุ่ม **"เชื่อมต่อบัญชี (Accounts)"** บนเมนูด้านบน
   - หากใช้ Outlook ในเครื่อง ให้กดปุ่ม **"เชื่อมต่อ Outlook"**
   - หากใช้ Gmail ให้กดปุ่ม **"ตั้งค่า Gmail"** แล้วกรอกอีเมลและ App Password
3. **กำหนดกฎการบันทึก:**
   - คลิกที่ปุ่ม **"จัดการกฎ (Rules)"**
   - สร้างกฎใหม่ เช่น หัวข้อมีคำว่า `"Invoice"` ให้บันทึกลงโฟลเดอร์ `C:\Invoices`
4. **ทดสอบระบบ:**
   - ลากไฟล์ `.eml` หรือ `.msg` มาปล่อยในช่อง **"Drag & Drop Test Zone"** บนหน้าโปรแกรม
   - ระบบจะตรวจจับกฎ บันทึกไฟล์ `.eml` และแตกไฟล์แนบลงโฟลเดอร์ปลายทางทันที พร้อมแสดงความคืบหน้าบน Live Monitor!
