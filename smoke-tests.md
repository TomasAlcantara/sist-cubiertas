# Smoke Tests — Sistema Cubiertas MasterBus

> Ejecutados el 2026-04-07 contra https://sist-cubiertas.vercel.app

## Configuración

```bash
BASE_URL="https://sist-cubiertas.vercel.app"
COOKIE_JAR="/tmp/mb_cookies.txt"
```

## Tests

### Auth

- [x] **ST-001** — Login con credenciales válidas
  - **Type**: api
  - **Goal**: POST /login con admin/admin devuelve 302 a /
  - **Expected**: HTTP 302, cookie `token` guardada
  - **Actual**: HTTP 302 ✅

- [x] **ST-002** — Login con credenciales inválidas
  - **Type**: api
  - **Goal**: POST /login con pass incorrecta devuelve 200 con mensaje de error
  - **Expected**: HTTP 200, body contiene "incorrectos"
  - **Actual**: HTTP 200, body contiene "incorrectos" ✅

- [x] **ST-003** — Ruta protegida sin autenticación redirige a /login
  - **Type**: api
  - **Goal**: GET / sin cookie → redirect a /login
  - **Expected**: HTTP 302
  - **Actual**: HTTP 302 ✅

- [x] **ST-004** — Logout limpia la cookie y redirige
  - **Type**: api
  - **Goal**: GET /logout → 302 a /login
  - **Expected**: HTTP 302
  - **Actual**: HTTP 302 ✅

### Páginas principales

- [x] **ST-005** — Inicio carga correctamente
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-006** — Manual de usuario carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Almacenes

- [x] **ST-007** — Lista de almacenes carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-008** — Vista de cubiertas de un almacén
  - **Type**: api
  - **Expected**: HTTP 200 o 302
  - **Actual**: HTTP 200 ✅ *(Fix aplicado: sql.unsafe → function-call syntax)*

### Gomerías

- [x] **ST-009** — Lista de gomerías carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### OTs

- [x] **ST-010** — Listado de OTs carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-011** — Formulario nueva OT carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Carga Km

- [x] **ST-012** — Página de carga de km carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Cubiertas

- [x] **ST-013** — Listado de cubiertas carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅ *(Fix aplicado: sql.unsafe → function-call syntax)*

### Recapadoras

- [x] **ST-014** — Recapadoras carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Reportes

- [x] **ST-015** — Índice de reportes carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-016** — Reporte por cubierta carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-017** — Reporte de estados carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-018** — Reporte por interno carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-019** — Reporte por gomería carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-020** — Reporte por proveedor carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Admin (tipo=1 requerido)

- [x] **ST-021** — Panel de administración carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-022** — Admin usuarios carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅ *(Fix previo: conditional sql fragment → split queries)*

- [x] **ST-023** — Admin almacenes carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-024** — Admin gomerías carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-025** — Admin recapadoras carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-026** — Admin anular OT carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-027** — Admin modelos de cubiertas carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-028** — Admin unidades carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-029** — Admin medidas carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-030** — Admin proveedores carga
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

### Control de acceso

- [x] **ST-031** — Usuario no-master no puede acceder a /admin
  - **Type**: api
  - **Goal**: GET /admin con cookie de usuario tipo=2 → redirige a /
  - **Expected**: HTTP 302 a /
  - **Actual**: HTTP 302 ✅ *(usuario test creado y luego desactivado)*

### AJAX endpoints

- [x] **ST-032** — AJAX change_filter acepta petición autenticada
  - **Type**: api
  - **Expected**: HTTP 200, body "ok"
  - **Actual**: HTTP 200, body "ok" ✅

- [x] **ST-033** — AJAX listar_ruedas devuelve tabla HTML
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅

- [x] **ST-034** — AJAX sin autenticación rechaza petición
  - **Type**: api
  - **Expected**: HTTP 302
  - **Actual**: HTTP 302 ✅

- [x] **ST-035** — AJAX inactive desactiva registros correctamente
  - **Type**: api
  - **Expected**: HTTP 200
  - **Actual**: HTTP 200 ✅ *(Fix aplicado: sql(table) identifier → function-call syntax)*

## Summary

| Status  | Count |
| ------- | ----- |
| Total   | 35    |
| Passed  | 35    |
| Failed  | 0     |
| Skipped | 0     |
