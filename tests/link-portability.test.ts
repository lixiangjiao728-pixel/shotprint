import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import test from "node:test";

test("portable source files contain no machine absolute user paths", async () => {
  const files = glob("{app,lib,public,worker,extension,tests}/**/*", { cwd: new URL("../", import.meta.url), withFileTypes: false });
  for await (const file of files) {
    if (!/\.(ts|tsx|js|json|css|md|mjs)$/.test(file)) continue;
    const content = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/(?:[A-Za-z]:\\Users\\|C:\\Users\\)/.test(content), false, `absolute path in ${file}`);
  }
});
