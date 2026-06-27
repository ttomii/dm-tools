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

`dm-preview`のJavaScript依存と同梱MapLibre資材のライセンスは
[`../../dm-preview/THIRD_PARTY_LICENSES`](../../dm-preview/THIRD_PARTY_LICENSES)を
参照してください。
