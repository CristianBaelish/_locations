import { useCallback, useEffect, useState } from "react";

type BeforeInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

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
  const [bip, setBip] = useState<BeforeInstallPrompt | null>(null);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setBip(e as BeforeInstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const installAndroid = useCallback(async () => {
    if (!bip) return;
    await bip.prompt();
    await bip.userChoice.catch(() => undefined);
    setBip(null);
  }, [bip]);

  const installIOS = useCallback(async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url: window.location.href, title: document.title });
      } catch {
        /* usuario canceló */
      }
    }
  }, []);

  if (isStandalone()) return null;

  const showAndroid = isAndroid() && bip != null;
  const showIOS = isIOS();

  if (!showAndroid && !showIOS) return null;

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        {showAndroid ? (
          <button type="button" onClick={() => void installAndroid()}>
            Instalar en Android
          </button>
        ) : null}
        {showIOS ? (
          <button type="button" className={showAndroid ? "secondary" : undefined} onClick={() => void installIOS()}>
            Instalar en iPhone
          </button>
        ) : null}
      </div>
    </div>
  );
}
