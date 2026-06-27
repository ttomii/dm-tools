# 変換仕様

引数、オプション、終了コードは次のコマンドで確認してください。

```bash
dm-converter convert --help
```

## 変換動作

### MapLibre出力

GeoPackage入力ではDM解析と中間GeoPackage生成を省略します。入力GeoPackageは
変更しません。`--include-codes`、`--include-types`、`--decorations`などの
DM解析用設定は、GeoPackage内で確定済みの地物には適用されません。
DM入力から直接MapLibreを生成した場合は、PMTiles生成に使った中間GeoPackageを
`{layer-name}.gpkg`として出力ディレクトリへ残します。

プレビューと配布用bundleは[MapLibre出力とプレビュー](../../docs/maplibre-preview.md)を
参照してください。

### 変換ログ

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

変換エラー時は作成途中のGeoPackageとWALファイルを削除します。警告終了時は
正常に変換できた地物を保持します。進捗、警告、結果サマリは標準エラーへ出力します。

## 共通データ仕様

### データモデル

GeoPackageとMapLibreは、同じDM地物モデルを基に生成します。MapLibreをDMから
直接生成する場合も、内部で同じGeoPackageデータモデルを経由します。

### 地物の分類

DMの地物を次の4種類へ分類します。

| DM地物 | 出力ジオメトリ種別 |
| --- | --- |
| 面 | `polygon` |
| 線、円、円弧 | `line` |
| 点、方向 | `point` |
| 注記 | `text` |

ジオメトリは次のように正規化します。

- 面: 外周を閉じたPolygon
- 線: LineString
- 円・円弧: 最大5度間隔で線形化したLineString
- 点・方向・注記: Point

DMの図郭原点、端数座標、座標単位を反映します。Z値は解析中に保持しますが、
出力ジオメトリは2Dです。

### 地物のグループ化

ベース地物は、次の値の組み合わせでグループ化します。

- DM分類コード
- 出力ジオメトリ種別
- 平面直角座標系番号
- 地図情報レベル

異なる平面直角座標系番号または地図情報レベルの地物は、別の論理グループとして
扱います。GeoPackageでは物理レイヤーを分け、MapLibreではsource-layerを
統合したうえで`ZONE`と`LEVEL`属性によって元のグループを保持します。

### ベース地物属性

| 属性 | 論理型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `USER_ID` | INTEGER | 必須 | グループ内で1から採番する地物ID |
| `DMCODE` | INTEGER | 必須 | DM分類コード |
| `DMFIGTYPE` | INTEGER | 任意 | DM要素レコードの図形区分 |
| `DMMOVE` | INTEGER | 任意 | DM要素レコードの転位区分 |
| `DMSKIP` | INTEGER | 任意 | DM要素レコードの間断区分 |
| `DMATTR` | INTEGER | 任意 | DM要素レコードの属性数値 |
| `DMPREC` | INTEGER | 任意 | DM要素レコードの取得精度 |
| `DMYYMM` | INTEGER | 任意 | DM要素レコードの取得年月 |
| `DMFILE` | TEXT | 必須 | 入力DMファイル名 |
| `ANGLE` | REAL | 任意 | 点・注記の方向角 |
| `SIZE` | REAL | 任意 | 注記サイズ |
| `CHARSPACING` | REAL | 任意 | 注記の字隔。単位は0.1mm |
| `LINENO` | INTEGER | 任意 | 注記の線号 |
| `VERTICAL` | INTEGER | 任意 | 注記の縦書き区分 |
| `TEXT` | TEXT | 任意 | 注記文字列 |

`ANGLE`は方向付き点または方向付き注記で取得できる場合に設定します。
`SIZE`、`CHARSPACING`、`LINENO`、`VERTICAL`、`TEXT`は注記だけが使用します。
値を取得できない任意属性は未設定です。

### 補助図形

