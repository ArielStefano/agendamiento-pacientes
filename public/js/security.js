"use strict";

(function () {
  const meta = [
    { name: "X-Content-Type-Options", content: "nosniff" },
    { name: "X-Frame-Options", content: "DENY" },
    { name: "Referrer-Policy", content: "strict-origin-when-cross-origin" },
    { name: "Permissions-Policy", content: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()" },
    {
      name: "Content-Security-Policy",
      content: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://xgfwcrdrkzcoxepnicfb.supabase.co wss://xgfwcrdrkzcoxepnicfb.supabase.co",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
  ];

  meta.forEach(function (m) {
    if (!document.querySelector('meta[http-equiv="' + m.name + '"]')) {
      const el = document.createElement("meta");
      el.setAttribute("http-equiv", m.name);
      el.setAttribute("content", m.content);
      document.head.appendChild(el);
    }
  });
})();
