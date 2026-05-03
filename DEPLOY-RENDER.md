# Cómo desplegar esta app en Render (una sola URL)

No hace falta Vercel para la versión recomendada: **un solo servicio** sirve el mapa (React) y el servidor (Node + Socket.io). La URL será algo como `https://live-street-pov.onrender.com`.

---

## Opción A — La más fácil: Blueprint (usa `render.yaml` del repo)

1. Entrá a [dashboard.render.com](https://dashboard.render.com) e iniciá sesión.
2. Arriba a la derecha: **New** → **Blueprint**.
3. Conectá **GitHub** si aún no lo hiciste y elegí el repo **`_locations`** (o como se llame en tu cuenta).
4. Render detecta el archivo **`render.yaml`** en la raíz. Dale **Apply** (o el botón equivalente para crear los recursos).
5. Cuando te pida el valor de **`VITE_GOOGLE_MAPS_API_KEY`**, pegá la clave de Google Cloud (Maps JavaScript API), la misma que usás en local.
6. Esperá a que el **deploy** termine (puede fallar la primera vez si falta algo; mirá **Logs** abajo).
7. Abrí la URL que te muestre Render (botón **Open** o similar) y probá:
   - `https://TU-SERVICIO.onrender.com/health` → tiene que verse **`ok`**.
   - La página principal → tiene que cargar el mapa si la clave de Google es válida.

Si algo falla, abrí **Logs** del servicio y buscá líneas en rojo (error de build, `npm ci`, falta de variable, etc.).

---

## Opción B — Manual: crear Web Service a mano

Usala si no querés usar Blueprint o si falló el YAML.

1. **New** → **Web Service**.
2. Conectá el mismo repo de GitHub y elegí la rama **`main`**.
3. Completá **exactamente** estos campos (el orden en el panel puede variar):

| Campo en Render | Valor |
|-----------------|--------|
| **Name** | El que quieras (ej. `live-street-pov`) |
| **Region** | Oregon u otra cercana |
| **Branch** | `main` |
| **Root Directory** | **Déjalo vacío** (debe ser la **raíz** del repo, **no** la carpeta `server`) |
| **Runtime** | Node |
| **Build Command** | `npm ci && npm run build` |
| **Start Command** | `npm start` |
| **Instance type** | Free (o de pago) |

4. **Environment** (Variables de entorno) → **Add environment variable**:
   - `VITE_GOOGLE_MAPS_API_KEY` = tu clave de Google Maps (obligatoria para que el **build** del cliente embeba la clave).
   - Opcional: `NODE_VERSION` = `20` (ayuda a fijar la versión de Node).

5. **Advanced** (si existe la sección): **Health Check Path** = `/health`.

6. Guardá y dejá que haga el **primer deploy**.

---

## Errores típicos

- **Root Directory = `server`**: mal para este proyecto. El build del cliente vive en `client/` y el comando `npm run build` está en la raíz. Si dejás solo `server`, no se genera `client/dist` y el servidor no sirve la web.
- **Start Command = `node src/index.js` desde la carpeta server**: evitalo con esta estructura; usá **`npm start`** desde la **raíz** (`package.json` del monorepo ya apunta al workspace `server`).
- **`/health` no responde o tarda muchísimo**: en plan **Free**, Render apaga el servicio por inactividad; el primer request puede tardar **varios minutos**. Si nunca responde, mirá **Logs** → suele ser error de arranque (puerto, dependencias, etc.).
- **Mapa en blanco**: casi siempre falta `VITE_GOOGLE_MAPS_API_KEY` en las variables de **Render** (y redeploy después de agregarla).

---

## Qué hace el código en el servidor

- Si existe la carpeta **`client/dist`** (generada por `npm run build`), Express sirve los archivos estáticos y el SPA.
- **`/health`** responde `ok` para Render y para vos.
- **`/api`** y **Socket.io** siguen en el mismo proceso.

---

## Vercel

Podés dejar de usarlo para esta app si usás solo Render. Si seguís con Vercel además, es opcional; el cliente ya puede hablar con el mismo origen o con rewrites según cómo lo configures.
