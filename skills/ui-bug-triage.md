---
id: ui-bug-triage
version: "1.0"
created_at: "2026-01-30"
---
# skill: ui-bug-triage

## When to use
- UI screenshot shows error or unexpected behavior
- Bug report involves visual/interaction issue

## Inputs
- Screenshot Findings (OCR + analysis)
- Error logs (if any)
- Recent commits affecting UI

## Steps
1. Read OCR text and identify error messages
2. Cross-reference errors with recent code changes
3. Identify the root component/module
4. Formulate root cause hypothesis
5. Propose minimal fix with file paths
6. Define regression test criteria

## Output Contract
- Root cause hypothesis with evidence
- Minimal fix (files and changes)
- Regression test plan (at least 2 test cases)

## Pitfalls
- Do not assume OCR text is 100% accurate
- Check for CSS/layout issues that OCR cannot capture
- Consider browser/environment differences
