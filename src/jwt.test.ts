import { createHmac } from "node:crypto"
import { describe, it, expect } from "vitest"
import { base64urlEncode, createJwt } from "./jwt.js"

const decodePart = (part: string) =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"))

describe("createJwt", () => {
  const args = {
    issuer: "user:1:2",
    secret: "s3cret",
    nowMs: 1_700_000_000_123,
    jti: "fixed-jti",
  }

  it("emits a verifiable HS256 token with exp = iat + 60", () => {
    const [header, payload, signature] = createJwt(args).split(".")
    expect(decodePart(header)).toEqual({ alg: "HS256", typ: "JWT" })
    const body = decodePart(payload)
    expect(body).toMatchObject({ iss: "user:1:2", jti: "fixed-jti" })
    expect(body.iat).toBe(1_700_000_000)
    expect(body.exp - body.iat).toBe(60)
    const expected = base64urlEncode(
      createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest(),
    )
    expect(signature).toBe(expected)
  })

  it("uses a unique jti per token by default", () => {
    const a = decodePart(createJwt({ issuer: "i", secret: "s" }).split(".")[1])
    const b = decodePart(createJwt({ issuer: "i", secret: "s" }).split(".")[1])
    expect(a.jti).not.toBe(b.jti)
  })

  it("rejects a missing issuer or secret", () => {
    expect(() => createJwt({ issuer: "", secret: "s" })).toThrow(/issuer/)
    expect(() => createJwt({ issuer: "i", secret: "" })).toThrow(/secret/)
  })
})
