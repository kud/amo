import { describe, it, expect, vi } from "vitest"
import {
  createAmoClient,
  getPublicAddon,
  isAmoError,
  redactHeaders,
  redactSecrets,
} from "./index.js"

type Call = { url: string; init: RequestInit }

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers })

const setup = (responses: (Response | Error)[]) => {
  const calls: Call[] = []
  const queue = [...responses]
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      const next = queue.shift()
      if (!next) throw new Error("no more responses")
      if (next instanceof Error) throw next
      return next
    },
  ) as unknown as typeof fetch
  const sleeps: number[] = []
  const client = createAmoClient({
    issuer: "user:1:2",
    secret: "top-secret-value",
    fetch: fetchMock,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  return { client, calls, sleeps }
}

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected rejection")
}

describe("createAmoClient", () => {
  it("requires credentials", () => {
    expect(() => createAmoClient({ issuer: "", secret: "s" })).toThrow()
  })

  it("GETs an add-on with a JWT authorization header", async () => {
    const { client, calls } = setup([json({ id: 1, guid: "a@b.c", slug: "a" })])
    const addon = await client.getAddon("a@b.c")
    expect(addon.slug).toBe("a")
    expect(calls[0].url).toBe(
      "https://addons.mozilla.org/api/v5/addons/addon/a@b.c/",
    )
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers["Authorization"]).toMatch(/^JWT [\w-]+\.[\w-]+\.[\w-]+$/)
  })

  it("PATCHes listing fields as JSON", async () => {
    const { client, calls } = setup([json({ id: 1, guid: "g", slug: "s" })])
    await client.updateListing("g", { name: { "en-US": "New" }, tags: ["x"] })
    expect(calls[0].init.method).toBe("PATCH")
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: { "en-US": "New" },
      tags: ["x"],
    })
  })

  it("uploads an icon as multipart", async () => {
    const { client, calls } = setup([json({ id: 1, guid: "g", slug: "s" })])
    await client.uploadIcon("g", {
      data: new Uint8Array([1, 2, 3]),
      filename: "icon.png",
    })
    const form = calls[0].init.body as FormData
    expect(form.get("icon")).toBeInstanceOf(Blob)
    expect((form.get("icon") as File).name).toBe("icon.png")
  })

  it("adds, captions and removes previews", async () => {
    const { client, calls } = setup([
      json({ id: 9 }, 201),
      json({ id: 9 }),
      new Response(null, { status: 204 }),
    ])
    await client.addPreview(
      "g",
      { data: new Uint8Array([1]), filename: "a.png" },
      {
        caption: "Hello",
      },
    )
    await client.updatePreviewCaption("g", 9, "Bye")
    await client.removePreview("g", 9)
    expect((calls[0].init.body as FormData).get("caption")).toBe(
      JSON.stringify({ "en-US": "Hello" }),
    )
    expect(calls[0].url.endsWith("/previews/")).toBe(true)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      caption: { "en-US": "Bye" },
    })
    expect(calls[2].init.method).toBe("DELETE")
    expect(calls[2].url.endsWith("/previews/9/")).toBe(true)
  })

  it("lists previews in position order", async () => {
    const { client } = setup([
      json({
        id: 1,
        guid: "g",
        slug: "s",
        previews: [
          { id: 2, caption: null, position: 1 },
          { id: 1, caption: null, position: 0 },
        ],
      }),
    ])
    expect((await client.listPreviews("g")).map((p) => p.id)).toEqual([1, 2])
  })

  it("follows pagination for versions and reports the latest status", async () => {
    const { client, calls } = setup([
      json({
        next: "https://addons.mozilla.org/api/v5/addons/addon/g/versions/?page=2",
        results: [{ id: 5, version: "1.0.0", file: { status: "public" } }],
      }),
      json({
        next: null,
        results: [
          {
            id: 6,
            version: "1.1.0",
            channel: "listed",
            file: { status: "unreviewed" },
          },
        ],
      }),
    ])
    const status = await client.getVersionStatus("g")
    expect(calls).toHaveLength(2)
    expect(status).toEqual({
      id: 6,
      version: "1.1.0",
      channel: "listed",
      fileStatus: "unreviewed",
      approved: false,
    })
  })

  it("returns null when there are no versions", async () => {
    const { client } = setup([json({ results: [], next: null })])
    expect(await client.getVersionStatus("g")).toBeNull()
  })
})

