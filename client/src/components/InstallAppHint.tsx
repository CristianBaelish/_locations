import { useCallback, useEffect, useState } from "react";

type BeforeInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppHint() {
  const [bip, setBip] = useState<BeforeInstallPrompt | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setBip(e as BeforeInstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const install = useCallback(async () => {
    if (!bip) return;
    await bip.prompt();
    await bip.userChoice.catch(() => undefined);
    setBip(null);
  }, [bip]);

  if (dismissed) return null;

  return (
    <div className="card install-hint" style={{ marginTop: "1rem", borderColor: "#2d4a6f" }}>
      <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Usar en el celular</h2>
      <ul className="muted" style={{ margin: "0 0 0.75rem", paddingLeft: "1.2rem", fontSize: "0.88rem" }}>
        <li>
          <strong>Misma Wi‑Fi:</strong> <code>dev-lan.cmd</code> o <code>npm run dev:lan</code>. En el celular usá la URL{" "}
          <strong>Network</strong> que muestra Vite (puerto 5173 o 5174…). Firewall:{" "}
          <code>abrir-puertos-firewall.cmd</code> como administrador.
        </li>
        <li>
          <strong>Ubicación / GPS en el celular:</strong> con <code>http://192.168…</code> Chrome{" "}
          <strong>no permite</strong> ubicación. Usá <code>dev-lan-https.cmd</code> (o{" "}
          <code>npm run dev:lan-https</code>) y abrí <code>https://TU-IP:PUERTO</code>; la primera vez aceptá el certificado
          local (Avanzado → continuar). Agregá ese origen en restricciones de la API de Google Maps.
        </li>
        <li>
          Preview del build: <code>npm run preview:lan -w client</code> → <code>http://IP:4173</code> (para GPS desde el
          móvil necesitás el mismo modo HTTPS si usás IP local).
        </li>
        <li>
          <strong>Dos personas lejos:</strong> hacé un deploy con HTTPS (por ejemplo front en Vercel/Netlify y API en
          Railway/Render) y definí <code>VITE_API_ORIGIN</code> al construir el cliente.
        </li>
        <li>
          <strong>iPhone (Safari):</strong> Compartir → <strong>Añadir a pantalla de inicio</strong>.
        </li>
      </ul>
      {bip ? (
        <div className="row">
          <button type="button" onClick={install}>
            Instalar app (Android / Chrome)
          </button>
          <button type="button" className="secondary" onClick={() => setDismissed(true)}>
            Ocultar
          </button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          En Chrome para Android suele aparecer “Instalar app” en el menú si la página cumple requisitos PWA. Si no, usá
          “Añadir a pantalla de inicio”.
        </p>
      )}
    </div>
  );
}
