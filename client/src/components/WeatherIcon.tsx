type Props = {
  weatherCode: number;
  isDay: boolean;
  size?: number;
};

const stroke = "currentColor";
const fillSun = "#fbbf24";
const fillMoon = "#94a3b8";
const fillCloud = "#94a3b8";
const fillRain = "#3d8bfd";

/** Icono simple según código WMO (Open-Meteo). */
export function WeatherIcon({ weatherCode, isDay, size = 40 }: Props) {
  const s = size;

  if (weatherCode === 0) {
    return isDay ? (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="24" r="10" fill={fillSun} stroke={stroke} strokeWidth="1.2" opacity="0.95" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1="24"
            y1="4"
            x2="24"
            y2="9"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${deg} 24 24)`}
          />
        ))}
      </svg>
    ) : (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <path
          d="M28 14a9 9 0 1 0 9 14 7 7 0 0 1-9-14z"
          fill={fillMoon}
          stroke={stroke}
          strokeWidth="1.2"
        />
        <circle cx="14" cy="22" r="2" fill={fillMoon} opacity="0.5" />
      </svg>
    );
  }

  if (weatherCode === 1 || weatherCode === 2) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        {isDay ? (
          <circle cx="18" cy="18" r="8" fill={fillSun} stroke={stroke} strokeWidth="1" />
        ) : null}
        <path
          d="M14 32c0-5 4-9 10-9s10 4 10 9H14z"
          fill={fillCloud}
          stroke={stroke}
          strokeWidth="1.2"
          transform="translate(4 -2)"
        />
      </svg>
    );
  }

  if (weatherCode === 3) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="26" rx="16" ry="10" fill={fillCloud} stroke={stroke} strokeWidth="1.2" />
        <ellipse cx="16" cy="24" rx="10" ry="7" fill={fillCloud} opacity="0.85" />
      </svg>
    );
  }

  if (weatherCode === 45 || weatherCode === 48) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <path
          d="M8 28h32M12 32h24M10 36h28"
          stroke={fillCloud}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.7"
        />
        <ellipse cx="24" cy="22" rx="14" ry="9" fill={fillCloud} stroke={stroke} strokeWidth="1" />
      </svg>
    );
  }

  if (weatherCode >= 51 && weatherCode <= 57) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="20" rx="14" ry="9" fill={fillCloud} stroke={stroke} strokeWidth="1" />
        {[16, 24, 32].map((x, i) => (
          <line key={i} x1={x} y1="30" x2={x - 2} y2="38" stroke={fillRain} strokeWidth="2" strokeLinecap="round" />
        ))}
      </svg>
    );
  }

  if (
    (weatherCode >= 61 && weatherCode <= 67) ||
    (weatherCode >= 80 && weatherCode <= 82)
  ) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="18" rx="15" ry="9" fill={fillCloud} stroke={stroke} strokeWidth="1" />
        {[14, 22, 30].map((x, i) => (
          <line key={i} x1={x} y1="28" x2={x - 3} y2="40" stroke={fillRain} strokeWidth="2.2" strokeLinecap="round" />
        ))}
      </svg>
    );
  }

  if ((weatherCode >= 71 && weatherCode <= 77) || (weatherCode >= 85 && weatherCode <= 86)) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="18" rx="15" ry="9" fill={fillCloud} stroke={stroke} strokeWidth="1" />
        {[18, 24, 30].map((x, i) => (
          <circle key={i} cx={x} cy={34 + (i % 2) * 2} r="2" fill="#e2e8f0" opacity="0.9" />
        ))}
      </svg>
    );
  }

  if (weatherCode >= 95) {
    return (
      <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="18" rx="15" ry="9" fill="#475569" stroke={stroke} strokeWidth="1" />
        <path d="M20 28 L24 36 L28 28" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r="12" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
      <text x="24" y="29" textAnchor="middle" fontSize="12" fill="currentColor">
        ?
      </text>
    </svg>
  );
}