Styleだけでは表現しにくい図式は、元地物を変更せず、別の補助図形として生成します。
補助図形生成はデフォルトで有効です。DM入力時に`--decorations false`を指定した
場合は生成しません。`DMFIGTYPE=99`のベース地物は補助図形生成対象外です。

補助図形は次の追跡属性を持ちます。

| 属性 | 論理型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `USER_ID` | INTEGER | 必須 | 補助図形グループ内で1から採番する地物ID |
| `SRC_LAYER` | TEXT | 必須 | 元のGeoPackageベース地物レイヤー名 |
| `SRC_USER_ID` | INTEGER | 必須 | 元地物の`USER_ID` |
| `SRC_DMFILE` | TEXT | 必須 | 元地物の`DMFILE` |
| `SRC_DMCODE` | INTEGER | 必須 | 元地物の`DMCODE` |
| `DECORATION` | TEXT | 必須 | `bridge_end`、`line_symbol`、`stair_step`などの補助図形種別 |
| `DECO_INDEX` | INTEGER | 必須 | 同一元地物内で1から採番する補助図形連番 |
| `ANGLE` | REAL | 任意 | 補助図形点の回転角 |

### 座標参照系

インデックスレコード(a)の平面直角座標系番号を、JGD2011の1系から19系へ
対応付けます。ファイル内ヘッダから平面直角座標系番号を特定できない場合は、
ファイル名（図郭割り番号を準用）の先頭2桁を系番号として用います。それでも
特定できない場合はファイル名付きの警告を出力します。座標参照系を取得できない
場合の扱いと、実際に格納する座標系はフォーマットごとに異なります。

## GeoPackage仕様

### 出力単位

1回の変換につき1つのGeoPackageファイルを出力します。複数DMファイルを入力した
場合も、共通データ仕様のグループ単位で同じGeoPackageへ統合します。

### レイヤー名

ベース地物レイヤー名:

```text
dm_{DMCODE}_{GEOM}_{ZONE}_{LEVEL}
```

例:

- `dm_2100_line_08_2500`
- `dm_7100_point_09_5000`
- `dm_8100_text_unknown_2500`

`GEOM`は`polygon`、`line`、`point`、`text`です。`ZONE`は2桁ゼロ埋めの
平面直角座標系番号、`LEVEL`は地図情報レベルです。取得できない値には
`unknown`を使用します。

補助図形レイヤー名:

```text
dm_{DMCODE}_{GEOM}_{ZONE}_{LEVEL}_deco_{DECO_GEOM}
```

例:

- `dm_2205_line_08_2500_deco_line`

### 属性列

ベース地物レイヤーには、共通データ仕様のベース地物属性を列として格納します。
Pointレイヤーには`ANGLE`を追加し、注記レイヤーには`ANGLE`、`SIZE`、
`CHARSPACING`、`LINENO`、`VERTICAL`、`TEXT`を追加します。
対象外のレイヤーにはこれらの列を作成しません。
任意属性を取得できない場合はNULLです。

補助図形レイヤーには、共通データ仕様の補助図形属性を格納します。補助図形点
レイヤーだけに`ANGLE`列を追加します。

### ジオメトリとCRS

DM座標を変換せず格納します。平面直角座標系番号を次のJGD2011 EPSGコードへ
対応付けます。

- 1系: `EPSG:6669`
- 2系から18系: 系番号に対応する`EPSG:6670`から`EPSG:6686`
- 19系: `EPSG:6687`

平面直角座標系番号を取得できないレイヤーは、未定義Cartesian SRSとして格納します。

### インデックス

各地物レイヤーにGeoPackage RTree空間インデックスを作成します。

ベース地物レイヤーには次のSQLiteインデックスを作成します。

- `DMCODE`
- `DMFILE`
- `USER_ID`（UNIQUE）

補助図形レイヤーには次のSQLiteインデックスを作成します。

- `SRC_DMCODE`
- `SRC_DMFILE`
- `SRC_USER_ID`
- `DECORATION`

## MapLibre仕様

### 出力ディレクトリ

