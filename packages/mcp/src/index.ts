#!/usr/bin/env node
/**
 * focal MCP server over stdio.
 *
 * - With FOCAL_TOKEN (a focal session token): account mode, the same tools as
 *   the hosted server, reading and writing the signed-in profile (src/bridge.ts).
 * - Without it: local mode, read-only tools over a profile file (src/local.ts).
 */
import { DEFAULT_MCP_URL, runBridge } from "./bridge.js";

const token = process.env.FOCAL_TOKEN?.trim();
if (token) {
  await runBridge({ url: process.env.FOCAL_MCP_URL?.trim() || DEFAULT_MCP_URL, token });
} else {
  await import("./local.js");
}
