export type AmoErrorKind =
  | "bad-request"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "server"
  | "network"
  | "unexpected"

export type AmoError = Error & {
  name: "AmoError"
  kind: AmoErrorKind
  status: number | null
  detail: string
  retryAfterMs: number | null
}

type AmoErrorInput = {
  status: number | null
  detail: string
  retryAfterMs?: number | null
  kind?: AmoErrorKind
}

export const kindForStatus = (status: number | null): AmoErrorKind => {
  if (status === null) return "network"
  if (status === 400) return "bad-request"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not-found"
  if (status === 429) return "rate-limited"
  if (status >= 500) return "server"
  return "unexpected"
}

export const createAmoError = ({
  status,
  detail,
  retryAfterMs = null,
  kind = kindForStatus(status),
}: AmoErrorInput): AmoError => {
  const prefix =
    status === null
      ? "AMO request failed"
      : `AMO rejected the request (HTTP ${status})`
  const error = new Error(`${prefix}: ${detail || "(empty response)"}`)
  return Object.assign(error, {
    name: "AmoError" as const,
    kind,
    status,
    detail,
    retryAfterMs,
  })
}

export const isAmoError = (value: unknown): value is AmoError =>
  value instanceof Error && (value as { name?: unknown }).name === "AmoError"

export const formatErrorBody = (bodyText: string): string => {
  const trimmed = bodyText.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      if (typeof record["detail"] === "string") return record["detail"]
      return Object.entries(record)
        .map(
          ([key, errors]) =>
            `${key}: ${Array.isArray(errors) ? errors.join(", ") : String(errors)}`,
        )
        .join("; ")
        .slice(0, 500)
    }
  } catch {
    return trimmed.slice(0, 500)
  }
  return trimmed.slice(0, 500)
}

export const parseRetryAfterMs = (
  header: string | null,
  nowMs: number = Date.now(),
): number | null => {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs)
}