describe("errors", () => {
  it.each([
    [400, "bad-request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
  ])("maps HTTP %i to %s and keeps AMO's message", async (status, kind) => {
    const { client, sleeps } = setup([
      json({ detail: "Nope from AMO" }, status),
    ])
    const error = await catchError(client.getAddon("g"))
    expect(isAmoError(error)).toBe(true)
    expect(error).toMatchObject({ kind, status, detail: "Nope from AMO" })
    expect((error as Error).message).toContain("Nope from AMO")
    expect(sleeps).toEqual([])
  })

  it("formats per-field validation errors", async () => {
    const { client } = setup([json({ name: ["Too long.", "Bad."] }, 400)])
    const error = await catchError(client.updateListing("g", {}))
    expect((error as Error).message).toContain("name: Too long., Bad.")
  })

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const { client, calls, sleeps } = setup([
      json({ detail: "Throttled" }, 429, { "retry-after": "2" }),
      json({ id: 1, guid: "g", slug: "s" }),
    ])
    await client.getAddon("g")
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([2000])
  })

  it("backs off exponentially on 5xx and gives up after maxRetries", async () => {
    const { client, calls, sleeps } = setup([
      json({}, 503),
      json({}, 503),
      json({}, 503),
      json({}, 503),
    ])
    const error = await catchError(client.getAddon("g"))
    expect(error).toMatchObject({ kind: "server", status: 503 })
    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([500, 1000, 2000])
  })

  it("uses a fresh token for each attempt", async () => {
    const { client, calls } = setup([
      json({}, 500),
      json({ id: 1, guid: "g", slug: "s" }),
    ])
    await client.getAddon("g")
    const auth = (i: number) =>
      (calls[i].init.headers as Record<string, string>)["Authorization"]
    expect(auth(0)).not.toBe(auth(1))
  })

  it("never leaks the secret or token through errors", async () => {
    const { client, calls } = setup([
      new Error("boom top-secret-value"),
      new Error("boom top-secret-value"),
      new Error("boom top-secret-value"),
      new Error("boom top-secret-value"),
    ])
    const error = (await catchError(client.getAddon("g"))) as Error
    expect(error).toMatchObject({ kind: "network", status: null })
    expect(error.message).not.toContain("top-secret-value")
    const token = (calls[0].init.headers as Record<string, string>)[
      "Authorization"
    ]
    expect(JSON.stringify(error)).not.toContain(token.slice(4))
  })

  it("scrubs the secret from AMO responses that echo it", async () => {
    const { client } = setup([
      json({ detail: "bad key top-secret-value" }, 403),
    ])
    const error = (await catchError(client.getAddon("g"))) as Error
    expect(error.message).not.toContain("top-secret-value")
  })
})

describe("redaction", () => {
  it("redacts secrets in text and authorization headers", () => {
    expect(redactSecrets("a s3 b", ["s3", undefined])).toBe("a <redacted> b")
    expect(redactHeaders({ Authorization: "JWT abc", Accept: "x" })).toEqual({
      Authorization: "JWT <redacted>",
      Accept: "x",
    })
  })
})

describe("getPublicAddon", () => {
  it("reads anonymously, without an Authorization header", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ id: 1, guid: "a@b.c", slug: "x" }))
    }) as unknown as typeof fetch
    const addon = await getPublicAddon("a@b.c", { fetch: fakeFetch })
    expect(addon.slug).toBe("x")
    expect(calls[0].url).toBe(
      "https://addons.mozilla.org/api/v5/addons/addon/a@b.c/",
    )
    expect(calls[0].init).toBeUndefined()
  })

  it("throws a typed error on a failed read", async () => {
    const fakeFetch = (async () =>
      new Response("{}", { status: 404 })) as unknown as typeof fetch
    await expect(
      getPublicAddon("nope", { fetch: fakeFetch }),
    ).rejects.toMatchObject({ kind: "not-found" })
  })
})
