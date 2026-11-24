# MapLibre出力とプレビュー

## MapLibre出力ディレクトリ

```text
{layer-name}.pmtiles
{layer-name}.gpkg
pmtiles-manifest.json
dmi-info.json (DMI情報がある場合)
```

`{layer-name}.gpkg`はDM入力から直接MapLibre出力を生成した場合だけ作成されます。
固定Style、sprite、glyph、プレビュー画面は`dm-preview`側の資材であり、
`dm-converter`の出力には含めません。

DM入力から直接MapLibre出力を生成した場合は、PMTiles生成に使った中間GeoPackageが
`{layer-name}.gpkg`として残ります。このGeoPackageがある場合、`dm-preview`はレイヤ別
地物一覧と地物選択用APIに使用します。

## DMI情報

DMI情報を含む変換結果では地物一覧と同じ上部パネルの「データ情報」タブ内の「DMI情報」に、DMIごとの地図情報レベル、
座標系、計画機関、作業規程、分類コード対応などを表示します。
複数のDMIがある場合は、ドロップダウンで切り替えられます。
manifestの `dmiInfo` を参照するため、元のDM/DMIは不要です。
DMI情報がない旧データも表示できます。DMI情報は元の変換出力からプレビュー用APIで参照し、
配布用ディレクトリにはコピーしません。
保存形式は[manifest・DMI情報JSON仕様](pmtiles-manifest-specification.md)を参照してください。

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
`vendor/`、`pmtiles-manifest.json`、`dmi-info.json`は含まれません。
スタイル編集後の`style.json`、PMTiles、sprite、glyphsを静的Web配信に使用します。
既存の配布先に旧版が作成したmanifest・DMI情報JSONが残っている場合は、
元の変換出力を指定してpreviewを起動すると除去します。

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

注記はPMTiles内の`dm_annotation` source-layerへ統合されます。固定Styleでは横書き・
縦書きを分け、描画設定が同一のDMCodeをまとめたうえで、`DMCODE`属性を使って表示対象を
絞り込みます。Style編集の保存時もこの構成を維持します。

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

## inspectの仕様

- DMコードを昇順で北から南へ並べ、同じコードの行に5つの地図情報レベルを左から右へ配置します。形状区分11／12、点・折線・面・注記、方向のケースを含めます。図形の寸法は各レベルの図上mmから地上寸法へ換算します。
- 各コードの対応レベルの図形の左にコード・レベルの注記を置き、GeoPackageの`inspect_labels`地物テーブルに保存します。
- converterは全コードを一度に`--format gpkg --decorations true`で変換します。PMTilesは生成しません。生成結果は`runs/<run-id>/inspect.gpkg`、表示用メタデータは同じ場所の`inspect-manifest.json`です。実行条件・入力とconverterのハッシュ・終了結果は`execution.json`、ログは`conversion.log`へ保存します。
- アプリは`GET /preview/api/inspect/geojson`から、GeoPackageを経緯度に変換したGeoJSON FeatureCollectionを取得して表示します。`DM_SOURCE_LAYER`に基づいて既存の正式スタイルを適用し、点記号・注記の回転も変換します。元図形・生成図形・コード注記を同じAPIで返します。
- 地物一覧のDMコードのドロップダウンは対象図形への移動と一覧の絞り込みに使います。コード変更で変換や地図表示の絞り込みは行いません。正式図式の未実装コードもGeoPackageには含め、横のコード注記を表示します。
- 共通ヘッダの「基準縮尺」で1:250・1:500・1:1000・1:2500・1:5000を選び、「基準縮尺へ」で地図中心を保ってズームします。縮尺の操作で再変換はしません。
- クリック・地物一覧・ハイライト・属性・生成元と補助図形の参照、スタイル編集・保存・再読込み、sprite再読込みを引き継ぎます。編集内容は`presentation/`へ保存します。250では500の図式を適用します。
- 初回は全コードの索引作成に時間がかかります。生成済みの結果は次回起動で再利用します。旧PMTiles方式の結果、converter実体の変更、必要なコード・形状種別の追加、確認用DMの内容変更を検出した場合は再生成します。生成に失敗しても前回の成功結果を保持します。

`--work-dir`には、新規なら空のディレクトリ、再開なら同じinspectセッションを指定します。`--converter`省略時はPATHの`dm-converter`を使います。`--no-open`と`--port`はpreviewと同じです。OSの強制終了等で`.inspect.lock`が残った場合は、該当プロセスの終了を確認してからこのファイルだけを削除してください。

### 表示確認機能のE2Eテスト

```bash
npm --prefix ./dm-preview exec -- playwright install chromium
npm --prefix ./dm-preview run test:inspect
```

