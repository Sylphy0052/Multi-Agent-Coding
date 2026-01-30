---
id: test-regression-minimal
version: "1.0"
created_at: "2026-01-30"
---
# skill: test-regression-minimal

## When to use
- A bug fix has been applied and regression tests are needed
- Test coverage is insufficient for a changed module
- Post-merge validation is required

## Inputs
- Changed file paths and diff summary
- Original bug description or failing test output
- Existing test files for the affected module

## Steps
1. Identify the exact function or component changed
2. List the edge cases the fix addresses
3. Write minimal test cases that cover the bug scenario
4. Write at least one negative test (ensure old bug does not regress)
5. Verify tests pass with the fix and fail without it
6. Document test rationale in test file comments

## Output Contract
- At least 2 test cases per bug fix
- One positive test (fix works) and one negative test (regression guard)
- Test file path and run command

## Pitfalls
- Avoid testing implementation details; test observable behavior
- Do not duplicate existing tests; check for overlap first
- Ensure tests are deterministic (no flaky timing or external deps)
