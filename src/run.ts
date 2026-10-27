import { findManagedComment, readSuggestion, renderComment } from "./comment";
import { selectReviewer } from "./selection";
import type { AssignmentStatus, GitHubApi, Options, RunResult, Target } from "./model";
export async function run(
  options: Options,
  target: Target,
  api: GitHubApi,
  random = Math.random,
): Promise<RunResult> {
  const identity = await api.checkAccess(target, options.organizations);
  const pull = await api.getPull(target);
  const eligible = options.reviewers.filter(
    (login) => login.toLowerCase() !== pull.author.toLowerCase(),
  );
  if (!eligible.length)
    throw new Error("No eligible reviewers remain after excluding the PR author");
  const counts = await api.getCounts(target, options.organizations, eligible);
  const comment = findManagedComment(await api.listComments(target), identity);
  const suggestion = selectReviewer(
    eligible,
    pull.author,
    counts,
    pull.requestedReviewers,
    comment ? readSuggestion(comment.body) : undefined,
    random,
  );
  const alreadyRequested = pull.requestedReviewers.some(
    (login) => login.toLowerCase() === suggestion.reviewer.toLowerCase(),
  );
  let assigned = false;
  let status: AssignmentStatus = alreadyRequested ? "already-requested" : "suggested";
  if (options.assignReviewer && !alreadyRequested) {
    await api.requestReview(target, suggestion.reviewer);
    assigned = true;
    status = "requested";
  }
  const body = renderComment(suggestion, status);
  if (comment) await api.updateComment(target, comment.id, body);
  else await api.createComment(target, body);
  return { ...suggestion, assigned };
}
