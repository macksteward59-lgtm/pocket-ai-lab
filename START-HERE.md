# Pocket AI Lab source archive

This snapshot covers all 311 branch names returned by the Pocket AI Lab repository during collection on November 25, 2026 (New York). The branch names resolve to 306 distinct commits. All 179 open pull-request heads observed during collection match one of those commits.

## Open the project

- `Main/` contains the 338 tracked files at commit `42de73ff6a41ef752770133899f52dd9f840f557`. The project README and the Windows and Mac launchers are in that folder.
- `Model-Workshop-PR-300/` contains the separate 386-file working tree for pull request 300 at commit `9863916f56530f0bf2670a6b152042aaf68e177d`. Its README and package scripts apply to that version.
- `Additional-source/` and `Other-versions/` store source bytes required by other branches. A source file can have several incompatible versions. Use the index to find which file belongs to a particular branch. Run the application from a complete branch directory.
- `source-index.json` records each branch name and commit, the file IDs belonging to each snapshot, and the project path, Git mode, Git object ID, and archive path for every file version.

## Recover another branch offline

Extract the whole ZIP first. From the extracted archive directory, use Python 3 to list the branch names:

```
python restore_branch.py --list
```

For example, recover the account-owned task recovery branch into a new folder:

```
python restore_branch.py codex/account-owned-task-recovery Recovered-Pocket-AI-Lab
```

The program verifies each file's bytes against its Git object ID and restores executable modes on supporting filesystems. Windows users can also invoke Python with `py -3`; on macOS or Linux, use `python3`. No network connection or Git installation is needed to restore tracked repository files.

## Coverage

The archive preserves the source as committed at each captured branch tip. It includes alternate implementations, tests, docs and configuration. A complete snapshot can still contain unfinished code. Use the branch-specific build instructions to evaluate an implementation.

Some older branches record the external submodule `packages/exploitgym` at `a8029e47135a29f1c1a6e79109bf86fba379b3f3`. The index preserves the Git reference. For those branches the recovery tool reports it and leaves its directory empty. Dependency installs, downloaded model weights, local credentials, uncommitted work, files stored only outside this GitHub repository, and prior commit history are outside this source snapshot. This archive does not incorporate external uploads.

Project: https://github.com/macksteward59-lgtm/pocket-ai-lab
