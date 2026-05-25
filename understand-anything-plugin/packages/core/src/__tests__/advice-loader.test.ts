import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  adviceForPath,
  generateStarterAdviceFile,
  loadAdviceContext,
} from "../advice-loader";

describe("advice-loader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `advice-loader-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads .understand-anything/advice.md and root .understandadvice", () => {
    mkdirSync(join(testDir, ".understand-anything"), { recursive: true });
    writeFileSync(join(testDir, ".understand-anything", "advice.md"), "Project advice");
    writeFileSync(join(testDir, ".understandadvice"), "Root advice");

    const context = loadAdviceContext(testDir);

    expect(context.files.map((file) => file.path)).toEqual([
      ".understand-anything/advice.md",
      ".understandadvice",
    ]);
    expect(context.combinedProjectAdvice).toContain("Project advice");
    expect(context.combinedProjectAdvice).toContain("Root advice");
  });

  it("loads nested .understandadvice files with subtree scopes", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine"), { recursive: true });
    mkdirSync(join(testDir, "repos", "Sql"), { recursive: true });
    writeFileSync(join(testDir, ".understandadvice"), "All repositories");
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "Sql", ".understandadvice"), "Sql advice");

    const context = loadAdviceContext(testDir);

    expect(context.files.map((file) => file.path)).toEqual([
      ".understandadvice",
      "repos/GlobalLine/.understandadvice",
      "repos/Sql/.understandadvice",
    ]);
    expect(context.files.find((file) => file.path.endsWith("GlobalLine/.understandadvice"))?.scope).toBe("repos/GlobalLine");
  });

  it("returns applicable advice ordered from broad to specific", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine", "Server"), { recursive: true });
    writeFileSync(join(testDir, ".understandadvice"), "All repositories");
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "GlobalLine", "Server", ".understandadvice"), "Server advice");

    const context = loadAdviceContext(testDir);
    const matches = adviceForPath(context, "repos/GlobalLine/Server/start.proj");

    expect(matches.map((file) => file.content)).toEqual([
      "All repositories",
      "GlobalLine advice",
      "Server advice",
    ]);
  });

  it("does not apply sibling advice", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine"), { recursive: true });
    mkdirSync(join(testDir, "repos", "Sql"), { recursive: true });
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "Sql", ".understandadvice"), "Sql advice");

    const context = loadAdviceContext(testDir);
    const matches = adviceForPath(context, "repos/Sql/src/Readme.md");

    expect(matches.map((file) => file.content)).toEqual(["Sql advice"]);
  });

  it("generates starter advice with detected ADO repository hints", () => {
    mkdirSync(join(testDir, ".data", "ado", "tfsonprem", "repos"), { recursive: true });
    mkdirSync(join(testDir, ".data", "ado", "tfsintegrations", "repos"), { recursive: true });

    const starter = generateStarterAdviceFile(testDir);

    expect(starter).toContain("# Understand Advice");
    expect(starter).toContain(".data/ado/tfsonprem/repos");
    expect(starter).toContain(".data/ado/tfsintegrations/repos");
    expect(starter).toContain("Use existing graph edge types");
  });
});

import * as core from "../index";

describe("advice-loader public exports", () => {
  it("exports advice helpers from the core package index", () => {
    expect(core.loadAdviceContext).toBeTypeOf("function");
    expect(core.generateStarterAdviceFile).toBeTypeOf("function");
    expect(core.adviceForPath).toBeTypeOf("function");
  });
});
