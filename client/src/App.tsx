import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Share } from "./pages/Share";
import { View } from "./pages/View";

const apiOriginMissing =
  import.meta.env.PROD &&
  (!import.meta.env.VITE_API_ORIGIN || import.meta.env.VITE_API_ORIGIN.length === 0);

export function App() {
  return (
    <BrowserRouter>
      {apiOriginMissing ? (
        <div
          className="banner"
          role="alert"
          style={{
            margin: 0,
            borderRadius: 0,
            borderLeft: "none",
            borderRight: "none",
            borderTop: "none",
          }}
        >
          <strong>Falta configuración en Vercel:</strong> agregá la variable{" "}
          <code>VITE_API_ORIGIN</code> con la URL del API en Render (sin barra final) y volvé a desplegar.
          Sin eso, el front no puede crear sesiones ni sincronizar ubicación para nadie que abra el sitio
          público.
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:roomId" element={<Share />} />
        <Route path="/v/:roomId" element={<View />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
