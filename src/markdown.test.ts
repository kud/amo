import { describe, it, expect } from "vitest"
import { diffListing } from "./listing.js"
import {
  htmlToPlainText,
  markdownToPlainText,
  sameDescription,
} from "./markdown.js"

const PROXY =
  "https://prod.outgoing.prod.webservices.mozgcp.net/v1/0123456789abcdef"

const localDescription = [
  "**How it works**",
  "",
  "Press the shortcut and pick a tab. Works with _any_ window & `about:` pages.",
  "",
  "- Fuzzy search across titles",
  "- Jump to the **last used** tab",
  "",
  "1. Install",
  "2. Press the shortcut",
  "",
  "> Nothing leaves your machine.",
  "",
  "Source: [acme/widget](https://github.com/acme/widget) and https://acme.example/docs",
  "",
  "```",
  "widget --help",
  "```",
].join("\n")

const liveDescription = [
  "<strong>How it works</strong>",
  "<br />",
  "Press the shortcut and pick a tab. Works with <em>any</em> window &amp; <code>about:</code> pages.",
  "<ul><li>Fuzzy search across titles</li>",
  "<li>Jump to the <strong>last used</strong> tab</li></ul>",
  "<ol><li>Install</li><li>Press the shortcut</li></ol>",
  "<blockquote>Nothing leaves your machine.</blockquote>",
  `Source: <a href="${PROXY}/https%3A//github.com/acme/widget">acme/widget</a> and <a href="${PROXY}/https%3A//acme.example/docs">acme.example/docs</a>`,
  "<pre><code>widget --help</code></pre>",
].join("\n")

describe("markdownToPlainText", () => {
  it("drops markers and keeps the words", () => {
    expect(markdownToPlainText("**bold** _it_ `code` and *star*")).toBe(
      "bold it code and star",
    )
  })

  it("keeps intraword underscores and asterisk maths", () => {
    expect(markdownToPlainText("my_tool_name and 2 * 3 * 4")).toBe(
      "my_tool_name and 2 * 3 * 4",
    )
  })

  it("leaves emphasis markers inside code spans alone", () => {
    expect(markdownToPlainText("run `a*b*c` now")).toBe("run a*b*c now")
  })

  it("renders a link with a different label as label plus target", () => {
    expect(markdownToPlainText("[docs](https://acme.example/d)")).toBe(
      "docs (https://acme.example/d)",
    )
  })

  it("unescapes markdown escapes", () => {
    expect(markdownToPlainText("1\\. not a list \\*literal\\*")).toBe(
      "1. not a list *literal*",
    )
  })
})

describe("htmlToPlainText", () => {
  it("unwraps proxied links, decodes entities and collapses whitespace", () => {
    expect(
      htmlToPlainText(
        `<p>A&nbsp;&amp;&nbsp;B</p>\n\n<a href="${PROXY}/https%3A//acme.example/x">label</a>`,
      ),
    ).toBe("A & B label (https://acme.example/x)")
  })

  it("does not treat a stray less-than as a tag", () => {
    expect(htmlToPlainText("1 &lt; 2 and a < b > c")).toBe(
      "1 < 2 and a < b > c",
    )
  })
})

describe("sameDescription", () => {
  it("treats AMO-rendered HTML as equal to its Markdown source", () => {
    expect(sameDescription(localDescription, liveDescription)).toBe(true)
  })

  it("still detects a real wording change", () => {
    expect(
      sameDescription(
        localDescription.replace("Fuzzy search", "Exact search"),
        liveDescription,
      ),
    ).toBe(false)
  })

  it("still detects a changed link target", () => {
    expect(
      sameDescription(
        localDescription.replace("acme/widget)", "acme/other)"),
        liveDescription,
      ),
    ).toBe(false)
  })

  it("accepts a legacy HTML local description against the rendered one", () => {
    expect(
      sameDescription(
        '<a href="https://acme.example/docs">acme.example/docs</a> &amp; more',
        `<a href="${PROXY}/https%3A//acme.example/docs">acme.example/docs</a> &amp; more`,
      ),
    ).toBe(true)
  })
})

describe("diffListing with a Markdown description", () => {
  it("reports no description difference for a rendered live listing", () => {
    const changes = diffListing(
      { description: { "en-US": localDescription } },
      { description: { "en-US": liveDescription } },
    )
    expect(changes).toEqual([])
  })

  it("reports the field when the text really changed", () => {
    const changes = diffListing(
      { description: { "en-US": `${localDescription}\n\nNew paragraph.` } },
      { description: { "en-US": liveDescription } },
    )
    expect(changes.map((c) => c.field)).toEqual(["description"])
  })
})
