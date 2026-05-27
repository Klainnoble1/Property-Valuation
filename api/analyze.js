const { analyze, json, requestBody } = require("./_lib.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const { prompt } = await requestBody(req);
    return json(res, 200, await analyze(prompt));
  } catch (error) {
    return json(res, 500, { error: error.message || "AI analysis failed" });
  }
};
