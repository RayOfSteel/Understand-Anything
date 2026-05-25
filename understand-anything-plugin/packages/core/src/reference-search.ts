import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".git", ".understand-anything", "node_modules", "vendor", "venv", ".venv",
  "__pycache__", "dist", "build", "out", "coverage", ".next", ".cache",
  ".turbo", "target", "obj", ".vs",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".7z",
  ".exe", ".dll", ".pdb", ".so", ".dylib",
  ".nupkg", ".jar", ".class",
  ".mp3", ".mp4", ".wav", ".webm", ".mov",
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB — skip very large files.

export interface ReferenceCount {
  count: number;
  /** Sample of files where the basename appeared. Capped at `samplesPerKey`. */
  samples: string[];
}

export interface CountBasenameReferencesOptions {
  /** Max sample paths per key. Default 5. */
  samplesPerKey?: number;
  /** Additional file extensions to treat as binary. */
  extraBinaryExtensions?: string[];
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isTextFile(filePath: string, binarySet: Set<string>): boolean {
  return !binarySet.has(extname(filePath).toLowerCase());
}

function walk(currentDir: string, out: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(join(currentDir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(join(currentDir, entry.name));
  }
}

/**
 * For each input project-relative file path, return the number of OTHER files
 * that mention its basename stem as a substring, plus a few sample paths.
 *
 * Walks the project ONCE regardless of how many target paths are passed. Pure
 * substring scan — does not parse syntax. Sufficient for the "is this lonely
 * node grep-discoverable?" heuristic. Skips binary extensions, files > 1 MB,
 * and standard junk directories.
 */
export function countBasenameReferences(
  projectRoot: string,
  targetPaths: string[],
  options: CountBasenameReferencesOptions = {},
): Map<string, ReferenceCount> {
  const samplesPerKey = options.samplesPerKey ?? 5;
  const binarySet = new Set([...BINARY_EXTENSIONS, ...(options.extraBinaryExtensions ?? [])]);

  const stemToTargets = new Map<string, string[]>();
  for (const targetPath of targetPaths) {
    const stem = basename(targetPath, extname(targetPath));
    if (!stem) continue;
    if (!stemToTargets.has(stem)) stemToTargets.set(stem, []);
    stemToTargets.get(stem)!.push(targetPath);
  }

  const results = new Map<string, ReferenceCount>();
  for (const target of targetPaths) results.set(target, { count: 0, samples: [] });
  if (stemToTargets.size === 0) return results;

  const allFiles: string[] = [];
  walk(projectRoot, allFiles);

  for (const absolutePath of allFiles) {
    if (!isTextFile(absolutePath, binarySet)) continue;
    let size: number;
    try { size = statSync(absolutePath).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) continue;

    const relativePath = toPosix(relative(projectRoot, absolutePath));
    let content: string;
    try { content = readFileSync(absolutePath, "utf-8"); } catch { continue; }

    for (const [stem, targetsForStem] of stemToTargets) {
      if (!content.includes(stem)) continue;
      for (const target of targetsForStem) {
        if (relativePath === toPosix(target)) continue; // exclude self
        const result = results.get(target)!;
        result.count += 1;
        if (result.samples.length < samplesPerKey) result.samples.push(relativePath);
      }
    }
  }

  return results;
}