全コード・全5レベルの図形と注記、コード順の配置、GeoJSONでの実描画、クリックと生成元参照、縮尺操作、コード変更時に再変換しないことを確認します。初回生成を含むカタログE2Eは最大20分まで待機します。初回生成に時間がかかるため、`DM_INSPECT_CATALOG_FIXTURE`へ生成済みの`runs/<run-id>`ディレクトリを指定すると、テスト用ディレクトリへコピーして表示経路を検証できます。converterの変更時はキャッシュを再生成します。`DM_CONVERTER`でconverter実行ファイルを指定できます。実データモードでは、既存のクリック・スタイル保存・再変換後の選択復元も検証します。

### 線号と再生成

`static/maplibre/pen-spec.json`にPDFの線号・対象縮尺・入力形状・形状区分を記録しています。1号は図上0.05mmで、線・円の縁取り・SVGのstrokeを基準縮尺のCSS pixelへ換算します。250は500図式を採用する製品側の方針です。破線は線幅を変更しても図上の実線長・空き長を維持します。生成スタイルには線号と参照ページを付けています。

```bash
npm run normalize:pen-styles
npm run generate:maplibre-assets
```

線号を変更したときは上記の順に再生成します。SVG描画には開発依存のresvg、atlasの合成にはImageMagickを使います。1x／2x両方に線号別の画像を生成します。既存の塗りシルエットは輪郭形状を保持します。部分的なSVG修正では従来どおりコード指定でspriteを更新でき、対応する線号別画像も一緒に更新します。

2204（木橋）の正式な対象は500・1000とし、250は500図式の継承として確認対象に含め、3号（0.15mm）の実線で描画します。各縁線の両端へ図上1mm・45度のひ開部を生成します。2204（250・500・1000）と2203（2500・5000）の確認用図形は、長さ40mm・間隔6mmの平行な2本の直線とし、上側を下側と逆向きにします。2204の2500・5000には確認用図形・コード注記・個別スタイルを生成しません。

2205（徒橋）の500・1000では中心線の各端に左右2本ずつ、図上1mmのひ開部を生成します。250は500図式を継承し、2500・5000は従来の0.6mmを維持します。2213（歩道）の500・1000は3号の通常の実線で表示し、250も同じ図式を継承します。2213の2500・5000の既存破線は維持します。

2221（バス停）は500・1000と、500図式を継承する250にSVGと線号別spriteを用意しています。直径1mmの白抜き円、円の下端から2mmの支柱、支柱の下端を中心とする幅1mmの横棒を3号（0.15mm）で描きます。入力位置を円の中心に合わせ、既定の点記号との重複を除外します。

2235（雨水桝）・2236（並木桝）の500・1000は面（E1）の外周を3号（0.15mm）の実線で表示し、塗りつぶしは行いません。250は500図式を継承します。分断線用のlineスタイルに加え、polygon source-layerの境界をline型レイヤーで描く個別スタイルと、inspectの面サンプルを用意しています。

定形記号の補完対象36コードは`static/maplibre/symbol-spec.json`に、図式寸法、mm単位の座標、取得位置（`anchorMm`）、向き、対象レベルを記録しています。500・1000で寸法が異なる3508・3553・3557・6223は別SVGです。2261・2262の正式対象は500のみで、250は500図式を継承します。3557は対象レベルの河川図式を描き、外側4号・内部3号を保持します。E6の2241～2244・2246・2247・4206は取得方向を上向きに正規化し、ROTATIONで回転します。

```bash
npm run generate:symbol-assets
```

このコマンドは仕様JSONからSVGとスタイルを生成し、250への継承・線号別画像・1x／2x spriteを更新します。対象のSVGを再現する際は仕様JSONを更新してください。PDF本体は生成時にも実行時にも不要です。真形の面入力があるコードはpolygon外周用のlineレイヤーを持ち、点記号を面の中心へ自動追加しません。対象外レベルの既定点記号も除外しています。

火の見4233は主縦棒下端、量水標5256は矩形下端中央、陵墓6223は下側横棒と縦線の交点、古墳6224は上部円中心に入力位置を合わせます。`anchorMm`と`icon-offset`により、画像の中央からずれた位置でも図式の取得位置を保ちます。干潟6345は長さ2mmの線2本・上下間隔1.5mm・全幅3mmの1組です。

2252（スノーポール）・2253（カーブミラー）の500・1000は、外径2mmの白円と固定文字S／Cで表示します。250は500図式を継承します。円の塗り半径0.85mm＋外枠3号0.15mmとし、文字は既存のBIZ UDPGothic Regularの字面高1.35mm（text-sizeは図上1.62mm）へ調整しています。glyphのメトリクスに合わせたtext-offsetで円中心へ重ねます。SVG・sprite追加やconverterでの再生成は不要です。

