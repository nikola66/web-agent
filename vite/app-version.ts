import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const SW_CACHE_PLACEHOLDER = "web-agent-v5";

function resolveBuildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha) return sha;
  } catch {
    /* not a git repo or git unavailable */
  }
  return Date.now().toString(36);
}

export function appVersionPlugin(rootDir: string, appVersion: string): Plugin {
  let buildId = "dev";
  let outDir = "dist";

  return {
    name: "app-version",
    config(config, { command, mode }) {
      buildId = command === "serve" ? "dev" : resolveBuildId();
      outDir = config.build?.outDir ?? "dist";
      return {
        define: {
          "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url !== "/version.json") return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.end(
          JSON.stringify({ version: appVersion, buildId: "dev" }),
        );
      });
    },
    closeBundle() {
      if (buildId === "dev") return;
      const distDir = path.resolve(rootDir, outDir);
      const versionPath = path.join(distDir, "version.json");
      fs.writeFileSync(
        versionPath,
        JSON.stringify({ version: appVersion, buildId }) + "\n",
      );

      const swPath = path.join(distDir, "sw.js");
      if (!fs.existsSync(swPath)) return;
      const swSource = fs.readFileSync(swPath, "utf8");
      const cacheName = `web-agent-${buildId}`;
      const updated = swSource.replace(
        `const CACHE_NAME = "${SW_CACHE_PLACEHOLDER}";`,
        `const CACHE_NAME = "${cacheName}";`,
      );
      if (updated !== swSource) {
        fs.writeFileSync(swPath, updated);
      }
    },
  };
}
