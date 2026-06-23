# CLIリファレンス

## Convert

```bash
dm-converter convert INPUT OUTPUT [OPTIONS]
```

### Arguments

| 引数 | 必須 | 初期値 | 設定例 | 説明 |
| --- | --- | --- | --- | --- |
| `input` | 必須 | なし | `./dm-data`、`./08CF932.DM`、`./result.gpkg` | DMファイル、DMディレクトリ、または本ツールで生成したGeoPackage |
| `output` | 必須 | なし | `./result.gpkg` | GeoPackageファイルまたはMapLibre出力ディレクトリ |
| `--format` | 任意 | `gpkg` | `--format maplibre` | `gpkg`または`maplibre` |
| `--layer-name` | 条件付き | なし | `--layer-name dm-sample` | MapLibre時に必須の配信レイヤ名 |
| `--encoding` | 任意 | `shift_jis` | `--encoding shift_jis` | DM内の文字列を解釈する文字エンコーディング |
| `--include-codes` | 任意 | 全DMコード | `--include-codes 2101,3001` | 出力するDMコード |
| `--include-types` | 任意 | 全種別 | `--include-types polygon,line,text` | 出力するジオメトリ種別 |
| `--overwrite` | 任意 | `false` | `--overwrite` | 指定時のみ既存出力を置換 |
| `--batch-size` | 任意 | `10000` | `--batch-size 5000` | 1トランザクションの地物数 |
| `--decorations` | 任意 | `true` | `--decorations false` | 補助図形レイヤーを生成するか |
| `--progress` | 任意 | `true` | `--progress false` | DMファイルおよびPMTiles候補タイルの進捗を標準エラーへ出力するか |

## 複数ファイルの一括変換

`input`にディレクトリを指定すると、配下を再帰的に検索し、拡張子が`.dm`の
全ファイルを1回の実行で変換します。拡張子の大文字小文字は区別しません。
レイヤーの統合単位、名称、属性、座標参照系は
[出力仕様](output-specification.md)を参照してください。

## Exit Codes

| コード | 意味 |
| --- | --- |
| `0` | 正常終了 |
| `1` | I/O、解析、GeoPackage書き込みエラー |
| `2` | 引数または入力条件のエラー |
| `3` | 警告・スキップありで変換完了 |

## MapLibre出力

```bash
dm-converter convert INPUT OUTPUT \
  --format maplibre \
  --layer-name dm-sample
```

`--layer-name`にはASCII英数字、ハイフン、アンダースコアだけを使用できます。
MapLibre出力先はディレクトリで、既存時は`--overwrite`が必要です。GeoPackageへ
`--layer-name`を指定した場合と、MapLibreで省略した場合は終了コード2です。

GeoPackage入力ではDM解析と中間GeoPackage生成を省略します。入力GeoPackageは
変更しません。`--include-codes`、`--include-types`、`--decorations`などの
DM解析用設定は、GeoPackage内で確定済みの地物には適用されません。
DM入力から直接MapLibreを生成した場合は、PMTiles生成に使った中間GeoPackageを
`{layer-name}.gpkg`として出力ディレクトリへ残します。

生成されるPMTiles、Style、アセットは[出力仕様](output-specification.md)を
参照してください。

## 変換ログ

変換ログは標準エラーへ出力します。処理の開始時に処理名を出力し、完了時に
直前の処理にかかった時間を`elapsed: 秒数s`として出力します。処理は入れ子に
なるため、内側の`elapsed`に続いて、その処理を含む外側の`elapsed`が出力される
場合があります。

端末上では、`scan`、`convert`、`finalized layer`、`pmtiles tile`の進捗を
同じ1行で更新し、処理完了時に消去します。そのため、ログ履歴には処理名と
その処理全体の`elapsed`だけが残ります。標準エラーをファイルやパイプへ
リダイレクトした場合は進捗行を出力しません。

`--progress false`を指定すると進捗表示とDM解析時の警告詳細を省略します。
処理名、`elapsed`、MapLibre生成時の警告、最後の結果サマリは引き続き
出力します。

### DMからGeoPackageを生成する処理

MapLibre形式をDMから生成する場合も、まずGeoPackageを生成するため、
以下のログを出力します。

GeoPackageのレイヤーは、DMコード、形状種別、平面直角座標系の系番号、
地図情報レベルの組み合わせで分割します。地物を書き込むには、対応するテーブル、
座標参照系、GeoPackageメタデータを先に作成しなければなりません。しかし、
複数のDMファイルを入力した場合、必要な組み合わせは全ファイルを解析するまで
確定しません。

そのため、DM入力は次の2パスで処理します。

1. `scan`で全DMを読み、必要な地物レイヤーと補助図形レイヤーの構成を収集する
2. 収集した構成からGeoPackageのテーブルを作り、`convert`で全DMを再度読んで
   地物を書き込む

`scan`は地物データを保持せず、レイヤー構成だけを収集します。全地物をメモリへ
保持して1パスで処理する方式を避けることで、大量データでもメモリ使用量を
抑えています。また、`scan`と`convert`で警告数が変わった場合は、処理中に入力が
変更された可能性があるため変換エラーにします。

