import {relayWebHandler} from './web-handler.mjs';
// Node.js /api Function, not the Edge runtime.
export default {fetch:request=>relayWebHandler(request)};
