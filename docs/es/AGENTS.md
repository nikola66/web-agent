<!-- i18n-sync: en@8293e87 2026-05-20 -->

# Guía del repositorio para agentes de código IA

Reglas para agentes (Claude Code, Codex, etc.) que trabajan en `web-agent`.

## Estilo de ingeniería

- Arreglos quirúrgicos; no añadas líneas innecesarias.
- Al cambiar o eliminar una función, limpia el código obsoleto en el mismo paso.
- Menos código es mejor.
- Pregunta si la intención no está clara.
- Edita archivos existentes antes de crear otros nuevos.
- Comentarios solo para el «por qué» no obvio, no para describir el «qué».

## Forma del proyecto

Contexto de arquitectura: `docs/es/ARCHITECTURE.md`. Usa la documentación canónica en inglés salvo que el usuario pida un locale.

Puntos de entrada:

- `src/main.tsx` — raíz React
- `src/core/orchestrator.ts` — ciclo de vida del agente
- `src/agent/adapter.ts` — puente UI ↔ runtime Node embebido
- `src/agent/runtime/turn.ts` — bucle LLM principal
- `src/agent/runtime/tools/registry.ts` — herramientas built-in y de capacidades

`src/agent/runtime` está **excluido de `tsc`**. Confía en tests y comprobaciones en runtime.

## Antes de enviar

- `npx tsc -b --noEmit` limpio
- `npm test` pasa
- `npm run build` sin chunks desmesurados
- Cambios de UI: humo en `npm run dev`
