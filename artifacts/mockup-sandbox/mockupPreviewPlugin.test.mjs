import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin.ts";

test("discovery retains nested TSX previews and excludes private files/directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mockup-discovery-"));
  try {
    for (const file of [
      "Hero.tsx",
      "nested/Card.tsx",
      "_Private.tsx",
      "_internal/Hidden.tsx",
      "nested/_Private.tsx",
      ".hidden.tsx",
      "notes.ts",
      "not-a-component.txt",
    ]) {
      const target = path.join(root, "src/components/mockups", file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        "export default function Preview() { return null; }",
      );
    }
    const plugin = mockupPreviewPlugin();
    plugin.configResolved({ root });
    await plugin.buildStart();
    const output = await readFile(
      path.join(root, "src/.generated/mockup-components.ts"),
      "utf8",
    );
    assert.match(output, /"\.\/components\/mockups\/Hero\.tsx"/);
    assert.match(output, /"\.\/components\/mockups\/nested\/Card\.tsx"/);
    assert.equal((output.match(/=> import\(/g) || []).length, 2);
    assert.doesNotMatch(output, /Private|Hidden|hidden|notes|not-a-component/);
    await plugin.buildStart();
    assert.equal(
      await readFile(
        path.join(root, "src/.generated/mockup-components.ts"),
        "utf8",
      ),
      output,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing mockup directory generates an empty registry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mockup-empty-"));
  try {
    const plugin = mockupPreviewPlugin();
    plugin.configResolved({ root });
    await plugin.buildStart();
    const output = await readFile(
      path.join(root, "src/.generated/mockup-components.ts"),
      "utf8",
    );
    assert.doesNotMatch(output, /=> import\(/);
    assert.match(output, /export const modules: ModuleMap = \{/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
