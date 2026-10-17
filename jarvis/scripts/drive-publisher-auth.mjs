// Server-side only. OAuth values stay in Actions and never enter player config.
export class DrivePublisherStopped extends Error {}

export function drivePublisherAuth({env=process.env,fetcher=fetch,now=Date.now}={}) {
  if (env.GOOGLE_DRIVE_AUTH_MODE !== 'oauth') {
    if (env.GOOGLE_DRIVE_AUTH_MODE && env.GOOGLE_DRIVE_AUTH_MODE !== 'public_api_key') throw Error('Unknown publisher authorization mode.');
    return {key:env.GOOGLE_DRIVE_API_KEY,authenticated:false,fetcher};
  }
  const names=['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN'];
  if (names.some(name=>!env[name])) throw new DrivePublisherStopped('Drive OAuth settings are incomplete.');
  let token='',expiresAt=0,refreshing,stopped;
  const stop=message=>{stopped ||= new DrivePublisherStopped(message);return stopped;};
  async function accessToken(signal) {
    if (stopped) throw stopped;
    if (token && now()<expiresAt-60000) return token;
    if (!refreshing) refreshing=(async()=>{
      try {
        const response=await fetcher('https://oauth2.googleapis.com/token',{
          method:'POST',redirect:'error',signal,
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({client_id:env[names[0]],client_secret:env[names[1]],refresh_token:env[names[2]],grant_type:'refresh_token'})
        });
        if (!response.ok) {await response.body?.cancel();throw Error();}
        const data=await response.json();
        if (typeof data.access_token!=='string' || !data.access_token || /[\r\n]/.test(data.access_token) || !Number.isFinite(data.expires_in) || data.expires_in<=60) throw Error();
        token=data.access_token;expiresAt=now()+data.expires_in*1000;return token;
      } catch {throw stop('Drive OAuth refresh failed; publisher stopped without falling back to a public key.');}
    })().finally(()=>{refreshing=null;});
    return refreshing;
  }
  async function authorizedFetch(input,options={}) {
    const url=new URL(input);
    const drive=url.origin==='https://www.googleapis.com' && /^\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(url.pathname);
    if (!drive) return fetcher(input,options);
    if (stopped) throw stopped;
    url.searchParams.delete('key');
    const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+await accessToken(options.signal));
    let response;
    try {response=await fetcher(url.href,{...options,headers,redirect:'error'});}
    catch {throw stop('Authenticated Drive request failed; publisher stopped.');}
    if ([401,403].includes(response.status)) {
      await response.body?.cancel();throw stop('Drive refused the publisher request; publication stopped.');
    }
    return response;
  }
  return {key:'',authenticated:true,fetcher:authorizedFetch};
}
