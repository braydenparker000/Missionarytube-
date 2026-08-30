/**
 * Astra media hub taxonomy.
 *
 * The Stremio protocol lets an add-on expose arbitrary catalog types. The hub
 * turns whatever the installed add-ons actually declare into an ordered set of
 * destinations, and it is deliberately honest about the difference between:
 *
 *   available   an installed add-on declares catalogs of this type
 *   empty       nothing installed exposes it, and we say what is missing
 *
 * A type nobody anticipated is never discarded: it becomes a custom sector at
 * the end of the list so the content stays reachable.
 *
 * Dependency free: a classic script in the browser, evaluated in `node:vm` by
 * the tests.
 */
(function (global) {
  "use strict";

  /**
   * The curated sectors, in presentation order. `match` lists the raw catalog
   * type strings an add-on might use for the same idea — Stremio has no
   * registry, so real-world add-ons spell these several ways.
   */
  var SECTORS = [
    {
      id: "movie",
      label: "Movies",
      singular: "Movie",
      match: ["movie", "movies", "film"],
      needs: "an add-on with movie catalogs"
    },
    {
      id: "series",
      label: "Series",
      singular: "Series",
      match: ["series", "tv", "show", "shows"],
      needs: "an add-on with series catalogs"
    },
    {
      id: "anime",
      label: "Anime",
      singular: "Anime",
      match: ["anime", "animes"],
      needs: "an anime add-on such as a Kitsu or AniList catalog"
    },
    {
      id: "channel",
      label: "Live TV",
      singular: "Live channel",
      match: ["channel", "channels", "tv_channel", "iptv", "live"],
      needs: "an add-on with live channel catalogs"
    },
    {
      id: "music",
      label: "Music",
      singular: "Music",
      match: ["music", "album", "albums", "track", "artist"],
      needs: "an add-on with music catalogs"
    },
    {
      id: "radio",
      label: "Radio",
      singular: "Radio station",
      match: ["radio", "station", "stations"],
      needs: "an add-on with radio station catalogs"
    },
    {
      id: "podcast",
      label: "Podcasts",
      singular: "Podcast",
      match: ["podcast", "podcasts"],
      needs: "an add-on with podcast catalogs"
    },
    {
      id: "youtube",
      label: "YouTube",
      singular: "YouTube",
      match: ["youtube", "yt"],
      needs: "an add-on that returns YouTube video ids"
    },
    {
      id: "other",
      label: "Other",
      singular: "Other",
      match: ["other", "misc"],
      needs: "an add-on with additional catalogs"
    }
  ];

  // Types that carry episodes and therefore use the series browser.
  var EPISODIC = ["series", "anime"];
  // Types that play as audio rather than video.
  var AUDIO_SECTORS = ["music", "radio", "podcast"];

  function str(value) {
    return value == null ? "" : String(value);
  }

  function normalizeType(type) {
    return str(type).trim().toLowerCase();
  }

  /** Which curated sector a raw catalog type belongs to, or null if custom. */
  function sectorIdForType(type) {
    var normalized = normalizeType(type);
    if (!normalized) return null;
    for (var i = 0; i < SECTORS.length; i += 1) {
      if (SECTORS[i].match.indexOf(normalized) !== -1) return SECTORS[i].id;
    }
    return null;
  }

  function sectorById(id) {
    for (var i = 0; i < SECTORS.length; i += 1) {
      if (SECTORS[i].id === id) return SECTORS[i];
    }
    return null;
  }

  function isEpisodic(type) {
    return EPISODIC.indexOf(sectorIdForType(type) || normalizeType(type)) !== -1;
  }

  function isAudio(type) {
    return AUDIO_SECTORS.indexOf(sectorIdForType(type) || normalizeType(type)) !== -1;
  }

  /** A readable label for a custom type an add-on invented. */
  function customLabel(type) {
    var raw = str(type).replace(/[_-]+/g, " ").trim();
    if (!raw) return "Other";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  /**
   * Collect the catalogs each installed add-on declares.
   *
   * `sources` is the app's manifest list: `[{ addon, manifest }]`. Anything
   * malformed is skipped rather than throwing into the render path.
   */
  function collectCatalogs(sources) {
    var out = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      if (!source || typeof source !== "object") return;
      var manifest = source.manifest;
      if (!manifest || typeof manifest !== "object") return;
      var catalogs = Array.isArray(manifest.catalogs) ? manifest.catalogs : [];
      catalogs.forEach(function (catalog) {
        if (!catalog || typeof catalog !== "object") return;
        var type = normalizeType(catalog.type);
        if (!type) return;
        out.push({
          type: type,
          id: str(catalog.id),
          name: str(catalog.name || catalog.id),
          addonName: str(manifest.name),
          addonUrl: str(source.addon && source.addon.url),
          catalog: catalog,
          source: source
        });
      });
    });
    return out;
  }

  /**
   * Build the ordered hub.
   *
   * Every curated sector is returned whether or not it is available, because a
   * sector the viewer cannot use still needs to explain what is missing and
   * point at Add-ons. Custom types discovered in the manifests are appended so
   * nothing an add-on exposes becomes unreachable.
   */
  function buildHub(sources, options) {
    var config = options || {};
    var catalogs = collectCatalogs(sources);
    var byType = {};

    catalogs.forEach(function (entry) {
      if (!byType[entry.type]) byType[entry.type] = [];
      byType[entry.type].push(entry);
    });

    var claimed = {};
    var sectors = SECTORS.map(function (definition) {
      var matched = [];
      definition.match.forEach(function (type) {
        if (!byType[type]) return;
        claimed[type] = true;
        matched = matched.concat(byType[type]);
      });
      return {
        id: definition.id,
        label: definition.label,
        singular: definition.singular,
        custom: false,
        types: definition.match.filter(function (type) {
          return !!byType[type];
        }),
        catalogs: matched,
        available: matched.length > 0,
        providers: providerNames(matched),
        needs: definition.needs,
        episodic: EPISODIC.indexOf(definition.id) !== -1,
        audio: AUDIO_SECTORS.indexOf(definition.id) !== -1
      };
    });

    // Whatever is left is a type no curated sector claimed.
    Object.keys(byType)
      .filter(function (type) {
        return !claimed[type];
      })
      .sort()
      .forEach(function (type) {
        var matched = byType[type];
        sectors.push({
          id: "custom:" + type,
          label: customLabel(type),
          singular: customLabel(type),
          custom: true,
          types: [type],
          catalogs: matched,
          available: true,
          providers: providerNames(matched),
          needs: "",
          episodic: false,
          audio: false
        });
      });

    if (config.availableOnly) {
      return sectors.filter(function (sector) {
        return sector.available;
      });
    }
    return sectors;
  }

  function providerNames(entries) {
    var seen = {};
    var names = [];
    entries.forEach(function (entry) {
      var name = entry.addonName;
      if (!name || seen[name]) return;
      seen[name] = true;
      names.push(name);
    });
    return names;
  }

  /**
   * The name for one item of a type. Naive de-pluralising turns "Series" into
   * "Serie", so each sector carries its own singular instead.
   */
  function typeLabel(type) {
    var id = sectorIdForType(type);
    var sector = id ? sectorById(id) : null;
    return sector ? sector.singular : customLabel(type);
  }

  /** Whether a raw catalog type belongs to an already-built hub sector. */
  function catalogMatchesSector(sector, type) {
    if (!sector || !Array.isArray(sector.types)) return false;
    return sector.types.indexOf(normalizeType(type)) !== -1;
  }

  /**
   * A one-line explanation of a sector's state, used verbatim in the UI so the
   * copy cannot drift from the logic that produced it.
   */
  function describe(sector) {
    if (!sector) return "";
    if (!sector.available) return "No installed add-on provides " + sector.label.toLowerCase() + ".";
    var count = sector.catalogs.length;
    var catalogWord = count === 1 ? "catalog" : "catalogs";
    var providers = sector.providers.length;
    if (!providers) return count + " " + catalogWord;
    var providerWord = providers === 1 ? "add-on" : "add-ons";
    return count + " " + catalogWord + " · " + providers + " " + providerWord;
  }

  /** What the viewer would have to install, for the empty state. */
  function missingReason(sector) {
    if (!sector || sector.available) return "";
    return sector.needs ? "Install " + sector.needs + " to use this sector." : "Install an add-on that provides this content.";
  }

  /**
   * Does any installed add-on declare a `stream` resource for this type?
   * A catalog without streams can be browsed but not played, and the UI should
   * not promise playback it cannot deliver.
   */
  function canStream(sources, type) {
    var wanted = normalizeType(type);
    if (!wanted) return false;
    return (Array.isArray(sources) ? sources : []).some(function (source) {
      var manifest = source && source.manifest;
      if (!manifest) return false;
      var resources = Array.isArray(manifest.resources) ? manifest.resources : [];
      return resources.some(function (resource) {
        if (typeof resource === "string") return resource === "stream";
        if (!resource || resource.name !== "stream") return false;
        var types = Array.isArray(resource.types) ? resource.types : [];
        return types.length === 0 || types.map(normalizeType).indexOf(wanted) !== -1;
      });
    });
  }

  global.AstraHub = {
    SECTORS: SECTORS,
    EPISODIC: EPISODIC,
    AUDIO_SECTORS: AUDIO_SECTORS,
    normalizeType: normalizeType,
    sectorIdForType: sectorIdForType,
    sectorById: sectorById,
    isEpisodic: isEpisodic,
    isAudio: isAudio,
    customLabel: customLabel,
    typeLabel: typeLabel,
    catalogMatchesSector: catalogMatchesSector,
    collectCatalogs: collectCatalogs,
    buildHub: buildHub,
    describe: describe,
    missingReason: missingReason,
    canStream: canStream
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
