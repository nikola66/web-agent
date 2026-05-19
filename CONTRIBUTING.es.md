# Contribuir

**Idiomas:** [English](CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Deutsch](CONTRIBUTING.de.md)

Gracias por contribuir a Web Agent.

## Contenido

- [Principios](#principios)
- [Configuración de desarrollo](#configuración-de-desarrollo)
- [Comandos útiles](#comandos-útiles)
- [Antes de abrir un pull request](#antes-de-abrir-un-pull-request)
- [Reportar errores](#reportar-errores)
- [Estilo de pull request](#estilo-de-pull-request)
- [Documentación para colaboradores](#documentación-para-colaboradores)

## Principios

- Mantén los cambios quirúrgicos.
- No añadas complejidad si no es necesaria.
- Elimina código obsoleto causado por tu cambio.
- Preserva el diseño nativo del navegador, local-first y aislado del proyecto.
- No hagas commit de réplicas de workspace por perfil (`memory/`, `tmp/`, `knowledge-vault/`, `.webagent/`, bases SQLite, etc.): pertenecen al almacenamiento del navegador y están en `.gitignore`.

## Configuración de desarrollo

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
git lfs install
git lfs pull
npm install
npm run dev
```

Abre `http://localhost:5173`. `npm install` en la raíz instala dependencias del sidecar del judge vía `postinstall`. El modelo ONNX del turn judge está en `models/turn-judge/` — ver [docs/turn-judge.md](docs/turn-judge.md).

## Comandos útiles

```bash
npm run dev
npm run build
npm run test
npm run judge:test
npm run test:browser
```

## Antes de abrir un pull request

- verifica que el cambio resuelve un problema real
- mantén el diff enfocado
- actualiza la documentación cuando cambie el comportamiento (primero en inglés, luego los `*.es.md`, `*.zh-CN.md`, `*.de.md` si cambia texto visible)
- añade o actualiza tests si el cambio afecta el runtime
- evita refactors no relacionados

Si tocas persistencia local del navegador, aislamiento del runtime, uploads, tools o estado de perfil, explica el impacto en la descripción del PR.

## Reportar errores

Abre un issue en GitHub con:

- qué esperabas
- qué ocurrió en su lugar
- pasos exactos de reproducción
- navegador y sistema operativo
- si ocurre en el demo alojado, en desarrollo local o en ambos

Para reportes sensibles de seguridad, usa [SECURITY.md](SECURITY.md) en lugar de issues públicos.

## Estilo de pull request

- prefiere la corrección más pequeña que sea correcta
- sigue el estilo de código existente
- elimina imports muertos, ramas obsoletas y residuos locales de tu cambio
- mantén el texto orientado al usuario conciso y concreto

## Documentación para colaboradores

- [README.es.md](README.es.md)
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/README.es.md](docs/README.es.md)
- [docs/ARCHITECTURE.es.md](docs/ARCHITECTURE.es.md)
- [docs/turn-judge.md](docs/turn-judge.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)
