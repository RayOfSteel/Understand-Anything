import { describe, expect, it } from "vitest";
import * as core from "../../index.js";

describe("regenerate exports", () => {
  it("exports regenerate helpers from the core package index", () => {
    expect(core.createAttemptArchive).toBeTypeOf("function");
    expect(core.buildSubstrateManifest).toBeTypeOf("function");
    expect(core.mergeGraphWithCarryForward).toBeTypeOf("function");
    expect(core.compareGraphs).toBeTypeOf("function");
    expect(core.mergeDomainGraph).toBeTypeOf("function");
    expect(core.buildConnectivityCandidates).toBeTypeOf("function");
  });
});
