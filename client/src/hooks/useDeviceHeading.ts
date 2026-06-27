import { useCallback, useEffect, useRef, useState } from "react";

type DeviceOrientationWithWebkit = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

function deviceOrientationWithPermission(): DeviceOrientationWithPermission {
  return DeviceOrientationEvent as unknown as DeviceOrientationWithPermission;
}

function readHeading(e: DeviceOrientationEvent): number | null {
  const webkit = (e as DeviceOrientationWithWebkit).webkitCompassHeading;
  if (webkit != null && Number.isFinite(webkit)) {
    return (webkit + 360) % 360;
  }
  if (e.absolute && e.alpha != null && Number.isFinite(e.alpha)) {
    return (360 - e.alpha + 360) % 360;
  }
  return null;
}

function iosNeedsPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== "undefined" &&
    "requestPermission" in DeviceOrientationEvent &&
    typeof deviceOrientationWithPermission().requestPermission === "function"
  );
}

export function useDeviceHeading(): {
  heading: number | null;
  needsPermission: boolean;
  requestPermission: () => Promise<boolean>;
} {
  const [heading, setHeading] = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const needsPermission = iosNeedsPermission() && !permissionGranted;

  const handlerRef = useRef<(e: DeviceOrientationEvent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (e: DeviceOrientationEvent) => {
      const h = readHeading(e);
      if (h != null) setHeading(h);
    };
  });

  useEffect(() => {
    if (needsPermission) return;

    const handler = (e: DeviceOrientationEvent) => handlerRef.current(e);
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }, [needsPermission]);

  const requestPermission = useCallback(async () => {
    if (!iosNeedsPermission()) {
      setPermissionGranted(true);
      return true;
    }
    try {
      const result = await deviceOrientationWithPermission().requestPermission?.();
      const ok = result === "granted";
      setPermissionGranted(ok);
      return ok;
    } catch {
      return false;
    }
  }, []);

  return { heading, needsPermission, requestPermission };
}
