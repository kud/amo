import { decodeHtmlEntities, normalizeOutgoingUrls } from "./listing.js"

const ANCHOR = /<a\b[^>]*?\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
const BLOCK_BREAK =
  /<\/?(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|br|hr)\b[^>]*>/gi
const TAG = /<\/?[a-zA-Z][^>]*>/g
const CODE_SPAN = /(`[^`\n]+`)/

const bareUrl = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/+$/, "")

const linkToText = (text: string, url: string): string => {
  const label = decodeHtmlEntities(text.replace(TAG, "")).trim()
  const target = decodeHtmlEntities(url).trim()
  return bareUrl(label) === bareUrl(target) || label === ""
    ? target
    : `${label} (${target})`
}

const htmlToText = (value: string): string =>
  value
    .replace(ANCHOR, (_match, _quote, url: string, text: string) =>
      linkToText(text, url),
    )
    .replace(BLOCK_BREAK, "\n")
    .replace(TAG, "")

const stripBlockMarkers = (value: string): string =>
  value
    .replace(/^\s*(?:```|~~~).*$/gm, "")
    .replace(
      /^ {0,3}(?:#{1,6}[ \t]+|(?:>[ \t]?)+|[-*+][ \t]+|\d+[.)][ \t]+)/gm,
      "",
    )

const stripInlineMarkers = (value: string): string =>
  value
    .replace(/!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, "$1")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_match, text: string, url: string) => linkToText(text, url),
    )
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<![\w])__(?=\S)(.+?)(?<=\S)__(?![\w])/g, "$1")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    .replace(/(?<![\w])_(?=\S)(.+?)(?<=\S)_(?![\w])/g, "$1")

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!>])/g
const ESCAPE_MARK = "\uE000"

const stashEscapes = (value: string): string =>
  value.replace(
    ESCAPABLE,
    (_match, char: string) => `${ESCAPE_MARK}${char.charCodeAt(0)};`,
  )

const restoreEscapes = (value: string): string =>
  value.replace(
    new RegExp(`${ESCAPE_MARK}(\\d+);`, "g"),
    (_match, code: string) => String.fromCharCode(Number(code)),
  )

const stripMarkdown = (value: string): string =>
  restoreEscapes(
    stripBlockMarkers(stashEscapes(value))
      .split(CODE_SPAN)
      .map((part) =>
        CODE_SPAN.test(part) ? part.slice(1, -1) : stripInlineMarkers(part),
      )
      .join(""),
  )

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim()

export const htmlToPlainText = (value: unknown): string =>
  collapse(
    decodeHtmlEntities(htmlToText(normalizeOutgoingUrls(String(value ?? "")))),
  )

export const markdownToPlainText = (value: unknown): string =>
  collapse(
    decodeHtmlEntities(
      stripMarkdown(htmlToText(normalizeOutgoingUrls(String(value ?? "")))),
    ),
  )

export const sameDescription = (local: unknown, live: unknown): boolean =>
  markdownToPlainText(local) === htmlToPlainText(live)
