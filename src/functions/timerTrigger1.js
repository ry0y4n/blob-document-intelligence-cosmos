const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const DocumentIntelligence =
    require("@azure-rest/ai-document-intelligence").default;
const {
    getLongRunningPoller,
} = require("@azure-rest/ai-document-intelligence");
const { CosmosClient } = require("@azure/cosmos");

const DefaultAzureCredential =
    require("@azure/identity").DefaultAzureCredential;

const defaultAzureCredential = new DefaultAzureCredential();

require("dotenv").config(); // ローカル実行時の .env ファイル読み込み用
const blobStorageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const blobContainerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const documentIntelligenceEndpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
const cosmosDbEndpoint = process.env.COSMOS_DB_ENDPOINT;
const cosmosDbDatabaseName = process.env.COSMOS_DATABASE_NAME;
const cosmosDbContainerName = process.env.COSMOS_CONTAINER_NAME;

// 各環境変数のバリデーション（どれか一つでも未設定の場合はエラー）
function validateEnvironmentVariables() {
    return (
        blobStorageAccountName &&
        blobContainerName &&
        documentIntelligenceEndpoint &&
        cosmosDbEndpoint &&
        cosmosDbDatabaseName &&
        cosmosDbContainerName
    );
}

const blobServiceClient = new BlobServiceClient(
    `https://${blobStorageAccountName}.blob.core.windows.net`,
    defaultAzureCredential
);

const containerClient = blobServiceClient.getContainerClient(blobContainerName);

const documnetIntelligenceClient = DocumentIntelligence(
    documentIntelligenceEndpoint,
    defaultAzureCredential
);

const client = new CosmosClient({
    endpoint: cosmosDbEndpoint,
    aadCredentials: defaultAzureCredential,
});

const cosmosDatabase = client.database(cosmosDbDatabaseName);
const cosmosContainer = cosmosDatabase.container(cosmosDbContainerName);

app.timer("timerTrigger1", {
    schedule: "0 */1 * * * *", // 1 分ごとに実行
    handler: async (myTimer, context) => {
        const isReady = validateEnvironmentVariables();
        if (!isReady) {
            return {
                status: 500,
                body: "Please set all environment variables",
            };
        }

        // Blob の ファイル一覧を取得
        for await (const blob of containerClient.listBlobsFlat()) {
            const blobUrl = `https://${blobStorageAccountName}.blob.core.windows.net/${blobContainerName}/${blob.name}`;
            // Document Intelligence で解析
            const initialResponse = await documnetIntelligenceClient
                .path("/documentModels/{modelId}:analyze", "prebuilt-layout")
                .post({
                    contentType: "application/json",
                    body: {
                        urlSource: blobUrl,
                    },
                    queryParameters: { outputContentFormat: "markdown" },
                });
            const poller = await getLongRunningPoller(
                documnetIntelligenceClient,
                initialResponse
            );

            // 解析結果を Cosmos DB に保存
            const result = (await poller.pollUntilDone()).body;
            context.log(result.analyzeResult.content);

            const item = {
                id: blob.name,
                content: result.analyzeResult.content,
            };

            const response = await cosmosContainer.items.upsert(item);
            context.log(response.statusCode);
        }
    },
});
