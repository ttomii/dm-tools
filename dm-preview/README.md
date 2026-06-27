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
node ./dm-preview/bin/dm-preview.js preview OUTPUT [--no-open]
node ./dm-preview/bin/dm-preview.js bundle PMTILES OUTPUT
```

`preview`の`OUTPUT`は実行時のカレントディレクトリを基準に解決します。

配布用の静的ファイル一式を作成する場合は`bundle`を使います。

```bash
node ./dm-preview/bin/dm-preview.js bundle ./maplibre/dm.pmtiles ./public
```

`bundle`の出力内容は[MapLibre出力とプレビュー](../docs/maplibre-preview.md)を参照してください。

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
