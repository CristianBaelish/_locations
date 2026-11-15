import { bearingToCardinalEs } from "../lib/geo";

type Props = {
  bearingDeg: number | null;
  compact?: boolean;
};

export function CompassRose({ bearingDeg, compact }: Props) {
  const deg = bearingDeg != null && Number.isFinite(bearingDeg) ? bearingDeg : null;
  const label = deg != null ? bearingToCardinalEs(deg) : "—";
  const size = compact ? 100 : 128;

  return (
    <div
      className="compass-wrap"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div className="compass-dial" style={{ width: size, height: size }} aria-hidden>
        {["N", "E", "S", "O"].map((letter, i) => {
          const rot = i * 90;
          return (
            <span
              key={letter}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(-${size * 0.36}px) rotate(-${rot}deg)`,
                fontSize: compact ? "0.65rem" : "0.75rem",
                fontWeight: 700,
                color: letter === "N" ? "var(--accent)" : "var(--muted)",
              }}
            >
              {letter}
            </span>
          );
        })}
        <div
          className="compass-needle"
          style={{
            height: size * 0.38,
            marginLeft: -2,
            marginTop: -size * 0.38,
            transform: deg != null ? `rotate(${deg}deg)` : "rotate(0deg)",
            opacity: deg != null ? 1 : 0,
            visibility: deg != null ? "visible" : "hidden",
            transition: "transform 0.2s linear, opacity 0.2s",
          }}
        />
        <div className="compass-hub" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: compact ? "0.95rem" : "1.05rem" }}>
          {deg != null ? `${deg.toFixed(0)}°` : "—"}
        </div>
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          {label}
        </div>
      </div>
    </div>
  );
}
