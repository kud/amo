export const redactSecrets = (
  text: string,
  secrets: (string | undefined | null)[],
): string =>
  secrets.reduce<string>(
    (out, secret) => (secret ? out.split(secret).join("<redacted>") : out),
    text,
  )

export const redactHeaders = (
  headers: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) =>
      name.toLowerCase() === "authorization"
        ? [name, "JWT <redacted>"]
        : [name, value],
    ),
  )
