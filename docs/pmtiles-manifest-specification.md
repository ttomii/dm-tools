# PMTiles manifest・DMI情報JSON仕様

## 用途とバージョン

`pmtiles-manifest.json` は、dm-converterの出力をdm-previewや配布ツールが
参照するためのJSONです。UTF-8を使用します。MapLibre Style JSONとは別の形式です。
現在の `version` は `1` です。未知のバージョンは読込エラーになります。
未知の追加項目は無視します。任意項目 `dmiInfo` の追加によるバージョン変更はありません。

変換のデータ仕様は[変換仕様](../dm-converter/docs/conversion-specification.md)、
プレビューと配布の操作は[MapLibre出力とプレビュー](maplibre-preview.md)を参照してください。

## manifestの項目

| 項目 | 型 | 必須 | 内容 |
| --- | --- | --- | --- |
| `version` | integer | はい | `1` |
| `layerName` | string | はい | 空でないデータ名。converterでは英数字・`-`・`_` に限定 |
| `pmtiles` | string | はい | PMTilesファイルの相対パス |
| `levels` | integer[] | はい | 地図情報レベル。1つ以上の正の整数。converterは昇順・重複なしで出力 |
| `sourceLayers` | string[] | いいえ | MVTのsource-layer一覧。省略時は空配列 |
| `bounds` | number[4] | はい | WGS84経緯度の `[西,南,東,北]`。西≦東、南≦北。経度±180、緯度±90の範囲 |
| `center` | number[3] | はい | `[経度,緯度,ズーム]`。経度±180、緯度±90、ズーム0～24の範囲 |
| `styles` | string[] | いいえ | Style JSONの相対パス。指定時は1つ以上。省略時、previewが縮尺に応じたStyleを生成 |
| `dmiInfo` | string | いいえ | DMI情報JSONの相対パス。DMI情報がなければ項目を省略 |

`sourceLayers` は `dm_annotation` または
`dm_{数字}_{point|line|polygon|text}`、必要に応じてその後に
`_deco_{point|line|polygon}` が付く形式です。

パスの基準はmanifestのあるディレクトリです。区切りは `/` です。
絶対パス、バックスラッシュ、空パス、空のパス要素、`.`、`..` のパス要素は使用できません。
previewとbundleは参照ファイルの存在を確認し、シンボリックリンクで基準ディレクトリの
外へ出る参照も拒否します。

`styles` が省略されていて同じディレクトリに保存済み `style.json` があれば、
previewはそのStyleを使用します。manifestがない配布用データでは、従来どおり
`style.json` の `dm` sourceと `dm:*` metadataから基本情報を取得します。
DMI情報の参照にはmanifestが必要です。

```json
{
  "version": 1,
  "layerName": "shizuoka",
  "pmtiles": "shizuoka.pmtiles",
  "levels": [2500, 10000],
  "sourceLayers": ["dm_1103_line", "dm_annotation"],
  "bounds": [138.28, 34.89, 138.65, 35.18],
  "center": [138.46, 35.03, 15],
  "dmiInfo": "dmi-info.json"
}
```

上記の範囲・source-layerは形式説明用の例です。

## DMI情報JSON

トップレベルは `version: 1` と `indexes`（DMIオブジェクトの配列）です。
DMIを相対パスの順に格納します。1つのDMIにつき1オブジェクトです。
DMI情報がない場合、converterはファイル自体を省略します。

