import { useEffect, useState } from "react";

type Props = {
  title: string;
  detail: string;
  /** Muestra los segundos para que una espera larga no parezca congelada. */
  trackTime?: boolean;
  layout?: "stack" | "row";
};

export function WarmStatus({ title, detail, trackTime = false, layout = "stack" }: Props) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!trackTime) return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [trackTime]);

  const shownDetail =
    trackTime && seconds >= 20
      ? "Sigue en marcha. El primer arranque del día es el más lento."
      : detail;

  return (
    <div className={`warm-status${layout === "row" ? " warm-status--row" : ""}`}>
      <div className="warm-pin" aria-hidden="true">
        <span />
      </div>
      <div role="status" aria-live="polite">
        <p className="warm-status-title">{title}</p>
        <p className="muted">{shownDetail}</p>
      </div>
      {trackTime ? (
        <p className="warm-elapsed" aria-hidden="true">
          {seconds}s
        </p>
      ) : null}
    </div>
  );
}
