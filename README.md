# ローカル実行方法

## クローン & 依存関係インストール

```bash
git clone <repo url>
cd <repo name>
npm install
```

## `.env` ファイルの準備

1. `.env.sample` ファイルをコピーし、`.env` ファイルを作成します。
2. `.env` ファイルに必要な情報を記入します。

## `local.settings.json` ファイルの準備

`local.settings.json` の `Value` オブジェクトの中に以下のように記述

```JSON
{
    ・・・その他設定
    "Values": {
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",
        "FUNCTIONS_WORKER_RUNTIME": "node"
    }
}
```

## Azurite の起動

以下のコマンドで Azurite を起動します。Azurite はローカルで Azure Storage のエミュレータとして動作します。Azure Functions では前回実行時間や次回実行時間などを Blob コンテナーに保存して管理しています。なので Azurite が起動していないと Azure Functions の Timer Trigger が動作しません。

```bash
azurite --silent --location ./azurite --debug ./azurite/debug.log
```

## 関数の実行

以下のコマンドで関数を実行します。

```
npm run start
```
