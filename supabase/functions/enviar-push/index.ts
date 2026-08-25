import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";

webPush.setVapidDetails("mailto:admin@clinica.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: jobs, error: jobsErr } = await supabase
    .from("push_cola")
    .select("id, user_id, titulo, mensaje, url")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(20);

  if (jobsErr || !jobs || !jobs.length) {
    return new Response(JSON.stringify({ sent: 0, message: "No pending jobs" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;

  for (const job of jobs) {
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
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        jobSent++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_suscripciones").delete().eq("id", sub.id);
        }
      }
    }

    await supabase
      .from("push_cola")
      .update({ estado: jobSent > 0 ? "enviado" : "fallido", enviado_at: new Date().toISOString() })
      .eq("id", job.id);
    sent += jobSent;
  }

  return new Response(JSON.stringify({ sent, processed: jobs.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
