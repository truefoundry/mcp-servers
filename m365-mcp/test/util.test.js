/**
 * Unit tests for the pure helpers in src/tools/util.js.
 * Run with `npm test` (uses the built-in node:test runner).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  odataString,
  siteId,
  searchPhrase,
  dateRangeKql,
  toRecipients,
} from "../src/tools/util.js";

test("odataString doubles single quotes and percent-encodes", () => {
  assert.equal(odataString("inbox"), "inbox");
  assert.equal(odataString("a'b"), "a''b");
  assert.equal(odataString("a b"), "a%20b");
});

test("siteId preserves Graph's structural ':' '/' ',' but escapes spaces", () => {
  // hostname:path form — colon and slashes must stay literal.
  assert.equal(
    siteId("contoso.sharepoint.com:/sites/Team"),
    "contoso.sharepoint.com:/sites/Team",
  );
  // composite host,siteCollectionId,siteId form — commas must stay literal.
  assert.equal(siteId("contoso.sharepoint.com,abc,def"), "contoso.sharepoint.com,abc,def");
  // spaces (e.g. in a path) are still escaped.
  assert.equal(siteId("host:/sites/Team Site"), "host:/sites/Team%20Site");
});

test("searchPhrase wraps in quotes and strips embedded quotes", () => {
  assert.equal(searchPhrase("hello world"), '"hello world"');
  assert.equal(searchPhrase('say "hi"'), '"say  hi"');
});

test("dateRangeKql builds bounded clauses", () => {
  assert.equal(dateRangeKql("received", undefined), "");
  assert.equal(dateRangeKql("received", { start: "2024-01-01" }), "received>=2024-01-01");
  assert.equal(
    dateRangeKql("received", { start: "2024-01-01", end: "2024-12-31" }),
    "received>=2024-01-01 AND received<=2024-12-31",
  );
});

test("toRecipients maps addresses to Graph recipient objects", () => {
  assert.deepEqual(toRecipients(["a@x.com", "b@x.com"]), [
    { emailAddress: { address: "a@x.com" } },
    { emailAddress: { address: "b@x.com" } },
  ]);
  assert.deepEqual(toRecipients(), []);
});
