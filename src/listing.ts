import { readFile } from "node:fs/promises"
import { sameDescription } from "./markdown.js"
import type {
  AmoPreview,
  Listing,
  ListingChange,
  ListingField,
  LocalizedText,
} from "./types.js"

export const LISTING_FIELDS: readonly ListingField[] = [
  "name",
  "summary",
  "description",
  "homepage",
  "support_email",
  "support_url",
  "categories",
  "tags",
]

const SLUG_FIELDS: readonly ListingField[] = ["categories", "tags"]

const OUTGOING_URL =
  /https:\/\/prod\.outgoing\.prod\.webservices\.mozgcp\.net\/v1\/[0-9a-f]+\/([^"'\s<>]+)/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export const normalizeOutgoingUrls = (value: string): string =>
  value.replace(OUTGOING_URL, (_match, embedded: string) => {
    try {
      const decoded = decodeURIComponent(embedded)
      return /^https?:\/\//.test(decoded) ? decoded : embedded
    } catch {
      return embedded
    }
  })

export const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(amp|lt|gt|quot|apos|nbsp);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (match, name?: string, decimal?: string, hex?: string) => {
      if (name) return NAMED_ENTITIES[name] ?? match
      const code = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex ?? "", 16)
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    },
  )

export const normalizeText = (value: unknown): string =>
  decodeHtmlEntities(normalizeOutgoingUrls(String(value ?? "")))

export const sameText = (a: unknown, b: unknown): boolean =>
  normalizeText(a).trim() === normalizeText(b).trim()

export const localizedEnUs = (
  value: unknown,
  locale: string = "en-US",
): string | null => {
  if (value == null) return null
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (locale in record) {
      const text = record[locale]
      return text == null ? null : String(text)
    }
    if ("url" in record) return localizedEnUs(record["url"], locale)
    return null
  }
  return String(value)
}

export const categorySlugs = (value: unknown): string[] => {
  const firefox =
    value != null && typeof value === "object"
      ? (value as Record<string, unknown>)["firefox"]
      : undefined
  const list = Array.isArray(value)
    ? value
    : Array.isArray(firefox)
      ? firefox
      : []
  return list.map(String).sort()
}

export const sameSlugs = (a: string[], b: string[]): boolean => {
  const left = [...a].sort()
  const right = [...b].sort()
  return left.length === right.length && left.every((s, i) => s === right[i])
}

const asSlugs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : []

export const diffListing = (
  local: Listing,
  live: Record<string, unknown>,
): ListingChange[] =>
  LISTING_FIELDS.flatMap((field): ListingChange[] => {
    const localValue = local[field]
    if (localValue === undefined) return []
    if (SLUG_FIELDS.includes(field)) {
      const localSlugs = asSlugs(localValue)
      return sameSlugs(localSlugs, categorySlugs(live[field]))
        ? []
        : [{ field, live: live[field] ?? null, patch: localSlugs }]
    }
    const localText = localizedEnUs(localValue)
    const liveText = localizedEnUs(live[field])
    if (localText == null && liveText == null) return []
    const equal = field === "description" ? sameDescription : sameText
    if (localText != null && liveText != null && equal(localText, liveText))
      return []
    return [{ field, live: liveText, patch: localValue }]
  })

export const buildListingPatch = (
  changes: ListingChange[],
): Record<string, unknown> =>
  Object.fromEntries(changes.map(({ field, patch }) => [field, patch]))

export const extractCaption = (caption: unknown): string | null =>
  localizedEnUs(caption)

export type LocalShot = { file: string; caption: string | null }

export type PreviewSyncPlan = {
  inSync: boolean
  deletes: number[]
  uploads: LocalShot[]
}

export const planPreviewSync = (
  localShots: LocalShot[],
  livePreviews: Pick<AmoPreview, "id" | "caption">[],
): PreviewSyncPlan => {
  if (localShots.length === 0) return { inSync: true, deletes: [], uploads: [] }
  const inSync =
    localShots.length === livePreviews.length &&
    localShots.every(
      (shot, i) =>
        (shot.caption ?? "") ===
        (extractCaption(livePreviews[i]?.caption) ?? ""),
    )
  if (inSync) return { inSync: true, deletes: [], uploads: [] }
  return {
    inSync: false,
    deletes: livePreviews.map((preview) => preview.id),
    uploads: localShots.map(({ file, caption }) => ({ file, caption })),
  }
}

export const toLocalized = (
  value: string | LocalizedText,
  locale: string = "en-US",
): LocalizedText => (typeof value === "string" ? { [locale]: value } : value)

export const parseListing = (input: unknown, source = "listing"): Listing => {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source} must be a JSON object`)
  }
  const record = input as Record<string, unknown>
  SLUG_FIELDS.forEach((field) => {
    const value = record[field]
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`${source}: "${field}" must be an array of strings`)
    }
  })
  return record as Listing
}

export const readListingFile = async (path: string): Promise<Listing> => {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    throw new Error(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  })
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(
        `cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  })()
  return parseListing(parsed, path)
}
