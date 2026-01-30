---
id: memory-update-governance
version: "1.0"
created_at: "2026-01-30"
---
# skill: memory-update-governance

## When to use
- Agent proposes a new memory update (decision, pattern, pitfall)
- Reviewing or auditing pending memory entries
- Establishing governance workflow for shared knowledge base

## Inputs
- Proposed MemoryUpdate (type, title, body, tags, confidence)
- Existing memory entries for dedup/conflict check
- Auditor review criteria (relevance, accuracy, actionability)

## Steps
1. Agent drafts MemoryUpdate with citation ID format (e.g. DEC-YYYY-MM-DD-NN)
2. Validate required fields: type, title, body, confidence score
3. Check for duplicates or conflicts against existing approved entries
4. Submit as "pending" status in memory store
5. Auditor reviews: relevance, accuracy, and actionability
6. On approval: status -> "approved", inject into future Context
7. On rejection: status -> "rejected", record reason for learning

## Output Contract
- Every memory update has a unique citation ID
- Pending updates are not injected into prompts until approved
- Approval/rejection is traced with actor and timestamp
- Duplicate detection prevents redundant entries

## Pitfalls
- Do not auto-approve memory updates without auditor review
- Confidence score below threshold (< 0.5) should be flagged for manual review
- Stale memory entries (> 30 days without review) should be flagged for re-evaluation
- Memory injection must respect token budget limits (1500 tokens max)
