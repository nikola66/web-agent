#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sync = '<!-- i18n-sync: en@8293e87 2026-05-20 -->\n\n';

const bars = {
  es: '**Idiomas:** [English](../ARCHITECTURE.md) · [简体中文](../zh-CN/ARCHITECTURE.md) · [Español](ARCHITECTURE.md) · [العربية](../ar/ARCHITECTURE.md)\n\n',
  ar: '**اللغات:** [English](../ARCHITECTURE.md) · [简体中文](../zh-CN/ARCHITECTURE.md) · [Español](../es/ARCHITECTURE.md) · [العربية](ARCHITECTURE.md)\n\n',
};

const esMap = {
  '# Architecture': '# Arquitectura',
  'High-level map of `web-agent`. Updated 2026-05-18.': 'Mapa de alto nivel de `web-agent`. Actualizado 2026-05-18.',
  '## Layers': '## Capas',
  '## Runtime boundary': '## Límite del runtime',
  '### IPC marker protocol': '### Protocolo de marcadores IPC',
  'The "agent" runs *inside* the browser tab': 'El «agente» corre *dentro* de la pestaña del navegador',
  '## Storage layers': '## Capas de almacenamiento',
  '## Agent loop': '## Bucle del agente',
  '## Tool registry': '## Registro de herramientas',
  '## Build pipeline': '## Pipeline de build',
  '## Where to look first': '## Dónde mirar primero',
  '# Agent notes (Web Agent single-runtime)': '# Notas del agente (runtime único Web Agent)',
  'This document is for contributors working on': 'Este documento es para contribuidores que trabajan en',
  '## WebContainer filesystem': '## Sistema de archivos WebContainer',
  '## OPFS snapshots': '## Instantáneas OPFS',
  '## Agent runtime': '## Runtime del agente',
  '## Loop Guard': '## Loop Guard',
  '## Open-web research (Hermes-style)': '## Investigación web abierta (estilo Hermes)',
  '## Profiles': '## Profiles',
  '## ANSI in UI strings': '## ANSI en cadenas de UI',
  '# Modular Capabilities': '# Capacidades modulares',
  '# Web Agent Design System': '# Sistema de diseño Web Agent',
  '## Design Principles': '## Principios de diseño',
  '# Manual testing checklist — Web Agent': '# Lista de pruebas manuales — Web Agent',
  '# Test Prompts — Web Agent': '# Prompts de prueba — Web Agent',
  'Curated prompts for smoke and regression runs.': 'Prompts seleccionados para humo y regresión.',
  '# Contributor Covenant Code of Conduct': '# Código de conducta del Pacto de Contribuidores',
};

const arMap = {
  '# Architecture': '# البنية',
  'High-level map of `web-agent`. Updated 2026-05-18.': 'خريطة عالية المستوى لـ `web-agent`. محدّث 2026-05-18.',
  '## Layers': '## الطبقات',
  '## Runtime boundary': '## حدود وقت التشغيل',
  '### IPC marker protocol': '### بروتوكول علامات IPC',
  '## Storage layers': '## طبقات التخزين',
  '## Agent loop': '## حلقة الوكيل',
  '## Tool registry': '## سجل الأدوات',
  '## Build pipeline': '## خط أنابيب البناء',
  '## Where to look first': '## أين تبدأ',
  '# Agent notes (Web Agent single-runtime)': '# ملاحظات الوكيل (وقت تشغيل Web Agent واحد)',
  '# Modular Capabilities': '# قدرات معيارية',
  '# Web Agent Design System': '# نظام تصميم Web Agent',
  '# Manual testing checklist — Web Agent': '# قائمة اختبار يدوي — Web Agent',
  '# Test Prompts — Web Agent': '# مطالبات اختبار — Web Agent',
  '# Contributor Covenant Code of Conduct': '# مدونة سلوك المساهمين',
};

function apply(locale, files, enDir, map, barFile) {
  for (const f of files) {
    const enPath = join(root, enDir, f);
    let body = readFileSync(enPath, 'utf8');
    for (const [from, to] of Object.entries(map)) {
      body = body.split(from).join(to);
    }
    const bar = barFile.replace(/ARCHITECTURE\.md/g, f);
    writeFileSync(join(root, `docs/${locale}`, f), sync + bar + body);
  }
}

const shared = [
  { file: 'ARCHITECTURE.md', en: 'docs' },
  { file: 'agent-notes.md', en: 'docs' },
  { file: 'test-prompts.md', en: 'docs' },
  { file: 'CAPABILITIES.md', en: '.' },
  { file: 'DESIGN.md', en: '.' },
  { file: 'CODE_OF_CONDUCT.md', en: '.' },
];

for (const { file: f, en: enDir } of shared) {
  const en = readFileSync(join(root, enDir, f), 'utf8');
  const esBar = `**Idiomas:** [English](../${f}) · [简体中文](../zh-CN/${f}) · [Español](${f}) · [العربية](../ar/${f})\n\n`;
  const arBar = `**اللغات:** [English](../${f}) · [简体中文](../zh-CN/${f}) · [Español](../es/${f}) · [العربية](${f})\n\n`;
  let esBody = en;
  let arBody = en;
  for (const [from, to] of Object.entries(esMap)) {
    esBody = esBody.split(from).join(to);
    arBody = arBody.split(from).join(to);
  }
  for (const [from, to] of Object.entries(arMap)) {
    arBody = arBody.split(from).join(to);
  }
  writeFileSync(join(root, 'docs/es', f), sync + esBar + esBody);
  writeFileSync(join(root, 'docs/ar', f), sync + arBar + arBody);
}

// CODE_OF_CONDUCT enforcement line
for (const locale of ['es', 'ar']) {
  const p = join(root, `docs/${locale}/CODE_OF_CONDUCT.md`);
  const note =
    locale === 'es'
      ? '*La versión en inglés es autoritativa para su aplicación.*\n\n'
      : '*النسخة الإنجليزية هي المرجع للتطبيق.*\n\n';
  const body = readFileSync(p, 'utf8');
  if (!body.includes('autoritativa') && !body.includes('المرجع')) {
    writeFileSync(p, body.replace(sync, sync + note));
  }
}

// test-prompts intro
for (const [locale, intro] of [
  [
    'es',
    'Pega los prompts en inglés tal cual en el chat. Ajusta rutas si hace falta.\n\n',
  ],
  [
    'ar',
    'الصق مطالبات الإنجليزية كما هي في الدردشة. عدّل المسارات عند الحاجة.\n\n',
  ],
]) {
  const p = join(root, `docs/${locale}/test-prompts.md`);
  let body = readFileSync(p, 'utf8');
  body = body.replace(
    /Paste into the chat as-is[^\n]+\n\n/,
    intro
  );
  writeFileSync(p, body);
}

console.log('Applied es/ar doc headers and section titles from English canonical.');
