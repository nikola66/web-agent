import test from "node:test";
import assert from "node:assert/strict";

import { searchWorkspaceFiles, type WorkspaceFileIndex } from "../src/core/workspace-file-search.ts";
import {
  appendReferencedFilesNote,
  extractAtReferences,
  getAtReferenceQuery,
  insertAtReference,
} from "../src/ui/chat/at-reference.ts";

test("getAtReferenceQuery detects @ token at cursor", () => {
  assert.deepEqual(getAtReferenceQuery("@rep", 4), {
    query: "rep",
    replaceStart: 0,
    replaceEnd: 4,
  });
  assert.deepEqual(getAtReferenceQuery("see @up", 7), {
    query: "up",
    replaceStart: 4,
    replaceEnd: 7,
  });
  assert.deepEqual(getAtReferenceQuery("(@foo", 5), {
    query: "foo",
    replaceStart: 1,
    replaceEnd: 5,
  });
});

test("getAtReferenceQuery ignores email-like tokens", () => {
  assert.equal(getAtReferenceQuery("mail user@example.com", 21), null);
});

test("insertAtReference replaces active token and advances cursor", () => {
  const result = insertAtReference("Check @rep please", 6, 10, "work/report.md");
  assert.equal(result.nextValue, "Check @work/report.md  please");
  assert.equal(result.nextCursor, "Check @work/report.md ".length);
});

test("extractAtReferences dedupes workspace paths", () => {
  assert.deepEqual(
    extractAtReferences("Use @uploads/a.png and @work/report.md plus @uploads/a.png"),
    ["uploads/a.png", "work/report.md"]
  );
});

test("appendReferencedFilesNote adds footer once", () => {
  const message = "Review @work/report.md";
  const refs = extractAtReferences(message);
  const withNote = appendReferencedFilesNote(message, refs);
  assert.match(withNote, /Referenced workspace files: work\/report\.md/);
  assert.equal(appendReferencedFilesNote(withNote, refs), withNote);
});

test("searchWorkspaceFiles ranks basename matches ahead of path matches", () => {
  const index: WorkspaceFileIndex = {
    profileId: "demo",
    fetchedAt: Date.now(),
    entries: [
      {
        path: "work/report.md",
        size: 100,
        basename: "report.md",
        basenameLower: "report.md",
        pathLower: "work/report.md",
        kind: "markdown",
      },
      {
        path: "uploads/report.png",
        size: 200,
        basename: "report.png",
        basenameLower: "report.png",
        pathLower: "uploads/report.png",
        kind: "image",
      },
      {
        path: "notes/daily-report.txt",
        size: 50,
        basename: "daily-report.txt",
        basenameLower: "daily-report.txt",
        pathLower: "notes/daily-report.txt",
        kind: "markdown",
      },
    ],
  };

  const results = searchWorkspaceFiles(index, "report");
  assert.deepEqual(
    results.map((entry) => entry.path),
    ["work/report.md", "uploads/report.png", "notes/daily-report.txt"]
  );
});

test("searchWorkspaceFiles prefers exact basename matches", () => {
  const index: WorkspaceFileIndex = {
    profileId: "demo",
    fetchedAt: Date.now(),
    entries: [
      {
        path: "notes/my-report.md",
        size: 10,
        basename: "my-report.md",
        basenameLower: "my-report.md",
        pathLower: "notes/my-report.md",
        kind: "markdown",
      },
      {
        path: "report.md",
        size: 20,
        basename: "report.md",
        basenameLower: "report.md",
        pathLower: "report.md",
        kind: "markdown",
      },
    ],
  };

  const results = searchWorkspaceFiles(index, "report.md");
  assert.equal(results[0]?.path, "report.md");
});
