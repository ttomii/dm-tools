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
`style.json`、PMTiles、`sprite/`、`glyphs/`を配置します。
`style.json`は同じフォルダにあるPMTiles、sprite、glyphsを相対参照します。
作成した`OUTPUT`をHTTPサーバーに配置すると、MapLibre GL JSからそのまま参照できます。
プレビュー画面の`index.html`、`assets/`、`vendor/`は出力しません。
`OUTPUT`が既に存在する場合は空ディレクトリである必要があります。

### スタイル編集

`OUTPUT`を`preview`で開いた場合、プレビュー画面からDMスタイルを編集できます。
`bundle`で作成した`OUTPUT`では既存の`style.json`を更新します。通常のプレビューで
パッケージ同梱Styleを参照している場合は、保存時に`OUTPUT/style.json`と
不足している`sprite/`、`glyphs/`を作成します。

編集対象はMapLibre Style内のDMレイヤです。アイコン、ライン、ポリゴン、
テキストの種別単位で色を一括変更できます。レイヤ単位では色と表示・非表示を
変更できます。アイコン色は通常のPNG spriteを維持し、色変更後のsprite IDを
追加して`layout.icon-image`へ適用します。

保存時は`OUTPUT/style.json`を作成または更新します。アイコン色を変更した場合は、
あわせて`OUTPUT/sprite/sprite.json`、`OUTPUT/sprite/sprite.png`、
`OUTPUT/sprite/sprite@2x.json`、`OUTPUT/sprite/sprite@2x.png`を更新します。
更新後の`OUTPUT`を再度`preview`で指定すると、保存済みのStyleとspriteが適用されます。

スタイル編集API:

```text
GET /preview/api/style-editor/state
PUT /preview/api/style-editor/state
```

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
