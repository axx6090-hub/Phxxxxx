# 🌸 كليشة (Ayman Ph) — متجر العناية بالبشرة

متجر عراقي بواجهة عربية RTL يستقبل الطلبات عبر واتساب.

- 🌐 **الموقع:** https://balyiq.site
- 🔐 **لوحة الأدمن:** https://balyiq.site/#/admin
- 📦 **سيرفر الطلبات:** https://api.balyiq.site (المجلد `ph-api/`)

## كيف يشتغل

الموقع ثابت (React) ومنشور على GitHub Pages. ما في سيرفر ولا قاعدة بيانات:

| الشي | مكانه |
|---|---|
| المنتجات والأقسام | `frontend/src/staticData.json` |
| صور المنتجات | `frontend/public/images/products/` |
| واجهة المتجر | `frontend/src/App.js` |
| لوحة الأدمن | `frontend/src/admin/` |
| النشر التلقائي | `.github/workflows/deploy-pages.yml` |

أي تعديل ينرفع على فرع `main` يبني الموقع وينشره تلقائياً خلال دقيقتين تقريباً.

> مجلد `backend/` من النسخة القديمة (FastAPI + MongoDB) وغير مستخدم في الموقع المنشور.

## لوحة الأدمن

- إضافة / تعديل / حذف المنتجات، وإضافة وحذف الأقسام.
- **إضافة منتج بالذكاء الاصطناعي:** ترفع صورة المنتج، فتنشال الخلفية وتصير بيضاء، وتنقرأ العلبة لكتابة الاسم بالعربي والإنجليزي والوصف. الأدمن يكتب السعر فقط.
- زر «نشر التغييرات» يحفظ كل شي في هذا المستودع.

### الإعداد (مرة وحدة)

1. **رمز GitHub للدخول:** من [صفحة إنشاء الرمز](https://github.com/settings/personal-access-tokens/new) اختر
   Only select repositories ← `Ph`، ثم Repository permissions ← **Contents: Read and write**.
2. **مفتاح Claude API** (اختياري، لقراءة الاسم والوصف من الصورة): يضاف من تبويب «الإعدادات» في اللوحة.
   بدون المفتاح يشتغل شيل الخلفية فقط.

الرمز والمفتاح ينحفظون في متصفح الأدمن فقط، وما ينكتبون في الكود أبداً.

## تخصيص سريع

في `frontend/src/App.js`:

```js
const WHATSAPP_NUMBER = "9647832882348"; // رقم استقبال الطلبات
const DELIVERY_FEE = 5000;               // رسوم التوصيل
```

## التشغيل المحلي

```bash
cd frontend
yarn install
yarn start      # http://localhost:3000
yarn build      # نسخة الإنتاج في frontend/build
```

## الترخيص

مكتبة إزالة الخلفية `@imgly/background-removal` مرخصة AGPL-3.0، لذلك لازم كود الموقع يبقى متاحاً للعامة ما دامت مستخدمة.
