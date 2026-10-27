import { expect, it } from "vite-plus/test";
import { renderComment, readSuggestion, findManagedComment } from "../src/comment";
it.each(["suggested", "requested", "already-requested"] as const)(
  "renders one selection with truthful %s status",
  (status) => {
    const body = renderComment({ reviewer: "Alice", reviewCount: 2 }, status);
    expect(body).toContain("### Review roulette");
    expect(body).toContain("| Category | Suggested reviewer |");
    expect(body).toContain("| All | @Alice — 2 pending review requests |");
    expect(body).toContain(
      {
        suggested: "Suggestion only",
        requested: "Review requested",
        "already-requested": "Review already requested",
      }[status],
    );
    expect(readSuggestion(body)).toBe("Alice");
  },
);
it("renders singular workload", () => {
  expect(renderComment({ reviewer: "Bob", reviewCount: 1 }, "suggested")).toContain(
    "1 pending review request |",
  );
});
it.each([
  "hello",
  "<!-- review-roulette:v2:Alice -->",
  "<!-- review-roulette:v1:bad login -->",
  "<!-- review-roulette:v1:-bad -->",
  "<!-- review-roulette:v1:Alice -->\n<!-- review-roulette:v1:Bob -->",
])("ignores invalid markers", (body) => {
  expect(readSuggestion(body)).toBeUndefined();
});
it("ignores copied markers and picks earliest owned valid comment", () => {
  const body = renderComment({ reviewer: "Alice", reviewCount: 0 }, "suggested");
  const comments = [
    { id: 1, body, authorLogin: "mallory", authorType: "User" },
    { id: 5, body, authorLogin: "roulette[bot]", authorType: "Bot", appId: 10 },
    { id: 3, body, authorLogin: "roulette[bot]", authorType: "Bot", appId: 10 },
    { id: 2, body, authorLogin: "roulette[bot]", authorType: "Bot", appId: 11 },
  ];
  expect(findManagedComment(comments, { login: "roulette[bot]", appId: 10 })?.id).toBe(3);
});
it("supports authenticated user comments and rejects unmarked ones", () => {
  const comments = [
    { id: 1, body: "unmarked", authorLogin: "Alice", authorType: "User" },
    {
      id: 2,
      body: renderComment({ reviewer: "Bob", reviewCount: 0 }, "suggested"),
      authorLogin: "alice",
      authorType: "User",
    },
  ];
  expect(findManagedComment(comments, { login: "Alice" })?.id).toBe(2);
  expect(findManagedComment(comments, { login: "other" })).toBeUndefined();
});
