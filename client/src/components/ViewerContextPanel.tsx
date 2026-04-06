import { useSharerContext } from "../hooks/useSharerContext";
import { useViewerDistanceKm } from "../hooks/useViewerDistanceKm";
import type { LatLng } from "./StreetFollowView";
import { WeatherIcon } from "./WeatherIcon";
import { ClockIcon, DistanceIcon } from "./ContextIcons";

type Props = {
  sharerPos: LatLng | null;
};

export function ViewerContextPanel({ sharerPos }: Props) {
  const { data, loading, error } = useSharerContext(sharerPos);
  const { km, error: distErr, refresh } = useViewerDistanceKm(sharerPos);

  if (!sharerPos) return null;

  return (
    <div className="card viewer-context" style={{ marginBottom: "1rem" }}>
      <h2 style={{ fontSize: "0.95rem", marginTop: 0, marginBottom: "0.85rem" }}>
        Contexto en su ubicación
      </h2>
      <div className="context-tiles">
        <div className="context-tile">
          <span className="context-tile-icon" style={{ color: "var(--muted)" }}>
            <ClockIcon size={24} />
          </span>
          <div className="context-tile-body">
            <div className="context-tile-label">Hora local</div>
            {loading && !data ? (
              <div className="context-tile-value muted">…</div>
            ) : data ? (
              <>
                <div className="context-tile-value">{data.localTimeLabel}</div>
                <div className="context-tile-sub muted">{data.timezone}</div>
              </>
            ) : (
              <div className="context-tile-value muted">{error ?? "—"}</div>
            )}
          </div>
        </div>

        <div className="context-tile context-tile--weather">
          <span className="context-tile-icon context-tile-icon--weather">
            {loading && !data ? (
              <span className="muted" style={{ fontSize: "1.5rem" }}>
                …
              </span>
            ) : data ? (
              <WeatherIcon weatherCode={data.weatherCode} isDay={data.isDay} size={48} />
            ) : (
              <span className="muted">—</span>
            )}
          </span>
          <div className="context-tile-body">
            <div className="context-tile-label">Clima</div>
            {data ? (
              <>
                <div className="context-tile-value">{data.weatherLabel}</div>
                <div className="context-tile-sub muted">
                  {data.temperatureC.toFixed(1)} °C
                  {data.apparentC != null ? ` · sensación ${data.apparentC.toFixed(1)} °C` : ""}
                </div>
              </>
            ) : (
              <div className="context-tile-value muted">{error ?? "—"}</div>
            )}
          </div>
        </div>

        <div className="context-tile">
          <span className="context-tile-icon" style={{ color: "var(--muted)" }}>
            <DistanceIcon size={24} />
          </span>
          <div className="context-tile-body">
            <div className="context-tile-label">Distancia hasta vos</div>
            {km != null ? (
              <div className="context-tile-value">
                {km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`}
                <span className="muted" style={{ fontWeight: 400, fontSize: "0.85em" }}>
                  {" "}
                  en línea recta
                </span>
              </div>
            ) : (
              <div className="context-tile-value muted">{distErr ?? "Calculando…"}</div>
            )}
            <button
              type="button"
              className="secondary context-tile-btn"
              onClick={refresh}
            >
              Actualizar distancia
            </button>
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 0, marginTop: "0.85rem" }}>
        Clima y hora (aprox.) por Open-Meteo. La distancia pide permiso de ubicación en este teléfono.
      </p>
    </div>
  );
}
