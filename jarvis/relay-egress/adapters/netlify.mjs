import {relayWebHandler} from './web-handler.mjs';
// Netlify's Node Functions runtime, not Edge Functions.
export default request=>relayWebHandler(request);
export const config={path:'/api/relay-egress'};
