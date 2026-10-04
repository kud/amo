export type LocalizedText = Record<string, string | null>

export type Listing = {
  name?: LocalizedText | string | null
  summary?: LocalizedText | string | null
  description?: LocalizedText | string | null
  homepage?: LocalizedText | string | null
  support_email?: LocalizedText | string | null
  support_url?: LocalizedText | string | null
  categories?: string[]
  tags?: string[]
}

export type ListingField = keyof Listing

export type ListingChange = {
  field: ListingField
  live: unknown
  patch: unknown
}

export type AmoPreview = {
  id: number
  caption: LocalizedText | null
  position?: number
  image_url?: string
  thumbnail_url?: string
  image_size?: [number, number]
  thumbnail_size?: [number, number]
}

export type AmoAddon = {
  id: number
  guid: string
  slug: string
  status?: string
  name?: LocalizedText | null
  summary?: LocalizedText | null
  description?: LocalizedText | null
  homepage?: unknown
  support_email?: LocalizedText | null
  support_url?: unknown
  categories?: unknown
  tags?: string[]
  previews?: AmoPreview[]
  icon_url?: string
  [key: string]: unknown
}

export type AmoFileStatus = "public" | "disabled" | "unreviewed" | (string & {})

export type AmoVersion = {
  id: number
  version: string
  channel?: string
  file?: { id?: number; status?: AmoFileStatus; [key: string]: unknown }
  [key: string]: unknown
}

export type VersionStatus = {
  id: number
  version: string
  channel: string | null
  fileStatus: AmoFileStatus | null
  approved: boolean
}

export type UploadFile =
  string | { data: Uint8Array | Blob; filename: string; contentType?: string }

export type PreviewCaption = string | LocalizedText
