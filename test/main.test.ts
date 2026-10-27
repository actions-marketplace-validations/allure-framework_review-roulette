import { beforeEach, expect, it, vi } from "vite-plus/test";
const doubles = vi.hoisted(() => ({
  inputs: {
    token: "secret",
    reviewers: "Alice",
    organizations: "",
    "assign-reviewer": "false",
  } as Record<string, string>,
  context: {
    eventName: "pull_request",
    payload: {
      number: 7,
      pull_request: {
        number: 7,
        base: { repo: { name: "project", owner: { login: "base-owner" } } },
        head: { repo: { name: "fork" } },
      },
    },
  } as { eventName: string; payload: Record<string, unknown> },
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  getInput: (key: string) => doubles.inputs[key],
  setOutput: doubles.setOutput,
  setFailed: doubles.setFailed,
  setSecret: doubles.setSecret,
}));
vi.mock("@actions/github", () => ({ context: doubles.context }));
vi.mock("../src/github", () => ({ createGitHubApi: doubles.create }));
vi.mock("../src/run", () => ({ run: doubles.run }));
import { main } from "../src/main";
beforeEach(() => {
  vi.clearAllMocks();
  doubles.run.mockResolvedValue({ reviewer: "Alice", reviewCount: 3, assigned: false });
});
it.each(["pull_request", "pull_request_target"])(
  "uses base repo and publishes outputs for %s",
  async (event) => {
    doubles.context.eventName = event;
    await main();
    expect(doubles.run.mock.calls.at(-1)?.[1]).toEqual({
      owner: "base-owner",
      repo: "project",
      pullNumber: 7,
    });
    expect(doubles.setOutput.mock.calls).toEqual([
      ["reviewer", "Alice"],
      ["review-count", 3],
      ["assigned", false],
    ]);
    expect(doubles.setSecret).toHaveBeenCalledWith("secret");
  },
);
it("fails before API work without PR context", async () => {
  const payload = doubles.context.payload;
  doubles.context.payload = {};
  await main();
  doubles.context.payload = payload;
  expect(doubles.create).not.toHaveBeenCalled();
  expect(doubles.setFailed.mock.calls[0][0]).toMatch(/pull.request/i);
});
it("sanitizes failure messages and never publishes partial outputs", async () => {
  doubles.run.mockRejectedValue(new Error("request failed with secret"));
  await main();
  expect(doubles.setOutput).not.toHaveBeenCalled();
  expect(doubles.setFailed).toHaveBeenCalledWith("request failed with ***");
});
it("reports a missing token before constructing the API", async () => {
  doubles.inputs.token = "";
  await main();
  doubles.inputs.token = "secret";
  expect(doubles.create).not.toHaveBeenCalled();
  expect(doubles.setFailed).toHaveBeenCalledWith("token is required");
});
it("handles non-Error failures without serializing arbitrary objects", async () => {
  doubles.run.mockRejectedValue({ token: "secret" });
  await main();
  expect(doubles.setFailed).toHaveBeenCalledWith("Review roulette failed");
});
