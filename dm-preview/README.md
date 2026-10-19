# dm-preview

`dm-converter`が生成したMapLibre出力をプレビューするNode.js CLIです。
MapLibre出力ディレクトリ、preview、bundle、スタイル編集の共通説明は
[MapLibre出力とプレビュー](../docs/maplibre-preview.md)を参照してください。

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
node ./dm-preview/bin/dm-preview.js preview OUTPUT [--distribution DIR] [--no-open] [--port PORT]
node ./dm-preview/bin/dm-preview.js bundle PMTILES OUTPUT
```

`preview`の`OUTPUT`は実行時のカレントディレクトリを基準に解決します。
`--port`を省略した場合は空いているポートを自動で使用します。
`OUTPUT`にGeoPackageがある場合は、既定で`OUTPUT/public`を配布用bundleとして作成または
再利用します。プレビュー用のGeoPackageは`OUTPUT`に残り、スタイル編集で更新する
`style.json`、sprite、glyphsは`OUTPUT/public`へ保存されます。配布先を変更する場合は
`--distribution DIR`を指定してください。`DIR`は`OUTPUT`とは別のディレクトリを指定します。
保存済みの`style.json`がない場合は同梱の標準Styleを表示し、初回保存時に
`OUTPUT/public/style.json`を作成します。

配布用の静的ファイル一式を作成する場合は`bundle`を使います。

```bash
node ./dm-preview/bin/dm-preview.js bundle ./maplibre/dm.pmtiles ./public
```

`bundle`の出力内容は[MapLibre出力とプレビュー](../docs/maplibre-preview.md)を参照してください。
入力側の`OUTPUT`に保存済みの`style.json`、sprite、glyphsがある場合は、それらを配布用bundleへ
引き継ぎます。配布用bundleにはGeoPackageやプレビュー画面の資材は含まれません。

### 背景の変更

画面上部の「背景」で任意の色を選び、「不透明度」で透明度を調整できます。
0%で完全透過、100%で不透明になります。地理院地図を非表示にすると背景を確認できます。
背景設定は表示スタイルを切り替えても維持されます。プレビュー専用の設定で、保存するスタイルには反映しません。

### スタイル編集

スタイル編集とAPIは[MapLibre出力とプレビュー](../docs/maplibre-preview.md)を参照してください。

既定ではブラウザを開きます。`--no-open`指定時はURLだけを標準出力へ表示します。
入力またはmanifestのエラーは終了コード`2`、サーバーなどの実行時エラーは
終了コード`1`です。

## Development

```bash
cd dm-preview
npm install
npm run check
npm test
npm run coverage
```

`npm run coverage`は`c8`を使い、`src/`と`static/assets/`の行・分岐・関数カバレッジを
標準出力へ表示します。HTMLレポートは`coverage/index.html`に生成されます。

MapLibre spriteを再生成する場合はImageMagickが必要です。

```bash
npm run generate:maplibre-assets
```

このコマンドは`static/maplibre/icons/source/`配下のSVG/BMP/PNGから
`static/maplibre/icons/png/`、`static/maplibre/icons/icon-mapping.csv`、
`static/maplibre/sprite/sprite.png`、`static/maplibre/sprite/sprite@2x.png`を
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

### 地図情報レベルと縮尺

保存済みのスタイルがない場合は、複数の地図情報レベルを縮尺に応じて自動で切り替えます。
2500と5000がある場合、1/5000より拡大すると2500、1/5000ちょうどを含む縮小側では5000を表示します。
切り替えズームはmanifestの中心緯度と96 dpiを基準に計算し、bundleの`style.json`にも保存します。
地図を南北に移動した場合も切り替えズームは固定です。

5000を超える地図情報レベルには5000の表現を使い、線幅・文字サイズ・記号サイズは
データの地図情報レベルを基準に計算します。10000なら5000用スタイルの2倍のサイズです。
5000のデータがない場合に限り、10000の切り替え縮尺を1/5000まで延ばします。
2500と10000だけの場合は1/5000ちょうどまで10000を表示し、それより拡大すると2500へ切り替えます。
5000も存在する場合は、1/10000より拡大すると10000から5000へ、1/5000より拡大すると2500へ切り替えます。

### DMI情報の表示

変換時に入力DMと同じフォルダにある `.dmi` を読み取り、GeoPackageの
`dm_dmi_metadata` テーブルにDMIごとに1行保存します。図郭番号でDM本体と照合し、
対応DMと地図情報レベルを専用列にも保持します。PMTiles出力には `dmi-info.json` を含め、
manifestの `dmiInfo` に相対パスを記録します。previewの「DMI情報」タブは、
地物一覧と同じ上部パネルの「DMI情報」タブに、座標系・作業規程・分類コード対応・方向定義などを表示します。
複数のDMIがある場合は、ドロップダウンで切り替えて確認できます。
配布時にもJSONをコピーするため、元のDM/DMIファイルは不要です。
旧出力やDMIのない入力では「DMI情報はありません」と表示します。
この表示機能は、独自分類コードの図式への適用や方向の解釈を変更しません。

保存形式と参照の詳細は[manifest・DMI情報JSON仕様](../docs/pmtiles-manifest-specification.md)を参照してください。
