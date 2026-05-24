import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightPython } from "../src/agent/runtime/tools/python-preflight.js";

test("blocks subprocess soffice", () => {
  const src = `
import subprocess
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "doc.docx"])
`;
  const pre = preflightPython(src);
  assert.ok(pre.block, "should block");
  assert.match(pre.block!, /soffice/i);
  assert.match(pre.block!, /LibreOffice|python-docx/i);
});

test("blocks subprocess pdftoppm via string command", () => {
  const src = `import subprocess\nsubprocess.run("pdftoppm in.pdf out", shell=True)`;
  const pre = preflightPython(src);
  assert.ok(pre.block);
  assert.match(pre.block!, /pdftoppm/);
});

test("blocks os.system tesseract", () => {
  const src = `import os\nos.system("tesseract in.png out")`;
  const pre = preflightPython(src);
  assert.ok(pre.block);
  assert.match(pre.block!, /tesseract|OCR/);
});

test("blocks shutil.which gcc as a strong host-only signal", () => {
  const src = `import shutil\ngcc = shutil.which("gcc")`;
  const pre = preflightPython(src);
  assert.ok(pre.block);
  assert.match(pre.block!, /gcc/);
});

test("blocks pdf2image import (runtime poppler dependency)", () => {
  const src = `from pdf2image import convert_from_path`;
  const pre = preflightPython(src);
  assert.ok(pre.block);
  assert.match(pre.block!, /pdf2image/);
  assert.match(pre.block!, /pypdf|server/i);
});

test("blocks hallucinated `directus` SDK", () => {
  const src = `from directus import DirectusClient`;
  const pre = preflightPython(src);
  assert.ok(pre.block);
  assert.match(pre.block!, /directus/i);
  assert.match(pre.block!, /web_fetch|web_post/);
});

test("auto-loads python-docx for `import docx`", () => {
  const src = `import docx\ndoc = docx.Document()`;
  const pre = preflightPython(src);
  assert.equal(pre.block, undefined);
  assert.deepEqual(pre.autoPackages, ["python-docx"]);
});

test("auto-loads multiple office libs and dedupes against declared packages", () => {
  const src = `
from openpyxl import Workbook
import pypdf
from PIL import Image
import numpy as np
`;
  const pre = preflightPython(src, ["pypdf"]);
  assert.equal(pre.block, undefined);
  assert.ok(pre.autoPackages.includes("openpyxl"));
  assert.ok(pre.autoPackages.includes("Pillow"));
  assert.ok(pre.autoPackages.includes("numpy"));
  assert.ok(!pre.autoPackages.includes("pypdf"), "declared pypdf should not be re-added");
});

test("does not auto-load for stdlib-only imports", () => {
  const src = `
import os, json, urllib.request, re, sys
from pathlib import Path
print("hi")
`;
  const pre = preflightPython(src);
  assert.equal(pre.block, undefined);
  assert.deepEqual(pre.autoPackages, []);
});

test("warns but does not block raw socket usage", () => {
  const src = `import socket\ns = socket.socket(socket.AF_INET, socket.SOCK_STREAM)`;
  const pre = preflightPython(src);
  assert.equal(pre.block, undefined);
  assert.ok(pre.warnings.some((w) => /socket/i.test(w)));
});

test("warns on LD_PRELOAD / ctypes .so trickery", () => {
  const src = `
import os, ctypes
os.environ["LD_PRELOAD"] = "/tmp/shim.so"
lib = ctypes.CDLL("/tmp/shim.so")
`;
  const pre = preflightPython(src);
  assert.equal(pre.block, undefined);
  assert.ok(pre.warnings.some((w) => /LD_PRELOAD|ctypes/.test(w)));
});

test("ignores subprocess python/python3 (Pyodide-friendly meta-invocation)", () => {
  const src = `import subprocess\nsubprocess.run(["python3", "-c", "print(1)"])`;
  const pre = preflightPython(src);
  assert.equal(pre.block, undefined);
});
