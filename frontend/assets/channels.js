// Routing only: keep the original shared history and publication protocol intact.
export const MUSE_PREFIX = '[Jarvis Muse v1]\n';
export const MUSE_TEST_ID = 'f62e9e27-d106-465c-a2e7-c4dd64323040';
export function isMuseMessage(message) {
  return message.role === 'user' && (message.id === MUSE_TEST_ID ||
    (typeof message.body === 'string' && message.body.startsWith(MUSE_PREFIX)));
}
export function channelMessages(messages, channel = 'jarvis') {
  const targets = new Set([MUSE_TEST_ID, ...messages.filter(isMuseMessage).map(m => m.id)]);
  return messages.filter(m => {
    const muse = m.role === 'user' ? isMuseMessage(m) : m.kind==='coordination'&&['muse','jarvis'].includes(m.destination)?m.destination==='muse':targets.has(m.replyTo);
    return channel === 'muse' ? muse : !muse;
  });
}
export function channelState(state, channel = 'jarvis') {
  const messages = channelMessages(state.messages, channel);
  const answered = new Set(messages.filter(m => m.kind === 'reply').map(m => m.replyTo));
  return {...state, channel, messages, posts: channel === 'muse' ? [] : state.posts,
    unanswered: messages.filter(m => m.role === 'user' && !answered.has(m.id))};
}
export function museBody(body) {
  return body.startsWith(MUSE_PREFIX) ? body.slice(MUSE_PREFIX.length) : body;
}
