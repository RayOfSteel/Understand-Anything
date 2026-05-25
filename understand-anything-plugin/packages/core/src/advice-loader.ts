import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const NESTED_ADVICE_FILE = ".understandadvice";
const PROJECT_ADVICE_FILE = join(".understand-anything", "advice.md");

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".understand-anything",
  "node_modules",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  "target",
  "obj",
]);

export interface AdviceFile {
  path: string;
  scope: string;
  appliesTo: string[];
  content: string;
  source: "project" | "root" | "nested";
}

export interface AdviceContext {
  files: AdviceFile[];
  combinedProjectAdvice: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function normalizeScope(projectRoot: string, absoluteAdvicePath: string): string {
  const raw = toPosix(relative(projectRoot, dirname(absoluteAdvicePath)));
  return raw === "" ? "." : raw;
}

function adviceFile(projectRoot: string, absolutePath: string, source: AdviceFile["source"]): AdviceFile {
  const path = toPosix(relative(projectRoot, absolutePath));
  const scope = source === "project" ? "." : normalizeScope(projectRoot, absolutePath);
  const appliesTo = scope === "." ? ["**/*"] : [`${scope}/**/*`];
  return {
    path,
    scope,
    appliesTo,
    content: readFileSync(absolutePath, "utf-8").trim(),
    source,
  };
}

function walkForNestedAdvice(projectRoot: string, currentDir: string, out: AdviceFile[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walkForNestedAdvice(projectRoot, join(currentDir, entry.name), out);
      continue;
    }

    if (!entry.isFile() || entry.name !== NESTED_ADVICE_FILE) continue;

    const absolutePath = join(currentDir, entry.name);
    const relativePath = toPosix(relative(projectRoot, absolutePath));
    if (relativePath === NESTED_ADVICE_FILE) continue;
    out.push(adviceFile(projectRoot, absolutePath, "nested"));
  }
}

export function loadAdviceContext(projectRoot: string): AdviceContext {
  const root = resolve(projectRoot);
  const files: AdviceFile[] = [];

  const projectAdvicePath = join(root, PROJECT_ADVICE_FILE);
  if (existsSync(projectAdvicePath)) {
    files.push(adviceFile(root, projectAdvicePath, "project"));
  }

  const rootAdvicePath = join(root, NESTED_ADVICE_FILE);
  if (existsSync(rootAdvicePath)) {
    files.push(adviceFile(root, rootAdvicePath, "root"));
  }

  walkForNestedAdvice(root, root, files);

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    combinedProjectAdvice: files
      .filter((file) => file.scope === ".")
      .map((file) => `## ${file.path}\n\n${file.content}`)
      .join("\n\n"),
  };
}

export function adviceForPath(context: AdviceContext, relativePath: string): AdviceFile[] {
  const normalized = toPosix(relativePath);
  return context.files
    .filter((file) => file.scope === "." || normalized === file.scope || normalized.startsWith(`${file.scope}/`))
    .sort((a, b) => {
      if (a.scope === b.scope) return a.path.localeCompare(b.path);
      if (a.scope === ".") return -1;
      if (b.scope === ".") return 1;
      return a.scope.split("/").length - b.scope.split("/").length;
    });
}

export function generateStarterAdviceFile(projectRoot: string): string {
  const root = resolve(projectRoot);
  const detectedBoundaries: string[] = [];

  for (const candidate of [
    ".data/ado/tfsonprem/repos",
    ".data/ado/tfsintegrations/repos",
    "packages",
    "apps",
    "src",
  ]) {
    if (existsSync(join(root, candidate))) {
      detectedBoundaries.push(candidate);
    }
  }

  const boundaryLines =
    detectedBoundaries.length === 0
      ? "- Treat each top-level application, package, service, or source mirror as its own analysis slice."
      : detectedBoundaries.map((boundary) => `- Treat \`${boundary}\` children as candidate repository or product slices.`).join("\n");

  return `# Understand Advice

This file gives Understand Anything project-specific guidance. It does not exclude files. Use .understandignore for filtering.

## Project Boundaries

${boundaryLines}

## Relationship Guidance

- Use existing graph edge types such as imports, depends_on, configures, deploys, routes, defines_schema, reads_from, writes_to, publishes, subscribes, transforms, and related.
- Prefer deterministic file evidence over naming guesses.
- Treat config, manifest, service wrapper, pipeline, SQL, and build files as first-class graph evidence.

## Noise Guidance

- Keep source-controlled deployable assets even when they are generated from another engine or platform.
- Down-rank generated, vendor, runtime, cache, and binary payloads unless a local advice file says they are source-of-truth inputs.
`;
}
