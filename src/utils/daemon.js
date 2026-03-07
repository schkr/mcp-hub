/**
 * Daemon helpers: spawn hub in background, stop by port, status.
 * PID and log files live in getRuntimeDirectory() (e.g. ~/.cache/mcp-hub).
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { getRuntimeDirectory } from "./xdg-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "cli.js");

const LOG_ROTATE_BYTES = 5 * 1024 * 1024; // 5MB

function getPidPath(port) {
  return path.join(getRuntimeDirectory(), `mcp-hub-${port}.pid`);
}

function getLogPath(port) {
  return path.join(getRuntimeDirectory(), `mcp-hub-${port}.log`);
}

/**
 * Ensure runtime directory exists.
 */
export function ensureRuntimeDir() {
  const dir = getRuntimeDirectory();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Spawn hub as a detached background process. Writes PID file and rotates log if >5MB.
 * @param {number} port
 * @param {string} configPath - Absolute path to one config file
 * @param {string} logLevel
 * @returns {Promise<void>}
 */
export function spawnDaemon(port, configPath, logLevel = "error") {
  ensureRuntimeDir();
  const pidPath = getPidPath(port);
  const logPath = getLogPath(port);

  if (fs.existsSync(pidPath)) {
    const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
    try {
      process.kill(pid, 0);
      return Promise.reject(new Error(`Already running (PID ${pid}, port ${port})`));
    } catch {
      fs.unlinkSync(pidPath);
    }
  }

  if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath);
    if (stat.size > LOG_ROTATE_BYTES) {
      fs.renameSync(logPath, `${logPath}.old`);
    }
  }

  const logFd = fs.openSync(logPath, "a");

  const child = spawn(
    process.execPath,
    [CLI_PATH, "--port", String(port), "--config", configPath, "--log-level", logLevel],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, MCP_HUB_LOG_LEVEL: logLevel },
      cwd: process.cwd(),
    }
  );

  fs.closeSync(logFd);
  child.unref();

  fs.writeFileSync(pidPath, String(child.pid), "utf8");
  return Promise.resolve();
}

/**
 * Stop daemon by port. Removes PID file.
 * @param {number} port
 */
export function stopDaemon(port) {
  const pidPath = getPidPath(port);
  if (!fs.existsSync(pidPath)) {
    return { stopped: false, message: `not running (port ${port})` };
  }
  const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isInteger(pid)) {
    fs.unlinkSync(pidPath);
    return { stopped: false, message: `stale PID file (port ${port})` };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    if (e.code === "ESRCH") {
      fs.unlinkSync(pidPath);
      return { stopped: false, message: `stale PID file (port ${port})` };
    }
    throw e;
  }
  fs.unlinkSync(pidPath);
  return { stopped: true, pid, port };
}

/**
 * Status for one port: 'running' | 'not running' | 'stale'
 */
export function statusDaemon(port) {
  const pidPath = getPidPath(port);
  if (!fs.existsSync(pidPath)) return { status: "not running", port };
  const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isInteger(pid)) {
    fs.unlinkSync(pidPath);
    return { status: "not running", port };
  }
  try {
    process.kill(pid, 0);
    return { status: "running", pid, port };
  } catch {
    fs.unlinkSync(pidPath);
    return { status: "stale", port };
  }
}

/**
 * Load instances manifest. Config paths resolved relative to manifest directory.
 * @param {string} manifestPath - Path to instances.json
 * @returns {{ name: string, port: number, config: string }[]}
 */
export function loadInstances(manifestPath) {
  const absPath = path.resolve(manifestPath);
  const dir = path.dirname(absPath);
  const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  const list = Array.isArray(raw.instances) ? raw.instances : [];
  return list.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`Invalid instance at index ${index}: expected an object.`);
    }
    const portNum = Number(entry.port);
    if (!Number.isInteger(portNum) || portNum <= 0) {
      throw new Error(`Invalid or missing "port" for instance at index ${index}: got ${entry.port}`);
    }
    const cfg = entry.config;
    if (typeof cfg !== "string" || cfg.trim() === "") {
      throw new Error(`Invalid or missing "config" for instance at index ${index}: expected non-empty string.`);
    }
    const configRel = cfg.trim();
    const configAbs = path.isAbsolute(configRel) ? configRel : path.join(dir, configRel);
    const name =
      typeof entry.name === "string" && entry.name.trim() !== ""
        ? entry.name.trim()
        : String(portNum);
    return {
      name,
      port: portNum,
      config: configAbs,
    };
  });
}
