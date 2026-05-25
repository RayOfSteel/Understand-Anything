import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SubstrateManifest } from "./types.js";

export interface BuildSubstrateOptions {
  coreVersion: string;
  extractorVersion: string;
  parserVersions: Record<string, string>;
  generatedAt?: string;
}

export interface CacheReuseResult {
  reusable: boolean;
  reasons: string[];
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildSubstrateManifest(
  projectRoot: string,
  filePaths: string[],
  options: BuildSubstrateOptions,
): SubstrateManifest {
  const files: SubstrateManifest["files"] = {};

  for (const filePath of [...filePaths].sort()) {
    const absolutePath = join(projectRoot, filePath);
    const content = readFileSync(absolutePath);
    const stat = statSync(absolutePath);
    files[filePath.replace(/\\/g, "/")] = {
      path: filePath.replace(/\\/g, "/"),
      contentHash: sha256(content),
      sizeBytes: stat.size,
    };
  }

  return {
    version: "1.0.0",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    coreVersion: options.coreVersion,
    extractorVersion: options.extractorVersion,
    parserVersions: options.parserVersions,
    files,
  };
}

export function isSubstrateCacheReusable(
  previous: SubstrateManifest,
  current: SubstrateManifest,
): CacheReuseResult {
  const reasons: string[] = [];

  if (previous.coreVersion !== current.coreVersion) {
    reasons.push(`core version changed: ${previous.coreVersion} -> ${current.coreVersion}`);
  }
  if (previous.extractorVersion !== current.extractorVersion) {
    reasons.push(`extractor version changed: ${previous.extractorVersion} -> ${current.extractorVersion}`);
  }
  if (JSON.stringify(previous.parserVersions) !== JSON.stringify(current.parserVersions)) {
    reasons.push("parser versions changed");
  }

  const previousPaths = Object.keys(previous.files).sort();
  const currentPaths = Object.keys(current.files).sort();
  if (JSON.stringify(previousPaths) !== JSON.stringify(currentPaths)) {
    reasons.push("file set changed");
  }

  for (const path of currentPaths) {
    const oldFile = previous.files[path];
    const newFile = current.files[path];
    if (!oldFile) continue;
    if (oldFile.contentHash !== newFile.contentHash) {
      reasons.push(`content hash changed: ${path}`);
    }
  }

  return { reusable: reasons.length === 0, reasons };
}
