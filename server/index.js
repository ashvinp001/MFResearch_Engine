// Prosperr website server.
// Usage:  node server/index.js [--port=5173]      (or: npm start)
// Serves the website at http://localhost:<port>/ — this PC only — and its /api endpoints (data from the Python pipeline).
// Every visitor signs in first with the admin or team ID (.env). Sharing over the local network was removed (2026-11-06).
// --container: only inside the Docker image (Dockerfile) — listens on the container's own network so Docker's port
//   mapping can reach it; never used on a PC.
// If a listener fails after starting (network drop, Wi-Fi reconnect), it is logged and restarted after 3 s.
import http from "node:http";
import { DEFAULT_PORT } from "./config.js";
import { handleRequest } from "./app.js";
import { log } from "./lib/logger.js";
import { startSchemeSync } from "./lib/scheme-sync.js";

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, container: false };
  for (const arg of argv) {
    if (arg === "--container") options.container = true;
    else if (/^--port=\d{1,5}$/.test(arg)) options.port = Number(arg.slice(7));
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.port < 1 || options.port > 65535) throw new Error("Port must be 1-65535");
  return options;
}

const options = parseArgs(process.argv.slice(2));
// This PC only: both loopback addresses (browsers may try either for "localhost"). In a container: its own network.
// The first address is required; the IPv6 one is skipped on a PC without IPv6.
const hosts = options.container ? ["0.0.0.0", "::"] : ["127.0.0.1", "::1"];

function listen(host, required) {
  const server = http.createServer(handleRequest);
  server.requestTimeout = 300_000;
  let started = false;
  server.on("error", (error) => {
    if (!started) {
      if (!required && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) return;   // no IPv6 here
      log(`could not start on port ${options.port}: ${error.message} - exiting`);
      console.error(`Could not start on port ${options.port}: ${error.message}`);
      process.exit(1);
    }
    log(`listener on ${host} stopped: ${error.message} - restarting in 3 s`);
    server.close();
    setTimeout(() => listen(host, required), 3000);
  });
  server.listen({ port: options.port, host, ipv6Only: true }, () => {
    started = true;
    if (required) console.log(`Prosperr website: http://localhost:${options.port}/`);
  });
}

hosts.forEach((host, i) => listen(host, i === 0));
log(`started (port ${options.port}${options.container ? ", container" : ""}, pid ${process.pid}, node ${process.version})`);
// The daily data job runs in the cloud; the fund lists it writes to Supabase are copied here (now and every 30 min).
startSchemeSync();

// One bad request must never stop the site for everyone.
process.on("uncaughtException", (error) => log(`uncaught: ${error.stack || error.message}`));
process.on("unhandledRejection", (error) => log(`unhandled: ${error?.stack || error}`));
