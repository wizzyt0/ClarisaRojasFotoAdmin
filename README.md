# Photo Admin Simple

Aplicación web interna para administrar un negocio de fotografía. Es simple, estática y sin frameworks: HTML5, CSS3, JavaScript puro con ES Modules, Supabase como base de datos y Supabase Auth para el administrador.

## Funciones incluidas

- Login de administrador con Supabase Auth.
- Clientes de sesiones de fotos y graduaciones escolares.
- Perfiles escolares con contacto, maestra, directora, curso, estudiantes y seguimiento anual.
- Catálogo de paquetes.
- Trabajos con estados, paquetes, cantidad, precio, fecha de entrega y token de aprobación.
- Abonos manuales, sin métodos de pago.
- Cálculo de abonado, pendiente y sobreabono.
- Links compartidos de Google Photos.
- Links seguros de Cloudflare R2 para previews de maestra y archivos de imprenta.
- Mensajes de WhatsApp con `wa.me`, sin enviar automáticamente.
- Página pública `approval.html?token=...` para aprobar impresión.
- Seguimiento anual de escuelas.
- Despliegue directo en Netlify.

## Funciones no incluidas

No usa Next.js, React, Vue, Angular, backend Node tradicional, pagos online, WhatsApp Business API, Google Photos API, dashboard de clientes ni cuentas para clientes.

## Modo local sin login

Por ahora la app está configurada para probar localmente sin login. En `js/auth.js` existe:

```js
export const AUTH_ENABLED = false;
```

Con ese valor, `index.html` redirige a `dashboard.html` y las páginas internas no piden sesión.

Importante: `sql/policies.sql` también incluye políticas `local anon` para poder leer y escribir con la anon key durante pruebas locales. Antes de publicar en internet, cambie `AUTH_ENABLED` a `true` y elimine esas políticas `local anon` en Supabase.

## Configurar Supabase

1. Cree un proyecto en Supabase.
2. Abra el SQL Editor.
3. Ejecute `sql/schema.sql`.
4. Ejecute `sql/policies.sql`.
5. Opcionalmente ejecute `sql/seed.sql` para datos demo.
6. Para usar login más adelante, en Authentication cree un usuario administrador con correo y contraseña.

No use la service role key en el frontend. Solo use la URL del proyecto y la anon key.

## Configurar la app

Edite `js/config.js`:

```js
export const SUPABASE_URL = "https://su-proyecto.supabase.co";
export const SUPABASE_ANON_KEY = "su-anon-key";
```

En producción cambie `APP_CONFIG.appUrl` por su URL de Netlify, por ejemplo:

```js
appUrl: "https://mi-foto-admin.netlify.app"
```

También puede cambiar:

- `currency`: moneda, por defecto `MXN`.
- `locale`: formato regional, por defecto `es-MX`.
- `defaultCountryCode`: código para WhatsApp, por defecto `52` para México.
- `businessName`: nombre usado en mensajes de seguimiento.
- `facebookUrl` e `instagramUrl`: redes sociales incluidas en mensajes de seguimiento escolar.

## Probar localmente

Abra la carpeta `photo-admin-simple` con Live Server o use un servidor estático:

```bash
python3 -m http.server 5500
```

Luego entre a:

```text
http://localhost:5500/index.html
```

Configure Supabase Auth Redirect URLs:

- `http://localhost:5500`
- `http://localhost:5500/index.html`
- `https://tu-sitio.netlify.app`
- `https://tu-sitio.netlify.app/index.html`

## Uso básico

1. Inicie sesión en `index.html`.
2. Cree paquetes en `packages.html`.
3. Cree clientes en `clients.html`.
4. Para escuelas, seleccione “Graduación escolar” y complete escuela, contacto, maestra, directora y seguimiento.
5. Cree trabajos en `jobs.html`.
6. Abra el detalle del trabajo.
7. Registre abonos en la sección “Abonos”.
8. Agregue links compartidos de Google Photos en “Galerías”.
9. Genere el mensaje de WhatsApp.
10. Copie o abra WhatsApp y envíe manualmente.
11. Copie el link público de aprobación y compártalo si lo necesita.
12. El cliente abre `approval.html?token=...`, revisa, acepta condiciones y autoriza impresión.

