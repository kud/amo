import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  buildListingPatch,
  diffListing,
  planPreviewSync,
  readListingFile,
} from "./listing.js"
import type { Listing } from "./types.js"

const liveAddon = () => ({
  name: { "en-US": "Fox Hop" },
  summary: { "en-US": "Focus a tab" },
  description: {
    "en-US":
      'Focus <a href="https://prod.outgoing.prod.webservices.mozgcp.net/v1/0123456789abcdef/https%3A//github.com/acme/widget">link</a> &amp; more',
  },
  homepage: { "en-US": null },
  support_email: null,
  support_url: { "en-US": "https://github.com/acme/widget" },
  categories: { firefox: ["tabs"] },
  tags: [],
})

const localListing = (): Listing => ({
  name: { "en-US": "Fox Hop" },
  summary: { "en-US": "Focus a tab" },
  description: {
    "en-US": 'Focus <a href="https://github.com/acme/widget">link</a> & more',
  },
  homepage: null,
  support_url: { "en-US": "https://github.com/acme/widget" },
  categories: ["tabs"],
  tags: [],
})

describe("diffListing", () => {
  it("reports no diff when proxy links and entities are normalised", () => {
    expect(diffListing(localListing(), liveAddon())).toEqual([])
  })

  it("builds a patch with only the changed fields", () => {
    const changed = diffListing(
      { ...localListing(), name: { "en-US": "Fox Hop 2" } },
      liveAddon(),
    )
    expect(changed.map((c) => c.field)).toEqual(["name"])
    expect(buildListingPatch(changed)).toEqual({
      name: { "en-US": "Fox Hop 2" },
    })
  })

  it("ignores tag order and flags real tag changes", () => {
    const live = { ...liveAddon(), tags: ["b", "a"] }
    expect(diffListing({ ...localListing(), tags: ["a", "b"] }, live)).toEqual(
      [],
    )
    expect(
      diffListing({ ...localListing(), tags: ["a"] }, live).map((c) => c.field),
    ).toEqual(["tags"])
  })

  it("treats null and { en-US: null } as equal", () => {
    expect(
      diffListing({ ...localListing(), homepage: null }, liveAddon()),
    ).toEqual([])
  })

  it("follows the nested support_url { url, outgoing } shape", () => {
    const live = {
      ...liveAddon(),
      support_url: {
        url: { "en-US": "https://github.com/acme/widget" },
        outgoing: { "en-US": "https://outgoing.example/x" },
      },
    }
    expect(diffListing(localListing(), live)).toEqual([])
  })

  it("does not touch fields the local listing leaves out", () => {
    expect(diffListing({ name: { "en-US": "Fox Hop" } }, liveAddon())).toEqual(
      [],
    )
  })

  it("detects a support_email to set", () => {
    const changed = diffListing(
      { support_email: { "en-US": "hi@example.com" } },
      liveAddon(),
    )
    expect(changed.map((c) => c.field)).toEqual(["support_email"])
  })
})

describe("planPreviewSync", () => {
  it("skips sync when there are no local screenshots", () => {
    expect(
      planPreviewSync([], [{ id: 7, caption: { "en-US": "old" } }]).inSync,
    ).toBe(true)
  })

  it("stays in sync when captions match in order", () => {
    const plan = planPreviewSync(
      [{ file: "a.png", caption: "A" }],
      [{ id: 1, caption: { "en-US": "A" } }],
    )
    expect(plan.inSync).toBe(true)
  })

  it("replaces every live preview when captions differ", () => {
    const plan = planPreviewSync(
      [{ file: "a.png", caption: "B" }],
      [{ id: 1, caption: { "en-US": "A" } }],
    )
    expect(plan).toEqual({
      inSync: false,
      deletes: [1],
      uploads: [{ file: "a.png", caption: "B" }],
    })
  })
})

describe("readListingFile", () => {
  it("reads a listing from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amo-"))
    const path = join(dir, "listing.json")
    await writeFile(path, JSON.stringify(localListing()))
    expect(await readListingFile(path)).toEqual(localListing())
  })

  it("rejects missing files and malformed content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amo-"))
    await expect(readListingFile(join(dir, "nope.json"))).rejects.toThrow(
      /cannot read/,
    )
    const bad = join(dir, "bad.json")
    await writeFile(bad, "{")
    await expect(readListingFile(bad)).rejects.toThrow(/cannot parse/)
    const wrong = join(dir, "wrong.json")
    await writeFile(wrong, JSON.stringify({ tags: "x" }))
    await expect(readListingFile(wrong)).rejects.toThrow(/tags/)
  })
})
