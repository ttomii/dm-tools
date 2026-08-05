# dm-tools for Windows

この配布物には、Windows x64向けのDM変換CLIとMapLibreプレビューCLIが含まれます。

## 内容

- `dm-converter.exe`: DMファイルをGeoPackageまたはMapLibre向けPMTilesへ変換します。
- `dm-preview/dm-preview.exe`: `dm-converter`が生成したMapLibre出力をプレビューまたは配布用にbundleします。

`dm-preview`の同階層にある`assets`、`maplibre`、`vendor`は実行時に必要です。移動・削除しないでください。

## 使用例

PowerShellで、このREADMEがあるディレクトリから実行します。

```powershell
.\dm-converter.exe convert C:\path\to\dm-data C:\path\to\result.gpkg
.\dm-converter.exe convert C:\path\to\dm-data C:\path\to\maplibre --format pmtiles --layer-name dm
.\dm-preview\dm-preview.exe preview C:\path\to\maplibre
# 配布用bundleだけを作る場合は、上記とは別に次を実行します。
.\dm-preview\dm-preview.exe bundle C:\path\to\maplibre\dm.pmtiles C:\path\to\public-direct
```

引数とオプションの詳細は、それぞれ次で確認できます。

```powershell
.\dm-converter.exe convert --help
.\dm-preview\dm-preview.exe --help
```
