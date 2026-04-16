# Plan de Auditoría — Módulo OTs vs Referencia (mundoratio.com/MasterBus/OTs/)

## Contexto del proyecto

- **Stack:** Node.js + Express + EJS + Neon (PostgreSQL serverless) — deployado en Vercel
- **Directorio:** `/Users/cristinacragnolini/Downloads/SISTEMA CUBIERTAS`
- **Rama:** `main`
- **Referencia visual:** capturas de pantalla de `mundoratio.com/MasterBus/OTs/nueva.php` y `list.php`

El módulo OTs fue rediseñado recientemente para replicar la interfaz de referencia. Esta auditoría revisa punto por punto qué falta, qué difiere, y qué puede estar roto.

---

## Cómo correr el proyecto localmente

```bash
cd "/Users/cristinacragnolini/Downloads/SISTEMA CUBIERTAS"
npm start          # o: node api/index.js
# → http://localhost:3000
```

Credenciales de prueba: usar las del sistema (hay usuarios en tabla `usuarios`).

---

## 1. Imágenes faltantes (BLOQUEANTE visual)

El CSS y las vistas referencian imágenes que **no existen** en `public/images/`. Solo está `masterbus-logo.png`.

| Imagen referenciada | Dónde se usa | Impacto |
|---|---|---|
| `images/rojo.png` | Botón "X" del modal en `nueva.ejs`, `list.ejs`, `modelo.ejs` | Botón cierre invisible |
| `images/header_bg.gif` | `style.css` — fondo del header | Sin fondo de cabecera |
| `images/image.jpg` | `style.css` — imagen del header (970px) | Header sin imagen |
| `images/menu_a.gif` | `style.css` — hover del menú | Sin efecto hover en nav |
| `images/content_bg.gif` | `style.css` — fondo del content | Sin fondo |
| `images/content_rbg.jpg` | `style.css` — fondo lateral del content | Sin fondo |
| `images/li.gif` | `style.css` — bullet del sidebar | Sin bullets |

**Acción:** Obtener estas imágenes del sitio de referencia o reemplazar con equivalentes.  
Para `rojo.png` específicamente (crítico): es un cuadradito rojo 15×15px — puede recrearse como PNG o reemplazarse con un `×` en HTML.

---

## 2. Vista `nueva.ejs` — Auditoría detallada

**Archivo:** `views/OTs/nueva.ejs`

### 2.1 Lo que está implementado ✓
- Dropdown Unidad, Gomería, Fecha de solicitud con fecha de hoy pre-cargada
- Checkboxes Trabajo a realizar (Rotación, Arreglo, Cambio, Alinear, Balanceo, Armar)
- Campo Observaciones (textarea)
- Diagrama visual de bus con 4 layouts por tipo de unidad
- Modal de selección de cubiertas con filtros: Almacén, Fuego, Modelo, Medida, Estado
- Lógica JS: `cargar_tires()` carga cubiertas al seleccionar unidad, `seleccionar_ot()` marca posición, `guardar_ot()` envía todo al backend
- Botón "Imprimir" → `window.print()`

### 2.2 Diferencias visuales a verificar contra referencia

| Elemento | Referencia | Implementación actual | Estado |
|---|---|---|---|
| Layout del diagrama de bus | Eje delantero arriba, carrocería, eje trasero doble abajo, auxilio abajo-derecha | Implementado con 4 layouts | **Verificar** — comparar posición de ruedas con capturas |
| Colores del diagrama | Ruedas negras `#111`, fuego en rojo `#cc0000` | Implementado igual | ✓ |
| Tamaño ruedas | ~52×68px aprox. | 52×68px implementado | ✓ |
| Modal: ancho | ~600px en referencia | 750px actual | **Ajustar** |
| Modal: botón X cierre | Imagen `rojo.png` | Imagen `rojo.png` (imagen faltante — ver punto 1) | ✗ Imagen faltante |
| Título de página | "Nueva Orden de trabajo" centrado | Implementado | ✓ |
| Botón guardar | "Generar" en actual | Referencia: verificar texto exacto | **Verificar** |
| Campo fecha | `DD/MM/AAAA` con date picker jQuery UI | Input text sin picker | **Agregar** — el layout.ejs incluye jQuery UI calendar |
| Orden de secciones | Unidad → Gomería → Fecha → Trabajos → Diagrama | Implementado igual | ✓ |

### 2.3 Funcionalidad a verificar

