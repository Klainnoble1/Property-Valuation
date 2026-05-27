const { RAPIDAPI_ALLOWED_PATHS, RAPIDAPI_HOST, json } = require("./_lib.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return json(res, 500, { error: "RAPIDAPI_KEY is not set." });

  try {
    const path = req.query.path;
    if (!RAPIDAPI_ALLOWED_PATHS.has(path)) return json(res, 400, { error: "Unsupported RapidAPI path." });
    const upstreamUrl = new URL(`https://${RAPIDAPI_HOST}${path}`);
    Object.entries(req.query).forEach(([key, value]) => {
      if (key !== "path" && value != null) upstreamUrl.searchParams.set(key, Array.isArray(value) ? value[0] : value);
    });
    const upstream = await fetch(upstreamUrl, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": RAPIDAPI_HOST },
    });
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.end(await upstream.text());
  } catch (error) {
    return json(res, 500, { error: error.message || "RapidAPI request failed" });
  }
};
