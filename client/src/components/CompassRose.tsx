import { bearingToCardinalEs } from "../lib/geo";

type Props = {
  bearingDeg: number | null;
  /** Texto bajo la brújula (ej. fuente del dato) */
  caption?: string;
  compact?: boolean;
};

export function CompassRose({ bearingDeg, caption, compact }: Props) {
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
      <div
        className="compass-dial"
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          border: "2px solid #334155",
          background: "radial-gradient(circle at 35% 30%, #243044, #151c28)",
          flexShrink: 0,
        }}
        aria-hidden
      >
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
                color: letter === "N" ? "#f87171" : "var(--muted)",
              }}
            >
              {letter}
            </span>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 4,
            height: size * 0.38,
            marginLeft: -2,
            marginTop: -size * 0.38,
            background: "linear-gradient(180deg, #3d8bfd, #1e4a8a)",
            borderRadius: 2,
            transformOrigin: "50% 100%",
            /** Sin dato no rotamos a 0° (eso parece “mirando al norte”); ocultamos la aguja. */
            transform: deg != null ? `rotate(${deg}deg)` : "rotate(0deg)",
            opacity: deg != null ? 1 : 0,
            visibility: deg != null ? "visible" : "hidden",
            transition: "transform 0.35s ease-out, opacity 0.2s",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 10,
            height: 10,
            marginLeft: -5,
            marginTop: -5,
            borderRadius: "50%",
            background: "#e7ecf3",
            border: "2px solid #1a2332",
          }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: compact ? "0.95rem" : "1.05rem" }}>{label}</div>
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          {deg != null ? `${deg.toFixed(0)}° respecto al norte` : "Sin rumbo aún"}
        </div>
        {caption ? (
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
            {caption}
          </div>
        ) : null}
      </div>
    </div>
  );
}
