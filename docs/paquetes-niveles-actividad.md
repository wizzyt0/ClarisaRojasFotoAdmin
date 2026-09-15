# Paquetes por nivel y actividad del trabajo

## Orden para publicar esta actualizacion

1. Haga una copia de seguridad de Supabase antes de aplicar cambios de esquema.
2. Abra su proyecto de Supabase, entre a **SQL Editor > New query**.
3. Abra `sql/package-levels-activity.sql` en este proyecto, copie TODO su contenido, peguelo en la consulta y pulse **Run**. Debe finalizar sin errores. Es una migracion incremental que requiere las tablas del flujo de grupos/catalogos y los roles ya instalados. No borra clientes, trabajos, paquetes, abonos ni usuarios. Reemplaza funciones/triggers y la politica de lectura del nuevo historial; por eso el editor puede mostrar una advertencia de cambios de objetos.
4. No ejecute otra vez `schema.sql`, `catalog-previews.sql` ni `staff-roles-rbac.sql`: son scripts anteriores y pueden sobrescribir estos ajustes o los permisos.
5. En GitHub Desktop, revise los cambios, haga **Commit to main** y **Push origin**. En GitHub > Actions compruebe que **Verify static application** termina en verde.
6. En HostGator > cPanel > Git Version Control > Manage, pulse **Update from Remote** y despues **Deploy HEAD Commit**. No basta con hacer Push a GitHub si el despliegue de cPanel es manual.
7. Recargue el panel con Command + Shift + R e inicie sesion con un propietario.
8. Entre a **Paquetes**, busque **Graduaciones escolares > Sin nivel asignado**, pulse **Editar** en cada paquete y asigne **Preescolar** o **Primaria**. Se conserva Secundaria porque el sistema ya admite ese nivel. Un paquete pertenece a un nivel; si se ofrece en ambos, cree una ficha para cada nivel y suba sus imagenes.
9. Compruebe en **Clientes > Editar** que cada escuela tenga el nivel correcto. KINDER corresponde a Preescolar. Los paquetes sin nivel no aparecen en nuevos catalogos de graduacion, para evitar que la maestra elija uno incorrecto. Las selecciones previas no se borran.

No necesita cambiar Cloudflare, crear nuevos buckets, renovar tokens ni modificar usuarios para esta actualizacion.

## Cambiar una seleccion como administrador

1. Abra **Trabajos > Abrir > Datos escolares > Grupos**.
2. Pulse **Editar grupo** en la maestra correspondiente.
3. Cambie el paquete y/o la cantidad. El selector muestra los paquetes activos del evento y nivel de esa escuela, ademas de la seleccion anterior si ya no esta disponible.
4. Pulse **Guardar grupo**. El servidor calcula el precio del paquete por la cantidad, sincroniza la imagen seleccionada de la pieza y actualiza el total del trabajo en la misma transaccion. No necesita enviar otro enlace. Una seleccion anterior desactivada o sin nivel debe corregirse/clasificarse antes de cambiar su cantidad.
5. Los abonos existentes se conservan; el saldo del grupo sigue siendo su total menos sus abonos. Los abonos generales siguen separados de los asignados a una maestra.

Cambiar el precio del catalogo no modifica retroactivamente todos los grupos. Una nueva seleccion o cambio de cantidad usa el precio vigente.

## Historial de actividad

- Al final del trabajo aparece **Historial de actividad**, cerrado por defecto. Se consulta al desplegarlo, no al cargar toda la pagina.
- Registra creacion, cambios y eliminaciones de grupos, abonos, trabajos y piezas, con fecha/hora, actor y valores anteriores/nuevos relevantes. Incluye paquete, cantidad, total, abono y estado.
- Una accion puede generar varios registros: por ejemplo, cambiar un paquete actualiza el grupo, su pieza y el total del trabajo.
- Los movimientos por enlace de cliente quedan como **Enlace publico / sistema**. No se atribuyen a una identidad no autenticada.
- Solo los propietarios pueden leer este historial. Editores y clientes no tienen acceso; la proteccion tambien esta en Supabase, no solamente en la pantalla.
- El historial empieza al ejecutar la migracion. No se inventan movimientos anteriores ni se guardan tokens de aprobacion. No se puede editar o borrar desde el panel.

## Comprobacion recomendada

En un trabajo de prueba de Primaria, envie el catalogo: no deben aparecer paquetes de Preescolar ni de Navidad. Seleccione un paquete y cantidad; luego cambielos desde Editar grupo. Compruebe la imagen, total y saldo, agregue un abono de prueba al grupo y abra el historial. Repita la seleccion en una escuela de Preescolar. Entre con el editor: no debe tener acceso a Paquetes ni al historial.

Las pruebas automaticas locales usan una base PostgreSQL temporal: `npm ci`, `npm run verify`, `npm test`. No prueban su conexion de produccion, su configuracion de HostGator ni el envio real de WhatsApp.
