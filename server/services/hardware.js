/**
 * Hardware integration layer.
 *
 * Everything hardware-specific lives behind these two adapters. Today the
 * system runs in `mock` mode: the exact ZPL that WOULD be sent to a Zebra
 * ZD500R is generated, stored and shown on screen, but nothing is transmitted.
 *
 * To go live with real hardware, nothing in the app changes — you only register
 * a device row (Settings → Devices) with driver `zebra_zpl_tcp`, host = printer
 * IP, port = 9100. The same ZPL then goes down a TCP socket instead.
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
 * @returns {Promise<{status:'simulated'|'sent', transport:string, detail:string}>}
 */
export function sendToPrinter(device, zpl) {
  const driver = device?.driver || 'mock';

  if (driver === 'mock' || !device) {
    return Promise.resolve({
      status: 'simulated',
      transport: 'mock',
      detail:
        'Mock mode — ZPL generated and stored but not transmitted. Register a device with driver "zebra_zpl_tcp" to print for real.',
    });
  }

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

/** Simulated reads for demos/tests — mimics a sweep picking up tags twice. */
export function simulateSweep(epcs, { duplicateRate = 0.25 } = {}) {
  const reads = [];
  for (const epc of epcs) {
    reads.push({ epc, rssi: -(40 + Math.floor(Math.random() * 30)) });
    if (Math.random() < duplicateRate) {
      reads.push({ epc, rssi: -(40 + Math.floor(Math.random() * 30)) });
    }
  }
  return reads.sort(() => Math.random() - 0.5);
}