- [ ] Al seleccionar unidad, ¿el diagrama carga correctamente las cubiertas actuales?
- [ ] ¿Las posiciones del diagrama (`ddi`, `ddd`, `tie`, `tii`, `tdi`, `tde`, `ra`) coinciden con los valores reales en la tabla `cubiertas.posicion`?  
  Verificar con: `SELECT DISTINCT posicion FROM cubiertas WHERE posicion IS NOT NULL`
- [ ] Al hacer click en una posición → ¿abre el modal con cubiertas disponibles (micro_id IS NULL)?
- [ ] ¿El filtro de medida en el modal funciona? (requiere que `cubiertas.medida_id` esté poblado)
- [ ] Al hacer "Seleccionar" en el modal → ¿la posición se marca en rojo (`seleccionada`) y muestra el fuego?
- [ ] Al hacer "Generar/Guardar" → ¿crea el registro en `ots` con todos los campos y redirige a `ver`?
- [ ] ¿Se registran correctamente las filas en `ot_cubiertas` con `posicion` y `cubierta_anterior_id`?

### 2.4 Mejora pendiente: Date picker para campo fecha

El `layout.ejs` ya carga jQuery UI calendar. Agregar al script de `nueva.ejs`:
```javascript
$(function() {
  $('#fecha').datepicker({ dateFormat: 'dd/mm/yy' });
});
```

---

## 3. Vista `list.ejs` — Auditoría detallada

**Archivo:** `views/OTs/list.ejs`

### 3.1 Lo que está implementado ✓
- Filtros: Unidad, Gomería, Estado
- Tabla: N° OT, Unidad, Gomería, Fecha, Trabajos, Estado, Acciones
- Botón "Nueva OT"
- Modal de cierre con formulario HTML (km, factura, costo) generado por `mb_cerrar_ot`
- Función `confirmar_cerrar()` que llama a `confirmar_cerrar_ot` y recarga la página

### 3.2 Diferencias a verificar

| Elemento | Referencia | Implementación actual | Estado |
|---|---|---|---|
| Columna "Trabajos" | No confirmado si existe en referencia | Existe, muestra lista de trabajos | **Verificar** |
| Botón cierre del modal | `rojo.png` X | Imagen faltante | ✗ |
| Tamaño modal cierre | 700×530px | 700×530px | ✓ |
| N° OT mostrado | Referencia usa número correlativo (puede ser `ots.numero`) | Muestra `ot.id` (número de DB) | **Verificar** — si `ots.numero` debe mostrarse en su lugar |

### 3.3 Funcionalidad a verificar

- [ ] Click en "CERRAR" → ¿abre el modal con datos de la OT?
- [ ] ¿La tabla de cubiertas a cambiar dentro del modal se muestra correctamente?
- [ ] ¿Ingresar km y confirmar cierra la OT, actualiza km en `micro`, y mueve cubiertas?
- [ ] ¿Tras cerrar, la fila cambia de "Abierta" a "Cerrada" en el listado?

---

## 4. Vista `ver.ejs` — Auditoría detallada

**Archivo:** `views/OTs/ver.ejs`

### 4.1 Lo que está implementado ✓
- Datos: Unidad, Gomería, Fecha, Estado, Trabajos, Observaciones, Factura, Costo
- Tabla de cubiertas: Posición, Fuego, Modelo, Medida, Estado, Km
- Botón "Imprimir"
- Link "Volver al listado"

### 4.2 A verificar

- [ ] ¿La columna "Posición" muestra valores legibles (ej. `ddi`, `dd`, `tie`) o necesita traducción a nombres amigables?
- [ ] ¿Se muestran las cubiertas correctamente cuando la OT tiene cambios registrados?

---

## 5. Backend — Endpoints a verificar

**Archivo:** `routes/ajax.js`

| Endpoint | Función | Verificar |
|---|---|---|
| `GET /ajax/cubiertas_unidad?unidad_id=X` | Devuelve `{tipo_unidad, cubiertas:[]}` | Respuesta JSON correcta; posiciones coinciden con el diagrama |
| `POST /ajax/listar_ruedas` | Lista cubiertas disponibles (micro_id IS NULL) | Filtros funcionan; columna km aparece |
| `POST /ajax/nueva_ot` | Crea OT + registra `ot_cubiertas` con posición | `cambios_ot_json` se parsea; `cubierta_anterior_id` se guarda |
| `POST /ajax/mb_cerrar_ot` | Devuelve HTML del formulario de cierre | HTML renderiza correctamente en el modal |
| `POST /ajax/confirmar_cerrar_ot` | Cierra OT + mueve cubiertas | Cubiertas nuevas pasan a `micro_id=unidad_id`; anteriores a `almacen_id=1` |

