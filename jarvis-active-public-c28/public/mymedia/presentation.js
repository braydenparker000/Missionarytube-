// Display archive metadata without changing filenames or stored video records.
import {sortVideos} from './library.js';

export function knownCreators(library) {
  const names = new Set();
  for (const video of library?.videos || []) {
    if (typeof video.creator === 'string' && video.creator.trim()) names.add(video.creator.trim());
    if (video.folder && video.folder !== library.name) names.add(video.folder.split('/').at(-1));
  }
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

export function videoPresentation(video, creators = []) {
  const title = String(video.title || 'Untitled video');
  const explicit = typeof video.creator === 'string' ? video.creator.trim() : '';
  const prefix = (explicit ? [explicit] : creators).filter(Boolean).find(name => title.toLocaleLowerCase().startsWith(name.toLocaleLowerCase() + ' - ') && title.length > name.length + 3);
  return {
    title: prefix ? title.slice(prefix.length + 3) : title,
    creator: explicit || prefix || '',
    collection: String(video.folder || '').split('/').at(-1) || ''
  };
}

// Folder names alone are collections, not proof of a channel identity.
export function creatorGroups(library, creators = knownCreators(library)) {
  const groups = new Map();
  for (const video of library?.videos || []) {
    const name = videoPresentation(video, creators).creator;
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, {name, items:[]});
    groups.get(name).items.push(video);
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
}

export function sortDisplayedVideos(videos, mode, creators = []) {
  if (mode !== 'title') return sortVideos(videos, mode);
  const titles = new Map(videos.map(video => [video, videoPresentation(video, creators).title]));
  return [...videos].sort((a, b) => titles.get(a).localeCompare(titles.get(b), undefined, {numeric:true, sensitivity:'base'}));
}

// Focused-browse count wording: shown-of-total ("60 of 120 videos") when the
// grid is paginated, plain total ("120 videos") when everything is on screen.
export function browseCountText(shown, total) {
  if (total <= shown) return `${total} video${total === 1 ? '' : 's'}`;
  return `${shown} of ${total} videos`;
}

// Accessible resume-progress bar for a card thumbnail. Empty when there is no
// progress to show; otherwise a progressbar role with a human-readable value.
export function progressBarMarkup(percent) {
  if (!Number.isFinite(percent) || percent <= 0) return '';
  const value = Math.min(100, percent), rounded = Math.round(value);
  return `<span class="bar" role="progressbar" aria-valuenow="${rounded}" aria-valuemin="0" aria-valuemax="100" aria-label="Watched ${rounded} percent"><span data-progress="${value.toFixed(1)}"></span></span>`;
}
