# dm-tools

DMファイルを扱うツール群です。

- `dm-converter`: DMファイルをGeoPackageまたはMapLibre向けPMTilesへ変換するRust CLI
- `dm-preview`: `dm-converter`が生成したMapLibre出力をプレビューするNode.js CLI

## 動作要件

変換CLIをソースコードからビルドする場合は、Rust 1.88以降が必要です。
MapLibre出力をプレビューする場合は、Node.js 22以降とWebブラウザが必要です。

## クイックスタート

```bash
cd dm-converter
cargo build --release

target/release/dm-converter convert ./dm-data ./result.gpkg
target/release/dm-converter convert ./dm-data ./maplibre --format maplibre --layer-name dm
```

実行ファイルは`target/release/dm-converter`に生成されます。入力には単一の
`.dm`ファイル、またはDMファイルを含むディレクトリを指定できます。
GeoPackageを作る場合は`.gpkg`ファイルを、MapLibre向けPMTilesを作る場合は
出力ディレクトリを指定します。

Windows向けリリースビルドの手順は
[dm-converter README](dm-converter/README.md)を参照してください。

## 利用方法

### DM変換

```bash
dm-converter convert INPUT OUTPUT [OPTIONS]
```

DMファイル、DMディレクトリ、または本ツールで生成したGeoPackageを入力できます。
引数、オプション、入力と出力の組み合わせは
[CLIリファレンス](dm-converter/docs/cli.md)を参照してください。

### MapLibreプレビュー

```bash
npm install --global ./dm-preview
dm-preview OUTPUT [--no-open]
```

Node.jsパッケージがMapLibre出力ディレクトリをローカルHTTPサーバーで公開し、
同梱のStyle・sprite・glyphとあわせて配信します。通常はブラウザを自動的に開きます。
`--no-open`を指定すると、ブラウザを開かずURLだけを表示します。詳細は
[dm-preview README](dm-preview/README.md)を参照してください。

### 詳細資料

- [CLIリファレンス](dm-converter/docs/cli.md)
- [出力仕様](dm-converter/docs/output-specification.md)
- [検証手順](dm-converter/docs/verification.md)
- [第三者ライセンス](dm-converter/docs/third-party-licenses.md)

## ライセンス

dm-toolsはApache License, Version 2.0でライセンスされています。詳細は
[LICENSE](LICENSE)を参照してください。

第三者ソフトウェアおよび同梱アセットには、それぞれのライセンスが適用されます。
[第三者ライセンス](dm-converter/docs/third-party-licenses.md)と
[dm-preview第三者ライセンス](dm-preview/THIRD_PARTY_LICENSES)を参照してください。
