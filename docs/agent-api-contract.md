# API privada para el asistente

## Objetivo y estado

Permitir que un agente autorizado consulte Clarisa Rojas Fotografia y actualice datos rutinarios expresamente permitidos sin iniciar sesion en el panel web. El Worker desplegado actualmente sigue siendo de solo lectura; las rutas PATCH descritas abajo son el cambio local pendiente de publicar y configurar.

Host actual: `https://clarisa-assistant-api.mudjkdriver.workers.dev`. El dominio personalizado `api.clarisarojasfoto.com` no esta conectado.

## Seguridad

- Worker independiente del Worker R2 actual; no hereda sus rutas administrativas de carga, edicion o borrado.
- Las consultas aceptan el token de lectura o el de escritura. Solo tres rutas PATCH aceptan `ASSISTANT_API_WRITE_TOKEN`, de minimo 40 caracteres y distinto al token de lectura.
- El token de lectura no puede escribir. El token de escritura se guarda como secreto separado en Cloudflare y en el almacenamiento seguro del conector; nunca en codigo ni en el chat.
- El Worker inicia sesion en Supabase con la cuenta de equipo de rol `assistant`, y consulta usando su JWT de usuario. Asi Supabase/RLS aplica sus permisos. La clave publishable/anon no es secreta; no se usa `service_role` en este Worker.
- El correo y contrasena de la cuenta assistant se guardan solo como secretos de Cloudflare. No se proporcionan al agente ni se pegan en el chat. Se requiere que la migracion del rol assistant este aplicada y el usuario tenga dicho rol.
- La API no acepta nombres de tablas, filtros PostgREST arbitrarios, SQL, RPC genericos ni cuerpos de solicitud.
- Los listados limitan paginas a 100 y offsets a 100000. La API no registra el token ni los cuerpos de datos en logs propios.
- No hay rutas para crear o eliminar datos, modificar finanzas/precios/cantidades/estados/fechas de evento y entrega, aprobar impresion, mandar mensajes, administrar usuarios/permisos ni cambiar selecciones.
- Las listas de grupos incluyen cantidades y datos operativos de la maestra, pero no listas de nombres de menores.

## Rutas de lectura existentes

| Metodo y ruta | Resultado |
| --- | --- |
| `GET /v1/health` | Estado y version; tambien requiere Bearer. |
| `GET /v1/schools?q=&limit=50&offset=0` | Escuelas, nivel, contactos y seguimiento. `q` busca nombre. |
| `GET /v1/jobs?client_id=&status=&limit=50&offset=0` | Trabajos paginados. |
| `GET /v1/jobs/{jobId}` | Detalle seguro del trabajo, sin tokens de aprobacion. |
| `GET /v1/jobs/{jobId}/groups?limit=50&offset=0` | Grupos, maestra, cantidad y paquete. |
| `GET /v1/jobs/{jobId}/pieces?limit=50&offset=0` | Diplomas, carpetas y estados de piezas, sin tokens. |
| `GET /v1/jobs/{jobId}/finance` | Total, abonos, saldo, gastos y fecha del ultimo abono. |
| `GET /v1/jobs/{jobId}/deposits?limit=50&offset=0` | Abonos con importe y fecha. |
| `GET /v1/finance/costs?limit=50&offset=0` | Costos activos y reglas de material por paquete. |
| `GET /v1/finance/expenses?job_id=&from=&to=&limit=50&offset=0` | Gastos paginados y filtrables. |
| `GET /v1/catalogs/packages?limit=50&offset=0` | Paquetes y metadatos de imagen; sin URL publica. |
| `GET /v1/catalogs/diplomas?school_level=&limit=50&offset=0` | Diplomas y link Canva registrado. |
| `GET /v1/catalogs/folders?school_level=&limit=50&offset=0` | Carpetas por nivel. |
| `GET /v1/previews/{previewId}` | Bytes de JPEG, PNG o WebP autenticados; hasta 15 MiB. Para archivos de trabajo solo permite `TEACHER_PREVIEW`, nunca alta resolucion de imprenta. |

## Rutas PATCH locales (no desplegadas)

Todas requieren `Authorization: Bearer <ASSISTANT_API_WRITE_TOKEN>`, JSON y actualizan solo los campos incluidos en el body. No se aceptan claves adicionales.

| Metodo y ruta | Campos permitidos |
| --- | --- |
| `PATCH /v1/clients/{clientId}` | `name`, `phone`, `secondary_phone`, `email`, `notes` |
| `PATCH /v1/schools/{schoolId}` | `school_name`, `contact_name`, `contact_phone`, `contact_email`, `teacher_name`, `teacher_phone`, `principal_name`, `principal_phone`, `grade_or_class`, `last_contact_date`, `next_follow_up_date`, `follow_up_status`, `commercial_notes` |
| `PATCH /v1/jobs/{jobId}` | `title`, `notes` |

Los campos opcionales se pueden limpiar con `null`; nombre, telefono principal, nombre escolar y titulo no aceptan nulos. Las fechas deben ser fechas reales `YYYY-MM-DD`; `follow_up_status` debe pertenecer al enum permitido. La cuenta `assistant`, RLS y el trigger de produccion vuelven a validar el permiso. No se usa `service_role`.

Listados devuelven `{ data, page: { limit, offset, has_more } }`; los objetos individuales usan `{ data }`. Los errores JSON usan `{ error: { code, message } }`. Consultar `cloudflare/assistant-api.openapi.yaml` para campos, tipos, parametros, errores y tipos MIME exactos.

## Secretos para el Worker

Variables no secretas:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (clave publishable/anon del proyecto)

Secretos que se ingresaran directamente en Cloudflare, sin mandarlos por chat:

- `ASSISTANT_API_TOKEN`: token aleatorio compartido con el almacenamiento seguro del agente.
- `ASSISTANT_API_WRITE_TOKEN`: segundo token aleatorio e independiente, solo para habilitar los PATCH limitados. El conector de Muse que vaya a escribir debe guardar este token; tambien sirve para GET.
- `SUPABASE_ASSISTANT_EMAIL` y `SUPABASE_ASSISTANT_PASSWORD`: credenciales de la cuenta de equipo con rol assistant.

El binding R2 de lectura debe apuntar al bucket privado `clarisa-fotos`. No cambiarlo a publico.

## Pendiente antes de habilitar escrituras en produccion

1. Ejecutar las pruebas locales del Worker.
2. Agregar `ASSISTANT_API_WRITE_TOKEN` como secreto de Cloudflare, distinto al token de lectura, y desplegar esta version.
3. Guardar ese segundo token en el almacenamiento seguro del conector de Muse y agregar solo los tres PATCH permitidos a su contrato.
4. Probar GET; luego PATCH con token de lectura (403), campos prohibidos (400) y un cambio rutinario autorizado que se verifique con GET.
5. Mantener `r2_key` interno y confirmar que ningun log registre secretos ni cuerpos de datos.

## Previews de menores

Las rutas de imagen requieren el mismo Bearer y transmiten bytes, no URLs permanentes. Antes de registrar el host, decidir si el agente realmente necesita analizar previews de menores. Si no es imprescindible, retirar `/v1/previews/{previewId}` del conector y del Worker antes de produccion.
