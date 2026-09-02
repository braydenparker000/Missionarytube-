# Private Invidious for MissionaryTube

MissionaryTube plays YouTube through Invidious. The app is a static site with
no server of its own, so this is the only server in the picture, and it does
two jobs:

- **Resolver.** It answers search and metadata requests, and returns the real
  playback URLs for a video. This is almost all of the traffic and it is tiny.
- **Compatibility proxy, for one case only.** Adaptive playback (720p and
  above) is fetched by JavaScript through Media Source Extensions, which is a
  CORS request. Google's video hosts do not send CORS headers, so those
  segments have to come through this server. Progressive playback (360p, and
  720p where YouTube still publishes it) goes straight from Google to the
  browser and never touches this machine.

That split is why the frontend turns adaptive quality **on** when a private
instance is configured and leaves it **off** when it is not: proxying video is
our bandwidth to spend, not a volunteer instance's.

## What you need

- A Linux VM with Docker and the Compose plugin.
  An Oracle Cloud **Always Free** Ampere A1 instance (ARM64, up to 4 OCPU and
  24 GB) is more than enough; 1 OCPU / 6 GB is comfortable. The images below
  are published for `linux/arm64` as well as `linux/amd64`.
- A DNS name pointing at the VM.
- A TLS certificate. **This is not optional**: MissionaryTube is served over
  https, and a browser will not load media or call an API from a plain-http
  origin on an https page.

## Install

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

git clone https://github.com/braydenparker000/Missionarytube-.git
cd Missionarytube-/deploy/invidious

cp .env.example .env
sed -i "s/CHANGE_ME/$(openssl rand -base64 24 | tr -d '=+/')/" .env
```

Then open `.env` and set `INVIDIOUS_DOMAIN` to the address you will actually
serve this from. Everything below writes it as `invidious.example.org`.

Then put TLS in front of it. Caddy is the shortest path, because it obtains
and renews the certificate itself:

```bash
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
invidious.example.org {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
sudo systemctl restart caddy
```

Invidious itself listens only on `127.0.0.1:3000`, so nothing reaches it
except through that proxy.

## Run

```bash
docker compose up -d          # start
docker compose ps             # what is running
docker compose logs -f        # follow the logs
docker compose down           # stop, keeping the database
docker compose pull && docker compose up -d    # update to the pinned image
```

The image tag in `docker-compose.yml` is pinned deliberately. To move to a
newer Invidious, change that tag, run the two update commands, and check the
health endpoint below before pointing the app at it.

## Health check

```bash
curl -fsS https://invidious.example.org/api/v1/stats | head -c 200
```

A JSON body naming `invidious` in `software.name` means the API is up. This is
the same endpoint MissionaryTube probes, and the same one **Settings → YouTube
→ Test servers** reports on.

Two more worth checking once, because they are the two paths playback uses:

```bash
# Metadata and format list.
curl -fsS "https://invidious.example.org/api/v1/videos/dQw4w9WgXcQ" | head -c 200

# The adaptive manifest, proxied. A 200 and an XML body means adaptive
# playback will work; anything else means the app will fall back to
# progressive, which still plays.
curl -fsSI "https://invidious.example.org/api/manifest/dash/id/dQw4w9WgXcQ?local=true"
```

And confirm the CORS header the browser depends on is present:

```bash
curl -fsSI -H "Origin: https://missionarytube.z13.web.core.windows.net" \
  "https://invidious.example.org/api/v1/stats" | grep -i access-control-allow-origin
```

## Network and firewall

Open **443/tcp** (and **80/tcp**, which Caddy needs for the ACME challenge and
for the redirect). Nothing else.

On Oracle Cloud that means two places, and forgetting the second is the usual
reason a fresh instance appears dead:

1. **Security list / NSG** on the VCN subnet: ingress for 80 and 443 from
   `0.0.0.0/0`.
2. **The VM's own firewall.** Oracle's Ubuntu images ship with iptables rules
   that drop everything but SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Port 3000 and Postgres 5432 stay closed: neither is published beyond the
Docker network or localhost.

## Point MissionaryTube at it

In the app: **Settings → YouTube**, paste `https://invidious.example.org` into
*Your Invidious server*, and press Save. Then press **Test servers**; your
instance should come back Ready with a latency.

The address is stored in that browser's local storage only. It is never
committed to this repository, and `assets/js/youtube/config.js` ships with
`privateInvidiousUrl: ""` for exactly that reason. If you would rather bake it
into a private fork, that constant is the single place to change.

## Sizing and upkeep

- **Disk.** The database holds no user data (registration and login are off),
  so it stays small. Log rotation is configured in the compose file.
- **Memory.** Invidious sits around 300-600 MB; Postgres around 100 MB.
- **Bandwidth.** This is the number to watch. Metadata is negligible. Adaptive
  playback is not: it moves the whole video through the VM. Oracle's Always
  Free tier includes 10 TB/month of egress, which is generous, but if you want
  to spend none of it, turn *Adaptive quality* off in the app and playback
  falls back to direct progressive streams.
- **Backups.** Nothing here is irreplaceable — the database is a cache. If you
  want one anyway:
  `docker compose exec postgres pg_dump -U invidious invidious | gzip > backup.sql.gz`

## When it breaks

| Symptom | Where to look |
| --- | --- |
| App says "No Invidious server is available" | `docker compose ps`, then `docker compose logs invidious` |
| `/api/v1/stats` works but videos do not | YouTube changed something; `docker compose pull && docker compose up -d` |
| Adaptive fails, progressive plays | The proxy path. Check `disable_proxy: false` and that `?local=true` returns 200 |
| Everything 403s | Google is rate limiting the VM's address. It usually clears; the app fails over to the public instances meanwhile |
| Certificate errors | `sudo journalctl -u caddy -n 50` |

The app is built so that none of these break the feature outright: a failing
instance is rested and the request moves to the next one, and if every one
fails the viewer sees *"YouTube playback is temporarily unavailable"* rather
than a broken player.
