import { useCallback, useEffect, useState } from "react";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function InstallAppHint() {
  const [bip, setBip] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== "undefined" ? window.__livePovInstall ?? null : null)
  );
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const sync = () => {
      if (window.__livePovInstall) setBip(window.__livePovInstall);
    };
    sync();
    const onInstalled = () => setInstalled(true);
    window.addEventListener("livepov-install-ready", sync);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("livepov-install-ready", sync);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const promptEvent = bip ?? window.__livePovInstall ?? null;
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => undefined);
    window.__livePovInstall = null;
    setBip(null);
  }, [bip]);

  if (installed) return null;

  const ios = isIOS();
  const android = isAndroid();
  const canPrompt = !ios && bip != null;
  if (!ios && !android && !canPrompt) return null;

  return (
    <div className="card">
      <h2>En el inicio del celular</h2>
      <p className="muted">
        Queda como una app. Abrila desde ese ícono y dejá la pantalla despierta mientras compartís.
      </p>
      {canPrompt ? (
        <button type="button" onClick={() => void install()}>
          Instalar
        </button>
      ) : (
        <ol className="install-steps">
          {ios ? (
            <>
              <li>Tocá Compartir en la barra del navegador: el cuadrado con la flecha hacia arriba.</li>
              <li>Elegí Agregar a inicio.</li>
              <li>Abrila desde ese ícono.</li>
            </>
          ) : (
            <>
              <li>En Chrome, abrí el menú de los tres puntos.</li>
              <li>Elegí Instalar app o Agregar a pantalla principal.</li>
              <li>Abrila desde ese ícono.</li>
            </>
          )}
        </ol>
      )}
    </div>
  );
}
