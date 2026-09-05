# dm-converter

DMファイルをGeoPackageまたはMapLibre向けPMTilesへ変換するRust CLIです。

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
