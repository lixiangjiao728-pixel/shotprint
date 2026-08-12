import assert from "node:assert/strict";
import test from "node:test";
import { researchErrorCode, researchFailureMessage } from "../lib/research-errors.ts";

test("provider timeout errors never leak the raw browser message", () => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  assert.equal(researchErrorCode(error), "RESEARCH_TIMEOUT");
  assert.doesNotMatch(researchFailureMessage("RESEARCH_SYNTHESIS_TIMEOUT"), /aborted|timeout/i);
  assert.match(researchFailureMessage("RESEARCH_SYNTHESIS_TIMEOUT"), /无需重新采集评论/);
});

test("known provider error codes remain unchanged", () => {
  assert.equal(researchErrorCode(new Error("SEARCH_AUTH_FAILED")), "SEARCH_AUTH_FAILED");
});
