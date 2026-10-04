import { createHmac, randomUUID } from "node:crypto"

export const base64urlEncode = (input: string | Uint8Array): string =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

export type JwtArgs = {
  issuer: string
  secret: string
  nowMs?: number
  jti?: string
  ttlSeconds?: number
}

export const createJwt = ({
  issuer,
  secret,
  nowMs = Date.now(),
  jti = randomUUID(),
  ttlSeconds = 60,
}: JwtArgs): string => {
  if (!issuer) throw new Error("missing AMO JWT issuer")
  if (!secret) throw new Error("missing AMO JWT secret")
  const iat = Math.floor(nowMs / 1000)
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64urlEncode(
    JSON.stringify({ iss: issuer, jti, iat, exp: iat + ttlSeconds }),
  )
  const signature = base64urlEncode(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest(),
  )
  return `${header}.${payload}.${signature}`
}
