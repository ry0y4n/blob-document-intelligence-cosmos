const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const DocumentIntelligence =
    require("@azure-rest/ai-document-intelligence").default;
const {
    getLongRunningPoller,
} = require("@azure-rest/ai-document-intelligence");

const DefaultAzureCredential =
    require("@azure/identity").DefaultAzureCredential;

const defaultAzureCredential = new DefaultAzureCredential();

require("dotenv").config(); // ローカル実行時の .env ファイル読み込み用
const blobStorageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const blobContainerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

const blobServiceClient = new BlobServiceClient(
    `https://${blobStorageAccountName}.blob.core.windows.net`,
    defaultAzureCredential
);

const containerClient = blobServiceClient.getContainerClient(blobContainerName);

const documnetIntelligenceClient = DocumentIntelligence(
    process.env["DOCUMENT_INTELLIGENCE_ENDPOINT"],
    defaultAzureCredential
);

app.http("httpTrigger1", {
    methods: ["GET", "POST"],
    authLevel: "anonymous",
    handler: async (request, context) => {
        for await (const blob of containerClient.listBlobsFlat()) {
            const blobUrl = `https://${blobStorageAccountName}.blob.core.windows.net/${blobContainerName}/${blob.name}`;
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
            const result = (await poller.pollUntilDone()).body;
            context.log(result.analyzeResult.content);
        }

        return { body: "hello world" };
    },
});