PMTiles v3とmanifestを1ディレクトリへ出力します。DM入力から直接MapLibreを
生成した場合は、PMTiles生成に使った中間GeoPackageも同じディレクトリへ残します。
固定Style、sprite、glyphは出力に含めず、Nodeパッケージ`../dm-preview`が
同梱・配信します。

```text
{layer-name}.pmtiles
{layer-name}.gpkg
pmtiles-manifest.json
```

manifestの`levels`には、入力に地物が存在する地図情報レベルを記録します。
manifestの`sourceLayers`には、PMTiles内に生成したsource-layer名を記録します。

### PMTilesとMVT

PMTiles内のタイルは次の設定で生成します。

| 項目 | 値 |
| --- | --- |
| タイル形式 | MVT |
| 圧縮 | gzip |
| ズーム | z15からz18 |
| extent | 4096 |
| buffer | 8表示ピクセル相当 |

z19からz24はクライアント側でz18をオーバーズームします。座標は各JGD2011
平面直角座標系からWeb Mercator（EPSG:3857）へ変換します。

### Source Layer

ベース地物のsource-layer名:

```text
dm_{DMCODE}_{GEOM}
```

補助図形のsource-layer名:

```text
dm_{DMCODE}_{GEOM}_deco_{DECO_GEOM}
```

PMTiles内には共通フォールバック用の`dm_default_*` source-layerを生成しません。
Style側のsource-layer展開は[MapLibre出力とプレビュー](../../docs/maplibre-preview.md)を
参照してください。

GeoPackageでは別レイヤーとなる`ZONE`と`LEVEL`の組み合わせを、MapLibreでは
同じsource-layerへ統合します。各地物の`ZONE`と`LEVEL`属性で区別します。

### MVT属性

ベース地物には次の属性を格納します。

- `USER_ID`
- `DMCODE`
- `ZONE`
- `LEVEL`
- `DMFILE`
- `DMFIGTYPE`
- `DMMOVE`
- `DMSKIP`
- `TEXT`
- `SIZE`
- `CHARSPACING`
- `LINENO`
- `VERTICAL`
- `ROTATION`

値がない任意属性はMVTへ格納しません。`ROTATION`はGeoPackageの`ANGLE`から
MapLibreの時計回り回転角へ変換した値です。

補助図形には上記の適用可能な属性に加え、`SRC_LAYER`、`SRC_USER_ID`、
`SRC_DMFILE`、`SRC_DMCODE`、`DECORATION`、`DECO_INDEX`を格納します。

### Styleとアセット

固定Style JSON（`style-2500.json`、`style-5000.json`）、sprite、glyphは
Nodeパッケージ`../dm-preview/maplibre/`に同梱します。Rust側`dm-converter`は
これらを生成・出力しません。SLDから実行時生成もしません。

Style・sprite・glyph・MapLibre GL JSはPreviewパッケージが配信し、変換結果へは
同梱しません。

### MapLibre manifest

`pmtiles-manifest.json`は表示ツール向けの出力契約です。

| 項目 | 型 | 説明 |
| --- | --- | --- |
| `version` | number | manifest仕様バージョン。初期値は`1` |
| `layerName` | string | `--layer-name`で指定した配信レイヤ名 |
| `pmtiles` | string | 出力ルートからのPMTiles相対パス |
| `levels` | number[] | 地物が存在する地図情報レベルの一覧（例 `[2500, 5000]`） |
| `bounds` | number[4] | `[west, south, east, north]`のWGS84範囲 |
| `center` | number[3] | `[longitude, latitude, zoom]`の初期表示位置 |

`pmtiles`は出力ディレクトリ内の通常ファイルを指し、絶対パス、空要素、`.`、
`..`、バックスラッシュを含みません。

## 制約

- グリッド、不整三角網、属性詳細レコードは出力せず警告として集計します。
- 内周を持つ面、未実装の補助図形・記号展開、INI変換式には対応しません。
- 平面直角座標系番号を取得できないGeoPackageはMapLibreへ変換できません。
