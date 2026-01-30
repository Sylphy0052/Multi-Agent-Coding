import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Phase } from "@multi-agent/shared";

export interface Skill {
  id: string;
  title: string;
  when_to_use: string;
  inputs: string[];
  steps: string[];
  output_contract: string[];
  pitfalls: string[];
  version: string;
  created_at: string;
  review_due?: string;
}

export interface SkillSelectionCriteria {
  phase: Phase;
  hasScreenshots: boolean;
  jobType?: string;
}

export class SkillsRegistry {
  private skills = new Map<string, Skill>();

  constructor(private readonly skillsDir: string) {}

  async loadAll(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.skillsDir);
    } catch {
      return; // No skills directory
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(this.skillsDir, entry);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const skill = this.parseSkill(content, entry);
        if (skill) this.skills.set(skill.id, skill);
      } catch {
        // Skip invalid files
      }
    }
  }

  select(criteria: SkillSelectionCriteria): Skill[] {
    const selected: Skill[] = [];

    for (const skill of this.skills.values()) {
      const whenLower = skill.when_to_use.toLowerCase();

      // Screenshot-related skills when screenshots present
      if (criteria.hasScreenshots &&
          (whenLower.includes("screenshot") || whenLower.includes("ui"))) {
        selected.push(skill);
        continue;
      }

      // Phase-specific matching
      if (criteria.phase === "test" && whenLower.includes("test")) {
        selected.push(skill);
        continue;
      }
      if (criteria.phase === "spec" &&
          (whenLower.includes("investigat") || whenLower.includes("analys"))) {
        selected.push(skill);
        continue;
      }
    }

    // Limit to 3 skills max
    return selected.slice(0, 3);
  }

  getSkill(skillId: string): Skill | null {
    return this.skills.get(skillId) ?? null;
  }

  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  private parseSkill(content: string, filename: string): Skill | null {
    // Parse YAML front matter
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontMatter: Record<string, string> = {};

    if (frontMatterMatch) {
      for (const line of frontMatterMatch[1].split("\n")) {
        const [key, ...vals] = line.split(":");
        if (key && vals.length > 0) {
          frontMatter[key.trim()] = vals.join(":").trim().replace(/^["']|["']$/g, "");
        }
      }
    }

    // Parse sections
    const sections = this.parseSections(content);

    return {
      id: frontMatter.id || filename.replace(".md", ""),
      title: this.extractTitle(content) || filename.replace(".md", ""),
      when_to_use: sections["When to use"] || "",
      inputs: this.parseList(sections["Inputs"] || ""),
      steps: this.parseList(sections["Steps"] || ""),
      output_contract: this.parseList(sections["Output Contract"] || ""),
      pitfalls: this.parseList(sections["Pitfalls"] || ""),
      version: frontMatter.version || "1.0",
      created_at: frontMatter.created_at || new Date().toISOString(),
      review_due: frontMatter.review_due,
    };
  }

  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(?:skill:\s*)?(.+)$/m);
    return match ? match[1].trim() : "";
  }

  private parseSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const sectionRegex = /^##\s+(.+)$/gm;
    let match;
    const positions: Array<{ title: string; start: number }> = [];

    while ((match = sectionRegex.exec(content)) !== null) {
      positions.push({ title: match[1].trim(), start: match.index + match[0].length });
    }

    for (let i = 0; i < positions.length; i++) {
      const end = i + 1 < positions.length ? positions[i + 1].start - positions[i + 1].title.length - 3 : content.length;
      sections[positions[i].title] = content.slice(positions[i].start, end).trim();
    }

    return sections;
  }

  private parseList(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.replace(/^[-\d.)\s]+/, "").trim())
      .filter((l) => l.length > 0);
  }
}
