import { randomBytes } from "node:crypto";

export class CoreHost {
  constructor({ fs, env = {}, cwd = "/home/user" }) {
    this.fs = fs;
    this.env = { ...env };
    this.currentDirectory = cwd;
    this.stdoutChunks = [];
    this.stderrChunks = [];
    this.debugLogs = [];
  }

  wallNowMs() {
    return Date.now();
  }

  monotonicNowMs() {
    return Math.floor(performance.now());
  }

  randomBytes(length) {
    return randomBytes(length);
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
    this.stdoutChunks.push(Buffer.from(bytes));
  }

  stderr(bytes) {
    this.stderrChunks.push(Buffer.from(bytes));
  }

  debugLog(level, message) {
    this.debugLogs.push({ level, message });
  }

  processUnavailable() {
    return "host.process is unavailable in the MVP";
  }
}