## Aprobación pública

La página pública usa funciones RPC seguras:

- `get_public_approval_by_token(token)`
- `approve_job_by_token(token, approval_name)`

La aprobación guarda:

- `approved_at`
- `approval_name`
- `approval_terms_accepted = true`
- `status = APPROVED_FOR_PRINT`

Texto obligatorio mostrado al cliente:

> Una vez autorizado este trabajo para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá un costo extra.

## Google Photos

No hay integración con Google Photos API. El administrador pega manualmente links compartidos. El frontend valida que el dominio parezca de Google Photos:

- `photos.app.goo.gl`
- `photos.google.com`

## Cloudflare R2

La app puede registrar archivos guardados en un bucket privado de Cloudflare R2 y generar links seguros:

- Preview para maestra: `https://clarisa-r2-share.mudjkdriver.workers.dev/preview?token=...`
- Descarga para imprenta: `https://clarisa-r2-share.mudjkdriver.workers.dev/download?token=...`

Ejecute `sql/r2-storage-links.sql` en Supabase para crear las tablas `job_files` y `file_share_links`.

El frontend nunca guarda llaves secretas de Cloudflare R2. La entrega de archivos se hace con un Cloudflare Worker en `cloudflare/r2-share-worker.js`.

Guía completa: `docs/r2-cloudflare-setup.md`.

## WhatsApp

No hay integración con WhatsApp Business API. La app genera un link `wa.me` con mensaje prellenado. El administrador revisa y envía manualmente desde WhatsApp. Cada mensaje generado se guarda en `message_logs`.

## Abonos

No existen métodos de pago. Use solo:

- Abono
- Monto abonado
- Fecha del abono
- Nota

El saldo pendiente no se guarda manualmente. Se calcula con el precio del trabajo menos la suma de abonos.

## Desplegar en Netlify

Opción 1:

1. Entre a Netlify.
2. Arrastre la carpeta `photo-admin-simple`.
3. Configure `APP_CONFIG.appUrl` con la URL final.

Opción 2:

1. Suba el proyecto a GitHub.
2. Conecte el repositorio en Netlify.
3. No necesita build command.
4. El publish directory es `.`.

El archivo `netlify.toml` ya contiene:

```toml
[build]
  publish = "."
```

## Dominio propio

En Netlify, abra Domain management, agregue el dominio y siga las instrucciones DNS. Después agregue las nuevas URLs como Redirect URLs en Supabase Auth y actualice `APP_CONFIG.appUrl`.

## Backup de Supabase

Use las copias automáticas del panel de Supabase si su plan las incluye. También puede exportar datos desde Table Editor o usar `pg_dump` si trabaja con la conexión PostgreSQL.

## Datos demo

`sql/seed.sql` crea:

- Juan Pérez, cliente de sesión.
- Colegio Santa María, cliente escolar.
- Perfil escolar con Ana Rodríguez, Laura Gómez y Marta Fernández.
- Paquetes básicos y premium.
- Trabajos demo.
- Galerías demo.
- Abonos demo.

## Problemas comunes

- “Debe iniciar sesión”: no hay sesión activa de Supabase Auth.
- “No se pudo cargar la información”: revise `SUPABASE_URL`, `SUPABASE_ANON_KEY`, RLS y que las tablas existan.
- “El link de aprobación no existe o expiró”: token incorrecto, revocado o expirado.
- WhatsApp no abre: revise que el teléfono tenga dígitos y código de país correcto.
- Google Photos no se guarda: el link debe usar `photos.app.goo.gl` o `photos.google.com`.
- La aprobación pública falla: confirme que ejecutó `sql/policies.sql` y que las funciones RPC tienen permisos para `anon`.
