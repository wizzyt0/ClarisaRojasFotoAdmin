# API privada para el asistente

## Objetivo y estado

Permitir que el agente consulte y realice tareas rutinarias expresamente permitidas sin iniciar sesion en el panel web. Las rutas nuevas de altas y registro de abonos requieren migracion SQL y despliegue del Worker antes de estar disponibles en produccion.

Host actual: `https://clarisa-assistant-api.mudjkdriver.workers.dev`. El dominio personalizado `api.clarisarojasfoto.com` no esta conectado.

## Seguridad

- Worker independiente del Worker R2 actual; no hereda sus rutas administrativas de carga, edicion o borrado.
- Las consultas usan el token de lectura. Las escrituras requieren `ASSISTANT_API_WRITE_TOKEN`, de minimo 40 caracteres y distinto al token de lectura.
- El token de lectura no puede escribir. El token de escritura se guarda como secreto separado en Cloudflare y en el almacenamiento seguro del conector; nunca en codigo ni en el chat.
- El Worker inicia sesion en Supabase con la cuenta de equipo de rol `assistant`, y consulta usando su JWT de usuario. Asi Supabase/RLS aplica sus permisos. La clave publishable/anon no es secreta; no se usa `service_role` en este Worker.
- El correo y contrasena de la cuenta assistant se guardan solo como secretos de Cloudflare. No se proporcionan al agente ni se pegan en el chat. Se requiere que la migracion del rol assistant este aplicada y el usuario tenga dicho rol.
- La API no acepta nombres de tablas, filtros PostgREST arbitrarios, SQL, RPC genericos ni cuerpos de solicitud.
- Los listados limitan paginas a 100 y offsets a 100000. La API no registra el token ni los cuerpos de datos en logs propios.
- Las rutas de escritura son especificas y validan cada campo. Los RPC de Supabase vuelven a validar el rol assistant y los campos autorizados.
- Puede agregar escuelas/contactos, crear trabajos sin fechas/paquete/precio, agregar grupos con maestra/teléfono/cantidad, cambiar datos rutinarios permitidos y registrar abonos nuevos.
- No puede cambiar fechas de evento/entrega, paquetes, precios, cantidades de paquetes, aprobaciones/estados de impresion; tampoco editar o borrar abonos, eliminar registros, mandar mensajes ni administrar usuarios/permisos.
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

## Rutas de escritura (pendientes de migracion y despliegue)

Todas requieren `Authorization: Bearer <ASSISTANT_API_WRITE_TOKEN>`, JSON y actualizan solo los campos incluidos en el body. No se aceptan claves adicionales.

| Metodo y ruta | Campos permitidos |
| --- | --- |
| `POST /v1/schools` | Alta con `school_name` y `contact_phone` obligatorios; contactos, maestra, directora, nivel, grado, cantidad de alumnos y seguimiento opcionales. Rechaza escuela duplicada por nombre. |
| `POST /v1/jobs` | `client_id`, `title` obligatorios; `event_type`, `notes` opcionales. Crea en estado inicial sin fechas, paquete ni precio y no expone token de aprobacion. |
| `PATCH /v1/clients/{clientId}` | `name`, `phone`, `secondary_phone`, `email`, `notes` |
| `PATCH /v1/schools/{schoolId}` | `school_name`, `contact_name`, `contact_phone`, `contact_email`, `teacher_name`, `teacher_phone`, `principal_name`, `principal_phone`, `grade_or_class`, `student_count`, `last_contact_date`, `next_follow_up_date`, `follow_up_status`, `commercial_notes` |
| `PATCH /v1/jobs/{jobId}` | `title`, `notes` |
| `POST /v1/jobs/{jobId}/groups` | `group_name` obligatorio; `teacher_name`, `teacher_phone`, `student_count`, `notes` opcionales. Nace sin paquete, formato, precio ni cantidad de paquetes. |
| `PATCH /v1/groups/{groupId}` | `group_name`, `teacher_name`, `teacher_phone`, `student_count`, `notes` |
| `POST /v1/jobs/{jobId}/deposits` | `amount` positivo (maximo 2 decimales), `deposit_date` y `notes` opcional. Requiere `Idempotency-Key` (UUID). Agrega un abono; no existe ruta para editarlo o borrarlo. |

