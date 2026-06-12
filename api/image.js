const BUCKET = "train-model-simulator.firebasestorage.app";
const ALLOWED_PREFIX = /^(background|items)\/[^/]+$/;

function isAllowedImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;

    if (parsed.hostname === "firebasestorage.googleapis.com") {
      return parsed.pathname.includes(`/b/${BUCKET}/`);
    }

    if (parsed.hostname === "storage.googleapis.com") {
      return parsed.pathname.includes(BUCKET);
    }

    return false;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  const url = typeof req.query.url === "string" ? req.query.url : "";

  let upstreamUrl = "";

  if (url && isAllowedImageUrl(url)) {
    upstreamUrl = url;
  } else if (ALLOWED_PREFIX.test(path)) {
    upstreamUrl =
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
      `${encodeURIComponent(path)}?alt=media`;
  } else {
    res.status(400).json({ error: "Invalid image request" });
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Image not found" });
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/octet-stream"
    );
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(body);
  } catch (err) {
    console.error("Image proxy failed:", upstreamUrl, err);
    res.status(502).json({ error: "Failed to fetch image" });
  }
}
