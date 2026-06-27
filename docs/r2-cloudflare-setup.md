# Configurar Cloudflare R2 para previews y archivos de imprenta

Esta integración mantiene privado el bucket de Cloudflare R2. El panel solo guarda rutas de archivos y genera tokens. Un Cloudflare Worker revisa el token en Supabase y entrega el archivo sin exponer llaves secretas en el frontend.

## 1. Supabase

1. Abra Supabase.
2. Entre a SQL Editor.
3. Copie y ejecute todo el archivo `sql/r2-storage-links.sql`.
4. Verifique que existan estas tablas:
   - `job_files`
   - `file_share_links`

No pegue la service role key en `js/config.js`. Esa llave solo se usa como secreto del Worker en Cloudflare.

## 2. Cloudflare R2

1. Entre a Cloudflare.
2. Vaya a R2 Object Storage.
3. Cree un bucket llamado `clarisa-fotos`.
4. Mantenga el bucket privado.
5. Suba archivos con una estructura como esta:

```text
trabajos/JOB_ID/preview/foto-001.jpg
trabajos/JOB_ID/preview/foto-002.jpg
trabajos/JOB_ID/print/archivos-finales.zip
```

Para maestra use JPG ligeros o con marca de agua. Para imprenta lo más práctico es subir un solo ZIP con los archivos finales.

## 3. Cloudflare Worker

1. Instale Wrangler si lo va a desplegar desde su computadora:

```bash
npm install -g wrangler
```

2. En la carpeta `cloudflare`, copie el ejemplo:

```bash
cp wrangler.toml.example wrangler.toml
```

3. Revise que el bucket sea correcto:

```toml
bucket_name = "clarisa-fotos"
```

4. Inicie sesión:

```bash
wrangler login
```

5. Configure el secreto de Supabase. Use la service role key de Supabase, no la publishable key:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

6. Despliegue:

```bash
wrangler deploy
```

El Worker usa `SUPABASE_URL` desde `wrangler.toml` y `SUPABASE_SERVICE_ROLE_KEY` como secreto.

## 4. URL del Worker

Para probar primero use el dominio gratis que Cloudflare ya creó:

```text
https://clarisa-r2-share.mudjkdriver.workers.dev
```

Más adelante, si agrega `clarisarojasfoto.com` a Cloudflare, puede cambiar `APP_CONFIG.r2WorkerUrl` a:

```text
https://files.clarisarojasfoto.com
```

## 5. Panel de la app

1. Abra un trabajo en `job-detail.html`.
2. En `Archivos R2`, haga clic en `Registrar archivo`.
3. Pegue el R2 key exacto, por ejemplo:

```text
trabajos/ID_DEL_TRABAJO/preview/foto-001.jpg
```

4. Seleccione:
   - `Preview maestra` para fotos de revisión.
   - `Alta calidad imprenta` para ZIP o archivos finales.
5. Haga clic en `Generar link`.
6. Seleccione:
   - `Preview para maestra`
   - `Descarga para imprenta`
7. El link generado se copia automáticamente y queda guardado con fecha de expiración.

## 6. GitHub

1. Abra GitHub Desktop.
2. Revise que el repositorio sea `ClarisaRojasFotoAdmin`.
3. Revise los cambios.
4. Escriba un mensaje como:

```text
Add Cloudflare R2 share links
```

5. Haga commit.
6. Haga push.

## 7. HostGator

1. Entre a cPanel.
2. Abra Git Version Control.
3. Seleccione el repositorio.
4. Haga Pull o Update from Remote.
5. Luego haga Deploy HEAD Commit.

HostGator solo publica la app estática. El Worker vive en Cloudflare y no se despliega desde HostGator.

## 8. Prueba final

1. Suba un JPG de preview al bucket.
2. Registre su R2 key en un trabajo.
3. Genere un link de preview.
4. Abra el link en una ventana privada.
5. Suba un ZIP de imprenta.
6. Registre su R2 key como `Alta calidad imprenta`.
7. Genere un link de descarga.
8. Abra el link en una ventana privada y confirme que descarga.
