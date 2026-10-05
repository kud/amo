import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  buildListingPatch,
  diffListing,
  parsePreviewState,
  planPreviewSync,
  readListingFile,
} from "./listing.js"
import type { PreviewState } from "./listing.js"
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
  const shots = [
    { file: "0-banner.png", caption: null, sha256: "aaa" },
    { file: "1-popup.png", caption: "Popup", sha256: "bbb" },
  ]
  const live = [
    { id: 21, position: 1, caption: { "en-US": "Popup" } },
    { id: 20, position: 0, caption: null },
  ]
  const state: PreviewState = {
    version: 1,
    previews: [
      { id: 20, file: "0-banner.png", sha256: "aaa", caption: null },
      { id: 21, file: "1-popup.png", sha256: "bbb", caption: "Popup" },
    ],
  }

  it("skips sync when there are no local screenshots", () => {
    expect(
      planPreviewSync([], [{ id: 7, caption: { "en-US": "old" } }]).inSync,
    ).toBe(true)
  })

  it("is in sync when live ids, hashes and captions all match the state", () => {
    expect(planPreviewSync(shots, live, { state })).toEqual({
      inSync: true,
      reason: "in-sync",
      deletes: [],
      uploads: [],
    })
  })

  it("replaces everything, in name order with positions, when there is no state", () => {
    const plan = planPreviewSync(
      shots,
      [
        { id: 418921, caption: null },
        { id: 418918, caption: null },
      ],
      { state: null },
    )
    expect(plan).toEqual({
      inSync: false,
      reason: "no-state",
      deletes: [418921, 418918],
      uploads: [
        { file: "0-banner.png", caption: null, sha256: "aaa", position: 0 },
        { file: "1-popup.png", caption: "Popup", sha256: "bbb", position: 1 },
      ],
    })
  })

  it("notices a replaced image with an unchanged caption", () => {
    const changed = [shots[0]!, { ...shots[1]!, sha256: "ccc" }]
    const plan = planPreviewSync(changed, live, { state })
    expect(plan.reason).toBe("local-changed")
    expect(plan.deletes).toEqual([20, 21])
  })

  it("notices two uncaptioned images swapping places", () => {
    const plain = [
      { file: "a.png", caption: null, sha256: "aaa" },
      { file: "b.png", caption: null, sha256: "bbb" },
    ]
    const swapped = [
      { file: "a.png", caption: null, sha256: "bbb" },
      { file: "b.png", caption: null, sha256: "aaa" },
    ]
    const plainState: PreviewState = {
      version: 1,
      previews: [
        { id: 1, file: "a.png", sha256: "aaa", caption: null },
        { id: 2, file: "b.png", sha256: "bbb", caption: null },
      ],
    }
    const plainLive = [
      { id: 1, position: 0, caption: null },
      { id: 2, position: 1, caption: null },
    ]
    expect(
      planPreviewSync(plain, plainLive, { state: plainState }).inSync,
    ).toBe(true)
    expect(
      planPreviewSync(swapped, plainLive, { state: plainState }).reason,
    ).toBe("local-changed")
  })

  it("notices previews changed on AMO since the last sync", () => {
    const edited = [live[1]!, { id: 99, position: 1, caption: null }]
    expect(planPreviewSync(shots, edited, { state }).reason).toBe(
      "live-changed",
    )
    const recaptioned = [
      { ...live[1]!, caption: { "en-US": "Edited" } },
      live[0]!,
    ]
    expect(planPreviewSync(shots, recaptioned, { state }).reason).toBe(
      "live-changed",
    )
  })

  it("notices a local caption change", () => {
    const recaptioned = [shots[0]!, { ...shots[1]!, caption: "New" }]
    expect(planPreviewSync(recaptioned, live, { state }).reason).toBe(
      "local-changed",
    )
  })

  it("never trusts a shot without a hash", () => {
    const unhashed = shots.map(({ file, caption }) => ({ file, caption }))
    expect(planPreviewSync(unhashed, live, { state }).inSync).toBe(false)
  })

  it("replaces regardless when forced", () => {
    const plan = planPreviewSync(shots, live, { state, force: true })
    expect(plan.reason).toBe("forced")
    expect(plan.uploads.map(({ position }) => position)).toEqual([0, 1])
  })
})

describe("parsePreviewState", () => {
  it("accepts a well-formed state", () => {
    const state = {
      version: 1,
      previews: [{ id: 1, file: "a.png", sha256: "x", caption: null }],
    }
    expect(parsePreviewState(state)).toEqual(state)
  })

  it("rejects anything else", () => {
    expect(() => parsePreviewState({ previews: [] })).toThrow(/not a valid/)
    expect(() =>
      parsePreviewState({ version: 1, previews: [{ id: "1" }] }),
    ).toThrow(/not a valid/)
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
