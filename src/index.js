export default {
  async fetch(request, env) {
    const url = env.ICAL_URL;
    if (!url) {
      return new Response("ICAL_URL が設定されていません", { status: 500 });
    }
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CleaningApp/1.0)" }
      });
      const text = await res.text();
      return new Response(`status: ${res.status}\n\n${text.slice(0, 500)}`, {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    } catch (e) {
      return new Response("fetch failed: " + e.message, { status: 500 });
    }
  }
}
