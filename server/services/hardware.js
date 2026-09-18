/**
 * Hardware integration layer.
 *
 * Everything hardware-specific lives behind these adapters, and every path here
 * talks to a real device or fails. Nothing is simulated.
 *
 * To connect a printer, register a device (RFID → Devices) with driver
 * `zebra_zpl_tcp`, host = the printer's IP, port = 9100 — or `http_agent` with
 * a URL when the printer is only reachable on the shop LAN. The ZPL this file
 * builds is the real command stream either way; it can be inspected on screen
 * before a printer exists, but it is never reported as printed unless a device
 * accepted it.
 */
import net from 'net';

/* ------------------------------------------------------------------ */
/*  Zebra print + encode                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the ZPL that prints a label AND encodes the RFID inlay.
 *  ^RS8            — select EPC Gen2 / 96-bit
 *  ^RFW,H          — write hex data to the tag
 *  ^RFR,H + ^FN0   — read back for verification
 */
export function buildZpl({
  epc,
  readable,
  productName = '',
  variantLabel = '',
  sku = '',
  price = '',
  currency = '',
  copies = 1,
  labelWidthDots = 609,   // 3" @ 203dpi
  labelHeightDots = 406,  // 2" @ 203dpi
}) {
  const esc = (s) => String(s).replace(/[\^~]/g, ' ').slice(0, 40);
  return [
    '^XA',
    `^PW${labelWidthDots}`,
    `^LL${labelHeightDots}`,
    '^LH0,0',
    '^MTT',                       // thermal transfer
    '^RS8,,,3',                   // Gen2, 3 write retries
    `^RFW,H,1,2,1^FD${epc}^FS`,   // ENCODE the unique EPC into the tag
    '^RFR,H,1,2,1^FN0^FS',        // read back
    `^FO20,20^A0N,34,34^FD${esc(productName)}^FS`,
    `^FO20,62^A0N,28,28^FD${esc(variantLabel)}^FS`,
    `^FO20,100^A0N,26,26^FD${esc(sku)}^FS`,
    price !== '' ? `^FO20,134^A0N,40,40^FD${esc(currency)}${esc(price)}^FS` : '',
    `^FO20,190^BY2^BCN,90,Y,N,N^FD${esc(readable)}^FS`,
    `^FO20,330^A0N,22,22^FDEPC: ${epc}^FS`,
    `^PQ${Math.max(1, Number(copies) || 1)}`,
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Send ZPL to a device.
 *
 * There is no simulation path. If no printer is configured, or the configured
 * driver cannot reach one, this THROWS. An earlier version returned a cheerful
 * "simulated" success with nothing on the wire, which meant a unit could be
 * marked as tagged when no label existed — the worst possible lie for a stock
 * system to tell, because you only discover it when the shelf and the screen
 * disagree months later.
 *
 * @returns {Promise<{status:'sent', transport:string, detail:string}>}
 */
export function sendToPrinter(device, zpl) {
  if (!device) {
    return Promise.reject(new Error(
      'No printer is configured. Add one under RFID → Devices, or bind pre-encoded '
      + 'labels with RFID → Tag stock instead.'));
  }
  const driver = device.driver;

  if (driver === 'zebra_zpl_tcp') {
    return new Promise((resolve, reject) => {
      const host = device.host;
      const port = Number(device.port) || 9100;
      if (!host) return reject(new Error('Printer host not configured'));
      const socket = new net.Socket();
      const timeout = Number(device.config?.timeout_ms) || 8000;
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn(arg);
      };
      socket.setTimeout(timeout);
      socket.on('timeout', () => finish(reject, new Error(`Printer ${host}:${port} timed out`)));
      socket.on('error', (err) => finish(reject, err));
      socket.connect(port, host, () => {
        socket.write(zpl, 'ascii', () => {
          finish(resolve, {
            status: 'sent',
            transport: `tcp://${host}:${port}`,
            detail: `${zpl.length} bytes written`,
          });
        });
      });
    });
  }

  if (driver === 'http_agent') {
    // For a printer reachable only from the shop LAN via a small local agent.
    const url = device.config?.url;
    if (!url) return Promise.reject(new Error('http_agent device needs config.url'));
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        ...(device.config?.token ? { Authorization: `Bearer ${device.config.token}` } : {}),
      },
      body: zpl,
    }).then((r) => {
      if (!r.ok) throw new Error(`Print agent responded ${r.status}`);
      return { status: 'sent', transport: url, detail: 'forwarded via print agent' };
    });
  }

  return Promise.reject(new Error(`Unsupported printer driver: ${driver}`));
}

/* ------------------------------------------------------------------ */
/*  Handheld UHF reader                                                */
/* ------------------------------------------------------------------ */

/**
 * A real handheld (Zebra RFD40, Chainway C72, etc.) posts its reads to
 * POST /api/rfid/scan-events as {epcs:[...], device_key, context}.
 * This normalises the several shapes those SDKs use.
 */
export function parseReaderPayload(body) {
  const out = [];
  const push = (epc, rssi) => {
    if (epc) out.push({ epc: String(epc), rssi: rssi ?? null });
  };

  if (Array.isArray(body?.epcs)) {
    body.epcs.forEach((e) =>
      typeof e === 'string' ? push(e) : push(e?.epc || e?.EPC || e?.tagId, e?.rssi ?? e?.RSSI)
    );
  }
  if (Array.isArray(body?.tags)) {
    body.tags.forEach((t) => push(t?.epc || t?.EPC || t?.tagId || t?.id, t?.rssi ?? t?.RSSI));
  }
  if (typeof body?.epc === 'string') push(body.epc, body.rssi);
  if (typeof body?.data === 'string') {
    body.data.split(/[\s,;\n\r]+/).forEach((s) => push(s));
  }
  return out;
}
