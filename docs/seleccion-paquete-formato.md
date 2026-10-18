# Selección de paquete y formato de foto

Cada grupo conserva su paquete, precio e imagen de catálogo. La maestra elige **Foto grupal** o **Foto individual** y la cantidad dentro del enlace de WhatsApp. El formato no altera el precio. El resumen del grupo muestra el paquete, formato y cantidad; la administradora puede cambiarlos desde **Editar grupo / paquete**.

## Aplicar el cambio

1. En Supabase, abra **SQL Editor > New query**.
2. Ejecute `sql/package-photo-selection.sql`. Esta migración requiere que ya esté instalado `sql/package-levels-activity.sql`. No borra registros de paquetes, grupos, imágenes, pagos ni selecciones.
3. Publique el código actualizado en GitHub y despliegue ese commit en cPanel/HostGator.
4. Recargue el panel con `Command + Shift + R`.
5. En **Paquetes**, suba al menos una imagen para cada paquete que quiera mostrar. La imagen representa el paquete y la maestra la verá antes de elegir el formato.
6. Abra el grupo y envíe el catálogo por WhatsApp. Si falta una imagen, el panel indicará qué paquete debe completarse antes de enviar.
7. Los grupos que ya tenían paquete asignado mostrarán **Formato pendiente**. Edítelos una vez para elegir el formato correcto; no se asigna uno automáticamente.

El enlace público solo muestra paquetes activos que coincidan con el evento y nivel de la escuela. Por eso, si el catálogo no tiene opciones, revise también que los paquetes tengan la categoría y el nivel correctos.

## Catálogo conjunto de diploma y carpeta

Para que cada maestra elija ambos diseños desde el mismo enlace, ejecute también `sql/combined-school-catalog.sql` en Supabase después de las migraciones anteriores. La página muestra las dos secciones filtradas al nivel escolar y guarda cada elección por separado en las piezas del grupo. El menú administrativo conserva un único acceso **Diplomas y carpetas**.

No vuelva a ejecutar `sql/schema.sql` ni `sql/print-items-workflow.sql` en una base ya existente.
