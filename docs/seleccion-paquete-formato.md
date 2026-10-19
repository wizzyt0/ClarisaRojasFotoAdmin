# Paquetes con presentaciones

Cada paquete que ve la maestra es una **oferta** con un nombre y un precio propios. Una oferta puede ser Paquete chico, grande, mediano o cualquier otra opción futura. Cada oferta contiene dos presentaciones con imágenes independientes: **Foto individual** y **Foto grupal**. Ambas presentaciones comparten el precio de la oferta; la maestra elige oferta, formato y cantidad.

El modelo aplica a graduaciones escolares por nivel y a fotografía de recuerdo. La selección se guarda en el registro de paquete de la presentación elegida, por lo que permanecen correctos los precios históricos, grupos y abonos. Navidad conserva su paquete único.

## Actualización

1. En Supabase, abre **SQL Editor > New query**.
2. Ejecuta el contenido completo de `sql/package-offers.sql`. La migración agrega la tabla de ofertas y el vínculo opcional en paquetes existentes. Agrupa automáticamente los Paquetes 1 y 2 actuales únicamente cuando cada uno tiene ambas presentaciones y ambas comparten precio. No modifica selecciones, fotos, grupos ni abonos. Los paquetes sin pareja siguen disponibles bajo **Paquetes sin agrupar**.
3. Despliega en HostGator los cambios de `packages.html`, `job-detail.html`, `approval.html`, `js/packages.js`, `js/job-detail.js`, `js/approval.js` y `docs/seleccion-paquete-formato.md`.
4. En **Paquetes**, cada oferta agrupada aparece como una tarjeta con precio y dos zonas de carga de imágenes. Para agregar otro paquete (por ejemplo, “Paquete mediano”), usa **Agregar paquete**, define nombre y precio y carga una foto para cada presentación. El sistema crea las dos variantes por ti.
5. Antes de enviar el catálogo, cada oferta activa debe tener una imagen en ambas presentaciones. La maestra verá una tarjeta por oferta, después las dos presentaciones con su imagen y luego podrá elegir la cantidad.

No crees manualmente una fila por formato para los paquetes nuevos: usa **Agregar paquete** dentro del nivel/categoría correspondiente. Para ajustar el costo, edita la oferta; el mismo precio se sincroniza a sus dos variantes.

## Requisitos

Esta migración va después de `sql/package-levels-activity.sql`, `sql/school-package-presentation-options.sql` y `sql/package-photo-selection.sql`. También requiere que ya existan `package_images`, `print_items`, `jobs`, `school_profiles` y `staff_roles`. No vuelvas a ejecutar `sql/schema.sql` ni `sql/print-items-workflow.sql` en producción.
