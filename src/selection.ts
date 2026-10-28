import type { Suggestion } from "./model";
export function selectReviewer(
  reviewers: string[],
  author: string,
  counts: ReadonlyMap<string, number>,
  requestedReviewers: string[],
  previousReviewer: string | undefined,
  random: () => number,
): Suggestion {
  const normalized = new Map([...counts].map(([login, count]) => [login.toLowerCase(), count]));
  const candidates = reviewers
    .filter((login) => login.toLowerCase() !== author.toLowerCase())
    .map((reviewer) => {
      const reviewCount = normalized.get(reviewer.toLowerCase());
      if (reviewCount === undefined || !Number.isSafeInteger(reviewCount) || reviewCount < 0)
        throw new Error("Invalid or missing reviewer workload count");
      return { reviewer, reviewCount };
    });
  if (!candidates.length)
    throw new Error("No eligible reviewers remain after excluding the PR author");
  const minimum = Math.min(...candidates.map((candidate) => candidate.reviewCount));
  const previous = candidates.find(
    (candidate) => candidate.reviewer.toLowerCase() === previousReviewer?.toLowerCase(),
  );
  if (
    previous &&
    (previous.reviewCount === minimum ||
      requestedReviewers.some((login) => login.toLowerCase() === previous.reviewer.toLowerCase()))
  )
    return previous;
  const tied = candidates.filter((candidate) => candidate.reviewCount === minimum);
  return tied[Math.floor(random() * tied.length)];
}
