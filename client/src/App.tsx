import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Share } from "./pages/Share";
import { View } from "./pages/View";

/**
 * REST y /health van al mismo origen que la app (p. ej. locationspov.vercel.app) salvo que definas
 * VITE_API_ORIGIN. Socket.io usa el mismo origen (rewrites de Vercel o proxy de Vite).
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/s/:roomId" element={<Share />} />
        <Route path="/v/:roomId" element={<View />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
