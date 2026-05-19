<!-- i18n-sync: en@8293e87 2026-05-20 -->

**Idiomas:** [English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [العربية](CONTRIBUTING.ar.md)

# Contribuir

Gracias por contribuir a Web Agent.

## Principios

- Cambios quirúrgicos; no añadas complejidad innecesaria.
- Elimina código obsoleto causado por tu cambio en el mismo PR.
- Preserva el diseño nativo del navegador, local-first y aislado por profile.
- No subas espejos de workspace por profile (`memory/`, `tmp/`, `knowledge-vault/`, `.webagent/`, bases SQLite, etc.): viven en almacenamiento del navegador (`.gitignore`).

## Configuración de desarrollo

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

Abre `http://localhost:5173`.

## Comandos útiles

```bash
npm run dev
npm run build
npm run test
npm run test:browser
```

## Antes de abrir un Pull Request

- Verifica que el cambio resuelve un problema real
- Mantén el diff enfocado
- Actualiza la documentación si cambia el comportamiento; si cambia texto de usuario, actualiza inglés y los locales afectados (véase [docs/TRANSLATING.md](docs/TRANSLATING.md))
- Añade o actualiza tests si afecta al runtime
- Evita refactors no relacionados

Si tocas persistencia local, aislamiento del runtime, subidas, herramientas o estado de profile, explica el impacto en la descripción del PR.

## Informar bugs

Abre un issue en GitHub con: lo esperado, lo ocurrido, pasos de reproducción, navegador y SO, y si ocurre en el demo alojado, en desarrollo local o en ambos.

Para seguridad, usa [SECURITY.es.md](SECURITY.es.md), no issues públicos.

## Estilo de PR

- El arreglo correcto más pequeño
- Mismo estilo de código
- Sin imports muertos ni residuos locales
- Texto de usuario conciso y concreto

## Documentación para contribuidores

- [README.es.md](README.es.md) — [English](README.md) · [简体中文](README.zh-CN.md) · [العربية](README.ar.md)
- [docs/es/README.md](docs/es/README.md)
- [docs/es/CAPABILITIES.md](docs/es/CAPABILITIES.md)
- [docs/es/ARCHITECTURE.md](docs/es/ARCHITECTURE.md)
- [docs/es/agent-notes.md](docs/es/agent-notes.md)
- [docs/es/testing-checklist.md](docs/es/testing-checklist.md)
- [docs/GLOSSARY.md](docs/GLOSSARY.md) · [docs/TRANSLATING.md](docs/TRANSLATING.md)
