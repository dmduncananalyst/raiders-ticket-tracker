import relay, {JDRelay} from '../relay/worker.js';
export {JDRelay};
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    let response;
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/publisher/')) {
      // Only the existing hosted page and the owner's GitHub Pages origin may
      // make browser requests. Bearer-key and publisher-role checks still apply.
      const origin=request.headers.get('Origin');
      const allowedOrigin=origin==='https://dmduncananalyst.github.io'?origin:url.origin;
      response=await relay.fetch(request,{...env,ALLOWED_ORIGIN:allowedOrigin});
    } else { response=await env.ASSETS.fetch(request); }
    const headers=new Headers(response.headers);
    headers.set('Strict-Transport-Security','max-age=31536000');
    headers.set('X-Frame-Options','DENY');
    headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self' 'sha256-qmun6VKotrrlgbM2wTIRmiNgtQAhl3d0ydKduuOQTKE='; style-src 'self'; img-src 'self'; connect-src 'self' https://*.workers.dev; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'");
    headers.set('Cache-Control','no-store');
    headers.set('Referrer-Policy','no-referrer');
    headers.set('X-Content-Type-Options','nosniff');
    return new Response(response.body,{status:response.status,headers});
  }
};
