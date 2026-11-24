# dm-converter

DMファイルをGeoPackageまたはMapLibre向けPMTilesへ変換するRust CLIです。

## 入力DMの測地系

`convert` の `--input-datum jgd2000|jgd2011|jgd2024` で入力座標の測地系を指定します。
未指定時は **jgd2024** です。

```bash
dm-converter convert input.dm output.gpkg --input-datum jgd2000
```

出力先ごとの扱いとEPSGコードは [変換仕様の入力DMの測地系](docs/conversion-specification.md#入力dmの測地系) を参照してください。

## 既存PMTilesの部分更新

```bash
dm-converter update-tiles input.gpkg output/map.pmtiles --map-level 10000 --min-zoom 15 --max-zoom 15
```

指定した地図情報レベル・ズームの地物を置換します。他レベルの地物と対象外ズームを保持し、削除された地物も反映します。
GeoPackageはこのツールが生成したもの、PMTilesはgzip MVT・gzipディレクトリのv3形式を使用します。
ズーム範囲は既存アーカイブの範囲内（最大18）に限ります。元の出力と同じレイヤ構成・範囲のGeoPackageを使用してください。

処理は1スレッドで、地物を1レイヤずつ処理し、タイル断片を一時ディスクへ退避します。
対象外タイルは圧縮済みデータをコピーします。PMTiles全体は一時ファイルへ再構築してから置換し、失敗時は既存ファイルを保持します。
一時領域にはPMTiles約1ファイル分と生成するタイル断片の空き容量が必要です。manifest・DMI情報・GeoPackageは変更しません。
GeoPackageを他のプロセスで編集している間は実行しないでください。

DM入力の変換対象レベルは`--include-levels 250,500,2500,5000`のように指定できます。省略時は全レベルを変換します。GeoPackage入力には適用しません。

## テストとカバレッジ

通常のテストは`dm-converter`ディレクトリで実行します。

```bash
cargo test --workspace
```

HTMLカバレッジを生成するには、初回のみ`cargo-llvm-cov`とRustのLLVMツールを
インストールします。

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --locked
```

その後、次のコマンドでワークスペース全体のカバレッジを計測できます。

```bash
cargo llvm-cov --workspace --all-features --html
```

HTMLレポートは`target/llvm-cov/html/index.html`に生成されます。CIなどでLCOV形式が
必要な場合は、次のコマンドを使います。

```bash
cargo llvm-cov --workspace --all-features --lcov --output-path target/llvm-cov/lcov.info
```

## Windows向けリリースビルドの参考手順

以下はLinux/WSL上でWindows GNUターゲット向けにクロスビルドする場合の一例です。
MSVCターゲットなど、環境に応じて別の方法でもビルドできます。この手順では
RustのWindows GNUターゲットとMinGW-w64のクロスリンカを使用します。

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt install gcc-mingw-w64-x86-64
```

環境に応じて`.cargo/config.toml`を作成し、Windows GNUターゲット用の
リンカを指定します。

```toml
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-ar"
```

その後、`dm-converter`ディレクトリでリリースビルドします。

```bash
cargo build --target x86_64-pc-windows-gnu --release
```

実行ファイルは`target/x86_64-pc-windows-gnu/release/dm-converter.exe`に
生成されます。
