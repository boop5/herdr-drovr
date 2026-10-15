#!/usr/bin/env node
import assert from "node:assert";
import { test } from "node:test";
import {
  rootFromFlatSnapshot,
  anchorOf,
  leavesOf,
  paneDestLines,
  parsePaneChoice,
  searchScript,
  searchScriptPs,
  togglePsScript,
  NEW_TAB_TOKEN,
  NEW_WS_TOKEN,
} from "./pick-and-move.ts";
import type { Rect, LayoutSnapshot, SnapshotPane, SplitNode, TabEntry, WorkspaceEntry } from "./pick-and-move.ts";

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const pane = (pane_id: string, r: Rect): SnapshotPane => ({ pane_id, rect: r, focused: false });

test("a tab with a single pane and no splits reconstructs as that pane", () => {
  const snap: LayoutSnapshot = { area: rect(0, 0, 100, 50), panes: [pane("p1", rect(0, 0, 100, 50))], splits: [] };
  assert.deepStrictEqual(rootFromFlatSnapshot(snap), { type: "pane", pane_id: "p1" });
});

test("split boundaries come from reported rects, not ratio arithmetic: 101 wide at ratio 0.5, server boundary at 50 while Math.round gives 51", () => {
  const snap: LayoutSnapshot = {
    area: rect(0, 0, 101, 40),
    panes: [pane("a", rect(0, 0, 50, 40)), pane("b", rect(50, 0, 51, 40))],
    splits: [{ direction: "right", ratio: 0.5, rect: rect(0, 0, 101, 40) }],
  };
  const root = rootFromFlatSnapshot(snap);
  assert.strictEqual(root.type, "split");
  assert.deepStrictEqual(leavesOf(root), ["a", "b"]);
});

test("nested splits with mixed directions reconstruct the full tree", () => {
  const snap: LayoutSnapshot = {
    area: rect(0, 0, 100, 60),
    panes: [
      pane("a1", rect(0, 0, 60, 30)),
      pane("a2", rect(0, 30, 60, 30)),
      pane("b", rect(60, 0, 40, 60)),
    ],
    splits: [
      { direction: "right", ratio: 0.6, rect: rect(0, 0, 100, 60) },
      { direction: "down", ratio: 0.5, rect: rect(0, 0, 60, 60) },
    ],
  };
  const root = rootFromFlatSnapshot(snap);
  assert.deepStrictEqual(root, {
    type: "split",
    direction: "right",
    ratio: 0.6,
    first: {
      type: "split",
      direction: "down",
      ratio: 0.5,
      first: { type: "pane", pane_id: "a1" },
      second: { type: "pane", pane_id: "a2" },
    },
    second: { type: "pane", pane_id: "b" },
  });
  assert.strictEqual(anchorOf(root), "a1");
  assert.deepStrictEqual(leavesOf(root), ["a1", "a2", "b"]);
});

test("a nested split on the second side picks the larger rect when a grandchild shares the parent's far edge", () => {
  const snap: LayoutSnapshot = {
    area: rect(0, 0, 100, 40),
    panes: [
      pane("a", rect(0, 0, 40, 40)),
      pane("b1", rect(40, 0, 30, 40)),
      pane("b2", rect(70, 0, 30, 40)),
    ],
    splits: [
      { direction: "right", ratio: 0.4, rect: rect(0, 0, 100, 40) },
      { direction: "right", ratio: 0.5, rect: rect(40, 0, 60, 40) },
    ],
  };
  const root = rootFromFlatSnapshot(snap);
  assert.deepStrictEqual(leavesOf(root), ["a", "b1", "b2"]);
  assert.strictEqual((root as SplitNode).second.type, "split");
});

test("a pane missing from the snapshot throws instead of misbuilding", () => {
  const snap: LayoutSnapshot = {
    area: rect(0, 0, 100, 40),
    panes: [pane("a", rect(0, 0, 50, 40))],
    splits: [{ direction: "right", ratio: 0.5, rect: rect(0, 0, 100, 40) }],
  };
  assert.throws(() => rootFromFlatSnapshot(snap), /could not find the second child/);
});

test("a malformed snapshot throws", () => {
  assert.throws(() => rootFromFlatSnapshot({} as LayoutSnapshot), /missing area\/panes\/splits/);
});

const tabs: TabEntry[] = [
  { tab_id: "w1:t1", workspace_id: "w1", label: "src" },
  { tab_id: "w1:t2", workspace_id: "w1", label: "logs" },
  { tab_id: "w2:t1", workspace_id: "w2", label: "api" },
  { tab_id: "w2:t2", workspace_id: "w2" },
];
const workspaces: WorkspaceEntry[] = [
  { workspace_id: "w1", label: "web" },
  { workspace_id: "w2", label: "backend" },
];

test("pane destinations exclude the source tab and stay within the source workspace by default", () => {
  assert.deepStrictEqual(paneDestLines(tabs, workspaces, "w1:t1", "w1", false), [
    "logs\ttab:w1:t2",
  ]);
});

test("the all-workspaces view lists source-workspace tabs first and prefixes foreign tabs with their workspace label", () => {
  assert.deepStrictEqual(paneDestLines(tabs, workspaces, "w1:t1", "w1", true), [
    "logs\ttab:w1:t2",
    "backend / api\ttab:w2:t1",
    "backend / w2:t2\ttab:w2:t2",
  ]);
});

