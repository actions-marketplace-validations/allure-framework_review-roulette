# Review roulette

A GitHub Action that picks the least-loaded reviewer from an explicit list or GitHub's native PR-specific suggestions, posts one managed pull-request comment, and optionally requests review.

**Workload = outstanding personal review requests on open PRs**, not PR assignees or submitted reviews. The PR author is excluded. Minimum-count ties are random.

## Quick start

Replace `OWNER/review-roulette@<commit-sha>` with this action's published repository and a trusted commit SHA. Consumers need no checkout or dependency installation.

```yaml
name: Review roulette
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
permissions:
  pull-requests: write
concurrency:
  group: review-roulette-${{ github.repository }}
  cancel-in-progress: false
jobs:
  suggest:
    runs-on: ubuntu-latest
    steps:
      - uses: OWNER/review-roulette@<commit-sha>
        id: roulette
        with:
          reviewers: |
            alice
            bob
            carol
          # Suggestion-only is the default.
          # assign-reviewer: 'true'
```

Both modes write a PR conversation comment and need `pull-requests: write`. Assignment is additive: it requests the chosen user's review without removing existing reviewers. GitHub enforces reviewer eligibility when the request is made; suggestion mode does **not** prove the user can review the repository.

## Inputs

| Input             | Default               | Meaning                                                                                                 |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `token`           | `${{ github.token }}` | Token used for all API operations.                                                                      |
| `reviewers`       | Empty                 | Comma- or newline-separated user logins; optional leading `@`. Empty uses GitHub's suggested reviewers. |
| `organizations`   | Empty                 | Organizations whose visible workloads are summed, **instead of** repository scope.                      |
| `assign-reviewer` | `false`               | Set to `true` to request review as well as suggest it.                                                  |

Lists are trimmed, validated, and deduplicated case-insensitively. Boolean inputs accept only `true` or `false`.

### Automatic reviewer discovery

Omit `reviewers` (or leave it empty) to use GitHub's native suggested reviewers for the target PR through GraphQL `PullRequest.suggestedReviewers`. GitHub bases these suggestions on commit history and past review comments; they are not a list of recently active contributors.

An explicit reviewer list takes precedence. In either mode, the action excludes the PR author and balances outstanding review requests across the remaining candidates. If no eligible candidates remain, the action fails before requesting a review or publishing a comment. API failures also fail the run rather than falling back to unrelated contributors.

### Multiple organizations and assignment

```yaml
- uses: OWNER/review-roulette@<commit-sha>
  with:
    token: ${{ secrets.REVIEW_ROULETTE_TOKEN }}
    reviewers: alice, bob, carol
    organizations: |
      acme
      acme-labs
    assign-reviewer: "true"
```

`GITHUB_TOKEN` is repository-scoped. Use a GitHub App installation token or PAT with access to the relevant repositories for broader counts. The token needs read access for PR workloads and write access to the target PR. Fine-grained tokens/App installations need repository **Pull requests: read** on workload repositories and **Pull requests: write** on the target; classic PATs need appropriate `repo` access for private repositories. The action resolves its authenticated comment identity through GraphQL `viewer`, including installation-token bot identities; it does not require installation tokens to support REST `/user`.

Repository and organization lookups check scope accessibility, **not full private-repository visibility or write permission**. Organization counts reflect only repositories visible to the supplied token. A successful lookup cannot establish complete organization coverage. An inaccessible configured scope or failed/partial search fails the run instead of silently lowering a reviewer's workload.

## Fork pull requests

Fork `pull_request` workflows commonly receive read-only tokens, so comment/review-request writes can fail. For forks, use a metadata-only `pull_request_target` workflow:

```yaml
name: Review roulette
on:
  pull_request_target:
    types: [opened, reopened, ready_for_review]
permissions:
  pull-requests: write
concurrency:
  group: review-roulette-${{ github.repository }}
  cancel-in-progress: false
jobs:
  suggest:
    runs-on: ubuntu-latest
    steps:
      - uses: OWNER/review-roulette@<commit-sha>
        with:
          reviewers: alice, bob, carol
          assign-reviewer: "true"
```

**Never check out or execute PR-head code in this privileged workflow.** Use trusted, pinned action code. Reviewer discovery uses GitHub API metadata only. The action uses the PR's base repository, never the fork's head repository. Dependabot PRs may also have token/secret restrictions; repository policy still applies.

## Comment and outputs

The comment shows only the selected reviewer:

| Category | Suggested reviewer                 |
| -------- | ---------------------------------- |
| All      | @alice — 2 pending review requests |

A status sentence says suggestion-only, review requested, or review already requested. The count is captured **before** a new request in that run.

| Output         | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `reviewer`     | Selected login.                                                                   |
| `review-count` | Outstanding request count at selection time.                                      |
| `assigned`     | `true` only if this run successfully created a review request; otherwise `false`. |

Outputs are published only after successful comment publication. API failures fail the action. If assignment succeeds but commenting fails, the request stays in place and the run fails; no rollback is attempted.

### Reruns

The action updates its earliest valid, identity-owned managed comment. A copied marker in someone else's comment is not editable. Preserve its hidden marker to retain selection history.

- Keep a prior selected reviewer who is still in the current candidate pool, is not the author, and has an outstanding request on this PR—even if their count is now higher.
- Otherwise retain a prior suggestion only while it shares the minimum count.
- Never request the chosen reviewer again if they are already requested, even without a prior comment.
- Changing token identity can result in a new managed comment. Concurrent runs or manually duplicated owned comments are not consolidated automatically.
