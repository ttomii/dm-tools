# Sprite generation

The committed sprite is generated from `icons/source` by:

```text
npm run generate:maplibre-assets
```

To update only existing sprite frames for changed icons, pass sprite IDs:

```text
npm run generate:maplibre-assets -- 6216
```

The script converts SVG/BMP/PNG sources with ImageMagick and creates
deterministic 1x and 2x atlases in filename order. Sources smaller than their
sprite frame are centered without upscaling. Sprite source licensing is
recorded in `icons/LICENSE.txt`.
