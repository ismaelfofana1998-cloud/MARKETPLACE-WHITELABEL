import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = normalize(join(import.meta.dirname, "..", "web"));
const port = Number(process.env.PORT || 8000);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let fichier = normalize(join(root, pathname));
  if (!fichier.startsWith(root)) {
    response.writeHead(403).end("Interdit");
    return;
  }
  if (existsSync(fichier) && statSync(fichier).isDirectory()) fichier = join(fichier, "index.html");
  if (!existsSync(fichier)) {
    response.writeHead(404).end("Introuvable");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(fichier)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(fichier).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`IKIGAI Market: http://127.0.0.1:${port}/`);
});
