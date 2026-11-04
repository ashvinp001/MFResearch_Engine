// Response and request helpers shared by the routes.
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

export function send(res, status, contentType, body, headers = {}) {
  if (res.headersSent) return;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": contentType, "Content-Length": data.length, ...headers });
  res.end(data);
}

export const sendText = (res, status, text) => send(res, status, "text/plain; charset=utf-8", text);
export const sendJson = (res, status, body, headers) =>
  send(res, status, "application/json", typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body), headers);

export class BodyTooLarge extends Error {}

// The request body as text, refused once it passes `limit` bytes (whatever Content-Length claims).
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > limit) { req.resume(); reject(new BodyTooLarge()); return; }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new BodyTooLarge()); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
