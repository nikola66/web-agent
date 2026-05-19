import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

const ORT_FILES = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"] as const;
const PUBLIC_PREFIX = "/transformers-ort/";

function contentType(name: string): string {
  if (name.endsWith(".wasm")) return "application/wasm";
  return "text/javascript; charset=utf-8";
}

export function transformersOrtAssetsPlugin(rootDir: string): Plugin {
  const ortDir = path.resolve(rootDir, "node_modules/@huggingface/transformers/dist");

  const serveOrt = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || "";
    if (!url.startsWith(PUBLIC_PREFIX)) return next();
    const name = url.slice(PUBLIC_PREFIX.length).split("?")[0] || "";
    if (!ORT_FILES.includes(name as (typeof ORT_FILES)[number])) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const filePath = path.join(ortDir, name);
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end("ORT asset missing — run npm install");
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType(name));
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: "transformers-ort-assets",
    configureServer(server) {
      server.middlewares.use(serveOrt);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveOrt);
    },
    writeBundle(options) {
      const outDir = options.dir || path.resolve(rootDir, "dist");
      const target = path.join(outDir, "transformers-ort");
      fs.mkdirSync(target, { recursive: true });
      for (const name of ORT_FILES) {
        fs.copyFileSync(path.join(ortDir, name), path.join(target, name));
      }
    },
  };
}
