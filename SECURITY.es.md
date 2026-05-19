<!-- i18n-sync: en@8293e87 2026-05-20 -->

**Idiomas:** [English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md) · [Español](SECURITY.es.md) · [العربية](SECURITY.ar.md)

# Política de seguridad

## Versiones soportadas

Se mantiene la rama por defecto más reciente y el último release etiquetado.

| Versión | Soportada |
| --- | --- |
| Último `main` | Sí |
| Último release | Sí |
| Releases anteriores | No |

## Informar una vulnerabilidad

No abras issues públicos para bugs sensibles.

1. Informe privado de vulnerabilidades en GitHub, si está habilitado.
2. Si no, contacta al mantenedor por la vía del perfil o web del proyecto, marcando el mensaje como informe de seguridad.

Incluye: descripción breve, impacto, pasos de reproducción o PoC, navegador/SO/despliegue, y si afecta al demo alojado, desarrollo local o ambos.

## Postura de seguridad

Web Agent es nativo del navegador y local-first:

- Workspaces, sesiones, memoria, skills y runtime persisten en el navegador
- Credenciales cifradas localmente
- Profiles aislados entre sí
- Despliegues alojados deben ser solo tránsito para peticiones upstream, no backend de persistencia

## Aviso de red

Si `web_fetch` y `web_search` no usan TinyFish, las peticiones pasan por un proxy temporal según `VITE_WEBAGENT_LAUNCH_MODE` por restricciones CORS.

Ese proxy no guarda telemetría ni logs.

Para máxima privacidad, clona el repositorio y ejecútalo en local.

## Alcance útil

- Fallos de aislamiento de workspace
- Filtración entre profiles
- Exposición de credenciales
- Persistencia no deseada en infraestructura alojada
- Manejo inseguro de rutas, subidas o shell
