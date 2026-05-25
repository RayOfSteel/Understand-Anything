import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countBasenameReferences } from "../reference-search.js";

describe("countBasenameReferences", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `ua-refsearch-${Date.now()}`);
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "src", "ResourceLoader.cs"), "public class ResourceLoader {}");
    writeFileSync(join(root, "src", "Other.cs"), "using ResourceLoader; var l = new ResourceLoader();");
    writeFileSync(join(root, "src", "Third.cs"), "var loader = ResourceLoader.Instance;");
    writeFileSync(join(root, "config", "settings.json"), "{ \"loader\": \"ResourceLoader\" }");
    writeFileSync(join(root, "README.md"), "No mention here.");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("counts basename matches in files OTHER than the source file", () => {
    const counts = countBasenameReferences(root, ["src/ResourceLoader.cs"]);
    const entry = counts.get("src/ResourceLoader.cs");
    expect(entry?.count).toBeGreaterThanOrEqual(3); // Other.cs, Third.cs, settings.json
    expect(entry?.samples.some((s) => s.includes("Other.cs"))).toBe(true);
    expect(entry?.samples.some((s) => s === "src/ResourceLoader.cs")).toBe(false); // self excluded
  });

  it("returns zero for files no one mentions", () => {
    writeFileSync(join(root, "src", "Lonely.cs"), "class Lonely {}");
    const counts = countBasenameReferences(root, ["src/Lonely.cs"]);
    expect(counts.get("src/Lonely.cs")?.count).toBe(0);
  });
});
