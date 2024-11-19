const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const DocumentIntelligence =
    require("@azure-rest/ai-document-intelligence").default;
const {
    getLongRunningPoller,
} = require("@azure-rest/ai-document-intelligence");
const { CosmosClient } = require("@azure/cosmos");
const { MarkdownTextSplitter } = require("@langchain/textsplitters");
const { AzureOpenAIEmbeddings } = require("@langchain/openai");
const { AzureCosmosDBNoSQLVectorStore } = require("@langchain/azure-cosmosdb");

const {
    getAzureOpenAiTokenProvider,
    getCredentials,
} = require("../lib/security");

const defaultAzureCredential = getCredentials();
const azureADTokenProvider = getAzureOpenAiTokenProvider();

const blobStorageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const blobContainerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const documentIntelligenceEndpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
const cosmosDbEndpoint = process.env.AZURE_COSMOSDB_NOSQL_ENDPOINT;
const cosmosDbDatabaseName = process.env.COSMOS_DATABASE_NAME;
const cosmosDbContainerName = process.env.COSMOS_CONTAINER_NAME;
const azureOpenAiEndpoint = process.env.AZURE_OPENAI_API_ENDPOINT;

// 各環境変数のバリデーション（どれか一つでも未設定の場合はエラー）
function validateEnvironmentVariables() {
    return (
        blobStorageAccountName &&
        blobContainerName &&
        documentIntelligenceEndpoint &&
        cosmosDbEndpoint &&
        cosmosDbDatabaseName &&
        cosmosDbContainerName &&
        azureOpenAiEndpoint
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

        const blobResponse = await cosmosContainer.items.readAll().fetchAll();
        const cosmosDbItems = blobResponse.resources;

        // Blob の ファイル一覧を取得
        for await (const blob of containerClient.listBlobsFlat()) {
            // blob.nameg が cosmosDbItems[index].metadata.source に含まれている場合はスキップ
            if (
                Array.isArray(cosmosDbItems) &&
                cosmosDbItems.some((item) => item.metadata.source === blob.name)
            ) {
                context.log(`Skip: ${blob.name}`);
                continue;
            }

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

            const markdownTextSplitter = new MarkdownTextSplitter({
                chunkSize: 1500,
                chunkOverlap: 100,
            });
            const document = {
                pageContent: result.analyzeResult.content,
                metadata: {
                    source: blob.name,
                },
            };

            const documents = await markdownTextSplitter.splitDocuments([
                document,
            ]);

            // doucmnets の各要素の id を `${blob.name}-${index}` に変更
            const documentsWithId = documents.map((doc, index) => {
                doc.id = `${blob.name}-${index + 1}`;
                return doc;
            });

            const embeddings = new AzureOpenAIEmbeddings({
                azureADTokenProvider,
            });
            const response = await AzureCosmosDBNoSQLVectorStore.fromDocuments(
                documentsWithId,
                embeddings,
                {
                    defaultAzureCredential,
                    databaseName: cosmosDbDatabaseName,
                    containerName: cosmosDbContainerName,
                }
            );

            context.log(response);
        }
    },
});
