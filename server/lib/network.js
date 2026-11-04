// Who is asking: this PC (loopback) or another computer on a private network.
import net from "node:net";

function toIPv4(address) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address || "");
  return m ? m[1] : address || "";
}

export function isLoopback(address) {
  const ip = toIPv4(address);
  return ip === "::1" || (net.isIPv4(ip) && ip.startsWith("127."));
}

export function isPrivateAddress(address) {
  if (isLoopback(address)) return true;
  const ip = toIPv4(address);
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export const clientAddress = (req) => toIPv4(req.socket.remoteAddress);
