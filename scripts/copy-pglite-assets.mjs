#!/usr/bin/env node
/** Copy PGlite runtime assets into the Nitro preview/function bundle. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sourceDir = join(root, "node_modules/@electric-sql/pglite/dist");
const targets = [
  join(root, ".vercel/output/functions/__server.func/_libs"),
  join(root, ".output/server/chunks"),
];
// PGLite 文件/内存模式都要的基础资产: 数据包+主 wasm+initdb wasm(文件模式必需)
const assets = ["pglite.data", "pglite.wasm", "initdb.wasm"];
for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const asset of assets) {
    const source = join(sourceDir, asset);
    if (!existsSync(source)) throw new Error(`Missing PGlite asset: ${source}`);
    copyFileSync(source, join(target, asset));
  }
  console.log(`[pglite-assets] ${assets.join(", ")} -> ${target}`);
}