#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startServer } from "../server.js";
import logger from "./logger.js";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  spawnDaemon,
  stopDaemon,
  statusDaemon,
  loadInstances,
} from "./daemon.js";
import { getRuntimeDirectory } from "./xdg-paths.js";

// VERSION will be injected from package.json during build
/* global process.env.VERSION */

if (process.env.NODE_ENV != "production") {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const pkgPath = path.join(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  process.env.VERSION = pkg.version;
}

function defaultLogLevel() {
  const raw = process.env.MCP_HUB_LOG_LEVEL;
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return ["error", "warn", "info", "debug"].includes(normalized) ? normalized : "info";
}

function handleParseError(msg, err) {
  logger.error(
    "CLI_ARGS_ERROR",
    "Failed to parse command line arguments",
    {
      message: msg || "Missing required arguments",
      help: "Use --help to see usage information",
      error: err?.message,
    },
    true,
    1
  );
}

async function runForeground(argv) {
  const logLevel = argv.debug ? "debug" : argv["log-level"];
  await startServer({
    port: argv.port,
    config: argv.config,
    watch: argv.watch,
    autoShutdown: argv["auto-shutdown"],
    shutdownDelay: argv["shutdown-delay"],
    ...(typeof logLevel === "string" && logLevel.trim() !== "" ? { logLevel } : {}),
  });
}

async function runStart(argv) {
  const logLevel = argv.debug ? "debug" : (argv["log-level"] || defaultLogLevel());
  const target = (argv.target || "all").toString().toLowerCase();

  if (argv.instances) {
    const instances = loadInstances(argv.instances);
    const selected =
      target === "all" ? instances : instances.filter((i) => i.name.toLowerCase() === target);
    if (selected.length === 0) {
      console.error(`No instance(s) matching "${target}". Use: all, or one of: ${instances.map((i) => i.name).join(", ")}`);
      process.exit(1);
    }
    for (const inst of selected) {
      try {
        await spawnDaemon(inst.port, inst.config, logLevel);
        console.log(`mcp-hub: started (port ${inst.port}, ${inst.name})`);
      } catch (e) {
        if (e.message && e.message.startsWith("Already running")) {
          console.warn(`mcp-hub: already running (port ${inst.port}, ${inst.name}), skipping`);
        } else {
          console.error(`mcp-hub: ${e.message}`);
          process.exitCode = 1;
        }
      }
    }
    return;
  }

  if (argv.port == null || !argv.config || argv.config.length === 0) {
    console.error("Single-instance start requires --port and --config (or use --instances PATH)");
    process.exit(1);
  }
  const configPath = Array.isArray(argv.config) ? argv.config[0] : argv.config;
  try {
    await spawnDaemon(argv.port, configPath, logLevel);
    console.log(`mcp-hub: started (PID in ${getRuntimeDirectory()}, port ${argv.port})`);
  } catch (e) {
    if (e.message && e.message.startsWith("Already running")) {
      console.warn(`mcp-hub: already running (port ${argv.port}), skipping`);
    } else {
      console.error(`mcp-hub: ${e.message}`);
      process.exit(1);
    }
  }
}

function runStop(argv) {
  if (argv.instances) {
    const instances = loadInstances(argv.instances);
    const target = (argv.target || "all").toString().toLowerCase();
    const selected =
      target === "all" ? instances : instances.filter((i) => i.name.toLowerCase() === target);
    if (selected.length === 0) {
      console.error(`No instance(s) matching "${target}". Use: all, or one of: ${instances.map((i) => i.name).join(", ")}`);
      process.exit(1);
    }
    for (const inst of selected) {
      const result = stopDaemon(inst.port);
      if (result.stopped) {
        console.log(`mcp-hub: stopped (PID ${result.pid}, port ${result.port}, ${inst.name})`);
      } else {
        console.log(`mcp-hub: ${result.message}`);
      }
    }
    return;
  }

  if (argv.port == null) {
    console.error("Single-instance stop requires --port (or use --instances PATH)");
    process.exit(1);
  }
  const result = stopDaemon(argv.port);
  if (result.stopped) {
    console.log(`mcp-hub: stopped (PID ${result.pid}, port ${result.port})`);
  } else {
    console.log(`mcp-hub: ${result.message}`);
  }
}

function runStatusSync(argv) {
  if (argv.instances) {
    const instances = loadInstances(argv.instances);
    for (const inst of instances) {
      const result = statusDaemon(inst.port);
      const label = result.status === "running" ? `running (PID ${result.pid})` : result.status;
      console.log(`mcp-hub: ${inst.name} port ${inst.port}: ${label}`);
    }
    return;
  }

  if (argv.port != null) {
    const result = statusDaemon(argv.port);
    const label =
      result.status === "running"
        ? `running (PID ${result.pid}, port ${result.port})`
        : `${result.status} (port ${result.port})`;
    console.log(`mcp-hub: ${label}`);
    return;
  }

  const dir = getRuntimeDirectory();
  if (!fs.existsSync(dir)) {
    console.log("mcp-hub: no instances (runtime dir empty)");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pid"));
  if (files.length === 0) {
    console.log("mcp-hub: no instances (no PID files)");
    return;
  }
  for (const f of files) {
    const port = f.replace("mcp-hub-", "").replace(".pid", "");
    const result = statusDaemon(parseInt(port, 10));
    const label = result.status === "running" ? `running (PID ${result.pid})` : result.status;
    console.log(`mcp-hub: port ${port}: ${label}`);
  }
}

async function main() {
  const args = hideBin(process.argv);
  const sub = args[0];

  if (sub === "start") {
    const argv = yargs(args.slice(1))
      .usage("Usage: mcp-hub start [--instances PATH] [target]")
      .version(process.env.VERSION || "v0.0.0")
      .option("instances", { type: "string", describe: "Path to instances.json" })
      .option("port", { type: "number", describe: "Port (single-instance mode)" })
      .option("config", { type: "array", describe: "Config path (single-instance mode)" })
      .option("log-level", { type: "string", choices: ["error", "warn", "info", "debug"], default: defaultLogLevel() })
      .option("debug", { type: "boolean", default: false })
      .option("target", { type: "string", describe: "Instance name or 'all' (default: all)" })
      .example("mcp-hub start --instances ./instances.json")
      .help("h")
      .alias("h", "help")
      .fail(handleParseError)
      .parseSync();
    argv.target = argv.target || (argv._ && argv._[0]) || "all";
    await runStart(argv);
    return;
  }

  if (sub === "stop") {
    const argv = yargs(args.slice(1))
      .usage("Usage: mcp-hub stop [--instances PATH] [target]")
      .version(process.env.VERSION || "v0.0.0")
      .option("instances", { type: "string", describe: "Path to instances.json" })
      .option("port", { type: "number", describe: "Port (single-instance mode)" })
      .option("target", { type: "string", describe: "Instance name or 'all' (default: all)" })
      .example("mcp-hub stop --instances ./instances.json")
      .help("h")
      .alias("h", "help")
      .fail(handleParseError)
      .parseSync();
    argv.target = argv.target || (argv._ && argv._[0]) || "all";
    runStop(argv);
    return;
  }

  if (sub === "status") {
    const argv = yargs(args.slice(1))
      .usage("Usage: mcp-hub status [--instances PATH | --port N]")
      .version(process.env.VERSION || "v0.0.0")
      .option("instances", { type: "string", describe: "Path to instances.json" })
      .option("port", { type: "number", describe: "Port (single-instance mode)" })
      .help("h")
      .alias("h", "help")
      .fail(handleParseError)
      .parseSync();
    runStatusSync(argv);
    return;
  }

  // Default: foreground run (original behavior)
  const argv = yargs(hideBin(process.argv))
    .usage("Usage: mcp-hub [options]")
    .version(process.env.VERSION || "v0.0.0")
    .options({
      port: { alias: "p", describe: "Port to run the server on", type: "number", demandOption: true },
      config: {
        alias: "c",
        describe: "Path to config file(s). Can be specified multiple times. Merged in order.",
        type: "array",
        demandOption: true,
      },
      watch: { alias: "w", describe: "Watch for config file changes", type: "boolean", default: false },
      "auto-shutdown": { describe: "Auto shutdown when no clients", type: "boolean", default: false },
      "shutdown-delay": { describe: "Delay before shutdown (ms)", type: "number", default: 0 },
      "log-level": {
        describe: "Log level",
        type: "string",
        choices: ["error", "warn", "info", "debug"],
        default: defaultLogLevel(),
      },
      debug: { describe: "Set log level to debug", type: "boolean", default: false },
    })
    .example("mcp-hub --port 3000 --config ./global.json")
    .help("h")
    .alias("h", "help")
    .fail(handleParseError)
    .parseSync();

  try {
    await runForeground(argv);
  } catch (error) {
    process.exit(1);
  }
}

main();