2304（モノレール）・2305（特殊鉄道）の500・1000は、converterで取得線の接線に垂直な全長2mm（左右各1mm）の短線を弧長10mm間隔で生成し、250にも500図式として継承します。始点余白は既存と同じ0.5mm、折れ線でも間隔は始点から継続します。`perpendicular_tick`の補助レイヤーを2304は8号、2305は6号で表示します。2305の2500・5000は従来の全長0.6mm・間隔5mmを維持します。converter更新後はinspectのGeoPackageも再生成してください。

2306（索道）の500・1000と250継承は、2500・5000と共通のattached_trianglesを生成・表示します。底辺0.8mm・斜辺0.5mm・高さ0.3mmの三角形を左右交互に2個連ね、組の先頭を10mm間隔で置きます。元線が底辺を描くため補助図形は4本の斜辺のみです。線幅は500・1000と250が3号、2500・5000が従来の2号です。

inspectのDMコード選択は、そのコード・地図情報レベルの全サンプルの中央へ基準縮尺で移動します。2419など線・面・点のあるコードでも、方向アイコンを確認できます。

2401の500・1000の方向点は外辺1mmの正方形を入力方向に合わせて表示します。3403の500・1000は、converterが面内に白抜き円の中心点を自動生成します。円の外径は0.3mm、横ピッチ1.5mm、行ピッチと交互の横ずれは0.75mmです。どちらも250は500図式を継承します。

3512・3513・3518・3527は500・1000それぞれの寸法でPDFのベクター字形を含むアイコンを表示します。3523の十字は500で縦横4mm・横棒は上から1.5mm、それ以外は縦横2.5mm・横棒は上から1mmです。250は500を継承します。

3528・3529・3552・3559と各マンホール・柱・公共施設の大縮尺アイコンをPDFに合わせて追加しました。4231は外径2mmの円内に「タ」、4227は500のみの「ヒ」です。3556・4228・4208は500・1000の専用形状を使い、2500・5000の元の画像を維持します。

### 水部・法面・柵の補助図形

4262の輸送管は全レベルで面の補助図形を表示し、500・1000では直径0.3mm・10mm間隔の記号を生成します。4265の補助図形は500・1000で20mm間隔です。5202・5211などの線上模様、6121～6123の面内模様、6130～6132の柵記号もconverterで生成します。250は500図式を継承します。

図形区分11の上端と12の下端を使う法面・被覆は、同じ入力ファイル・DMコード・レベル・座標系の下端だけを参照します。6101・6102の長ケバは上端と下端の幅（最小1mm・最大10mm）、短ケバと隣接間隔はその半分です。幅1mm未満は1mmに補正し、下端がない場合は生成しません。破線の対象区分も個別に設定しています。converter更新後はinspectを再起動してGeoPackageを再生成してください。

5105のWは全レベルでセリフなし、5106の大縮尺点記号は二重波、5204は字面高2mmの「(浮)」、5219の方向点は坑口記号です。図形区分によって表現が異なるコードはinspectにも区分別サンプルを収録しています。

### 構囲・土地利用・凹地の追加図式

500・1000の6133～6142の対象コードに、遮光柵のジグザグ、鉄柵の×、生垣の波線と黒丸、土囲・塀の短線を生成します。6141・6142の図形区分46では左右交互に短線を配置し、各側4mm間隔にします。7105・7106は実線、7108はconverterで5mm線・0.5mm空きの区間と内向き短線を一緒に生成し、タイル境界でも位相を保ちます。7199は取得線の終点に矢羽根を表示します。250は500図式を継承します。

6211・6212・6213はそれぞれ「(空)」「(駐)」「(花)」、6231～6233は採石場・土取場・採鉱地の固定文字を表示します。6340・6341のSと6342のGは字面高1.5mmで、入力点を字面の中心に合わせます。6217は全レベルで同じ寸法の太陽光パネル記号、6322は大縮尺用の牧草地記号を使います。

### inspectの図形の並び

各コードの対応図形だけを、点→方向点→線→ポリゴンの順に左詰めします。通常点は回転なしの1例、方向点は回転なし・90°回転の2例です。図形区分で表現が変わる場合は区分ごとに見本と注記を置きます。注記コードの既存の横書き・縦書き見本は末尾に残します。

上端11の見本には補助図形の生成に必要な下端12を併記し、区分12単体の見本は次のセルに置きます。対応図形は図式定義と実装済みスタイルから求め、250は500を継承します。旧配置のGeoPackageは起動時に再生成します。
