import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";

// Use a unique temp dir per test run to avoid touching real runtime dir
const testRuntimeDir = path.join(os.tmpdir(), `mcp-hub-daemon-test-${Date.now()}`);

vi.mock("../src/utils/xdg-paths.js", () => ({
  getRuntimeDirectory: () => testRuntimeDir,
}));

const mockKill = vi.fn();
process.kill = mockKill;

describe("daemon", () => {
  beforeEach(() => {
    vi.resetModules();
    mockKill.mockReset();
    if (fs.existsSync(testRuntimeDir)) {
      fs.rmSync(testRuntimeDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testRuntimeDir)) {
      fs.rmSync(testRuntimeDir, { recursive: true });
    }
  });

  describe("ensureRuntimeDir", () => {
    it("creates runtime directory if it does not exist", async () => {
      const { ensureRuntimeDir } = await import("../src/utils/daemon.js");
      expect(fs.existsSync(testRuntimeDir)).toBe(false);
      const dir = ensureRuntimeDir();
      expect(dir).toBe(testRuntimeDir);
      expect(fs.existsSync(testRuntimeDir)).toBe(true);
    });

    it("returns existing directory without error", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const { ensureRuntimeDir } = await import("../src/utils/daemon.js");
      const dir = ensureRuntimeDir();
      expect(dir).toBe(testRuntimeDir);
    });
  });

  describe("loadInstances", () => {
    it("loads valid manifest and resolves config paths relative to manifest dir", async () => {
      const manifestDir = path.join(os.tmpdir(), `instances-${Date.now()}`);
      fs.mkdirSync(manifestDir, { recursive: true });
      const manifestPath = path.join(manifestDir, "instances.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          instances: [
            { name: "aws", port: 37373, config: "mcp-hub-aws.json" },
            { name: "dev", port: 37374, config: "/absolute/config.json" },
          ],
        }),
        "utf8"
      );
      const { loadInstances } = await import("../src/utils/daemon.js");
      const list = loadInstances(manifestPath);
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual({
        name: "aws",
        port: 37373,
        config: path.join(manifestDir, "mcp-hub-aws.json"),
      });
      expect(list[1]).toEqual({
        name: "dev",
        port: 37374,
        config: "/absolute/config.json",
      });
      fs.rmSync(manifestDir, { recursive: true });
    });

    it("throws when instance entry is not an object", async () => {
      const manifestPath = path.join(testRuntimeDir, "bad.json");
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ instances: [null, 42] }),
        "utf8"
      );
      const { loadInstances } = await import("../src/utils/daemon.js");
      expect(() => loadInstances(manifestPath)).toThrow(/Invalid instance at index 0/);
      expect(() => loadInstances(manifestPath)).toThrow(/expected an object/);
    });

    it("throws when port is missing or invalid", async () => {
      const manifestPath = path.join(testRuntimeDir, "bad-port.json");
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ instances: [{ name: "x", config: "c.json" }] }),
        "utf8"
      );
      const { loadInstances } = await import("../src/utils/daemon.js");
      expect(() => loadInstances(manifestPath)).toThrow(/Invalid or missing "port"/);
    });

    it("throws when config is missing or empty", async () => {
      const manifestPath = path.join(testRuntimeDir, "bad-config.json");
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ instances: [{ name: "x", port: 3000 }] }),
        "utf8"
      );
      const { loadInstances } = await import("../src/utils/daemon.js");
      expect(() => loadInstances(manifestPath)).toThrow(/Invalid or missing "config"/);
    });

    it("returns empty array when instances is missing", async () => {
      const manifestPath = path.join(testRuntimeDir, "empty.json");
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify({}), "utf8");
      const { loadInstances } = await import("../src/utils/daemon.js");
      expect(loadInstances(manifestPath)).toEqual([]);
    });
  });

  describe("statusDaemon", () => {
    it("returns not running when no PID file exists", async () => {
      const { statusDaemon } = await import("../src/utils/daemon.js");
      const result = statusDaemon(39999);
      expect(result).toEqual({ status: "not running", port: 39999 });
    });

    it("returns running when PID file exists and process is alive", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const pidPath = path.join(testRuntimeDir, "mcp-hub-39998.pid");
      fs.writeFileSync(pidPath, "12345", "utf8");
      mockKill.mockReturnValue(undefined);

      const { statusDaemon } = await import("../src/utils/daemon.js");
      const result = statusDaemon(39998);
      expect(result).toEqual({ status: "running", pid: 12345, port: 39998 });
      expect(mockKill).toHaveBeenCalledWith(12345, 0);
    });

    it("returns stale and removes PID file when process does not exist", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const pidPath = path.join(testRuntimeDir, "mcp-hub-39997.pid");
      fs.writeFileSync(pidPath, "99999", "utf8");
      mockKill.mockImplementation(() => {
        const e = new Error("No such process");
        e.code = "ESRCH";
        throw e;
      });

      const { statusDaemon } = await import("../src/utils/daemon.js");
      const result = statusDaemon(39997);
      expect(result).toEqual({ status: "stale", port: 39997 });
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  describe("stopDaemon", () => {
    it("returns not running when no PID file exists", async () => {
      const { stopDaemon } = await import("../src/utils/daemon.js");
      const result = stopDaemon(39996);
      expect(result).toEqual({ stopped: false, message: "not running (port 39996)" });
    });

    it("returns stale when PID file contains non-integer and removes file", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const pidPath = path.join(testRuntimeDir, "mcp-hub-39995.pid");
      fs.writeFileSync(pidPath, "not-a-number", "utf8");

      const { stopDaemon } = await import("../src/utils/daemon.js");
      const result = stopDaemon(39995);
      expect(result).toEqual({ stopped: false, message: "stale PID file (port 39995)" });
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("returns stopped: false with stale message when process already dead (ESRCH)", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const pidPath = path.join(testRuntimeDir, "mcp-hub-39994.pid");
      fs.writeFileSync(pidPath, "88888", "utf8");
      mockKill.mockImplementation(() => {
        const e = new Error("No such process");
        e.code = "ESRCH";
        throw e;
      });

      const { stopDaemon } = await import("../src/utils/daemon.js");
      const result = stopDaemon(39994);
      expect(result).toEqual({ stopped: false, message: "stale PID file (port 39994)" });
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("returns stopped: true and removes PID file when SIGTERM succeeds", async () => {
      fs.mkdirSync(testRuntimeDir, { recursive: true });
      const pidPath = path.join(testRuntimeDir, "mcp-hub-39993.pid");
      fs.writeFileSync(pidPath, "77777", "utf8");
      mockKill.mockReturnValue(undefined);

      const { stopDaemon } = await import("../src/utils/daemon.js");
      const result = stopDaemon(39993);
      expect(result).toEqual({ stopped: true, pid: 77777, port: 39993 });
      expect(mockKill).toHaveBeenCalledWith(77777, "SIGTERM");
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });
});
