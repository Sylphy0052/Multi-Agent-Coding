import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadPersonaSet } from "../../../src/personas/loader.js";

const personasDir = path.resolve(
  import.meta.dirname,
  "../../../../config/personas",
);

describe("PersonaLoader", () => {
  it("should load the default persona set", () => {
    const result = loadPersonaSet(personasDir, "default");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.set.persona_set_id).toBe("default");
      expect(result.value.ui_chan.role).toBe("ui-chan");
      expect(result.value.ai_chan.role).toBe("ai-chan");
      expect(result.value.kobito.role).toBe("kobito");
    }
  });

  it("should load display names", () => {
    const result = loadPersonaSet(personasDir, "default");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.ui_chan.display_name).toBe("UIちゃん");
      expect(result.value.ai_chan.display_name).toBe("AIちゃん");
      expect(result.value.kobito.display_name_prefix).toBe("Kobito");
    }
  });

  it("should include tone_style for all personas", () => {
    const result = loadPersonaSet(personasDir, "default");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.ui_chan.tone_style).toBeTruthy();
      expect(result.value.ai_chan.tone_style).toBeTruthy();
      expect(result.value.kobito.tone_style).toBeTruthy();
    }
  });

  it("should include quality gates for ai-chan", () => {
    const result = loadPersonaSet(personasDir, "default");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const aiChan = result.value.ai_chan as Record<string, unknown>;
      expect(aiChan.quality_gates).toBeDefined();
      const gates = aiChan.quality_gates as Record<string, string[]>;
      expect(gates.spec).toBeDefined();
      expect(gates.impl).toBeDefined();
      expect(gates.test).toBeDefined();
    }
  });

  it("should return error for nonexistent persona set", () => {
    const result = loadPersonaSet(personasDir, "nonexistent");
    expect(result.isErr()).toBe(true);
  });

  it("should return error for nonexistent directory", () => {
    const result = loadPersonaSet("/nonexistent/dir", "default");
    expect(result.isErr()).toBe(true);
  });
});
