# luxkit

A pocket cheat sheet for shooting in manual mode. Tell it how bright it is, what frame rate you're on and which filter is on the lens, and it tells you what ISO and shutter to dial in, plus whether a different ND would do better.

The first tool is for the **Insta360 Luna Ultra**. Panasonic Lumix tools are planned.

It's a plain website (HTML, CSS and a little JavaScript), about 15 KB in total. There's no framework, no build step and nothing to install, and once you've opened it it works offline, so it's fine on a beach with no signal.

> Unofficial. Not made by or affiliated with Insta360, Panasonic or Freewell.

## Using it on your iPhone

1. Open the site in **Safari** and open the Luna Ultra page once while you're online.
2. Tap **Share → Add to Home Screen**. It now opens like an app.
3. To check it really works offline, switch on Airplane Mode and open it again.

For the most accurate result, measure the light with a light-meter app such as Lightprint or myLightMeter PRO, and type its EV reading into step 01 ("Measured with a light-meter app"). The lighting buttons are only rough guesses and can be a stop or two out.

## What the Luna Ultra page does

- **ISO and shutter** for your scene, keeping the shutter at the "180° rule" (1/50 at 24 fps, 1/120 at 60 fps, and so on) whenever ISO can make up the difference.
- **Filter advice** for the Freewell All Day kit, including the ND/PL versions and stacking two plain NDs. If something better exists, it shows it with a **Use** button that sets it for you.
- **I-Log support.** In I-Log it never goes below ISO 400 (the camera's native I-Log ISO), rounds towards a brighter exposure, and warns about any underexposure, because dark I-Log footage gets noisy quickly.
- **Noise warnings** above ISO 800 at 24/30 fps, or above 400 at 60 fps and up.
- **"Set it on the camera"**, a short step list that updates with your settings, for anyone new to manual mode.

## How the numbers are worked out

Everything comes from the standard exposure formula:

```
EV = log2(aperture² ÷ shutter) − log2(ISO ÷ 100)
```

Scene brightness (EV) minus the ND filter's stops gives the light reaching the sensor. The page first keeps the ideal shutter and solves for ISO. If that ISO is below the minimum, the shutter gets faster instead (up to 1/8000). If it's above 6400, the shutter opens to 1/fps first and then it warns about underexposure. ISO and shutter are rounded to the usual ⅓-stop values.

Presets: very bright sun EV 16, sunny 15, normal daylight 14, cloudy 12, shade 11, golden hour 10, indoor 7, night 4.

## Luna Ultra facts it relies on

| What | Value | Where it's from |
|---|---|---|
| Main lens | 1-inch sensor, 20mm, f/1.8 (fixed) | Insta360 spec sheet and manual |
| Tele lens | 1/1.3-inch sensor, 60mm, f/2.0 | Insta360 spec sheet and manual |
| ISO | 100–6400 | Insta360 spec sheet |
| Video shutter | 1/8000 to 1/24 s | Insta360 spec sheet |
| I-Log native ISO | 400 | Insta360 manual (I-Log FAQ), confirmed to CineD |
| 120 fps / 240 fps | up to 4K / 1080p only | Insta360 spec sheet |
| Colour profiles | Standard, Dolby Vision, 10-bit I-Log | Insta360 spec sheet |
| Which lens | 1× and 2× zoom use the main lens, 3× and up the tele | Leeming LUT Pro setup guide |
| Freewell All Day kit | ND8, 16, 32, 64 = 3, 4, 5, 6 stops; ND/PL versions the same; covers both lenses; plain NDs stack | Freewell product page |

Things nobody has confirmed yet, so the page says so where they matter:

- the camera's exact ISO and shutter steps;
- whether I-Log works in Slow Motion mode;
- the lowest ISO the camera allows in I-Log;
- whether two stacked filters darken the corners on the wide lens;
- how closely the camera's real exposure matches the f/1.8 maths (a quick check against the camera's Auto mode in the same light will tell you).

## Working on the code

```
site/            everything that gets deployed
  index.html     the hub page
  sw.js          offline support for the whole site
  shared/        the exposure maths and the shared styles
  luna-ultra/    the Luna Ultra page and its camera rules
tests/           unit tests and browser tests
reference/       the original single-file version, kept for comparison
tools/           a small script that draws the app icons
```

Run the tests:

```bash
npm test                       # unit tests, needs Node 18 or newer
npm install                    # first time only
npx playwright install webkit  # first time only, downloads Safari's engine
npx playwright test            # opens the site in WebKit and clicks through it
```

To look at the site locally, run `python3 -m http.server 8080 -d site` and open http://localhost:8080.

**One thing to remember:** after changing anything in `site/`, bump `CACHE` in `site/sw.js` (for example `luxkit-v1` to `luxkit-v2`). Otherwise phones that already have the site keep showing the old copy.

## Deploying

Connect the repository in Netlify (**Add new site → Import an existing project**). `netlify.toml` already sets the publish folder to `site` with no build command, so there's nothing to configure. Every push to `main` redeploys.

## Adding another camera

1. Copy `site/luna-ultra/` to a new folder and change `camera.js` to that camera's specs and rules. The maths in `shared/exposure-core.js` is reused as it is.
2. Add the new files to `PRECACHE` in `site/sw.js` and bump `CACHE`.
3. Add a row for it on the hub page, `site/index.html`.
4. Add tests next to the existing ones.

## License

MIT. See [LICENSE](LICENSE).
