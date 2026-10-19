# Selección de paquete y presentación

Para graduaciones y fotografía de recuerdo, la maestra ve dos precios: **Paquete chico** y **Paquete grande**. Después elige una de dos presentaciones con su imagen: **Foto del alumno en bastidor** o **Foto grupal e individual**. Las presentaciones de cada tamaño deben conservar el mismo precio. Finalmente elige de 1 a 99 paquetes y confirma. La selección se guarda en el registro original de paquete, por lo que el dashboard, los totales y los abonos existentes siguen usando el precio correcto.

El flujo aplica a todos los grupos escolares de graduación, en cada nivel escolar, y a fotografía de recuerdo. Navidad conserva su flujo de paquete único.

## Configuración

1. En Supabase, abra **SQL Editor > New query**.
2. Pegue y ejecute el contenido completo de `sql/school-package-presentation-options.sql`. Es una migración aditiva e idempotente: agrega los campos de clasificación y una función pública protegida por el token de la pieza. No elimina ni reasigna paquetes, imágenes, grupos o pagos.
3. Publique los cambios del proyecto en GitHub y despliegue en HostGator estos archivos juntos: `packages.html`, `job-detail.html`, `approval.html`, `js/packages.js`, `js/job-detail.js`, `js/approval.js`, `js/school-groups.js` y `css/styles.css`.
4. En el panel, abra **Paquetes** y edite cada paquete escolar. Seleccione su tamaño y presentación. Para cada nivel de graduación (Preescolar, Primaria y Secundaria) clasifique cuatro paquetes: chico/bastidor, chico/grupal e individual, grande/bastidor, grande/grupal e individual. Fotografía de recuerdo requiere la misma combinación de cuatro variantes. Suba al menos una imagen a cada paquete.
5. Verifique que las dos presentaciones del paquete chico tengan el mismo precio y que las dos del paquete grande tengan el mismo precio. El sistema impedirá enviar el catálogo si falta una variante, una imagen o no coincide el precio.
6. En el trabajo, envíe el catálogo por WhatsApp desde el paso **Paquete de fotos**. La maestra verá los dos precios; al elegir uno, verá las dos presentaciones y sus imágenes, luego la cantidad y la confirmación.

El precio que se cobra se toma del registro real elegido. La presentación seleccionada también se guarda en `school_groups.photo_format` para conservar compatibilidad con el historial y automatizaciones previas; en la interfaz se muestra el nombre descriptivo nuevo.

## Migraciones anteriores

Esta migración requiere la estructura ya existente de `packages`, `package_images`, `school_groups`, `print_items`, `jobs` y `school_profiles`, además de `sql/package-photo-selection.sql` para guardar la selección pública. No vuelva a ejecutar `sql/schema.sql` ni `sql/print-items-workflow.sql` sobre una base en producción.
