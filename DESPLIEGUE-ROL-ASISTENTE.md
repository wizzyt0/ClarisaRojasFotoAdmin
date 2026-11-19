# Despliegue del rol Asistente IA

## Permisos iniciales

- Puede consultar escuelas, trabajos, grupos, paquetes, diplomas, carpetas, previews, aprobaciones, pedidos y finanzas.
- Puede corregir datos de contacto y seguimiento, además del título, fechas y notas de trabajos existentes.
- Puede ver precios, abonos, costos, gastos, saldos y estados financieros, pero no guardarlos ni modificarlos.
- No puede crear o eliminar registros, asignar paquetes o cantidades, cambiar estados de producción, aprobar impresión, editar catálogos, gestionar usuarios, renovar/revocar enlaces ni enviar mensajes.
- Los archivos R2 visibles para este rol son previews; no puede subir, borrar ni descargar originales.

Los permisos de edición se mantienen deliberadamente acotados. Si al probar una tarea cotidiana la IA no puede completarla, anota qué pantalla y qué acción intentó; con ese resumen se amplía únicamente el permiso necesario.

## Orden de despliegue

1. En Supabase, abre **SQL Editor** y ejecuta `sql/assistant-role-deployment.sql` después de las migraciones actuales de autenticación/RLS, catálogo, flujo de impresión y finanzas. No ejecutes las migraciones antiguas otra vez.
2. Despliega `cloudflare/r2-share-worker.js` en el Worker que sirve los previews R2. Mantén los secretos actuales del Worker; no los copies a la página ni al chat.
3. Despliega el sitio actualizado desde GitHub/HostGator, incluyendo los cambios de `js/`, HTML y el archivo SQL del repositorio.
4. En Supabase, invita el correo dedicado desde **Authentication > Users > Invite user**. No uses una cuenta propietaria existente.
5. Cuando el usuario ya aparezca en Authentication > Users, ejecuta en SQL Editor el bloque de asignación de abajo, reemplazando correo y nombre. La condición evita cambiar por accidente una cuenta que ya sea propietaria.
6. Inicia sesión en una ventana privada con esa cuenta y prueba la lista de comprobación.

## Asignar el rol

Primero confirma el usuario y que no sea una cuenta propietaria:

```sql
select u.id, u.email, sr.role, sr.display_name
from auth.users u
left join public.staff_roles sr on sr.user_id = u.id
where lower(u.email) = lower('CORREO-INVITADO');
```

Después asigna el rol:

```sql
insert into public.staff_roles (user_id, role, display_name)
select u.id, 'assistant'::public.staff_role, 'Asistente IA'
from auth.users u
where lower(u.email) = lower('CORREO-INVITADO')
  and not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = u.id and sr.role = 'owner'
  )
on conflict (user_id) do update
set role = excluded.role,
    display_name = excluded.display_name,
    updated_at = now();
```

Verifica que `role` diga `assistant`:

```sql
select u.email, sr.role, sr.display_name
from public.staff_roles sr
join auth.users u on u.id = sr.user_id
where lower(u.email) = lower('CORREO-INVITADO');
```

## Prueba de permisos

- Debe cargar trabajos, grupos, catálogos, imágenes preview, Aprobados para impresión y Pedidos y finanzas.
- Debe permitir editar una nota/fecha de trabajo y datos de contacto/seguimiento de una escuela.
- No deben aparecer controles para borrar, cambiar estado, asignar cantidades, registrar abonos/gastos, mover impresión, subir archivos, gestionar usuarios o enviar WhatsApp.
- Confirma que las consultas directas de actualización de precio, saldo, abono, estado de impresión y token sean rechazadas por Supabase.
- Comprueba que una cuenta propietaria y una cuenta editor sigan conservando su comportamiento actual.

Para retirar el acceso, actualiza su fila en `staff_roles` a `editor` solo si ese usuario debe seguir trabajando como editor; si no, elimina la fila de `staff_roles` desde una sesión propietaria. No borres su cuenta de autenticación sin necesidad.
