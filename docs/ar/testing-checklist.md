<!-- i18n-sync: en@8293e87 2026-05-20 -->

# قائمة اختبار يدوي — Web Agent

## Profiles

- [ ] التحميل الأول ينشئ profile باسم من المجموعة المدمجة.
- [ ] profile ثانٍ بشخصية ولون تمييز مخصصين.
- [ ] تبديل الـ profile النشط والوكيل **متوقف**؛ الاختيار يبقى بعد إعادة التحميل.
- [ ] لا يمكن حذف آخر profile.

## التشغيل / الطرفية

- [ ] **Launch Web Agent** يصل إلى `❯` الوردي خلال ~5 ثوانٍ (أول تشغيل WebContainer قد يكون أبطأ).
- [ ] بدون مفاتيح API، خطأ واضح دون تعطيل الواجهة.
- [ ] بمفتاح صالح، رسالة قصيرة ورد متدفق.
- [ ] **Stop** ينهي العملية؛ الشريط Stopped.
- [ ] تغيير حجم الطرفية دون تجميد التبويب.

## الأدوات (دخان)

اطلب من الوكيل قيد التشغيل:

- [ ] `read_file` / `write_file` تحت `/workspace`
- [ ] `list_dir` أو `tree`
- [ ] `grep` أو `find_files`
- [ ] `run_shell` (مثل `echo test`)
- [ ] `web_fetch` على `https://` عام

## الاستمرار

- [ ] ملف في `/workspace`، **Stop**، إعادة تحميل، **Launch** — الملف باقٍ لذلك الـ profile.
- [ ] **Export workspace** يحمّل JSON.
- [ ] (اختياري) **Import** لنفس JSON في profile آخر.

## الإعدادات

- [ ] مزود **Custom**: base URL + API key؛ يحل الوكيل `CUSTOM_BASE_URL` / `CUSTOM_API_KEY`.
