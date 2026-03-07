/**
 * XDG Base Directory Specification utilities with backward compatibility
 *
 * This module provides XDG-compliant directory paths while maintaining
 * backward compatibility with existing ~/.mcp-hub installations.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Get XDG-compliant directory paths with fallback to legacy ~/.mcp-hub
 *
 * @param {string} type - Directory type: 'data', 'state', or 'config'
 * @param {string} subdir - Subdirectory within the base directory
 * @returns {string} The resolved directory path
 */
export function getXDGDirectory(type, subdir = '') {
  const homeDir = os.homedir();
  const legacyPath = path.join(homeDir, '.mcp-hub', subdir);

  // Check if legacy path exists and use it for backward compatibility
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  let basePath;

  switch (type) {
    case 'data':
      basePath = process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
      break;
    case 'state':
      basePath = process.env.XDG_STATE_HOME || path.join(homeDir, '.local', 'state');
      break;
    case 'config':
      basePath = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
      break;
    default:
      throw new Error(`Unknown XDG directory type: ${type}`);
  }

  return path.join(basePath, 'mcp-hub', subdir);
}

/**
 * Get the log directory path (XDG_STATE_HOME or ~/.local/state/mcp-hub/logs)
 * Falls back to ~/.mcp-hub/logs if it exists
 */
export function getLogDirectory() {
  return getXDGDirectory('state', 'logs');
}

/**
 * Get the cache directory path (XDG_DATA_HOME or ~/.local/share/mcp-hub/cache)
 * Falls back to ~/.mcp-hub/cache if it exists
 */
export function getCacheDirectory() {
  return getXDGDirectory('data', 'cache');
}

/**
 * Get the data directory path (XDG_DATA_HOME or ~/.local/share/mcp-hub)
 * Falls back to ~/.mcp-hub if it exists
 */
export function getDataDirectory() {
  return getXDGDirectory('data');
}

/**
 * Get the runtime directory for daemon PID and log files.
 * Uses XDG_CACHE_HOME/mcp-hub or ~/.cache/mcp-hub.
 *
 * Note: The XDG spec recommends XDG_RUNTIME_DIR for PID files, but that
 * directory is session-scoped and typically cleaned on logout. Since the
 * mcp-hub daemon is expected to be long-lived and survive user logouts,
 * we instead use XDG_CACHE_HOME/mcp-hub (or ~/.cache/mcp-hub).
 *
 * Unlike other directory helpers in this module, this function does not
 * call getXDGDirectory() and therefore intentionally does not support the
 * legacy ~/.mcp-hub fallback. The runtime directory is only for transient
 * runtime files (PID, logs) and should not reuse the legacy layout.
 */
export function getRuntimeDirectory() {
  const homeDir = os.homedir();
  // Intentionally bypass getXDGDirectory() to avoid legacy ~/.mcp-hub
  // fallbacks for transient runtime data.
  const base = process.env.XDG_CACHE_HOME || path.join(homeDir, '.cache');
  return path.join(base, 'mcp-hub');
}