test("enter confirms with a right split, alt-d with a down split, and tab ids with colons survive parsing", () => {
  assert.deepStrictEqual(parsePaneChoice("", "logs\ttab:w1:t2"), {
    direction: "right",
    dest: { kind: "tab", tabId: "w1:t2" },
  });
  assert.deepStrictEqual(parsePaneChoice("alt-d", "logs\ttab:w1:t2"), {
    direction: "down",
    dest: { kind: "tab", tabId: "w1:t2" },
  });
});

test("sentinel rows parse to new-tab and new-workspace destinations", () => {
  assert.deepStrictEqual(parsePaneChoice("", `＋ new tab\t${NEW_TAB_TOKEN}`), {
    direction: "right",
    dest: { kind: "new-tab" },
  });
  assert.deepStrictEqual(parsePaneChoice("alt-d", `＋ new workspace\t${NEW_WS_TOKEN}`), {
    direction: "down",
    dest: { kind: "new-workspace" },
  });
});

test("lines without a token or with an unknown token parse to null", () => {
  assert.strictEqual(parsePaneChoice("", "no token here"), null);
  assert.strictEqual(parsePaneChoice("", "label\tgarbage"), null);
});

// The search script is real shell run under fzf's reload; exercise it as such.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runSearch(query: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drovr-test-"));
  try {
    const candidates = path.join(dir, "tabs.txt");
    fs.writeFileSync(candidates, "logs\ttab:w1:t2\napi\ttab:w2:t1");
    const sh = path.join(dir, "search.sh");
    fs.writeFileSync(sh, searchScript(`'${candidates}'`, [["＋ new tab", NEW_TAB_TOKEN], ["＋ new workspace", NEW_WS_TOKEN]]));
    const r = spawnSync("sh", [sh, query], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.split("\n").filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MUTE = "\x1b[38;5;8m";
const UNMUTE = "\x1b[0m";

test("an empty query lists every candidate, then the muted sentinels", () => {
  assert.deepStrictEqual(runSearch(""), [
    "logs\ttab:w1:t2",
    "api\ttab:w2:t1",
    `${MUTE}＋ new tab${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

test("a query puts matches first and stamps it on the sentinels", () => {
  assert.deepStrictEqual(runSearch("log"), [
    "logs\ttab:w1:t2",
    `${MUTE}＋ new tab “log”${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace “log”${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

test("a query matching nothing still offers the named sentinels", () => {
  assert.deepStrictEqual(runSearch("my new thing"), [
    `${MUTE}＋ new tab “my new thing”${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace “my new thing”${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

// Windows: the reload script is PowerShell, run by fzf as
// `powershell -NoProfile -ExecutionPolicy Bypass -File <script>` with the
// typed query in FZF_QUERY; exercise it the same way.
const IS_WIN32 = process.platform === "win32";
const HAS_PS = IS_WIN32 && spawnSync("powershell", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" }).status === 0;
const HAS_FZF = spawnSync("fzf", ["--version"], { encoding: "utf8" }).status === 0;

function runSearchPs(query: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drovr-test-"));
  try {
    const candidates = path.join(dir, "tabs.txt");
    fs.writeFileSync(candidates, "logs\ttab:w1:t2\r\napi\ttab:w2:t1\r\n");
    const ps1 = path.join(dir, "search.ps1");
    fs.writeFileSync(ps1, "\ufeff" + searchScriptPs(`$cand = '${candidates}'`, [["＋ new tab", NEW_TAB_TOKEN], ["＋ new workspace", NEW_WS_TOKEN]]));
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
      encoding: "utf8",
      env: { ...process.env, FZF_QUERY: query },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("windows: an empty query lists every candidate, then the muted sentinels", { skip: !HAS_PS ? "PowerShell not available" : false }, () => {
  assert.deepStrictEqual(runSearchPs(""), [
    "logs\ttab:w1:t2",
    "api\ttab:w2:t1",
    `${MUTE}＋ new tab${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

test("windows: a query puts matches first and stamps it on the sentinels", { skip: !HAS_PS || !HAS_FZF ? "PowerShell/fzf not available" : false }, () => {
  assert.deepStrictEqual(runSearchPs("log"), [
    "logs\ttab:w1:t2",
    `${MUTE}＋ new tab “log”${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace “log”${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

test("windows: a query matching nothing still offers the named sentinels", { skip: !HAS_PS || !HAS_FZF ? "PowerShell/fzf not available" : false }, () => {
  assert.deepStrictEqual(runSearchPs("my new thing"), [
    `${MUTE}＋ new tab “my new thing”${UNMUTE}\t${NEW_TAB_TOKEN}`,
    `${MUTE}＋ new workspace “my new thing”${UNMUTE}\t${NEW_WS_TOKEN}`,
  ]);
});

test("windows: the ctrl-t helper flips the marker and the prompt on each run", { skip: !HAS_PS ? "PowerShell not available" : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drovr-test-"));
  try {
    const allOn = path.join(dir, "all-on");
    const ps1 = path.join(dir, "toggle.ps1");
    fs.writeFileSync(ps1, togglePsScript(allOn));
    const run = () =>
      spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], { encoding: "utf8" });
    let r = run();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.replace(/^\uFEFF/, "").trim(), "change-prompt(move pane anywhere › )");
    assert.ok(fs.existsSync(allOn));
    r = run();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.replace(/^\uFEFF/, "").trim(), "change-prompt(move pane to › )");
    assert.ok(!fs.existsSync(allOn));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
