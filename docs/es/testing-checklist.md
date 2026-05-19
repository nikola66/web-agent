<!-- i18n-sync: en@8293e87 2026-05-20 -->

# Lista de pruebas manuales — Web Agent

## Profiles

- [ ] Carga inicial crea un profile con nombre del pool integrado.
- [ ] Segundo profile con personalidad y color de acento personalizados.
- [ ] Cambiar profile activo con el agente **detenido**; la selección persiste tras recargar.
- [ ] No se puede eliminar el último profile.

## Arranque / terminal

- [ ] **Launch Web Agent** muestra el prompt rosa `❯` en ~5s (primer arranque de WebContainer puede tardar más).
- [ ] Sin API keys, error claro sin tumbar la UI.
- [ ] Con clave válida, mensaje corto y respuesta en streaming.
- [ ] **Stop** termina el proceso; barra de estado en Stopped.
- [ ] Redimensionar terminal sin congelar la pestaña.

## Herramientas (humo)

Pide al agente en ejecución:

- [ ] `read_file` / `write_file` bajo `/workspace`
- [ ] `list_dir` o `tree`
- [ ] `grep` o `find_files`
- [ ] `run_shell` (p. ej. `echo test`)
- [ ] `web_fetch` en URL pública `https://`

## Persistencia

- [ ] Archivo en `/workspace`, **Stop**, recargar, **Launch** — el archivo sigue en ese profile.
- [ ] **Export workspace** descarga JSON.
- [ ] (Opcional) **Import** del mismo JSON en otro profile.

## Ajustes

- [ ] Proveedor **Custom**: base URL + API key; el agente resuelve `CUSTOM_BASE_URL` / `CUSTOM_API_KEY`.