**Verificar que almacén ID=1 existe y es el correcto:**
```sql
SELECT id, nombre FROM almacen ORDER BY id;
```

---

## 6. Base de datos — Estado del schema

### Tabla `ots` — columnas actuales
```
id, numero, recapadora_id, fecha, estado, gomeria_id, unidad_id, factura, costo,
rotacion, arreglo, cambio, alinear, balanceo, armar, observaciones
```
- `numero` y `recapadora_id` son nullable (campos legacy, no se usan en el nuevo flujo)
- Verificar que `estado` tiene DEFAULT 0 (abierta)

### Tabla `ot_cubiertas` — columnas actuales
```
ot_id, cubierta_id, posicion, cubierta_anterior_id
```
- Verificar constraint UNIQUE en `(ot_id, cubierta_id)` — el INSERT usa `ON CONFLICT (ot_id, cubierta_id)`

### Tabla `cubiertas` — columna `posicion`
Verificar qué valores existen realmente:
```sql
SELECT DISTINCT posicion FROM cubiertas WHERE posicion IS NOT NULL ORDER BY posicion;
```
Los valores deben coincidir con los IDs usados en el diagrama del bus: `ddi`, `ddd`, `tie`, `tii`, `tdi`, `tde`, `ra`.

### Tabla `micro` — columna `tipo_unidad`
```sql
SELECT id, unidad, tipo_unidad FROM micro WHERE activo = 1 ORDER BY unidad;
```
Cada micro debe tener `tipo_unidad` asignado (1–4) para que el diagrama muestre el layout correcto.

---

## 7. Conflictos CSS conocidos

### 7.1 `#back` definido dos veces
`style.css` define globalmente:
```css
#back, #back2 { position:fixed; opacity:0.6; background-color:#000; z-index:90 }
```
`nueva.ejs` y `list.ejs` lo sobreescriben inline con `background:rgba(0,0,0,0.4/0.5)`.  
Esto funciona pero puede causar comportamiento inconsistente. **Solución:** Remover la regla global de `style.css` o estandarizar en un solo lugar.

### 7.2 Ancho del layout (970px)
El `content_resize` tiene `width:970px` fijo. El diagrama del bus usa `width:420px` centrado — debería funcionar, pero verificar en pantallas pequeñas.

---

## 8. Checklist de prueba end-to-end

Hacer este recorrido completo con datos reales:

1. **Ir a** `/OTs/nueva`
2. **Seleccionar** una unidad → ¿aparece el diagrama? ¿carga las cubiertas actuales?
3. **Hacer click** en una posición → ¿abre el modal?
4. **Filtrar** por fuego/modelo/medida → ¿funciona el filtro?
5. **Seleccionar** una cubierta → ¿se marca la posición en rojo con el fuego?
6. **Marcar** trabajos (al menos uno)
7. **Guardar** la OT → ¿redirige a `/OTs/ver?ot=X`?
8. **Verificar** en `ver` que muestra: unidad, gomería, trabajos, cubiertas con posición
9. **Ir a** `/OTs/list` → ¿aparece la OT nueva?
10. **Click CERRAR** → ¿abre el modal con datos de la OT?
11. **Ingresar km** → **Confirmar cierre** → ¿OT pasa a "Cerrada"?
12. **Verificar en DB** que la cubierta nueva está en `micro_id=X, posicion=Y` y la anterior en `almacen_id=1`

---

## 9. Prioridades de corrección sugeridas

| Prioridad | Item | Esfuerzo |
|---|---|---|
| 🔴 Alta | Conseguir imágenes faltantes (`rojo.png` mínimo) | Bajo |
| 🔴 Alta | Verificar que posiciones del diagrama coincidan con DB | Bajo |
| 🔴 Alta | Verificar constraint UNIQUE en `ot_cubiertas(ot_id, cubierta_id)` | Bajo |
| 🟡 Media | Agregar jQuery UI datepicker al campo fecha | Bajo |
| 🟡 Media | Asignar `tipo_unidad` correcto a cada micro en Admin | Manual (datos) |
| 🟡 Media | Limpiar conflicto CSS `#back` | Bajo |
| 🟢 Baja | Traducir valores de posición a nombres legibles en `ver.ejs` | Bajo |
| 🟢 Baja | Verificar si se debe mostrar `ots.numero` en lugar de `ots.id` | Bajo |
