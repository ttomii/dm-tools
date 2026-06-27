# dm-previewファイル構成

`dm-preview`は、CLI入口、実行時ロジック、静的ファイル、開発用スクリプトを
パッケージ単位で分けて配置します。

## パッケージ

| パス | 役割 |
| --- | --- |
| `bin/` | npmの`bin`として公開するCLI入口。`src/main.js`を呼び、終了コードを設定する。 |
| `src/` | `preview`と`bundle`の実行時ロジック。 |
| `static/assets/` | ブラウザで動くプレビューUI。HTML、CSS、ブラウザJSを置く。 |
| `static/maplibre/` | DM地図描画用の標準MapLibreアセット。Style、sprite、glyphs、mapping CSVを置く。 |
| `scripts/` | 開発・配布用の補助スクリプト。通常の`dm-preview`コマンドからは呼ばない。 |
| `test/` | Node.jsテスト。 |
| `dist/` | ビルド成果物。手で編集しない。 |

## `src/`

| パス | 役割 |
| --- | --- |
| `src/main.js` | CLI引数を解釈し、`preview`または`bundle`を起動する。 |
| `src/server.js` | サーバー機能の公開入口。 |
| `src/node/` | Node.js依存の処理。HTTPサーバー、静的ファイル配信、manifest、bundle、APIを扱う。 |
| `src/core/` | Style変換、source-layer、sprite規則などの共有ルール。 |
| `src/proj4/` | GeoPackage地物の座標変換。 |
| `src/sqljs/` | sql.jsを使ったGeoPackage読み取り。 |

## `static/`

| パス | 役割 |
| --- | --- |
| `static/assets/index.html` | プレビュー画面のHTML。 |
| `static/assets/app.css` | プレビュー画面のCSS。 |
| `static/assets/app.js` | ブラウザ側アプリの入口。 |
| `static/assets/browser/` | ブラウザ側UI、APIクライアント、sprite編集処理。 |
| `static/assets/core/` | ブラウザから直接importする共有ルール。 |
| `static/maplibre/style-*.json` | 縮尺別の標準MapLibre Style。 |
| `static/maplibre/sprite/` | MapLibre sprite。 |
| `static/maplibre/glyphs/` | MapLibre glyph PBF。 |
| `static/maplibre/icons/` | sprite生成元アイコンと対応表。 |

## 実行経路

`dm-preview preview`と`dm-preview bundle`は次の経路で動きます。

```text
dm-preview
  -> dm-preview/bin/dm-preview.js
    -> dm-preview/src/main.js
      -> dm-preview/src/node/*
      -> dm-preview/src/core/*
      -> dm-preview/src/proj4/*
      -> dm-preview/src/sqljs/*
```

## `scripts/`

| パス | 役割 |
| --- | --- |
| `scripts/build.mjs` | `dist/static/`へ静的ファイルをコピーする。 |
| `scripts/generate-maplibre-assets.mjs` | MapLibreアセット生成の入口。 |
| `scripts/maplibre-assets/generator.mjs` | `static/maplibre/icons/source/`からspriteと対応表を生成する。 |
