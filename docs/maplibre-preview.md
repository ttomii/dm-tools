# MapLibre出力とプレビュー

`dm-converter`はMapLibre向けのPMTilesとmanifestを生成します。`dm-preview`は
その出力を検証し、MapLibre GL JSで表示するためのStyle、sprite、glyph、
プレビュー画面を配信します。

## 役割分担

| ツール | 役割 |
| --- | --- |
| `dm-converter` | DMまたはGeoPackageから`{layer-name}.pmtiles`、`pmtiles-manifest.json`を生成する |
| `dm-preview` | MapLibre出力ディレクトリをローカルHTTPサーバーで公開し、同梱Styleとアセットを配信する |

DM入力から直接MapLibre出力を生成した場合、`dm-converter`はPMTiles生成に使った
中間GeoPackageを`{layer-name}.gpkg`として出力ディレクトリへ残します。
このGeoPackageが存在する場合、`dm-preview`はレイヤ別地物一覧と地物選択用APIに
使用します。

## MapLibre出力ディレクトリ

```text
{layer-name}.pmtiles
{layer-name}.gpkg
pmtiles-manifest.json
```

`{layer-name}.gpkg`はDM入力から直接MapLibre出力を生成した場合だけ作成されます。
固定Style、sprite、glyph、プレビュー画面は`dm-preview`側の資材であり、
`dm-converter`の出力には含めません。

## Preview

```bash
dm-preview preview OUTPUT [--no-open]
```

`OUTPUT/pmtiles-manifest.json`とPMTilesを検証し、出力ディレクトリを
`127.0.0.1`の空きポートで配信します。PMTilesのRangeリクエストに対応します。
既定ではブラウザを開きます。`--no-open`指定時はURLだけを標準出力へ表示します。

通常のプレビューでは、StyleやマップアセットはCLI自身のファイル位置から解決します。
`bundle`で作成した配布フォルダを渡した場合は、そのフォルダ内のStyleやマップ
アセットを優先して表示します。

## Bundle

```bash
dm-preview bundle PMTILES OUTPUT
```

`PMTILES`と同じフォルダにある`pmtiles-manifest.json`を検証し、`OUTPUT`に
`style.json`、PMTiles、`sprite/`、`glyphs/`を配置します。
`style.json`は同じフォルダにあるPMTiles、sprite、glyphsを相対参照します。
作成した`OUTPUT`をHTTPサーバーに配置すると、MapLibre GL JSからそのまま参照できます。
プレビュー画面の`index.html`、`assets/`、`vendor/`は出力しません。
`OUTPUT`が既に存在する場合は空ディレクトリである必要があります。

## Styleとsource-layer

固定Styleに個別定義がない点・線・面を既定スタイルで表示できるように、
`dm-preview`はmanifestの`sourceLayers`を使い、固定Styleの既定スタイルを
`dm_{DMCODE}_{GEOM}` source-layerへ展開します。PMTiles内には共通フォールバック用の
`dm_default_*` source-layerを生成しません。

固定Styleでは個別スタイルが存在するDMCodeを除外し、未定義DMCodeだけを
既定スタイルで描画します。既定スタイルは点が0.5mm直径の黒い塗りつぶし丸、
線が0.15mmの実線、面が0.15mmの実線アウトラインかつ塗りつぶしなしです。

Style内のPMTiles URL、sprite URL、glyph URLは、プレビュー時に配信元へ
書き換えます。配布用bundleではPMTiles、sprite、glyphsへの相対参照に変換します。

## スタイル編集

`OUTPUT`を`preview`で開いた場合、プレビュー画面からDMスタイルを編集できます。
`bundle`で作成した`OUTPUT`では既存の`style.json`を更新します。通常のプレビューで
パッケージ同梱Styleを参照している場合は、保存時に`OUTPUT/style.json`と
不足している`sprite/`、`glyphs/`を作成します。

編集対象はMapLibre Style内のDMレイヤです。アイコン、ライン、ポリゴン、
テキストの種別単位で色を一括変更できます。レイヤ単位では色と表示・非表示を
変更できます。アイコン色は通常のPNG spriteを維持し、色変更後のsprite IDを
追加して`layout.icon-image`へ適用します。
縦書き注記の長音記号`ー`を縦棒`︱`で表示する設定も切り替えできます。
同梱Styleでは既定で有効です。表示用属性`TEXT_VERTICAL`がない地物は元の`TEXT`へ
フォールバックします。

保存時は`OUTPUT/style.json`を作成または更新します。アイコン色を変更した場合は、
あわせて`OUTPUT/sprite/sprite.json`、`OUTPUT/sprite/sprite.png`、
`OUTPUT/sprite/sprite@2x.json`、`OUTPUT/sprite/sprite@2x.png`を更新します。
更新後の`OUTPUT`を再度`preview`で指定すると、保存済みのStyleとspriteが適用されます。

## API

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

## 検証観点

`dm-converter`でMapLibre出力を作成したあと、次を確認します。

1. 出力ディレクトリに`{layer-name}.pmtiles`と`pmtiles-manifest.json`がある。
2. DM入力から直接生成した場合は`{layer-name}.gpkg`もある。
3. `dm-preview preview OUTPUT --no-open`でURLが出力される。
4. ブラウザでpreview URLを開き、Style切替、PMTiles Range配信、sprite、
   注記glyph、地物クリック属性、z24オーバーズームを確認する。
5. 同じ入力のGeoPackageをQGISで開き、地物数、位置、属性を比較する。