| ログ | この処理が必要な理由 | 実施内容 |
| --- | --- | --- |
| `running conversion` | 変換全体の所要時間を把握するため | 入力の探索から出力の配置までを実行します |
| `scanning input files` | GeoPackageのテーブルを地物書き込み前に作成するため | 全DMを解析し、フィルター適用後に必要なレイヤー構成と警告数を収集します。地物は書き込みません |
| `scan | 1/391` | 第1パスの進捗を確認するため | DMファイル名は表示せず、処理件数だけを表示します |
| `converting input files to GeoPackage` | 作成済みテーブルへ実データを格納するため | DMを再解析し、地物の識別子付与、補助図形生成、GeoPackageへのバッチ書き込みを行います |
| `convert | 1/391` | 第2パスの進捗を確認するため | DMファイル名は表示せず、処理件数だけを表示します |
| `flushing remaining GeoPackage features` | 最後のバッチに残った地物を失わないため | バッチサイズ未満でメモリ上に残っている地物を書き込みます |
| `finalizing GeoPackage layers` | 空間検索とGeoPackage利用ソフトで必要になる情報を完成させるため | レイヤー範囲を確定し、空間インデックスを更新するトリガーを作成します |
| `finalize layer | 1/20` | レイヤー単位の確定処理の進捗を確認するため | レイヤー名は表示せず、処理件数だけを表示します |
| `optimizing GeoPackage` | 後続の検索でSQLiteが適切な実行計画を選べるようにするため | SQLiteの`PRAGMA optimize`を実行します |
| `checkpointing GeoPackage WAL` | 変更内容をGeoPackage本体へ確実にまとめ、WALを残さないため | WALの内容を本体へ反映し、WALファイルを切り詰めます |

### GeoPackageからMapLibre出力を生成する処理

入力に生成済みGeoPackageを指定した場合は、DMの`scan`と`convert`を省略し、
以下の処理から開始します。

| ログ | この処理が必要な理由 | 実施内容 |
| --- | --- | --- |
| `generating MapLibre output from GeoPackage` | MapLibre出力全体の所要時間を把握するため | PMTilesとmanifestを生成します |
| `opening GeoPackage` | PMTilesの生成元データへアクセスするため | 入力または一時GeoPackageをSQLiteデータベースとして開きます |
| `reading GeoPackage layers` | 各レイヤーの読み取り方とタイル生成範囲を決めるため | GeoPackageメタデータから対象レイヤー、形状種別、座標系、地図情報レベル、範囲を読み取ります |
| `summarizing GeoPackage features` | PMTilesメタデータとmanifestの生成に必要な全体情報を得るため | 地物数、出力範囲、地図情報レベル、MapLibreのsource-layerを集計します |
| `collecting PMTiles tile candidates` | 全世界のタイルを調べず、地物が存在し得る範囲だけを処理するため | 各レイヤーの範囲から、ズームレベル15から18の候補タイルを列挙します |
| `writing PMTiles tiles` | GeoPackageの地物をMapLibreが表示できるベクトルタイルへ変換するため | 候補タイルごとに空間検索、Web Mercator変換、クリップ、簡略化、MVTエンコードを行います |
| `pmtiles tile 1/1000: 15/29072/12901` | タイル生成の進捗と、時間がかかっているタイルを確認するため | 現在処理している候補タイルを`ズーム/X/Y`で表示します。候補が空の場合はPMTilesへ格納しないため、分母は最終タイル数とは一致しません |
| `finalizing PMTiles archive` | 個別に書き込んだタイルを検索可能な1つのアーカイブにするため | PMTilesのディレクトリ、ヘッダー、メタデータを書き込みます |
| `writing PMTiles manifest` | 表示ツールが出力内容を推測せず利用できるようにするため | PMTiles、地図情報レベル、表示範囲、初期表示位置をJSONへ書き込みます |

### 結果サマリ

正常終了または警告終了時は、最後に次の形式で結果を出力します。

```text
features: 1000, warnings: 2, skipped: 1, layers: 20, tiles: 350
```

| 項目 | 意味 |
| --- | --- |
| `features` | 処理した地物数。GeoPackage出力ではDMの地物数、MapLibre出力では生成元GeoPackage内の補助図形を含む地物数です |
| `warnings` | DM解析およびMapLibre生成で発生した警告数 |
| `skipped` | 警告により出力しなかった地物数 |
| `layers` | 出力レイヤー数。MapLibre出力ではPMTilesのsource-layer数です |
| `tiles` | PMTilesへ実際に格納した空でないタイル数。GeoPackage出力では`0`です |

## Preview

```bash
dm-preview OUTPUT [--no-open]
```

Previewは`../dm-preview`のNode.jsパッケージが提供します。出力ディレクトリの
`pmtiles-manifest.json`とPMTilesを検証してから、`127.0.0.1`限定のHTTP
サーバーで公開します。MapLibreのStyle、sprite、glyphはパッケージ同梱資材から
配信します。既定ではブラウザを起動し、`--no-open`指定時はURLだけを表示します。
Rust版の`dm-converter preview`は提供しません。

変換エラー時は作成途中のGeoPackageとWALファイルを削除します。警告終了時は
正常に変換できた地物を保持します。進捗、警告、結果サマリは標準エラーへ出力します。
