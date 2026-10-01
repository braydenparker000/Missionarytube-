export function r2PlayerConfig(release) {
  if (!release.r2ManifestURL) return {rootId:'',manifestURL:''};
  const endpoint=release.apiOrigin+'/music/partial/manifest.json';
  if (release.r2ManifestURL!==endpoint || typeof release.r2RootId!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(release.r2RootId || '')) {
    throw Error('Unexpected R2 source configuration');
  }
  const url=new URL(endpoint);
  if(url.origin!==release.apiOrigin || url.protocol!=='https:' || url.username || url.password || url.search || url.hash) {
    throw Error('Unexpected R2 source configuration');
  }
  return {rootId:release.r2RootId,manifestURL:endpoint};
}
