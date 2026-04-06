/** Open-Meteo sin API key; CORS permitido desde el navegador. */

export type SharerWeatherContext = {
  temperatureC: number;
  apparentC: number | null;
  weatherLabel: string;
  weatherCode: number;
  isDay: boolean;
  localTimeLabel: string;
  timezone: string;
};

function wmoCodeToEs(code: number): string {
  if (code === 0) return "Despejado";
  if (code === 1) return "Mayormente despejado";
  if (code === 2) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if (code === 45 || code === 48) return "Niebla";
  if (code >= 51 && code <= 57) return "Llovizna";
  if (code >= 61 && code <= 67) return "Lluvia";
  if (code >= 71 && code <= 77) return "Nieve";
  if (code >= 80 && code <= 82) return "Chubascos";
  if (code >= 85 && code <= 86) return "Chubascos de nieve";
  if (code >= 95 && code <= 99) return "Tormenta";
  return "Condición desconocida";
}

export async function fetchSharerWeatherContext(lat: number, lng: number): Promise<SharerWeatherContext> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,is_day");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

  const j = (await res.json()) as {
    timezone?: string;
    current?: {
      time?: string;
      temperature_2m?: number;
      apparent_temperature?: number;
      weather_code?: number;
      is_day?: number;
    };
  };

  const tz = j.timezone ?? "—";
  const cur = j.current;
  if (typeof cur?.temperature_2m !== "number") {
    throw new Error("Sin datos meteorológicos");
  }

  const code = typeof cur.weather_code === "number" ? cur.weather_code : -1;
  const time = cur.time ?? "—";
  const apparent =
    typeof cur.apparent_temperature === "number" ? cur.apparent_temperature : null;
  const isDay = cur.is_day === 1;

  return {
    temperatureC: cur.temperature_2m,
    apparentC: apparent,
    weatherLabel: wmoCodeToEs(code),
    weatherCode: code,
    isDay,
    localTimeLabel: time,
    timezone: tz,
  };
}
