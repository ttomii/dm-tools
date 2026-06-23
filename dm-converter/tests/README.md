# Integration test assets

大容量のDMサンプルは本リポジトリへコピーせず、`dm-converter`ディレクトリから`../../test-data`を参照します。
実データ変換とOGR/QGIS確認は`../docs/verification.md`の手順で実施します。

小さな固定長レコードのfixtureは、レコード位置がテストから直接確認できるよう
`dm-parser`の単体テスト内で生成します。