Para cada pago confirmado, conserva un UUID estable antes del primer envio. Si se pierde la respuesta, no generes otra clave: usa la misma con el mismo trabajo, importe, fecha y notas. Una clave reutilizada con otros datos devuelve 409. Esto no deduplica pagos enviados con claves diferentes ni pagos ingresados por el panel.

Una segunda cuenta de Muse puede usar los mismos conectores y permisos mediante
`ASSISTANT_API_SECONDARY_READ_TOKEN` y `ASSISTANT_API_SECONDARY_WRITE_TOKEN`.
Configura ambos como secretos del Worker. Solo se habilitan si ambas claves
tienen al menos 40 caracteres sin espacios y son distintas entre si y de las
claves principales. Eliminar uno de los secretos secundarios deshabilita el par
sin revocar la cuenta principal. No se comparten las claves entre cuentas de
Muse. Ambas usan la misma identidad de servicio en Supabase; la auditoria de
base de datos no distingue cual de las dos cuentas de Muse inicio el cambio.

Despliegue: aplicar primero `sql/assistant-deposit-idempotency.sql`, luego desplegar el Worker y actualizar el conector de escritura. Entre ambos pasos, el alta de abonos queda inhabilitada; las demas operaciones no cambian. No volver a habilitar la RPC anterior para recuperar el servicio.

Los campos opcionales se pueden limpiar con `null`; nombre, telefono de contacto, nombre escolar y titulo no aceptan nulos. Las fechas de seguimiento deben ser fechas reales `YYYY-MM-DD`; fechas de evento y entrega no se pueden escribir. `follow_up_status` debe pertenecer al enum permitido. La cuenta `assistant`, RLS, los RPC y el trigger vuelven a validar el permiso. No se usa `service_role`.

Listados devuelven `{ data, page: { limit, offset, has_more } }`; los objetos individuales usan `{ data }`. Los errores JSON usan `{ error: { code, message } }`. Consultar `cloudflare/assistant-api.openapi.yaml` para campos, tipos, parametros, errores y tipos MIME exactos.

## Secretos para el Worker

Variables no secretas:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (clave publishable/anon del proyecto)

Secretos que se ingresaran directamente en Cloudflare, sin mandarlos por chat:

- `ASSISTANT_API_TOKEN`: token aleatorio compartido con el almacenamiento seguro del agente.
- `ASSISTANT_API_WRITE_TOKEN`: segundo token aleatorio e independiente, solo para las rutas de escritura limitadas. No funciona para GET; Muse debe conservar por separado el token de lectura.
- `SUPABASE_ASSISTANT_EMAIL` y `SUPABASE_ASSISTANT_PASSWORD`: credenciales de la cuenta de equipo con rol assistant.

El binding R2 de lectura debe apuntar al bucket privado `clarisa-fotos`. No cambiarlo a publico.

## Pendiente antes de habilitar escrituras en produccion

1. Revisar y aplicar `sql/assistant-routine-writes.sql` en Supabase Production. Crea RPC limitados y una bitacora minima; no da permisos generales de escritura a tablas.
2. Desplegar el Worker y confirmar `/v1/health` version `1.2.0`.
3. Actualizar el conector de Muse con las rutas nuevas; conservar tokens separados.
4. Probar que token de lectura no escriba (403), campos protegidos den 400 y operaciones validas solo afecten registros de prueba.
5. Confirmar que no existan rutas de paquetes/precios, aprobaciones, mensajes, usuarios/permisos ni PATCH/DELETE de abonos.
6. Mantener `r2_key` interno y confirmar que ningun log registre secretos ni cuerpos de datos.

## Previews de menores

Las rutas de imagen requieren el token de lectura y transmiten bytes, no URLs permanentes. El permiso aprobado cubre solo previews de maestra `TEACHER_PREVIEW`, nunca originales de alta resolucion para imprenta.
