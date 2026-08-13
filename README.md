# Agendamiento de Pacientes — Versión Supabase

Versión **100% estática** de la clínica: sin servidor propio. El frontend usa
**Supabase Auth** (login) y **PostgREST** (la base de datos de Supabase) con
seguridad por **Row Level Security**. Como no hay backend, **se puede publicar
gratis en GitHub Pages** (`usuario.github.io`).

## Arquitectura

```
Navegador (GitHub Pages)
   │  supabase-js (Auth + REST)
   ▼
Supabase Cloud
   ├─ Auth        → login por correo/contraseña
   ├─ PostgreSQL  → tablas con RLS y funciones de validación
   └─ Triggers    → recordatorios automáticos al crear citas
```

## Paso 1 — Crear el proyecto en Supabase

1. Regístrese en <https://supabase.com> y cree un nuevo proyecto.
2. En **SQL Editor**, ejecute los archivos en orden:
   - `supabase/schema.sql`  (tablas, RLS, funciones, triggers)
   - `supabase/seed.sql`    (médicos, pacientes y citas de ejemplo)

## Paso 2 — Crear los usuarios de demostración

1. En *Project Settings → API Keys* copie la **URL** y la **service_role key**.
2. Copie `.env.example` a `.env` y complete los valores.
3. Ejecute en su máquina (no se sube al repositorio):

```bash
node scripts/setup-users.mjs
```

Esto crea los accesos:

| Rol       | Correo                | Contraseña    |
| --------- | --------------------- | ------------- |
| Admin     | admin@clinica.com     | admin123      |
| Recepción | recepcion@clinica.com | recepcion123  |
| Médico    | ana@clinica.com       | medico123     |

> La `service_role` da acceso total: guárdela fuera del repositorio.

## Paso 3 — Configurar el frontend

Edite `public/js/config.js` con los datos públicos de su proyecto
(*Project Settings → API Keys → URL* y **anon key**):

```js
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

## Paso 4 — Publicar en GitHub Pages

1. Cree un repositorio en GitHub (ej. `agendamiento-pacientes`).
2. Suba **el contenido de la carpeta `public/`** (o todo el proyecto y apunte
   Pages a la carpeta `public`).
3. En el repo: *Settings → Pages → Source*:
   - Si subió solo `public/`: rama `main`, carpeta raíz `/`.
   - Si subió todo: rama `main`, carpeta `/public`.
4. En unos minutos estará en `https://usuario.github.io/agendamiento-pacientes/`.

Probar localmente antes de publicar:

```bash
npx serve public
# o con Python
python -m http.server 8080 --directory public
```

## Seguridad

- Las tablas tienen **Row Level Security**: cada rol solo ve/edita lo suyo.
- La creación y reprogramación de citas pasa por funciones `SECURITY DEFINER`
  (`crear_cita`, `actualizar_cita`, `cambiar_estado_cita`) que validan
  disponibilidad de forma atómica (día de atención, horario y solapamientos).
- La **anon key** es pública por diseño; los datos están protegidos por RLS.
- Secreto requerido para la creación de perfiles/usuarios (solo la
  `service_role`, que jamás se incluye en el frontend).

## Notas

- **Recordatorios por email**: se registran en la tabla `recordatorios`
  (canal `email`) al crear la cita. El envío real requiere una Supabase Edge
  Function con un proveedor SMTP (Resend, SendGrid…); la versión actual
  muestra las notificaciones dentro de la app (canal `app`).
- Los horarios devueltos por PostgREST usan el formato `HH:MM:SS`; el frontend
  los muestra como `HH:MM`.

## Estructura

```
agendamiento-pacientes-supabase/
├── supabase/
│   ├── schema.sql          # Tablas, RLS, funciones y triggers
│   └── seed.sql            # Datos de ejemplo
├── scripts/
│   ├── setup-users.mjs     # Crea usuarios Auth + perfiles (service_role)
│   └── .env.example → .env # Configuración local
└── public/                 # Sitio estático (GitHub Pages)
    ├── index.html          # Login
    ├── dashboard.html      # Panel con estadísticas
    ├── pacientes.html      # Gestión de pacientes
    ├── citas.html          # Gestión de citas
    ├── calendario.html     # Calendario semanal por médico
    ├── css/style.css
    └── js/                 # config, app, layout + páginas
```
