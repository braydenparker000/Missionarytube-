import test from "node:test";
import assert from "node:assert/strict";
import { loadHub, source } from "./helpers/redesign.mjs";

const hub = await loadHub();

const cat = (type, id, name) => ({ type, id, name });

test("every content type Astra carries has a sector", () => {
  const ids = hub.SECTORS.map((s) => s.id);
  for (const id of ["movie", "series", "anime", "music", "channel", "other"]) {
    assert.ok(ids.includes(id), `${id} must be reachable from the hub`);
  }
  // Movies, shows and anime lead; music is the secondary experience.
  assert.equal(ids.slice(0, 4).join(","), "movie,series,anime,music");
});

test("YouTube, podcasts and radio are out of product scope everywhere", () => {
  const ids = hub.SECTORS.map((s) => s.id);
  for (const id of ["youtube", "podcast", "radio"]) {
    assert.equal(ids.includes(id), false, `${id} must not be a destination`);
  }
  for (const type of ["youtube", "yt", "podcast", "podcasts", "radio", "station", "stations"]) {
    assert.equal(hub.isOutOfScope(type), true, `${type} must be out of scope`);
    assert.equal(hub.sectorIdForType(type), null);
  }
  // An out-of-scope catalog is dropped, not demoted to a custom sector, so it
  // cannot reappear at the end of the coverage list.
  const sources = [source("mixed", [
    cat("movie", "1", "Popular"),
    cat("podcast", "2", "Shows"),
    cat("radio", "3", "Stations"),
    cat("youtube", "4", "Channels")
  ])];
  assert.equal(hub.collectCatalogs(sources).map((entry) => entry.type).join(","), "movie");
  assert.equal(hub.buildHub(sources).filter((sector) => sector.custom).length, 0);
  assert.equal(hub.buildHub(sources, { availableOnly: true }).length, 1);
});

test("real-world type spellings map onto the same sector", () => {
  assert.equal(hub.sectorIdForType("movies"), "movie");
  assert.equal(hub.sectorIdForType("Film"), "movie");
  assert.equal(hub.sectorIdForType("tv"), "series");
  assert.equal(hub.sectorIdForType("iptv"), "channel");
  assert.equal(hub.sectorIdForType("live"), "channel");
  assert.equal(hub.sectorIdForType("animes"), "anime");
  assert.equal(hub.sectorIdForType("albums"), "music");
  // An unknown type is not forced into a sector it does not belong to.
  assert.equal(hub.sectorIdForType("audiobook"), null);
});

test("a sector filter keeps every catalog alias it claims", () => {
  const movies = hub.buildHub([
    source("mixed-movies", [cat("movie", "main", "Movies"), cat("film", "arthouse", "Films")])
  ]).find((sector) => sector.id === "movie");
  assert.equal(hub.catalogMatchesSector(movies, "movie"), true);
  assert.equal(hub.catalogMatchesSector(movies, "Film"), true);
  assert.equal(hub.catalogMatchesSector(movies, "series"), false);
  assert.equal(hub.catalogMatchesSector(null, "movie"), false);
});

test("a sector is never available unless an add-on actually exposes it", () => {
  const sectors = hub.buildHub([source("only-movies", [cat("movie", "top", "Top movies")])]);
  const byId = Object.fromEntries(sectors.map((s) => [s.id, s]));
  assert.equal(byId.movie.available, true);
  for (const id of ["series", "anime", "channel", "music", "other"]) {
    assert.equal(byId[id].available, false, `${id} has no provider and must not read as populated`);
    assert.equal(byId[id].catalogs.length, 0);
  }
});

test("an unavailable sector still explains what to install", () => {
  const [movies] = hub.buildHub([]);
  const reason = hub.missingReason(movies);
  assert.match(reason, /^Install /);
  assert.match(reason, /movie catalogs/);
  // Availability and the copy come from the same data, so they cannot drift.
  assert.equal(hub.missingReason({ available: true }), "");
});

