---
description: Smoke testing interactivo para el sistema MasterBus (Express + EJS + JWT cookie + Neon PostgreSQL).
---

## Smoke Test Skill — Sistema Cubiertas MasterBus

Runner de smoke tests interactivo. Genera escenarios desde las rutas del sistema, los ejecuta uno a uno con curl contra la URL configurada, y repara fallos en el momento.

**Principios:**
- Interactivo: esperar input del usuario entre tests
- Nunca saltear un test sin permiso explícito
- Secuencial: un test a la vez
- Quirúrgico: sólo arreglar lo que está roto
- Persistente: registrar progreso en `smoke-tests.md`

---

### Step 0: Configuración de autenticación

Este sistema usa JWT en cookie HttpOnly. El login se hace via POST /login con campos `usr` y `pass`.

**Credenciales por defecto:** usuario `admin`, contraseña `admin` (tipo 1 = Master Bus).

**URL base:** `https://sist-cubiertas.vercel.app` (o la que corresponda).

#### 0a. Login y obtención de cookie

```bash
BASE_URL="https://sist-cubiertas.vercel.app"
COOKIE_JAR="/tmp/mb_cookies.txt"
rm -f $COOKIE_JAR

LOGIN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" \
  -c $COOKIE_JAR \
  -X POST "$BASE_URL/login" \
  -d "usr=admin&pass=admin" \
  -L --max-redirs 0)

echo "Login response: $LOGIN_RESPONSE"
echo "Cookie guardada: $(cat $COOKIE_JAR | grep token | head -1)"
```

Si el login es exitoso, el servidor devuelve 302 a `/` y guarda la cookie `token`.

#### 0b. Verificar autenticación

```bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b $COOKIE_JAR "$BASE_URL/")
echo "GET / con cookie → HTTP $STATUS (esperado: 200)"
```

---

### Step 1: Determinar qué testear

Este sistema tiene las siguientes secciones:
- Autenticación: login, logout, protección de rutas
- Inicio: `/`
- Almacenes: `/almacen`, `/almacen/view`
- Gomerías: `/gomerias`, `/gomerias/view`
- OTs: `/OTs/list`, `/OTs/nueva`, `/OTs/ver`
- Carga Km: `/CargaKm`
- Cubiertas: `/cubiertas`
- Recapadoras: `/recapadoras`
- Reportes: `/reportes`, `/reportes/recorrido`, `/reportes/estados`, `/reportes/reporte_unidad`, `/reportes/reporte_gomeria`, `/reportes/cubierta_proveedor`
- Admin (solo tipo=1): `/admin`, `/admin/usuarios`, `/admin/almacen`, `/admin/gomeria`, `/admin/recapadora`, `/admin/anulaOT`, `/admin/modelo_cubierta`, `/admin/micros`, `/admin/medidas`, `/admin/proveedor`
- AJAX: `/ajax/change_filter`, `/ajax/nueva_ot`, `/ajax/listar_ruedas`, etc.

---

### Step 2: Chequear tests existentes

Si `smoke-tests.md` ya existe, leerlo y continuar desde el primer test incompleto.

---

### Step 3: Generar smoke-tests.md

Ver formato en el skill original. Todos los tests son de tipo `api` (curl) ya que la app renderiza HTML desde el servidor. La validación se hace chequeando:
- HTTP status code (200, 302, 400, etc.)
- Presencia de strings clave en el body HTML (títulos, palabras esperadas)

Para tests de tipo `api`:
- Usar `curl -s -b $COOKIE_JAR "$BASE_URL/ruta"` y verificar con grep o http code
- Sin cookie → esperar redirect 302 a /login

---

### Step 4-7: Igual que el skill original

Ejecutar test a test, marcar en smoke-tests.md, reparar fallos inmediatamente, nunca saltear sin permiso.
