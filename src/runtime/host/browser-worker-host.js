import { createNetworkPolicy, fetchUrlWithPolicy } from "./network-fetch.js";

export class BrowserWorkerHost {
  constructor({ fs, env = {}, cwd = "/home/user", postMessage, fetchImpl = globalThis.fetch, networkPolicy } = {}) {
    this.fs = fs;
    this.env = { ...env };
    this.currentDirectory = cwd;
    this.postMessage = postMessage;
    this.textDecoder = new TextDecoder();
    this.fetchImpl = fetchImpl;
    this.networkPolicy = networkPolicy ?? createNetworkPolicy();
  }

  wallNowMs() {
    return Date.now();
  }

  monotonicNowMs() {
    return Math.floor(performance.now());
  }

  randomBytes(length) {
    const bytes = new Uint8Array(length);
    self.crypto.getRandomValues(bytes);
    return bytes;
  }

  getenv(name) {
    return this.env[name];
  }

  environ() {
    return Object.entries(this.env).map(([name, value]) => ({ name, value }));
  }

  cwd() {
    return this.currentDirectory;
  }

  setCwd(path) {
    this.fs.stat(path);
    this.currentDirectory = path;
  }

  stdout(bytes) {
    const text = typeof bytes === "string" ? bytes : this.textDecoder.decode(bytes);
    this.postMessage({ type: "stdout", text });
  }

  stderr(bytes) {
    const text = typeof bytes === "string" ? bytes : this.textDecoder.decode(bytes);
    this.postMessage({ type: "stderr", text });
  }

  debugLog(level, message) {
    this.postMessage({ type: "debug-log", level, message });
  }

  processUnavailable() {
    return "host.process is unavailable in the browser MVP";
  }

  async fetchUrl(request) {
    return fetchUrlWithPolicy(request, {
      fetchImpl: this.fetchImpl,
      policy: this.networkPolicy,
    });
  }
}
