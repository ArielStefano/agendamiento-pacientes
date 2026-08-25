import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = "mailto:admin@clinica.com";

// ── Base64URL helpers ────────────────────────────────────────
function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── VAPID JWT ────────────────────────────────────────────────
async function getVapidJwt(): Promise<string> {
  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: "https://fcm.googleapis.com",
    exp: now + 43200,
    sub: VAPID_SUBJECT,
  })));

  const keyData = base64urlDecode(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey("pkcs8", keyData.buffer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, new TextEncoder().encode(`${header}.${payload}`));

  // Convert raw signature to DER format
  const rawSig = new Uint8Array(sig);
  const r = rawSig.slice(0, 32);
  const s = rawSig.slice(32, 64);

  // Remove leading zeros from r and s
  let rStart = 0, sStart = 0;
  while (rStart < 31 && r[rStart] === 0) rStart++;
  while (sStart < 31 && s[sStart] === 0) sStart++;

  const rLen = 32 - rStart;
  const sLen = 32 - sStart;
  const der = new Uint8Array([0x30, 2 + 2 + rLen + sLen, 0x02, rLen, ...r.slice(rStart), 0x02, sLen, ...s.slice(sStart)]);
  const derB64 = base64urlEncode(der);

  return `${header}.${payload}.${derB64}`;
}

// ── Web Push Encryption ──────────────────────────────────────
async function encryptPayload(subscription: any, payload: string): Promise<{ body: string; headers: Record<string, string> }> {
  const endpoint = subscription.endpoint;
  const p256dh = base64urlDecode(subscription.p256dh);
  const auth = base64urlDecode(subscription.auth);

  // Generate local ECDH key pair
  const localKey = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", localKey.publicKey));

  // Import subscription's public key
  const serverKey = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);

  // Derive shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, localKey.privateKey, 256));

  // IKM = HKDF(shared_secret, auth, "WebPush: info\0" + ua_pub + local_pub, 32)
  const ua_pub = p256dh;
  const info = new Uint8Array(1 + 64);
  info.set(new TextEncoder().encode("WebPush: info\x00"), 0);
  info.set(ua_pub, 13);
  info.set(localPubRaw, 13 + 32);

  const prk = await hmacSha256(auth, sharedSecret);
  const ikm = await hkdf(prk, info, 32);

  // Content encryption key
  const contentEncKey = await hkdf(ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\x00"), 16);

  // Salt = random 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive key and nonce
  const keyNonce = await hkdfExpand(contentEncKey, new TextEncoder().encode("Content-Encoding: aes128gcm\x00"), salt, 32 + 12);
  const aesKey = keyNonce.slice(0, 128 / 8);
  const nonce = keyNonce.slice(128 / 8);

  // Pad payload
  const payloadBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(payloadBytes.length + 1 + 16);
  padded.set(payloadBytes);
  padded[payloadBytes.length] = 2; // delimiter

  // Encrypt with AES-GCM
  const cryptoKey = await crypto.subtle.importKey("raw", aesKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, padded));

  // Construct rs=256, id=1 header
  const header = new Uint8Array([0x00, 0x04, 0x00, 256 / 8, ...salt]);

  // Derive record size (rs=256) mac key
  const macKey = await hkdfExpand(contentEncKey, new TextEncoder().encode("Content-Encoding: aes128gcm\x00"), salt, 32);

  // Compute MAC
  const macInput = new Uint8Array(16 + 5 + encrypted.length);
  macInput.set(salt, 0);
  macInput.set([0x00, 0x00, 0x01, 0x00, 0x01], 16); // record index = 0
  macInput.set(encrypted, 21);
  const macKeyObj = await crypto.subtle.importKey("raw", macKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", macKeyObj, macInput));

  const body = new Uint8Array(header.length + encrypted.length + 16);
  body.set(header, 0);
  body.set(encrypted, header.length);
  body.set(mac.slice(0, 16), header.length + encrypted.length);

  return {
    body: base64urlEncode(body),
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Authorization": `vapid t=${await getVapidJwt()}, k=${VAPID_PUBLIC_KEY}`,
    },
  };
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

async function hkdf(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(32);
  t[0] = 1;
  const infoHmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array([...info, ...t.slice(0, 1)])));
  const result = new Uint8Array(length);
  result.set(infoHmac.slice(0, Math.min(length, 32)));
  return result;
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, salt: Uint8Array, length: number): Promise<Uint8Array> {
  const prkHmac = await hmacSha256(salt, prk);
  const key = await crypto.subtle.importKey("raw", prkHmac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = new Uint8Array(length);
  let tPrev = new Uint8Array(0);
  const blocks = Math.ceil(length / 32);
  for (let i = 1; i <= blocks; i++) {
    const input = new Uint8Array(tPrev.length + info.length + 1);
    input.set(tPrev, 0);
    input.set(info, tPrev.length);
    input[input.length - 1] = i;
    tPrev = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
    result.set(tPrev.slice(0, Math.min(32, length - (i - 1) * 32)), (i - 1) * 32);
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Get pending push jobs
  const { data: jobs, error: jobsErr } = await supabase
    .from("push_cola")
    .select("id, user_id, titulo, mensaje, url")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(20);

  if (jobsErr || !jobs || !jobs.length) {
    return new Response(JSON.stringify({ sent: 0, message: "No pending jobs" }));
  }

  let sent = 0, failed = 0;

  for (const job of jobs) {
    // Get subscriptions for this user (or all if user_id is null)
    let subQuery = supabase.from("push_suscripciones").select("id, endpoint, p256dh, auth");
    if (job.user_id) subQuery = subQuery.eq("user_id", job.user_id);
    const { data: subs } = await subQuery;

    if (!subs || !subs.length) {
      await supabase.from("push_cola").update({ estado: "enviado", enviado_at: new Date().toISOString() }).eq("id", job.id);
      continue;
    }

    let jobSent = 0;
    for (const sub of subs) {
      try {
        const payload = JSON.stringify({ title: job.titulo, body: job.mensaje, url: job.url || "./dashboard.html" });
        const encrypted = await encryptPayload(sub, payload);

        const resp = await fetch(sub.endpoint, {
          method: "POST",
          headers: encrypted.headers,
          body: encrypted.body,
        });

        if (resp.ok || resp.status === 201) {
          jobSent++;
        } else if (resp.status === 404 || resp.status === 410) {
          await supabase.from("push_suscripciones").delete().eq("id", sub.id);
        }
      } catch (e) {
        // Subscription expired or invalid
        await supabase.from("push_suscripciones").delete().eq("id", sub.id);
      }
    }

    const finalState = jobSent > 0 ? "enviado" : "fallido";
    await supabase.from("push_cola").update({ estado: finalState, enviado_at: new Date().toISOString() }).eq("id", job.id);
    sent += jobSent;
  }

  return new Response(JSON.stringify({ sent, failed, processed: jobs.length }));
});
