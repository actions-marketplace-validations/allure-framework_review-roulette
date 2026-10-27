import { loginPattern } from "./inputs";
import type { AssignmentStatus, CommentIdentity, ManagedComment, Suggestion } from "./model";
export function renderComment(suggestion: Suggestion, status: AssignmentStatus): string {
  const copy = {
    suggested: "Suggestion only; no review request was created.",
    requested: "Review requested.",
    "already-requested": "Review already requested; no additional request was created.",
  };
  return `### Review roulette

| Category | Suggested reviewer |
| --- | --- |
| All | @${suggestion.reviewer} — ${suggestion.reviewCount} pending review request${suggestion.reviewCount === 1 ? "" : "s"} |

${copy[status]}

<!-- review-roulette:v1:${suggestion.reviewer} -->`;
}
export function readSuggestion(body: string): string | undefined {
  const matches = [...body.matchAll(/<!-- review-roulette:v1:([^\n]*?) -->/g)];
  if (matches.length !== 1) return undefined;
  const login = matches[0][1];
  return loginPattern.test(login) ? login : undefined;
}
export function findManagedComment(
  comments: ManagedComment[],
  identity: CommentIdentity,
): ManagedComment | undefined {
  return comments
    .filter(
      (comment) =>
        comment.authorLogin.toLowerCase() === identity.login.toLowerCase() &&
        (comment.authorType === "User" || comment.authorType === "Bot") &&
        (identity.appId === undefined ||
          (comment.authorType === "Bot" && comment.appId === identity.appId)) &&
        readSuggestion(comment.body) !== undefined,
    )
    .sort((a, b) => a.id - b.id)[0];
}
