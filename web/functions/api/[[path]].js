const PROJECT_ID = "studio-3607214974-ad41a";
const API_KEY = "AIzaSyDsAwUplm90XLCh-n60XXF1Dz37w8akcYU";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function b64(value) { return btoa(String.fromCharCode(...new Uint8Array(value))); }
function b64url(value) { return b64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

async function requireUser(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Sign in again. Firebase ID token is missing.");
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY || API_KEY), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token })
  });
  if (!response.ok) throw new Error("Firebase token validation failed. Please sign in again.");
  const result = await response.json();
  const account = result.users?.[0];
  if (!account?.localId || account.disabled) throw new Error("Firebase account is unavailable.");
  return { uid: account.localId, email: account.email || "" };
}

async function turso(env, sql, args = []) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new Error("Turso is not configured. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Cloudflare Pages secrets.");
  const host = env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = "https://" + host + "/v2/pipeline";
  const encodedArgs = args.map(v => v === null ? { type: "null" } : typeof v === "number" ? { type: "integer", value: String(v) } : { type: "text", value: String(v) });
  const response = await fetch(url, {
    method: "POST",
    headers: { "authorization": "Bearer " + env.TURSO_AUTH_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: encodedArgs } }, { type: "close" }] })
  });
  if (!response.ok) throw new Error("Turso request failed (" + response.status + "). Check database URL and token.");
  const body = await response.json();
  const result = body.results?.[0]?.response?.result;
  if (body.results?.[0]?.type === "error") throw new Error("Turso SQL error: " + (body.results[0].error?.message || "unknown error"));
  return result;
}

async function ensureSchema(env) {
  await turso(env, "CREATE TABLE IF NOT EXISTS guild_workspaces (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
}

async function b2Authorize(env) {
  if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET_ID || !env.B2_BUCKET_NAME) throw new Error("Backblaze B2 is not configured. Add B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID and B2_BUCKET_NAME in Cloudflare Pages secrets.");
  const auth = "Basic " + btoa(env.B2_KEY_ID + ":" + env.B2_APPLICATION_KEY);
  const response = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", { headers: { authorization: auth } });
  if (!response.ok) throw new Error("Backblaze authorization failed. Check the B2 application key.");
  return response.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": request.headers.get("origin") || "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
  try {
    const url = new URL(request.url);
    const user = await requireUser(request, env);
    if (url.pathname === "/api/data" && request.method === "GET") {
      await ensureSchema(env);
      const result = await turso(env, "SELECT payload FROM guild_workspaces WHERE user_id = ?", [user.uid]);
      const raw = result?.rows?.[0]?.[0]?.value;
      let data = { accounts: [], guildId: "", requests: [], files: [] };
      if (raw) { try { data = { ...data, ...JSON.parse(raw) }; } catch {} }
      return json({ user: { email: user.email }, data });
    }
    if (url.pathname === "/api/data" && request.method === "POST") {
      await ensureSchema(env);
      const incoming = await request.json();
      const data = {
        accounts: Array.isArray(incoming.accounts) ? incoming.accounts.slice(0, 500) : [],
        guildId: typeof incoming.guildId === "string" ? incoming.guildId.slice(0, 40) : "",
        requests: Array.isArray(incoming.requests) ? incoming.requests.slice(-500) : [],
        files: Array.isArray(incoming.files) ? incoming.files.slice(-100) : []
      };
      const payload = JSON.stringify(data);
      await turso(env, "INSERT INTO guild_workspaces(user_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", [user.uid, payload, new Date().toISOString()]);
      return json({ ok: true });
    }
    if (url.pathname === "/api/upload" && request.method === "POST") {
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      if (!/^image\/(png|jpeg|webp|gif)$/.test(contentType)) return json({ error: "Only PNG, JPEG, WebP or GIF images are allowed." }, 415);
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return json({ error: "Image must be between 1 byte and 5 MB." }, 413);
      const auth = await b2Authorize(env);
      const uploadInfo = await fetch(auth.apiInfo.storageApi.apiUrl + "/b2api/v3/b2_get_upload_url", {
        method: "POST", headers: { authorization: auth.authorizationToken, "content-type": "application/json" },
        body: JSON.stringify({ bucketId: env.B2_BUCKET_ID })
      });
      if (!uploadInfo.ok) throw new Error("Could not obtain Backblaze upload URL.");
      const upload = await uploadInfo.json();
      const digest = await crypto.subtle.digest("SHA-1", bytes);
      const ext = contentType.split("/")[1].replace("jpeg", "jpg");
      const name = user.uid + "/" + Date.now() + "-" + crypto.randomUUID() + "." + ext;
      const sent = await fetch(upload.uploadUrl, {
        method: "POST",
        headers: { authorization: upload.authorizationToken, "X-Bz-File-Name": encodeURIComponent(name), "Content-Type": contentType, "X-Bz-Content-Sha1": [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("") },
        body: bytes
      });
      if (!sent.ok) throw new Error("Backblaze upload failed (" + sent.status + ").");
      const saved = await sent.json();
      return json({ ok: true, fileName: saved.fileName, fileId: saved.fileId, contentType });
    }
    if (url.pathname === "/api/file-auth" && request.method === "POST") {
      const body = await request.json();
      const fileName = String(body.fileName || "");
      if (!fileName.startsWith(user.uid + "/") || fileName.includes("..")) return json({ error: "File access denied." }, 403);
      const auth = await b2Authorize(env);
      const response = await fetch(auth.apiInfo.storageApi.apiUrl + "/b2api/v3/b2_get_download_authorization", {
        method: "POST", headers: { authorization: auth.authorizationToken, "content-type": "application/json" },
        body: JSON.stringify({ bucketId: env.B2_BUCKET_ID, fileNamePrefix: user.uid + "/", validDurationInSeconds: 3600 })
      });
      if (!response.ok) throw new Error("Could not authorize file download.");
      const grant = await response.json();
      return json({ url: auth.apiInfo.storageApi.downloadUrl + "/file/" + encodeURIComponent(env.B2_BUCKET_NAME) + "/" + fileName.split("/").map(encodeURIComponent).join("/") + "?Authorization=" + encodeURIComponent(grant.authorizationToken) });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error?.message || "Unexpected server error" }, 400);
  }
}
