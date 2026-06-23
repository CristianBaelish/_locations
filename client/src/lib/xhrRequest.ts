/**
 * XHR permite saber cuándo llegan las cabeceras HTTP (readyState ≥ 2), antes de leer el cuerpo.
 * Así distinguimos “sigue sin haber respuesta del servidor” vs “el servidor ya contestó algo”.
 */
export type XhrResult = { ok: boolean; status: number; text: string };

export function xhrGet(
  url: string,
  timeoutMs: number,
  onHeadersReceived: () => void = () => {}
): Promise<XhrResult> {
  return xhrRequest("GET", url, null, timeoutMs, onHeadersReceived);
}

export function xhrPost(
  url: string,
  timeoutMs: number,
  onHeadersReceived: () => void = () => {}
): Promise<XhrResult> {
  return xhrRequest("POST", url, null, timeoutMs, onHeadersReceived);
}

function xhrRequest(
  method: "GET" | "POST",
  url: string,
  body: string | null,
  timeoutMs: number,
  onHeadersReceived: () => void
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let headersNotified = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };

    const timer = window.setTimeout(() => {
      xhr.abort();
      finish(() => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
    }, timeoutMs);

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && !headersNotified) {
        headersNotified = true;
        try {
          onHeadersReceived();
        } catch {
          /* no bloquear el flujo */
        }
      }
    };

    xhr.onload = () => {
      finish(() =>
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: xhr.responseText ?? "",
        })
      );
    };

    xhr.onerror = () => {
      finish(() => reject(new Error("Error de red (no se pudo completar la petición).")));
    };

    xhr.onabort = () => {
      finish(() => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
    };

    xhr.open(method, url);
    if (method === "POST") {
      xhr.setRequestHeader("Accept", "application/json");
    }
    xhr.send(body);
  });
}
