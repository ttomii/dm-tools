# MapLibre出力とプレビュー

## MapLibre出力ディレクトリ

```text
{layer-name}.pmtiles
{layer-name}.gpkg
pmtiles-manifest.json
```

`{layer-name}.gpkg`はDM入力から直接MapLibre出力を生成した場合だけ作成されます。
固定Style、sprite、glyph、プレビュー画面は`dm-preview`側の資材であり、
`dm-converter`の出力には含めません。

DM入力から直接MapLibre出力を生成した場合は、PMTiles生成に使った中間GeoPackageが
`{layer-name}.gpkg`として残ります。このGeoPackageがある場合、`dm-preview`はレイヤ別
地物一覧と地物選択用APIに使用します。

## Preview

```bash
dm-preview preview OUTPUT [--distribution DIR] [--no-open]
```

`OUTPUT/pmtiles-manifest.json`とPMTilesを検証し、出力ディレクトリを
`127.0.0.1`の空きポートで配信します。PMTilesのRangeリクエストに対応します。
既定ではブラウザを開きます。`--no-open`指定時はURLだけを標準出力へ表示します。

通常のプレビューでは、StyleやマップアセットはCLI自身のファイル位置から解決します。
`bundle`で作成した配布フォルダを渡した場合は、そのフォルダ内のStyleやマップ
アセットを優先して表示します。

GeoPackageを含むプレビュー用データを指定した場合は、既定で`OUTPUT/public`を配布用
ディレクトリとして使用します。配布先を変更する場合は`--distribution`を指定します。

```text
preview-data/
  {layer-name}.pmtiles
  {layer-name}.gpkg
  pmtiles-manifest.json
preview-data/public/
  {layer-name}.pmtiles
  sprite/
  glyphs/
  style.json (初回保存後)
```

次のコマンドは`preview-data/public/`が存在しない場合に配布用bundleを作成し、存在する
場合はそのbundleを再利用してプレビューを起動します。

```bash
dm-preview preview ./preview-data
```

地物一覧・地物選択APIは`preview-data`のGeoPackageを読み取り、Style編集の保存先と
MapLibreが参照するPMTilesは`preview-data/public`になります。保存済みStyleがない場合は
同梱の標準Styleを使用し、初回保存時に`preview-data/public/style.json`を作成します。
`style.json`保存後の配布用ディレクトリにはGeoPackageやプレビュー画面の資材を含めず、
そのまま静的配布できます。

## 保存後の出力データ

プレビュー画面でスタイルを保存すると、配布用ディレクトリに次のファイルが作成または
更新されます。このディレクトリをHTTPサーバーで公開すると、MapLibre GL JSから参照できます。

| パス | 内容 | 保存時の扱い |
| --- | --- | --- |
| `{layer-name}.pmtiles` | 地物データ | `preview`ではbundle作成時にコピー。`bundle`では入力からコピー |
| `style.json` | MapLibre Style | 初回保存時に作成し、以後更新 |
| `sprite/sprite.json`、`sprite/sprite.png` | 標準解像度の記号画像と索引 | アイコン色変更時に更新 |
| `sprite/sprite@2x.json`、`sprite/sprite@2x.png` | 2倍解像度の記号画像と索引 | アイコン色変更時に更新 |
| `glyphs/` | 注記表示用の文字glyph | 標準資材または保存済み資材を使用 |

DM入力から生成したプレビュー用データでは、元の`OUTPUT`にGeoPackageとmanifestを残し、
スタイル保存先は既定で`OUTPUT/public`です。`--distribution DIR`を指定した場合は、
指定した`DIR`が保存先になります。

配布用ディレクトリには、GeoPackage、プレビュー画面の`index.html`、`assets/`、
`vendor/`は含まれません。スタイル編集後の`style.json`、PMTiles、sprite、glyphsだけを
静的Web配信に使用します。

別の配布先を使う場合は次のように指定します。

```bash
dm-preview preview ./preview-data --distribution ./public
```

## Bundle

```bash
dm-preview bundle PMTILES OUTPUT
```

`PMTILES`と同じフォルダにある`pmtiles-manifest.json`を検証し、`OUTPUT`に
`style.json`、PMTiles、`sprite/`、`glyphs/`を配置します。
入力フォルダに保存済みの`style.json`、`sprite/`、`glyphs/`がある場合は、保存済みの
内容を引き継ぎます。ない場合は同梱の標準Style・アセットを使用します。
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
`bundle`で作成した`OUTPUT`では既存の`style.json`を更新します。GeoPackageを含む
MapLibre出力をプレビューする場合は、既定で`OUTPUT/public`へ配布用bundleを作成し、
そこへ保存します。保存済みStyleがない場合は同梱の標準Styleを表示し、初回保存時に
配布用ディレクトリの`style.json`を作成します。
`--distribution DIR`を指定した場合は、これらの保存先が`DIR`になります。指定しない場合は
GeoPackageがある`OUTPUT`に対して`OUTPUT/public`が保存先です。

編集対象はMapLibre Style内のDMレイヤです。アイコン、ライン、ポリゴン、
テキストの種別単位で色を一括変更できます。レイヤ単位では色と表示・非表示を
変更できます。アイコン色は通常のPNG spriteを維持し、色変更後のsprite IDを
追加して`layout.icon-image`へ適用します。
縦書き注記の長音記号`ー`を縦棒`︱`で表示する設定も切り替えできます。
同梱Styleでは既定で有効です。表示用属性`TEXT_VERTICAL`がない地物は元の`TEXT`へ
フォールバックします。

保存時は配布用ディレクトリの`style.json`を作成または更新します。アイコン色を変更した場合は、
あわせて保存先の`sprite/sprite.json`、`sprite/sprite.png`、
`sprite/sprite@2x.json`、`sprite/sprite@2x.png`を更新します。
更新後は同じ`preview`コマンドを再度起動すると、保存済みのStyleとspriteが適用されます。

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