### DMIオブジェクト

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `source` | string | 入力DMの共通親ディレクトリからのDMI相対パス。表示・識別用であり、previewが開くファイルへの参照ではない |
| `mapLevels` | integer[] | 対応DMのMレコードから取得したレベル。正の整数、昇順、重複なし。未確認なら `[]` |
| `dmFiles` | string[] | 対応する入力DMの相対パス。`source` と同じ基準。未確認なら `[]` |
| `zone` | integer | 平面直角座標系の系番号 |
| `planner` | string | 計画機関名 |
| `meshCount` | integer | DMIに記載された図郭数 |
| `meshes` | string[] | DMIに記載された図郭識別番号。先頭ゼロを含む元の表記を保持 |
| `classificationCount` | integer | 分類レコード数 |
| `classifications` | object[] | 下記の分類レコード配列 |
| `displacement` | integer | 転位の設定有無。0＝未設定、1＝設定あり |
| `interruption` | integer | 間断の設定有無。0＝未設定、1＝設定あり |
| `ruleYear` | integer | 作業規程年 |
| `ruleName` | string | 作業規程名 |
| `formatVersion` | integer | DMフォーマットのバージョン。2＝バージョン2、0＝旧DM |
| `spareUsage` | integer | 予備領域の使用区分 |

文字列欄の前後の空白は除去します。数値欄の空白は0として保存します。
`mapLevels` はDMIヘッダーの項目ではなく、DM本体との照合によって付加する情報です。
対応レベルが複数ならすべて保持し、フォルダ名から単一レベルを決めません。
図郭照合では同じフォルダを優先し、該当しない図郭は入力全体で対応DMが
一意に特定できる場合だけ関連付けます。曖昧な対応は推測しません。
`meshes` は元のDMI全体の図郭一覧、`dmFiles` は今回入力したDMとの対応です。
入力を一部に絞った場合、この2つが示す範囲は異なります。

### 分類レコード

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `usedCode` | string | 使用分類コード。4桁欄を文字列として保存 |
| `standardCode` | string | 対応する標準分類コード |
| `types` | integer[9] | 使用するデータタイプ。順に面・線・円・円弧・点・方向・注記・属性・格子/TIN。0＝未使用、1＝使用 |
| `direction` | integer | 方向の定義。0＝標準、1＝独自 |
| `dimension` | integer | 座標次元。0＝固定しない、2＝XY、3＝XYZ |
| `description` | string | 標準外分類の説明 |

これらは情報の保存・表示用です。独自コードの標準図式への適用や独自方向定義に
基づく地物の変更は行いません。previewは文字列をHTMLとして解釈しません。

```json
{
  "version": 1,
  "indexes": [
    {
      "source": "10000/index10000.dmi",
      "mapLevels": [10000],
      "dmFiles": ["10000/01.dm"],
      "zone": 8,
      "planner": "静岡市",
      "meshCount": 1,
      "meshes": ["1"],
      "classificationCount": 1,
      "classifications": [
        {
          "usedCode": "1103", "standardCode": "1103",
          "types": [0, 1, 0, 0, 0, 0, 0, 0, 0],
          "direction": 0, "dimension": 2, "description": ""
        }
      ],
      "displacement": 0, "interruption": 1,
      "ruleYear": 2008, "ruleName": "公共測量作業規程",
      "formatVersion": 2, "spareUsage": 0
    }
  ]
}
```

上記は1図郭・1分類に縮めた説明用の例です。

## GeoPackage・配布との関係

GeoPackageの `dm_dmi_metadata` にDMIごとに1行保存し、`source_path`、
`map_levels`、`dm_files` の専用列と `json` 列を持ちます。
JSON出力時は専用列から `source`、`mapLevels`、`dmFiles` を設定します。
GeoPackage入力でPMTilesを再生成する場合も、このテーブルから引き継ぎます。
テーブルのない従来のGeoPackageは従来どおり変換できます。

配布用bundleには地図表示に必要なStyle、PMTiles、sprite、glyphsだけを出力し、
`dmi-info.json` と `pmtiles-manifest.json` は含めません。
DMI情報は元の変換出力に保持し、previewは `/preview/api/dmi-info` から配信します。
ブラウザ向けmanifestはプレビューサーバーが生成し、`dmiInfo` に `api/dmi-info` を設定します。
既存の配布先を再利用するpreviewでは、旧版が配置した同名JSONを除去します。
配布先を単独で開いた場合、DMI情報は表示されません。
