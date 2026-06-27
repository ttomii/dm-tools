# MapLibre fixed assets

`style-500.json`, `style-1000.json`, `style-2500.json`, and `style-5000.json`
are manually maintained fixed
MapLibre Style Specification v8 documents. They are prepared by referring to
the DM SLD files and the DM specification, but they are not generated from SLD
at build time or runtime.

`style-mapping.csv` records the correspondence and known differences between
the reference SLD files and the fixed Style layers. Updating an SLD does not
update either Style automatically. A Style change must update the relevant
JSON, mapping rows, sprite references, and validation tests together.

`npm run generate:maplibre-assets` regenerates `icons/icon-mapping.csv` and
the sprite atlas from the committed `icons/source` files. It never writes the
fixed Style JSON files.
