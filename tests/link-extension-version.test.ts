import assert from "node:assert/strict";
import test from "node:test";
import { compareExtensionVersions, extensionCompatibility } from "../lib/extension-version.ts";

test("extension compatibility accepts current and newer releases without accepting older or malformed bridges", () => {
  assert.equal(extensionCompatibility("0.6.0", "0.6.0"), "compatible");
  assert.equal(extensionCompatibility("0.6.1", "0.6.0"), "compatible");
  assert.equal(extensionCompatibility("0.7.0", "0.6.0"), "compatible");
  assert.equal(extensionCompatibility("0.5.9", "0.6.0"), "outdated");
  assert.equal(extensionCompatibility("1.0.0", "0.6.0"), "invalid");
  assert.equal(extensionCompatibility("not-a-version", "0.6.0"), "invalid");
});

test("version comparison lets the page retain the newest bridge when two unpacked extensions announce", () => {
  assert.equal(compareExtensionVersions("0.6.0", "0.5.0"), 1);
  assert.equal(compareExtensionVersions("0.5.0", "0.6.0"), -1);
  assert.equal(compareExtensionVersions("0.6.0", "0.6.0"), 0);
  assert.equal(compareExtensionVersions("broken", "0.6.0"), null);
});
