#!/usr/bin/env node

import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] || ".");
const manifestPath = resolve(root, process.argv[3] || "xhs-package.json");
const supported = new Set([".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".woff", ".woff2"]);
const errors = [];
if (!existsSync(manifestPath)) { console.error(`Missing manifest: ${manifestPath}`); process.exit(1); }
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];
const scanFiles = Array.isArray(manifest.scanFiles) ? manifest.scanFiles : files.filter((file) => !file.startsWith("data/"));
const outputName = manifest.output || "xiaohongshu-tool.zip";
const outputPath = resolve(root, outputName);
const maxBytes = Number(manifest.maxBytes) || 50 * 1024 * 1024;
for (const extension of manifest.extraExtensions || []) supported.add(extension);
const allowedCapabilities = new Set(manifest.allowedCapabilities || []);
const safe = (file) => typeof file === "string" && file.length > 0 && !file.startsWith("/") && !file.split("/").includes("..");
if (!files.includes("index.html")) errors.push("index.html must be listed at ZIP root");
if (basename(outputPath) !== outputName) errors.push("output must be a root-level filename");
for (const file of files) {
  if (!safe(file)) { errors.push(`unsafe path: ${file}`); continue; }
  const absolute = resolve(root, file);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) errors.push(`missing file: ${file}`);
  if (!supported.has(extname(file).toLowerCase())) errors.push(`unsupported file type: ${file}`);
}
const forbidden = [
  ["inline script", /<script(?![^>]*\bsrc=)[^>]*>/i],
  ["inline event handler", /\son[a-z]+\s*=/i],
  ["runtime network API", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\s*\(/],
  ["dynamic code", /\beval\s*\(|new\s+Function\s*\(/],
  ["workers or wasm", /\b(WebAssembly|Worker|SharedWorker|ServiceWorker|SharedArrayBuffer)\b/],
  ["embedded page", /<(iframe|object)\b/i],
  ["external navigation", /\bwindow\.open\s*\(|target\s*=\s*["']_blank|\blocation\.(href\s*=|assign\s*\()/i],
  ["file download", /<a\b[^>]*\bdownload\b/i],
  ["form navigation", /<form\b/i],
  ["external resource", /<(script|link|img|video|audio)\b[^>]*(src|href)\s*=\s*["']https?:\/\//i],
  ["external CSS resource", /url\(\s*["']?https?:\/\//i],
  ["base tag", /<base\b/i],
  ["custom CSP", /http-equiv\s*=\s*["']Content-Security-Policy/i],
];
for (const file of scanFiles) {
  if (!files.includes(file)) errors.push(`scanFiles entry is not packaged: ${file}`);
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const source = readFileSync(absolute, "utf8");
  for (const [label, pattern] of forbidden) {
    if (!allowedCapabilities.has(label) && pattern.test(source)) errors.push(`${file}: ${label}`);
  }
}
if (existsSync(resolve(root, "index.html"))) {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(?:#|data:|mailto:|tel:|javascript:)/i.test(ref)) continue;
    if (/^https?:\/\//i.test(ref)) { errors.push(`index.html: external reference ${ref}`); continue; }
    const clean = ref.replace(/^\.\//, "").split(/[?#]/)[0];
    if (clean && !files.includes(clean)) errors.push(`index.html references unpackaged file: ${clean}`);
  }
}
if (errors.length) {
  console.error("Xiaohongshu package validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
if (existsSync(outputPath)) unlinkSync(outputPath);
const zipped = spawnSync("/usr/bin/zip", ["-9", outputPath, ...files], { cwd: root, encoding: "utf8" });
if (zipped.status !== 0) { console.error(zipped.stderr || zipped.stdout || "zip command failed"); process.exit(zipped.status || 1); }
const size = statSync(outputPath).size;
if (size > maxBytes) { unlinkSync(outputPath); console.error(`ZIP exceeds configured limit: ${size} > ${maxBytes} bytes`); process.exit(1); }
console.log(`Built ${outputPath}`);
console.log(`Files: ${files.length}; compressed size: ${(size / 1024).toFixed(1)} KiB`);
