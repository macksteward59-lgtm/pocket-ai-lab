# Director team expansion: implementation notes

Design note, stated plainly because the request that led here was phrased as
"build an agency smarter than yourself": this is not that, and was not built
as that. `TeamExpansionPlanner` cannot create a new specialist type, a new
skill, a new tool, or any capability beyond the fixed catalogs already in
this codebase (`SECURITY_SPECIALIST_TEMPLATES`, `SKILL_CATALOG`,
`TOOL_CATALOG`, `CORE_AGENTS`). There is no method anywhere in this class
that defines a new agent or writes a new template. "Bigger team" means more
instances of the six already-defined specialists, up to a hard ceiling
(`ABSOLUTE_MAX_TEAM_SIZE = 6`, one per template) that no caller -- including
the Director -- can raise at runtime.

## Code map
- `packages/intelligence/agents/TeamExpansionPlanner.ts` -- `expandTeam()`,
  `possibleSpecialists()`, `getLog()`.
- Not mounted on the consumer web server. A host that wants an HTTP route
  has to opt in elsewhere; this module does not listen.

## Rules enforced, with no path around them
- Up to `DEFAULT_TEAM_SIZE` (3): granted immediately, same as
  `SecurityDivision.assemble`'s existing default.
- Above `DEFAULT_TEAM_SIZE` and up to `ABSOLUTE_MAX_TEAM_SIZE` (6): requires
  a verified human approval (`ApprovalVerifier`), checked the same way
  operational-intent security tasks are checked elsewhere in this codebase.
- Above `ABSOLUTE_MAX_TEAM_SIZE`: refused unconditionally. No approval,
  voucher, or configuration raises this number.
- Every specialist still carries only the `lab` permission and still goes
  through `DelegationGate` for any tool use, same as a normal
  `SecurityDivision.assemble` team.

## Known limitations
- This only expands *security* specialist teams (reusing
  `SecurityDivision.assemble`). It does not expand the eight permanent core
  agents (`director`, `reasoner`, `researcher`, `engineer`, `security`,
  `critic`, `validator`, `archivist`) -- those are fixed at construction via
  `CORE_AGENTS` and this module does not touch that list.
- `getLog()` is in-memory and unsigned, same caveat as `DelegationGate`'s
  audit log.
