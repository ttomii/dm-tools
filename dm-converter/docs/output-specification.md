# 出力仕様

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

固定Styleに個別定義がない点・線・面を既定スタイルで表示できるように、MapLibre
previewはmanifestの`sourceLayers`を使い、固定Styleの既定スタイルを
`dm_{DMCODE}_{GEOM}` source-layerへ展開します。PMTiles内には共通フォールバック用の
`dm_default_*` source-layerを生成しません。
固定Styleでは個別スタイルが存在するDMCodeを除外し、未定義DMCodeだけを
既定スタイルで描画します。既定スタイルは点が0.5mm直径の黒い塗りつぶし丸、
線が0.15mmの実線、面が0.15mmの実線アウトラインかつ塗りつぶしなしです。

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

Style内のPMTiles URL、sprite URL、glyph URLは、Preview UIが実行時に
配信元へ書き換えます。Style・sprite・glyph・MapLibre GL JSはPreviewパッケージが
配信し、変換結果へは同梱しません。

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
`..`、バックスラッシュを含みません。PreviewパッケージはmanifestとPMTilesを
検証し、PMTilesのRangeリクエストを配信、Style・sprite・glyphは同梱資材から
配信します。

## 制約

- グリッド、不整三角網、属性詳細レコードは出力せず警告として集計します。
- 内周を持つ面、未実装の補助図形・記号展開、INI変換式には対応しません。
- 平面直角座標系番号を取得できないGeoPackageはMapLibreへ変換できません。
