# تقرير تدقيق الصلاحيات والأمان — بيات الأكنة v1.9.0

**تاريخ التدقيق:** 2026-08-24

---

## أولًا: نظام الصلاحيات المركزي

### 1. المخطط (9 مجموعات / 59 صلاحية)

| المجموعة | الصلاحيات |
|---|---|
| المشاريع | view_projects, add_project, edit_project, delete_project |
| الوحدات | view_units, add_unit, edit_unit, delete_unit, change_unit_status, edit_prices |
| الحجوزات | view_reservations, add_reservation, edit_reservation, cancel_reservation, **add_reservation_payment**, **convert_reservation_sale** |
| المبيعات | view_sales, add_sale, edit_sale, cancel_sale, view_prices, view_discounts, edit_discounts, view_payments, add_payment, **allow_overpayments** |
| العملاء | view_customers, view_customer_finance, add_customer, edit_customer, delete_customer |
| المسوقون | view_marketers, add_marketer, edit_marketer, disable_marketer, view_marketer_sales, view_commissions, pay_commission |
| التقارير | view_sales_reports, view_financial_reports, view_marketer_reports, view_settlements, manage_settlements, create_reports, export_pdf, print_reports, save_pdf, **export_excel** |
| المستخدمون | view_users, add_user, edit_user, disable_user, delete_user, edit_permissions |
| النظام | backup, restore, manage_settings, edit_branding, manage_docs_archive |

(الصلاحيات الجديدة في v1.9 بخط عريض — نمط التسمية `view_x` / `add_x` هو النمط المركزي المعتمد
في النظام؛ وهو ما يعادل أمثلة النقاط `projects.view` و `projects.export` في المواصفات بتمثيل underscore.)

### 2. قاعدة «لا صلاحية = لا شيء» (مطبقة على 4 طبقات)

| الطبقة | الآلية |
|---|---|
| الواجهة | إخفاء الأزرار والصفحات والأقسام حسب `permsSet` |
| Backend API | وسيط `perm(...)` على **كل** مسار — 403 بدون الصلاحية |
| البيانات الحساسة | إخفاء الأسعار/الخصومات/العمولات/الجوالات من الاستجابة (`stripSaleFields`, `maskPhone`) |
| قاعدة البيانات | الفهارس الفريدة الجزئية تمنع التعارضات حتى على مستوى DB |

- تغيير صلاحية المستخدم ينعكس **فورًا** (تُقرأ الصلاحيات من قاعدة البيانات مع كل طلب — اختبار 28).
- تعطيل الحساب يبطل جلسته فورًا (اختبار 29) وتغيير كلمة المرور يبطل كل الجلسات القديمة
  (`token_version`).
- النطاق القديم محفوظ: `sales` / `reservations_officer` بدون صلاحيات مخصصة يرون حجوزاتهم
  ومبيعاتهم فقط (`legacy` scope).

### 3. الأدوار الافتراضية (موثقة — أي تغيير مستقبلي يجب توثيقه هنا)

| الدور | النطاق الأساسي |
|---|---|
| super_admin | كل الصلاحيات تلقائيًا (لا يمكن تخصيصه) |
| admin | الكل عدا إدارة المستخدمين/النظام/النسخ الاحتياطي |
| sales_manager | مشاريع/وحدات/حجوزات+دفعات العربون/تحويل حجز/مبيعات/أسعار/خصومات/مدفوعات/عملاء/مسوقون/عمولات/تقارير+PDF+Excel/أرشيف |
| accountant | مشاريع/وحدات/مبيعات/أسعار/خصومات/مدفوعات+دفع زائد/عملاء/مالية/مسوقون/عمولات+دفع/تقارير+PDF+Excel/تصفيات |
| reservations_officer | مشاريع/وحدات/حجوزات+دفعات العربون/تحويل حجز/مبيعات/أسعار/خصومات/عملاء/PDF |
| sales | مشاريع/وحدات/حجوزات+دفعات العربون/تحويل حجز/مبيعات/أسعار/خصومات/عملاء/PDF |
| viewer | مشاريع ووحدات فقط (بلا أسعار) |

