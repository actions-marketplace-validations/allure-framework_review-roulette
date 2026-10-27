import { expect, it } from "vite-plus/test";
import { selectReviewer } from "../src/selection";
const counts = new Map([
  ["alice", 1],
  ["bob", 2],
  ["carol", 1],
]);
it("excludes the author case insensitively and picks minimum", () => {
  expect(
    selectReviewer(["Alice", "Bob", "Carol"], "ALICE", counts, [], undefined, () => 0),
  ).toEqual({ reviewer: "Carol", reviewCount: 1 });
});
it("uses randomness only among minimum ties", () => {
  expect(
    selectReviewer(["Alice", "Bob", "Carol"], "other", counts, [], undefined, () => 0.99).reviewer,
  ).toBe("Carol");
});
it("retains a configured outstanding assignment above minimum", () => {
  expect(selectReviewer(["Alice", "Bob"], "other", counts, ["BOB"], "bob", () => 0).reviewer).toBe(
    "Bob",
  );
});
it("retains a tied suggestion but replaces an overloaded one", () => {
  expect(selectReviewer(["Alice", "Carol"], "other", counts, [], "carol", () => 0).reviewer).toBe(
    "Carol",
  );
  expect(selectReviewer(["Alice", "Bob"], "other", counts, [], "Bob", () => 0).reviewer).toBe(
    "Alice",
  );
});
it("ignores previous reviewers outside the eligible pool", () => {
  expect(
    selectReviewer(["Alice", "Bob"], "Alice", counts, ["alice"], "Alice", () => 0).reviewer,
  ).toBe("Bob");
});
it.each([undefined, -1, 1.5, NaN])("rejects invalid counts %s", (value) => {
  const values = value === undefined ? new Map<string, number>() : new Map([["alice", value]]);
  expect(() => selectReviewer(["Alice"], "other", values, [], undefined, () => 0)).toThrow();
});
it("rejects empty eligible pool", () => {
  expect(() => selectReviewer(["Alice"], "alice", counts, [], undefined, () => 0)).toThrow(
    /eligible/,
  );
});
