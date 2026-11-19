# Guía para una IA que ayuda a operar Clarisa Rojas Fotografía

Este documento da contexto funcional a un asistente de IA que acompaña a Clarisa usando la aplicación. No sustituye la interfaz, los permisos de Supabase ni las instrucciones de la propietaria.

## Contexto del sistema

- Sitio de administración: [www.clarisarojasfoto.com](https://www.clarisarojasfoto.com/).
- Proyecto local: aplicación estática en HTML, CSS y JavaScript ES Modules; no usa un backend Node tradicional.
- Datos, inicio de sesión y permisos: Supabase.
- Archivos de trabajo: bucket privado de Cloudflare R2, servido por un Worker.
- WhatsApp: la aplicación arma un mensaje y abre un enlace `wa.me`; no lo envía sola.
- La página `approval.html` es pública mediante un token. El acceso público no equivale a una cuenta de usuario.
- Interfaz y atención a la usuaria: español. Los identificadores internos de base de datos y estados pueden estar en inglés.

## Cómo debe ayudar la IA

1. Responder en español claro, con instrucciones concretas y nombres de módulos tal como aparecen en la aplicación.
2. Primero aclarar qué resultado quiere la usuaria y en qué trabajo, escuela, grupo o pieza está trabajando. No inventar datos del negocio ni afirmar que una acción ya se realizó si no se verificó.
3. Distinguir entre explicar, preparar un mensaje y ejecutar una acción. La IA no debe enviar WhatsApps, aprobar impresión, registrar pagos/gastos, eliminar información ni cambiar permisos sin una instrucción explícita y específica.
4. Antes de cambios de producción, SQL, eliminación, revocación de enlaces o despliegues, explicar brevemente el efecto y confirmar que se trata del entorno y registro correctos. Nunca ejecutar `sql/schema.sql` o `sql/seed.sql` en producción como método de reparación.
5. No pedir ni mostrar contraseñas, claves `service_role`, tokens completos de aprobación, URLs privadas de archivos ni datos de pago. Si se necesita una clave, guiar a la propietaria para ingresarla directamente en el servicio correspondiente.
6. No confundir una selección de catálogo con una aprobación final para imprimir. La maestra puede seleccionar un paquete o diseño y después debe existir el flujo de revisión/aprobación de la pieza cuando aplique.
7. Al sugerir registrar una compra o gasto, distinguir el costo estimado del importe efectivamente pagado. Un pedido en borrador no es un gasto real.

## Roles

### Propietaria / administradora (`owner`)

Acceso completo al panel. Puede gestionar clientes, trabajos, paquetes, diplomas y carpetas, producción de impresión, pedidos, costos, materiales y finanzas.

### Editora (`editor`)

Al iniciar sesión debe ir a **Mis tareas**. Trabaja únicamente en piezas asignadas y puede usar el enlace de Canva de la tarea cuando esté registrado. No debe ver costos, pedidos, finanzas, paquetes ni administración de catálogos. La protección de datos también se aplica en Supabase; ocultar un botón no es la única barrera.

### Maestra / cliente

No inicia sesión en el panel interno. Usa enlaces con token para seleccionar catálogos, revisar abonos y consultar diseños/aprobaciones disponibles en su flujo. Un enlace público debe tratarse como información privada: no reenviarlo a otra escuela ni pegarlo en espacios públicos.

## Mapa de módulos

| Módulo | Archivo | Para qué sirve |
| --- | --- | --- |
| Dashboard | `dashboard.html` | Resumen general de clientes, trabajos, producción y saldos. |
| Clientes | `clients.html` | Alta y consulta de escuelas y clientes particulares; datos y nivel escolar de la escuela. |
| Trabajos | `jobs.html` | Crear trabajos de graduación, recuerdo, Navidad o particulares y abrir su detalle. |
| Detalle del trabajo | `job-detail.html?id=...` | Grupos/maestras, paquetes, piezas, archivos, galerías, abonos, asignaciones, enlaces e historial. |
| Paquetes | `packages.html` | Catálogo de paquetes, nivel/tipo, descripción e imágenes que verá la maestra. Solo `owner`. |
| Diplomas y carpetas | `diplomas.html` | Catálogos de diseños, previews y enlaces de Canva. Solo `owner`. |
| Aprobados para impresión | `print-approvals.html` | Cola de producción física, agrupada por escuela y etapa. Solo `owner`. |
| Pedidos y finanzas | `purchasing.html` | Pedidos de carpetas/materiales, catálogo de costos, recetas y gastos reales. Solo `owner`. |
| Seguimiento escuelas | `follow-ups.html` | Estado comercial y próximo contacto de escuelas. |
| Mis tareas | `editor-tasks.html` | Tareas asignadas a la editora; acceso exclusivo `editor`. |
| Enlace público | `approval.html` | Selección de paquetes/diseños o revisión de piezas, según el token y el flujo generado. |

## Flujo usual de una graduación

1. **Registrar escuela:** en **Clientes**, crear tipo Escuela y completar nivel (Preescolar/Kinder, Primaria o Secundaria), nombre de escuela, contacto y datos de maestra/grupo que correspondan.
2. **Crear trabajo:** en **Trabajos**, asociar la escuela, elegir tipo de evento y fechas. Abrir el trabajo para gestionar grupos y maestras.
3. **Configurar grupos:** crear cada grupo con nombre de maestra y cantidad. Revisar paquete y precio. La propietaria puede hacer o corregir la selección desde el panel; esto no requiere generar otro enlace para modificar el registro administrativo.
4. **Catálogo de paquetes:** el flujo escolar muestra dos tamaños (Paquete 1 y Paquete 2) y después formato (foto individual o grupal), con imágenes. Las cuatro variantes se configuran como registros de paquete y deben tener nivel/tipo correctos e imágenes. El formato no añade costo por sí mismo: el precio se toma del registro de paquete seleccionado. Navidad conserva un flujo distinto de paquete único.
5. **Enviar selección:** desde el detalle del grupo se abre WhatsApp con un mensaje preparado y el enlace de selección. La persona administradora revisa y pulsa enviar en WhatsApp. La maestra elige opción y cantidad; la aplicación registra la selección en el grupo.
6. **Diseño:** la maestra selecciona diploma y/o carpeta del catálogo cuando el trabajo lo requiere. La selección de diseño es previa a la edición final. La propietaria puede abrir el enlace de Canva del catálogo y asignar una tarea a la editora; la editora trabaja el diseño y lo pasa a revisión según la pieza.
7. **Revisión:** las piezas (por ejemplo diploma, carpeta, foto grupal o galería) tienen estados independientes. La maestra revisa el preview compartido y puede aprobar o pedir cambios con observaciones. Una selección de diseño no significa que el arte final esté aprobado.
8. **Impresión:** una pieza confirmada para impresión aparece en **Aprobados para impresión**. La progresión disponible es:
   - Pendientes de imprimir / `APPROVED_FOR_PRINT`
   - Enviados a imprenta / `PRINTING`
   - Impresos, pendientes de entrega / `PRINTED`
   - Entregados / `DELIVERED`

   El módulo avanza estados hacia adelante; una pieza impresa o entregada no se regresa a pendiente desde ahí. Verificar escuela, grupo, tipo de pieza y preview antes de avanzar para evitar reimpresiones.

## Paquetes y materiales: no confundir

- **Paquete** es la oferta/precio que se presenta al cliente.
- **Material o insumo** es lo que se compra o consume para producirla: bastidor 8x10, bastidor 8x12, impresión 6x8, carpeta, opalina, etc.
- En **Pedidos y finanzas > Costos y materiales**, primero se registra cada material con su unidad de consumo, unidad de compra, rendimiento por compra y costo de compra.
- Luego se asigna a los paquetes con un checkbox por paquete y la cantidad de unidades que ese paquete consume. Si un material se usa en varios paquetes, se seleccionan todos los correspondientes.
- Para diplomas: si una compra de $75 trae 100 hojas y de cada hoja sale un diploma, usa unidad de consumo `diploma`, unidad de compra `paquete de 100 hojas`, rendimiento `100`, costo de compra `75`; asigna `1 diploma` a cada paquete que lo incluya. Si las 100 hojas alcanzan para 100 paquetes, el costo estimado de opalina por diploma es $0.75, antes de otros insumos.
- Para carpeta estándar, registra un material por carpeta con su precio unitario. El diseño y las cantidades por grupo vienen de la selección de la maestra; no debe duplicarse un material por cada diseño si el proveedor cobra lo mismo.
- **Generar pedido** crea un borrador para revisar. En carpetas se agrupa por diseño, pero conserva cantidades por maestra/grupo y se pueden ajustar antes de marcar enviado.
- Estados de pedido: `Borrador` → `Enviado` → `Recibido`; cancelar solo está disponible en borrador.
- Los costos estimados de recetas/pedidos no entran como gasto real hasta registrar el pago efectivo en el módulo de gastos.

## Pagos y saldos

- Los abonos se registran manualmente desde el grupo o el historial del trabajo, incluyendo monto, fecha y nota si se conoce.
- El saldo se calcula con el total menos abonos; no capturar manualmente un saldo como si fuera un pago.
- Confirmar si el abono corresponde a un grupo específico o es general antes de registrarlo. No combinar ni reasignar abonos por suposición.
- La IA nunca debe inventar fechas, cantidades, comprobantes o importes.

## Archivos, Canva y galerías

- Google Photos es un enlace compartido que la administradora pega; no hay integración de API para crearlo.
- Los archivos de producción se guardan en el bucket privado de R2 y se entregan a través del Worker `clarisa-r2-share`. No cambiar el bucket a público.
- El editor recibe archivos/tareas que le hayan asignado y el link de Canva del diseño base si está guardado.
- Los links de Canva deben ser del diseño editable correcto. Confirmar cuál grupo/pieza y plantilla antes de modificar el vínculo.
- Los enlaces de aprobación son bearer tokens: quien tenga el enlace puede acceder a la información pública asociada. La configuración implementada prevé ocho meses de vigencia y bloquea modificaciones después de confirmaciones en las acciones protegidas. No revelar tokens en respuestas o canales compartidos.

## Mensajes y consentimiento

- La aplicación prepara mensajes para WhatsApp, pero no los envía automáticamente. La propietaria revisa destinatario, texto y link antes de presionar enviar.
- Una solicitud de corrección debe quedar registrada en la pieza con las observaciones de la maestra; no sustituirla por una conversación informal sin actualizar el trabajo.
- La aprobación final de impresión incluye el aviso sobre costos de cambios posteriores. La IA no debe aprobar en nombre de la maestra.

## Qué hacer ante errores

1. Identificar la URL/módulo y el usuario/rol con el que ocurre. No solicitar contraseña ni token.
2. Anotar texto exacto del error, hora aproximada y acción inmediatamente anterior. Captura sin datos privados es útil.
3. Distinguir error de interfaz, conexión Supabase, permisos/RLS, archivo R2 y configuración del Worker.
4. Revisar primero sesión, conexión y permisos del rol; no resolver un error de RLS desactivando RLS o concediendo acceso anónimo.
5. No pedir que la usuaria vuelva a crear registros o ejecute scripts de esquema para “probar”. Confirmar antes si el problema es producción o localhost.
6. Los archivos locales se pueden probar con un servidor estático, por ejemplo `python3 -m http.server 5500`; abrir un HTML con doble clic puede impedir que funcionen los ES Modules.
7. Un `git push` no garantiza que HostGator haya publicado los archivos: el flujo documentado usa **Update from Remote** y **Deploy HEAD Commit** en cPanel. El Worker de Cloudflare se despliega por separado.

## Archivos de referencia para la IA

- [README técnico](README.md): configuración, arquitectura y despliegues.
- [Selección de paquete y formato](docs/seleccion-paquete-formato.md): opciones y validaciones del catálogo escolar.
- [Paquetes por nivel e historial](docs/paquetes-niveles-actividad.md): clasificación, edición administrativa e historial.
- [Configuración R2/Cloudflare](docs/r2-cloudflare-setup.md): bucket y Worker.
- `sql/`: migraciones. Leer cada archivo y sus dependencias antes de recomendar su ejecución; no son scripts de reparación genéricos.
- `js/auth.js`: roles y redirecciones.
- `js/print-approvals.js`: etapas del tablero de impresión.
- `js/purchasing.js`: pedidos, materiales y gastos.
- `cloudflare/r2-share-worker.js`: enlaces privados de archivos y cron de actividad Supabase.

## Regla final

Cuando falte un dato, pedir únicamente el dato necesario. Si una acción puede afectar dinero, producción, accesos o datos de producción, detenerse antes del paso irreversible y confirmar el registro exacto con Clarisa.