test("an available sector describes its real catalog and provider counts", () => {
  const sectors = hub.buildHub([
    source("a", [cat("movie", "1", "Popular"), cat("movie", "2", "New")]),
    source("b", [cat("movie", "3", "Staff picks")])
  ]);
  const movies = sectors.find((s) => s.id === "movie");
  assert.equal(movies.catalogs.length, 3);
  assert.deepEqual(Array.from(movies.providers), ["a", "b"]);
  assert.equal(hub.describe(movies), "3 catalogs · 2 add-ons");
});

test("a type no sector claims is appended rather than discarded", () => {
  const sectors = hub.buildHub([source("weird", [cat("audiobook", "ab", "Audiobooks")])]);
  const custom = sectors.filter((s) => s.custom);
  assert.equal(custom.length, 1, "an unknown future type stays reachable");
  assert.equal(custom[0].id, "custom:audiobook");
  assert.equal(custom[0].label, "Audiobook");
  assert.equal(custom[0].available, true);
});

test("a claimed type is not also emitted as a custom sector", () => {
  const sectors = hub.buildHub([source("a", [cat("tv", "1", "Shows")])]);
  assert.equal(sectors.filter((s) => s.custom).length, 0);
  assert.equal(sectors.find((s) => s.id === "series").available, true);
});

test("episodic and audio sectors are classified, not guessed at the call site", () => {
  assert.equal(hub.isEpisodic("series"), true);
  assert.equal(hub.isEpisodic("anime"), true);
  assert.equal(hub.isEpisodic("movie"), false);
  assert.equal(hub.isAudio("music"), true);
  assert.equal(hub.isAudio("channel"), false, "live TV is video, not audio");
  assert.equal(hub.isAudio("movie"), false);
});

test("a browsable catalog does not imply a playable one", () => {
  const browseOnly = [source("catalog-only", [cat("movie", "1", "Popular")], ["catalog", "meta"])];
  assert.equal(hub.buildHub(browseOnly)[0].available, true, "it is still browsable");
  assert.equal(hub.canStream(browseOnly, "movie"), false, "but playback must not be promised");

  const withStreams = [source("full", [cat("movie", "1", "Popular")], ["catalog", "meta", "stream"])];
  assert.equal(hub.canStream(withStreams, "movie"), true);
});

test("a stream resource scoped to other types does not cover this one", () => {
  const scoped = [{
    addon: { url: "https://example.test/s/manifest.json" },
    manifest: { name: "s", catalogs: [cat("music", "1", "Albums")], resources: [{ name: "stream", types: ["movie"] }] }
  }];
  assert.equal(hub.canStream(scoped, "music"), false);
  assert.equal(hub.canStream(scoped, "movie"), true);
});

test("adult catalogs are filtered by the caller, and malformed input never throws", () => {
  assert.deepEqual(Array.from(hub.buildHub(null)).length ? "ok" : "ok", "ok");
  assert.equal(hub.buildHub(undefined).length, hub.SECTORS.length);
  assert.equal(hub.collectCatalogs([{ manifest: null }]).length, 0);
  assert.equal(hub.collectCatalogs([{ manifest: { catalogs: "nope" } }]).length, 0);
});

test("availableOnly narrows the hub without changing what availability means", () => {
  const sources = [source("a", [cat("movie", "1", "Popular")])];
  const all = hub.buildHub(sources);
  const live = hub.buildHub(sources, { availableOnly: true });
  assert.equal(all.length, hub.SECTORS.length);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, "movie");
});

test("each sector names one of its items without a plural rule", () => {
  // Naive de-pluralising turns "Series" into "Serie", so the label is stated.
  assert.equal(hub.typeLabel("series"), "Series");
  assert.equal(hub.typeLabel("tv"), "Series");
  assert.equal(hub.typeLabel("movies"), "Movie");
  assert.equal(hub.typeLabel("anime"), "Anime");
  assert.equal(hub.typeLabel("channel"), "Live channel");
  // An unknown type is titled from the raw string rather than mislabelled.
  assert.equal(hub.typeLabel("audiobook"), "Audiobook");
  for (const sector of hub.SECTORS) assert.ok(sector.singular, `${sector.id} must name one item`);
});
