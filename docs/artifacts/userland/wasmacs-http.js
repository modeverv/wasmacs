/* Synchronous side of process HTTP. The page owns fetch and its callbacks;
 * the cooperative kernel only polls shared state. No promise/timer/callback
 * in this file may retain a process instance. Each request owns its SAB, so a
 * late reply after cancellation can never complete a different request. */
(function (root) {
  'use strict';
  const MAX_BYTES = 25 * 1024 * 1024;
  const RESPONSE_BYTES = Math.ceil(MAX_BYTES / 3) * 4 + 256 * 1024;
  function createClient({ postMessage, wakeSAB, now = () => Date.now(), timeoutMs = 30000 }) {
    let sequence = 0;
    const clientId = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    return function start(request) {
      const requestId = `process-http-${clientId}-${++sequence}`;
      let responseSAB = new SharedArrayBuffer(16 + RESPONSE_BYTES);
      let signal = new Int32Array(responseSAB, 0, 4);
      const deadline = now() + timeoutMs;
      Atomics.store(signal, 0, 1);
      postMessage({ type: 'host-network-fetch', requestId, wakeSAB, responseSAB,
        requestJson: JSON.stringify({ ...request, processHttp: true, timeoutMs }) });
      function cancel() {
        if (!signal) return;
        if (Atomics.compareExchange(signal, 0, 1, 3) === 1) {
          postMessage({ type: 'host-network-cancel', requestId });
        }
        signal = null;
        responseSAB = null;
      }
      return {
        cancel,
        poll() {
          if (!signal) return { error: 'HTTP request was already released' };
          if (Atomics.load(signal, 0) !== 2) {
            if (now() < deadline) return null;
            cancel();
            return { error: 'HTTP request timed out' };
          }
          const length = Atomics.load(signal, 1);
          let result;
          try {
            if (length <= 0 || length > RESPONSE_BYTES) throw new Error('Invalid HTTP relay length');
            // Browser TextDecoder does not accept a SharedArrayBuffer view.
            const bytes = new Uint8Array(new Uint8Array(responseSAB, 16, length));
            result = JSON.parse(new TextDecoder().decode(bytes));
          } catch (_) {
            result = { error: 'Invalid HTTP relay response' };
          }
          signal = null;
          responseSAB = null;
          return result;
        },
      };
    };
  }
  root.WasmacsHttp = { createClient, MAX_BYTES, RESPONSE_BYTES };
})(globalThis);
