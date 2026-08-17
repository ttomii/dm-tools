# MapLibreプレビュー検証手順

`dm-converter`で生成したMapLibre出力と、`dm-preview`による表示・配布機能を
開発者、QA、リリース確認担当者が検証するための資料です。

利用者向けの出力形式、保存先、`preview`・`bundle`の使い方は、
[MapLibre出力とプレビュー](../maplibre-preview.md)を参照してください。

## 検証観点

`dm-converter`でMapLibre出力を作成したあと、次を確認します。

1. 出力ディレクトリに`{layer-name}.pmtiles`と`pmtiles-manifest.json`がある。
2. DM入力から直接生成した場合は`{layer-name}.gpkg`もある。
3. `dm-preview preview OUTPUT --no-open`でURLが出力される。
4. ブラウザでpreview URLを開き、Style切替、PMTiles Range配信、sprite、
   注記glyph、地物クリック属性、z24オーバーズームを確認する。
5. 同じ入力のGeoPackageをQGISで開き、地物数、位置、属性を比較する。