### 4. اختبارات الصلاحيات (من `test-v1.9.js` — تعمل فعلًا)

| الاختبار | النتيجة |
|---|---|
| viewer لا يرى المبيعات (صفحة + API) | ✅ 403 |
| الوصول المباشر للرابط المالي | ✅ 403 |
| استدعاء API مالي بدون صلاحية | ✅ 403 |
| منح صلاحية أثناء الجلسة → تُفعل فورًا | ✅ |
| سحب صلاحية الدفع → تبقى مرفوضة | ✅ |
| تعطيل المستخدم → 401 فورًا | ✅ |
| بدون view_prices → الأسعار null في الواجهة وAPI | ✅ |
| بدون view_customer_finance → الجوالات مقنعة | ✅ (سلوك أصلي) |
| بدون export_excel → تصدير Excel مرفوض | ✅ (403) |
| بدون allow_overpayments → الدفع الزائد مرفوض | ✅ (400) |

## ثانيًا: تدقيق الأمان

### 1. المصادقة والجلسات
- كلمات المرور: bcrypt (12 جولة) — لا تخزين نصي.
- الرموز: JWT HS256 بسر 48 بايت عشوائي في ملف خارج `public` (`.secret`).
- انتهاء الصلاحية: 10 ساعات؛ `token_version` يُبطل الجلسات عند تغيير/إعادة تعيين كلمة المرور.
- التحقق من `active` مع كل طلب.

### 2. حماية الطلبات
- **Rate Limiting**: `/api/login` 15 محاولة/15 دقيقة — عام 3000 طلب/15 دقيقة.
- **CORS**: `origin: false` (نفس المصدر فقط — النظام تطبيق PC/محلي).
- **Helmet** مفعل (CSP معطلة لصالح الواجهة الأصلية — موثق).
- **SQL Injection**: كل الاستعلامات parameterized؛ فلاتر `status` تحولت إلى placeholders (v1.9).
- **Validation**: أنواع وقيم وحقول إلزامية على كل المسارات المالية.
- **Idempotency**: رأس `Idempotency-Key` يمنع تكرار الأثر المالي عند إعادة إرسال الطلب (409).
- **رفع الملفات**: multer بحد 3MB و PNG/JPEG فقط، وتخزين خارج المسارات القابلة للتنفيذ.

### 3. سجل العمليات (Audit)
- `activity_log` لكل عملية + `financial_audit` لكل تغيير مالي (قبل/بعد/سبب) + `unit_events` لتاريخ الوحدة.
- v1.9: تسجيل **IP والجهاز** لكل عملية (عمودان جديدان).

### 4. البيانات والنسخ الاحتياطي
- النسخ الاحتياطية **مشفرة AES-256-GCM** (مفتاح مشتق من سر الجلسة) مع فحص سلامة قبل الاستعادة؛
  النسخ القديمة غير المشفرة تُدعم.
- الاستعادة «معلّقة» تُطبق عند الإقلاع التالي بعد فحص التوقيع.
- قاعدة البيانات ليست مكشوفة عبر الويب (SQLite محلي في `data/`).
- عدم وجود مفاتيح Google/تخزين في `public` — لا أسرار في الواجهة.

### 5. توصيات للنشر (HTTPS/شبكة)
- عند النشر على شبكة: اعكس الوكيل خلف HTTPS (nginx/Caddy) وقيّد المنفذ 4173 على الشبكة المحلية.
- غيّر كلمة مرور `admin` فور أول دخول (النظام يفرض ذلك بـ `must_change_password`).
- احتفظ بنسخ `data/` في موقع خارجي مشفر (ملفات `.bayat` مشفرة بالفعل بمفتاح على الجهاز —
  للنقل بين أجهزة انسخ مجلد `data` كاملًا أو استخدم النسخ الاحتياطي).

## ثالثًا: الخلاصة
- لا توجد نقطة API مالية بدون Authentication + Authorization + Validation + Audit.
- لا توجد بيانات حساسة في استجابات من لا يملك صلاحيتها.
- الاختبارات الآلية (الصلاحيات/الأمان/التكرار) تعمل فعليًا ونتيجتها 101/101 في v1.9.
