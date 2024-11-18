const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const DefaultAzureCredential =
    require("@azure/identity").DefaultAzureCredential;

const defaultAzureCredential = new DefaultAzureCredential();

require("dotenv").config(); // ローカル実行時の .env ファイル読み込み用
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    defaultAzureCredential
);

const containerClient = blobServiceClient.getContainerClient(containerName);

app.http("httpTrigger1", {
    methods: ["GET", "POST"],
    authLevel: "anonymous",
    handler: async (request, context) => {
        for await (const blob of containerClient.listBlobsFlat()) {
            context.log(blob.name);
            const blobClient = containerClient.getBlobClient(blob.name);
            const downloadBlockBlobResponse = await blobClient.download();
            const downloaded = (
                await streamToBuffer(
                    downloadBlockBlobResponse.readableStreamBody
                )
            ).toString();
            context.log("Downloaded blob content:", downloaded);
            // const localFilePath = path.join(__dirname, "download", blob.name);
            // const writeStream = fs.createWriteStream(localFilePath);
            // downloadBlockBlobResponse.readableStreamBody.pipe(writeStream);
            // context.log(
            //     `Blob ${blob.name} has been downloaded to ${localFilePath}`
            // );
            // context.log(`Blob name: ${blob.name}`);
        }

        return { body: "hello world" };
    },
});

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data instanceof Buffer ? data : Buffer.from(data));
        });
        readableStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        readableStream.on("error", reject);
    });
}
