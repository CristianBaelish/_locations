import { describe, expect, it } from "vitest";
import { resolveSocketServerOrigin } from "./apiBase";

const DEFAULT_BACKEND = "https://locationsbaelish.onrender.com";

describe("resolveSocketServerOrigin", () => {
  it("uses explicit backend overrides first", () => {
    expect(
      resolveSocketServerOrigin({
        explicitOrigin: "https://api.example.com",
        defaultBackend: DEFAULT_BACKEND,
        isDev: false,
        builtOnVercel: false,
        hostname: "live-street-pov.onrender.com",
      })
    ).toBe("https://api.example.com");
  });

  it("keeps local development sockets on the current origin", () => {
    expect(
      resolveSocketServerOrigin({
        defaultBackend: DEFAULT_BACKEND,
        isDev: true,
        builtOnVercel: true,
        hostname: "localhost",
      })
    ).toBeUndefined();
  });

  it("sends Vercel production sockets directly to Render", () => {
    expect(
      resolveSocketServerOrigin({
        defaultBackend: DEFAULT_BACKEND,
        isDev: false,
        builtOnVercel: true,
        hostname: "locationspov.vercel.app",
      })
    ).toBe(DEFAULT_BACKEND);
  });

  it("keeps non-Vercel production builds on the current origin", () => {
    expect(
      resolveSocketServerOrigin({
        defaultBackend: DEFAULT_BACKEND,
        isDev: false,
        builtOnVercel: false,
        hostname: "live-street-pov.onrender.com",
      })
    ).toBeUndefined();
  });
});
