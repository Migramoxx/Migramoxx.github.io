# Landing — Milagros Canestro

Un solo archivo: `index.html`. Sin build, sin dependencias que instalar.
Bilingüe (ES/EN), modo claro y oscuro, y contacto por email y WhatsApp.

## Publicar en GitHub Pages

GitHub Pages sirve el sitio desde un repositorio llamado exactamente como tu
usuario. Ese nombre es el que te da la URL corta.

**1. Creá el repositorio** en https://github.com/new

- **Repository name:** `Migramoxx.github.io` ← exactamente así
- **Visibility:** **Public** — Pages no funciona en repos privados con cuenta
  gratuita. Es solo esta página; Hilo sigue privado en su propio repositorio.
- No tildes "Add a README", "Add .gitignore" ni "Choose a license"

**2. Subila**

```bash
cd "C:\Users\milag\OneDrive\Escritorio\cv\site"
git remote add origin https://github.com/Migramoxx/Migramoxx.github.io.git
git push -u origin main
```

**3. Activá Pages**

Repositorio → **Settings** → **Pages** → en "Source" elegí **Deploy from a
branch**, rama `main`, carpeta `/ (root)` → **Save**.

En un par de minutos queda en **https://migramoxx.github.io**

## Actualizarla

```bash
cd "C:\Users\milag\OneDrive\Escritorio\cv\site"
git add index.html && git commit -m "Actualizo la landing" && git push
```

Los cambios aparecen en aproximadamente un minuto.

## Qué conviene ir sumando

- **Cada trabajo que cierres** se convierte en un caso real en la sección de
  arriba. Ahí la página pasa de "esto sé hacer" a "esto ya lo hice", que es un
  salto grande de credibilidad.
- **Las certificaciones**, cuando las tengas. Una sección vacía resta; con dos
  o tres certificados suma.
- **El link a Upwork** en el pie, cuando el perfil esté publicado.

## Notas técnicas

- El idioma arranca según el navegador de quien entra y se puede cambiar con el
  botón EN/ES. La elección se recuerda entre visitas.
- El tema sigue al del sistema hasta que la persona toca el botón del sol.
- El mensaje precargado de WhatsApp cambia con el idioma de la página.
- Verificado: contraste de texto ≥4.5:1, áreas táctiles ≥44px, sin scroll
  horizontal en pantallas de 390px, un solo `<h1>` y jerarquía de encabezados
  sin saltos.
- Si más adelante comprás un dominio propio, se conecta desde Settings → Pages
  → Custom domain, sin tocar el código.
