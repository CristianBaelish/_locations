import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./index.css";

registerSW({ immediate: true });

/* Sin StrictMode: en dev evita doble montaje de Google Maps (mucho peso en RAM/CPU). */
createRoot(document.getElementById("root")!).render(<App />);
