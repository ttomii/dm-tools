# Third-party software

本製品が直接利用するRustクレートは以下です。配布前に`Cargo.lock`を基準に
推移依存を含むライセンス監査を再実行してください。

| Package | Purpose | License |
| --- | --- | --- |
| clap | CLI引数解析 | MIT OR Apache-2.0 |
| encoding_rs | Shift_JISデコード | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| rusqlite | SQLiteアクセス | MIT |
| libsqlite3-sys / SQLite bundled | SQLiteリンク | MIT / Public Domain |
| thiserror | エラー型 | MIT OR Apache-2.0 |

GPLコード、実行ファイル、ライブラリは本製品へリンクまたは同梱しません。
# PMTiles生成で利用するRustクレート

- `pmtiles` Rust crate: MIT OR Apache-2.0
- `proj4rs`: MIT OR Apache-2.0
- `prost`: Apache-2.0
- `geo`: MIT OR Apache-2.0

# dm-preview Node.js package

Preview機能のJavaScript依存は`../dm-preview/package-lock.json`を正本とします。
配布時は同パッケージの`THIRD_PARTY_LICENSES`も含めます。

- MapLibre GL JS 5.24.0: BSD-3-Clause
- PMTiles JavaScript 4.3.0: BSD-3-Clause

同パッケージに同梱するMapLibre資材（`../dm-preview/maplibre/`）のライセンスは
資材内のライセンスファイルを正本とします。

- BIZ UDPGothic Regular: SIL Open Font License 1.1（`maplibre/glyphs/OFL.txt`）
- DM sprite source icons: CC0（`maplibre/icons/LICENSE.txt`）
- fontnik 0.7.4（glyph生成ツール、出力をコミット）: BSD（`maplibre/glyphs/FONTNIK_LICENSE.txt`）
