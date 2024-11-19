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

require("dotenv").config(); // ローカル実行時の .env ファイル読み込み用
const blobStorageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const blobContainerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const documentIntelligenceEndpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
const cosmosDbEndpoint = process.env.COSMOS_DB_ENDPOINT;
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

app.http("httpTrigger1", {
    methods: ["GET", "POST"],
    authLevel: "anonymous",
    handler: async (request, context) => {
        const isReady = validateEnvironmentVariables();
        if (!isReady) {
            return {
                status: 500,
                body: "Please set all environment variables",
            };
        }

        const response = await cosmosContainer.items.readAll().fetchAll();
        const cosmosDbItems = response.resources;

        // Blob の ファイル一覧を取得
        for await (const blob of containerClient.listBlobsFlat()) {
            // blob.nameg が cosmosDbItems[index].metadata.source に含まれている場合はスキップ
            if (
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

            // headers_to_split_on = [
            //     ("#", "Header 1"),
            //     ("##", "Header 2"),
            //     ("###", "Header 3"),
            // ];

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

        return { body: "hello world" };
    },
});
