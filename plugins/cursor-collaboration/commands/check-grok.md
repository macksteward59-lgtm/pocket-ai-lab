---
name: check-grok
description: Read the shared coordination mailbox and summarize Grok's latest status, requests, and blockers.
---

# Check Grok's status

1. Call `read_coordination_context`.
2. Summarize current owners, branches, and statuses from the board.
3. Identify the latest Grok Bot messages in the coordination log.
4. Report unanswered questions, ownership conflicts, blockers, and requested actions.
5. Do not modify code, change ownership, or merge anything during this check.
