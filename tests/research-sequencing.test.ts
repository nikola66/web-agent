import test from "node:test";
import assert from "node:assert/strict";

import {
  isResearchIntent,
  inputSuggestsMultimodal,
  inputSuggestsArchive,
  inputSuggestsDocument,
  buildFileHandlingContextPrefix,
} from "../dist/agent-runtime/turn-sequencing.js";

const BENCHMARK_PROMPT =
  "Please help me find YouTubers in UAE and KSA posting about openclaw and hermes agent";

test("isResearchIntent matches benchmark discover prompt", () => {
  assert.equal(isResearchIntent(BENCHMARK_PROMPT), true);
});

test("isResearchIntent is false for unrelated tasks", () => {
  assert.equal(isResearchIntent("Fix the typo in README.md"), false);
});

test("inputSuggestsMultimodal detects attachments, data URLs, and YouTube links", () => {
  assert.equal(inputSuggestsMultimodal("what is in this screenshot?"), true);
  assert.equal(inputSuggestsMultimodal("uploads/diagram.png"), true);
  assert.equal(inputSuggestsMultimodal("describe photo.jpeg"), true);
  assert.equal(inputSuggestsMultimodal("transcribe https://youtu.be/abc123"), true);
  assert.equal(inputSuggestsMultimodal('{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBOR"}}'), true);
  assert.equal(inputSuggestsMultimodal("transcribe this recording"), true);
  // No false positive on plain text tasks.
  assert.equal(inputSuggestsMultimodal("Fix the typo in README.md"), false);
  assert.equal(inputSuggestsMultimodal("Summarize the quarterly report"), false);
});

test("inputSuggestsArchive detects archive uploads and extract intent", () => {
  assert.equal(inputSuggestsArchive("uploads/directus-5lang-blog-publisher2.zip"), true);
  assert.equal(inputSuggestsArchive("here is the bundle.tar.gz"), true);
  assert.equal(inputSuggestsArchive("data.tgz"), true);
  assert.equal(inputSuggestsArchive("please unzip this archive"), true);
  // No false positive on plain text / unrelated extensions.
  assert.equal(inputSuggestsArchive("Fix the typo in README.md"), false);
  assert.equal(inputSuggestsArchive("read config.json"), false);
});

test("inputSuggestsDocument detects pdf and docx references", () => {
  assert.equal(inputSuggestsDocument("uploads/report.pdf"), true);
  assert.equal(inputSuggestsDocument("summarize contract.docx"), true);
  assert.equal(inputSuggestsDocument("Fix the typo in README.md"), false);
});

test("buildFileHandlingContextPrefix routes each file type to its tool", () => {
  const zipPrefix = buildFileHandlingContextPrefix("uploads/skill.zip");
  assert.match(zipPrefix, /extract_archive/);
  assert.match(zipPrefix, /Never run_python zipfile to EXTRACT/);

  const pdfPrefix = buildFileHandlingContextPrefix("uploads/report.pdf");
  assert.match(pdfPrefix, /pdf_extract/);

  const imgPrefix = buildFileHandlingContextPrefix("what is in uploads/diagram.png?");
  assert.match(imgPrefix, /vision_analyze/);

  // Plain-text task → no prefix.
  assert.equal(buildFileHandlingContextPrefix("Fix the typo in README.md"), null);
});
