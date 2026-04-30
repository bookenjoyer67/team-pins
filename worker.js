// Cloudflare Worker — replaces the Rust proxy
// Deploy with: wrangler deploy
// Set secrets: wrangler secret put SUPABASE_JWT_SECRET
//              wrangler secret put HOMESERVER_URL

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /auth — exchange Matrix token for Supabase JWT
    if (url.pathname === "/auth" && request.method === "POST") {
      const { scalar_token } = await request.json();

      // Verify token with homeserver
      const whoami = await fetch(
        `${env.HOMESERVER_URL}/_matrix/client/v3/account/whoami`,
        { headers: { Authorization: `Bearer ${scalar_token}` } }
      );
      if (!whoami.ok) return new Response("Invalid token", { status: 401 });

      const { user_id } = await whoami.json();

      // Sign Supabase JWT (HS256)
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", encoder.encode(env.SUPABASE_JWT_SECRET),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );

      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const now = Math.floor(Date.now() / 1000);
      const payload = btoa(JSON.stringify({
        sub: user_id,
        email: `${user_id.replace(":", "_")}@placeholder.matrix`,
        iat: now,
        exp: now + 3600,
        role: "authenticated",
      }));
      const signature = await crypto.subtle.sign(
        "HMAC", key,
        encoder.encode(`${header}.${payload}`)
      );

      const jwt = `${header}.${payload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

      return new Response(JSON.stringify({ access_token: jwt, expires_in: 3600 }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // OPTIONS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" },
      });
    }

    // Serve static files — handled by Cloudflare Pages, not this worker
    return new Response("Not found", { status: 404 });
  },
};
