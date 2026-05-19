<!-- i18n-sync: en@8293e87 2026-05-20 -->

**اللغات:** [English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [العربية](CONTRIBUTING.ar.md)

# المساهمة

شكرًا لمساهمتك في Web Agent.

## المبادئ

- تغييرات جراحية دقيقة؛ لا تُضف تعقيدًا دون حاجة.
- أزل الكود القديم الناتج عن تغييرك في نفس الـ PR.
- حافظ على التصميم الأصلي للمتصفح، المحلي أولًا، والعزل حسب الـ profile.
- لا تلتزم مرايا workspace لكل profile (`memory/`، `tmp/`، `knowledge-vault/`، `.webagent/`، قواعد SQLite، إلخ): تبقى في تخزين المتصفح (`.gitignore`).

## إعداد التطوير

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

افتح `http://localhost:5173`.

## أوامر مفيدة

```bash
npm run dev
npm run build
npm run test
npm run test:browser
```

## قبل فتح Pull Request

- تأكد أن التغيير يحل مشكلة حقيقية
- اجعل الـ diff مركزًا
- حدّث الوثائق عند تغيّر السلوك؛ إن تغيّر نص المستخدم، حدّث الإنجليزية وأي ملفات locale متأثرة ([docs/TRANSLATING.md](docs/TRANSLATING.md))
- أضف أو حدّث الاختبارات عند تأثير الـ runtime
- تجنّب إعادة الهيكلة غير المرتبطة

إن لمست التخزين المحلي، عزل الـ runtime، الرفع، الأدوات أو حالة الـ profile، اشرح التأثير في وصف الـ PR.

## الإبلاغ عن الأخطاء

افتح issue على GitHub يتضمن: المتوقع، ما حدث، خطوات إعادة الإنتاج، المتصفح ونظام التشغيل، وهل يحدث في العرض المستضاف أو التطوير المحلي أو كليهما.

للثغرات الحساسة استخدم [SECURITY.ar.md](SECURITY.ar.md) وليس issue عامًا.

## أسلوب الـ PR

- أصغر إصلاح صحيح
- نفس أسلوب الكود
- بدون imports ميتة أو بقايا محلية
- نص واجهة موجز وواضح

## وثائق المساهمين

- [README.ar.md](README.ar.md) — [English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)
- [docs/ar/README.md](docs/ar/README.md)
- [docs/ar/CAPABILITIES.md](docs/ar/CAPABILITIES.md)
- [docs/ar/ARCHITECTURE.md](docs/ar/ARCHITECTURE.md)
- [docs/ar/agent-notes.md](docs/ar/agent-notes.md)
- [docs/ar/testing-checklist.md](docs/ar/testing-checklist.md)
- [docs/GLOSSARY.md](docs/GLOSSARY.md) · [docs/TRANSLATING.md](docs/TRANSLATING.md)
