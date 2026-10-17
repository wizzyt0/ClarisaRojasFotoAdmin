# Formato de foto en paquetes

La ficha administrativa de cada paquete permite indicar si corresponde a **Foto grupal** o **Foto individual**. Los paquetes anteriores quedan como **Formato sin definir** hasta que se editen; no se les asigna un formato por suposición.

## Aplicar el cambio en Supabase

1. Abra **Supabase > SQL Editor > New query**.
2. Copie y ejecute todo el contenido de `sql/package-photo-format.sql`.
3. Publique los cambios del proyecto en GitHub y después despliegue el commit en cPanel/HostGator.
4. Recargue el panel con `Command + Shift + R`.
5. En **Paquetes**, edite los que indiquen **Formato sin definir**, seleccione el formato correcto y guarde.

La migración solo agrega una columna y una restricción; no modifica ni elimina paquetes, precios, imágenes o selecciones existentes.
