import type { UIFinding } from "@multi-agent/shared";

const ERROR_PATTERNS = [
  /error/i,
  /exception/i,
  /failed/i,
  /timeout/i,
  /permission\s*denied/i,
  /stack\s*trace/i,
  /assert(?:ion)?\s*(?:error|fail)/i,
  /cannot\s+(?:read|find|access)/i,
  /undefined|null\s+(?:reference|pointer)/i,
  /HTTP\s+[45]\d{2}/i,
];

export function extractFindings(ocrText: string): UIFinding[] {
  const lines = ocrText.split("\n").filter((l) => l.trim().length > 0);
  const findings: UIFinding[] = [];

  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          severity: classifySeverity(line),
          title: extractTitle(line),
          detail: line.trim(),
          evidence: `OCR extracted: "${line.trim().slice(0, 200)}"`,
        });
        break; // One finding per line
      }
    }
  }

  return findings;
}

export function generateSummary(ocrText: string, findings: UIFinding[]): string {
  if (findings.length === 0) {
    const preview = ocrText.slice(0, 300).replace(/\n/g, " ").trim();
    return `No error patterns detected. OCR preview: ${preview}`;
  }

  const highCount = findings.filter((f) => f.severity === "high").length;
  const medCount = findings.filter((f) => f.severity === "med").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  return `Found ${findings.length} issue(s): ${highCount} high, ${medCount} med, ${lowCount} low. ` +
    findings.slice(0, 3).map((f) => f.title).join("; ");
}

function classifySeverity(line: string): UIFinding["severity"] {
  const lower = line.toLowerCase();
  if (/exception|stack\s*trace|crash|fatal/i.test(lower)) return "high";
  if (/error|failed|cannot|denied/i.test(lower)) return "med";
  return "low";
}

function extractTitle(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 77) + "...";
}
