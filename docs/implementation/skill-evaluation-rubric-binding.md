# Skill evaluation rubric binding hardening

This follow-up is stacked on `codex/director-skill-lifecycle-gates` and does not change the operational SkillRegistry, Director commands, runtime capabilities, APEX authorization, East/e3 execution, or evidence authority.

## Finding

The original skill lifecycle record stored a `rubricDigest` on each evaluation, but promotion did not compare it with the rubric embedded in the immutable skill artifact. Consequently, a verifier could accept an internally valid evaluation record whose declared rubric was unrelated to the skill's actual assessment rubric.

## Change

- Export `skillRubricDigest`, which canonicalizes and SHA-256 hashes the exact rubric array.
- Require the evaluation's rubric digest to equal the artifact's rubric digest before invoking external promotion verifiers.
- Update the test fixture to derive the digest from the artifact rubric.
- Add a regression test proving a different, internally well-formed rubric digest is rejected.

## Boundary

This remains a non-executable candidate lifecycle primitive. The verifier ports still need trusted host implementations. A passing unit test does not authenticate a human approver, establish durable authorization, activate a skill, grant a tool, or authorize any target activity. No live-target or lab-target testing was performed.
