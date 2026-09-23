# Static output template
Copy `_headers` into the **production app's public directory**, not into the prototype. Vite copies it to dist. Deploy that dist directory to Cloudflare Pages without Functions or Workers.

`connect-src 'self'` allows fetching same-origin static sample assets, not remote telemetry. It does not by itself prove source privacy; canary network/storage tests are required. `style-src 'unsafe-inline'` permits React/Motion style attributes, not script execution; eliminate inline scripts in prerendered HTML. Review actual generated dependencies and browser behavior before tightening or changing policy. Module workers should use a same-origin emitted worker URL; do not add `blob:` to script/worker policy casually. Native downloads use Blob URLs, not iframes. No service worker in v1.

Verify headers at `/`, `/ar/` and hashed assets after deployment. Custom cache rules must not bypass fresh sample-manifest checks. Do not copy the reference prototype to production: its inline scripts intentionally do not conform to this production CSP.
