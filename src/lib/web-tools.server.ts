/** Real web access primitives used by every robot. No API keys required. */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|li|h1|h2|h3|h4|tr|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const html = await res.text();

  const results: SearchResult[] = [];
  const blocks = html.split(/class="result__body"/g).slice(1);
  for (const block of blocks) {
    const link = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    let url = decodeEntities(link[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith("//")) url = `https:${url}`;
    results.push({
      title: stripTags(link[2]!),
      url,
      snippet: snippet ? stripTags(snippet[1]!) : "",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface PageRead {
  url: string;
  title: string;
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
}

export async function readPage(rawUrl: string, maxChars = 14000): Promise<PageRead> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const target = new URL(url);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Only http(s) URLs can be read.");

  const res = await fetch(target.toString(), {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
    redirect: "follow",
  });
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${target.toString()}`);

  if (!/html/i.test(contentType)) {
    const plain = body.slice(0, maxChars);
    return {
      url: target.toString(),
      title: target.hostname,
      text: plain,
      links: [],
      truncated: body.length > maxChars,
    };
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  const text = stripTags(body);
  const links: { text: string; url: string }[] = [];
  const linkRe = /<a[^>]+href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(body)) && links.length < 40) {
    try {
      const abs = new URL(decodeEntities(m[1]!), target).toString();
      const label = stripTags(m[2]!).slice(0, 90);
      if (label && !links.some((l) => l.url === abs)) links.push({ text: label, url: abs });
    } catch {
      /* ignore malformed links */
    }
  }

  return {
    url: target.toString(),
    title: titleMatch ? stripTags(titleMatch[1]!) : target.hostname,
    text: text.slice(0, maxChars),
    links,
    truncated: text.length > maxChars,
  };
}
