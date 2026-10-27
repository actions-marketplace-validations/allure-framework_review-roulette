import { defineConfig } from "vite-plus";
export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "coverage/**"],
  },
  fmt: {
    ignorePatterns: [
      "dist/**",
      "coverage/**",
      "yarn.lock",
      "docs/superpowers/**",
      ".superpowers/**",
    ],
  },
  pack: {
    entry: { index: "src/index.ts" },
    platform: "node",
    target: "node24",
    format: "esm",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    dts: false,
    clean: true,
    outDir: "dist",
    outExtensions: () => ({ js: ".js" }),
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/model.ts", "src/index.ts"],
    },
  },
});
