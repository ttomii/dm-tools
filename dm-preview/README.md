# dm-preview

`dm-converter`が生成したMapLibre出力をプレビューするNode.js CLIです。

## Requirements

- Node.js 22以降
- Webブラウザ

## Install

依存をインストールします。グローバルインストールはしません。

```bash
npm install --prefix ./dm-preview
```

## Usage

リポジトリルートから`node`で起動します。

```bash
node ./dm-preview/bin/dm-preview.js preview OUTPUT [--no-open]
node ./dm-preview/bin/dm-preview.js bundle PMTILES OUTPUT
```

`preview`の`OUTPUT`は実行時のカレントディレクトリを基準に解決します。
通常のプレビューでは、StyleやマップアセットはCLI自身のファイル位置から解決するため、
起動ディレクトリに依存しません。`bundle`で作成した配布フォルダを渡した場合は、
そのフォルダ内のStyleやマップアセットを優先して表示します。

`OUTPUT/pmtiles-manifest.json`とPMTilesを検証し、出力ディレクトリを
`127.0.0.1`の空きポートで配信します。PMTilesのRangeリクエストに対応します。
`OUTPUT/{layerName}.gpkg`が存在する場合は、プレビュー画面のレイヤ別地物一覧と
地物選択用APIにも使用します。

MapLibreのStyle・sprite・glyphは本パッケージに同梱した`maplibre/`を配信します。
出力ディレクトリにはこれらを含めず、Rust側`dm-converter`はPMTilesと
`pmtiles-manifest.json`のみを生成します。

配布用の静的ファイル一式を作成する場合は`bundle`を使います。

```bash
node ./dm-preview/bin/dm-preview.js bundle ./maplibre/dm.pmtiles ./public
```

`PMTILES`と同じフォルダにある`pmtiles-manifest.json`を検証し、`OUTPUT`に
PMTiles、manifest、`index.html`、`assets/`、`vendor/`、`maplibre/`を配置します。
作成した`OUTPUT`をHTTPサーバーに配置すると、そのままMapLibreプレビューを配信できます。

地物一覧API:

```text
GET /preview/api/features?layer=dm_7100_point&page=1&pageSize=50
```

`layer`はmanifestの`sourceLayers`に含まれるレイヤ名を指定します。
レスポンスにはGeoJSONジオメトリ、bbox、中心座標、属性、総件数を含みます。

既定ではブラウザを開きます。`--no-open`指定時はURLだけを標準出力へ表示します。
入力またはmanifestのエラーは終了コード`2`、サーバーなどの実行時エラーは
終了コード`1`です。

## Development

```bash
cd dm-preview
npm install
npm run check
npm test
```

MapLibre spriteを再生成する場合はImageMagickが必要です。

```bash
npm run generate:maplibre-assets
```

このコマンドは`maplibre/icons/source/`配下のSVG/BMP/PNGから
`maplibre/icons/png/`、`maplibre/icons/icon-mapping.csv`、
`maplibre/sprite/sprite.png`、`maplibre/sprite/sprite@2x.png`を
再生成します。

変更したアイコンだけを既存spriteの同じ位置へ差分更新する場合は、
DMコードまたはsprite IDを指定します。

```bash
npm run generate:maplibre-assets -- 6216
npm run generate:maplibre-assets -- dm-6216
```

差分更新は既存の`sprite.json` / `sprite@2x.json`にある矩形だけを
上書きします。新しいsprite IDを追加した場合やsprite配置を作り直す場合は、
引数なしで全再生成してください。
