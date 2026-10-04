import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { createAmoError, formatErrorBody, parseRetryAfterMs } from "./errors.js"
import { createJwt } from "./jwt.js"
import { redactSecrets } from "./redact.js"
import { toLocalized } from "./listing.js"
import type {
  AmoAddon,
  AmoPreview,
  AmoVersion,
  Listing,
  PreviewCaption,
  UploadFile,
  VersionStatus,
} from "./types.js"

export const AMO_API = "https://addons.mozilla.org/api/v5"

export type AmoClientOptions = {
  issuer: string
  secret: string
  baseUrl?: string
  maxRetries?: number
  retryDelayMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type AddPreviewOptions = {
  caption?: PreviewCaption
  position?: number
}

export type GetVersionsOptions = {
  filter?: "all_with_unlisted" | "all_without_unlisted" | "only_beta"
}

const MAX_PAGES = 20

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const isRetryable = (status: number) => status === 429 || status >= 500

const addonPath = (guid: string) =>
  `/addons/addon/${encodeURIComponent(guid).replace(/%40/g, "@")}/`

const resolveUpload = async (
  file: UploadFile,
): Promise<{ blob: Blob; filename: string }> => {
  if (typeof file === "string") {
    const data = await readFile(file)
    const type =
      MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"
    return {
      blob: new Blob([new Uint8Array(data)], { type }),
      filename: basename(file),
    }
  }
  const type =
    file.contentType ??
    MIME_TYPES[extname(file.filename).toLowerCase()] ??
    "application/octet-stream"
  const blob =
    file.data instanceof Blob
      ? file.data
      : new Blob([new Uint8Array(file.data)], { type })
  return { blob, filename: file.filename }
}

export const createAmoClient = (options: AmoClientOptions) => {
  const { issuer, secret } = options
  if (!issuer) throw new Error("missing AMO JWT issuer")
  if (!secret) throw new Error("missing AMO JWT secret")

  const baseUrl = (options.baseUrl ?? AMO_API).replace(/\/+$/, "")
  const maxRetries = options.maxRetries ?? 3
  const retryDelayMs = options.retryDelayMs ?? 500
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? defaultSleep

  const scrub = (text: string) => redactSecrets(text, [secret])

  const backoffMs = (attempt: number, retryAfterMs: number | null) =>
    retryAfterMs ?? retryDelayMs * 2 ** attempt

  const send = async (
    method: string,
    url: string,
    body?: BodyInit,
    contentType?: string,
  ): Promise<Response> => {
    const attemptRequest = async (attempt: number): Promise<Response> => {
      const token = createJwt({ issuer, secret })
      const headers: Record<string, string> = { Authorization: `JWT ${token}` }
      if (contentType) headers["Content-Type"] = contentType

      const response = await doFetch(url, { method, headers, body }).catch(
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          return createAmoError({
            status: null,
            detail: scrub(redactSecrets(message, [token])),
          })
        },
      )

      if (response instanceof Response && response.ok) return response

      const failure =
        response instanceof Response
          ? createAmoError({
              status: response.status,
              detail: scrub(
                formatErrorBody(await response.text().catch(() => "")),
              ),
              retryAfterMs: parseRetryAfterMs(
                response.headers.get("retry-after"),
              ),
            })
          : response

      const retryable = failure.status === null || isRetryable(failure.status)
      if (!retryable || attempt >= maxRetries) throw failure
      await sleep(backoffMs(attempt, failure.retryAfterMs))
      return attemptRequest(attempt + 1)
    }
    return attemptRequest(0)
  }

  const requestJson = async <T>(
    method: string,
    url: string,
    json?: unknown,
  ): Promise<T> => {
    const response = await send(
      method,
      url,
      json === undefined ? undefined : JSON.stringify(json),
      json === undefined ? undefined : "application/json",
    )
    return (await response.json()) as T
  }

  const requestForm = async <T>(
    method: string,
    url: string,
    form: FormData,
  ): Promise<T> => {
    const response = await send(method, url, form)
    return (await response.json()) as T
  }

  const getAddon = (guid: string) =>
    requestJson<AmoAddon>("GET", `${baseUrl}${addonPath(guid)}`)

  const updateListing = (guid: string, fields: Listing) =>
    requestJson<AmoAddon>("PATCH", `${baseUrl}${addonPath(guid)}`, fields)

  const uploadIcon = async (guid: string, file: UploadFile) => {
    const { blob, filename } = await resolveUpload(file)
    const form = new FormData()
    form.append("icon", blob, filename)
    return requestForm<AmoAddon>("PATCH", `${baseUrl}${addonPath(guid)}`, form)
  }

  const listPreviews = async (guid: string): Promise<AmoPreview[]> => {
    const addon = await getAddon(guid)
    return [...(addon.previews ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    )
  }

  const addPreview = async (
    guid: string,
    file: UploadFile,
    { caption, position }: AddPreviewOptions = {},
  ) => {
    const { blob, filename } = await resolveUpload(file)
    const form = new FormData()
    form.append("image", blob, filename)
    if (caption) form.append("caption", JSON.stringify(toLocalized(caption)))
    if (position !== undefined) form.append("position", String(position))
    return requestForm<AmoPreview>(
      "POST",
      `${baseUrl}${addonPath(guid)}previews/`,
      form,
    )
  }

  const removePreview = async (guid: string, id: number | string) => {
    await send("DELETE", `${baseUrl}${addonPath(guid)}previews/${id}/`)
  }

  const updatePreviewCaption = (
    guid: string,
    id: number | string,
    caption: PreviewCaption,
  ) =>
    requestJson<AmoPreview>(
      "PATCH",
      `${baseUrl}${addonPath(guid)}previews/${id}/`,
      { caption: toLocalized(caption) },
    )

  const getVersions = async (
    guid: string,
    { filter }: GetVersionsOptions = {},
  ): Promise<AmoVersion[]> => {
    const query = filter ? `?filter=${filter}` : ""
    const collect = async (
      url: string | null,
      page: number,
      acc: AmoVersion[],
    ): Promise<AmoVersion[]> => {
      if (!url || page >= MAX_PAGES) return acc
      const data = await requestJson<{
        results?: AmoVersion[]
        next?: string | null
      }>("GET", url)
      return collect(data.next ?? null, page + 1, [
        ...acc,
        ...(data.results ?? []),
      ])
    }
    return collect(`${baseUrl}${addonPath(guid)}versions/${query}`, 0, [])
  }

  const getVersionStatus = async (
    guid: string,
    versionNumber?: string,
  ): Promise<VersionStatus | null> => {
    const versions = await getVersions(guid, { filter: "all_with_unlisted" })
    const chosen = versionNumber
      ? versions.find((v) => v.version === versionNumber)
      : [...versions].sort((a, b) => b.id - a.id)[0]
    if (!chosen) return null
    const fileStatus = chosen.file?.status ?? null
    return {
      id: chosen.id,
      version: chosen.version,
      channel: chosen.channel ?? null,
      fileStatus,
      approved: fileStatus === "public",
    }
  }

  return {
    getAddon,
    updateListing,
    uploadIcon,
    listPreviews,
    addPreview,
    removePreview,
    updatePreviewCaption,
    getVersions,
    getVersionStatus,
  }
}

export type AmoClient = ReturnType<typeof createAmoClient>

export type PublicReadOptions = { baseUrl?: string; fetch?: typeof fetch }

export const getPublicAddon = async (
  guid: string,
  options: PublicReadOptions = {},
): Promise<AmoAddon> => {
  const baseUrl = (options.baseUrl ?? AMO_API).replace(/\/+$/, "")
  const doFetch = options.fetch ?? fetch
  const response = await doFetch(`${baseUrl}${addonPath(guid)}`).catch(
    (error: unknown) => {
      throw createAmoError({
        status: null,
        detail: error instanceof Error ? error.message : String(error),
      })
    },
  )
  if (!response.ok) {
    throw createAmoError({
      status: response.status,
      detail: formatErrorBody(await response.text().catch(() => "")),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    })
  }
  return (await response.json()) as AmoAddon
}
