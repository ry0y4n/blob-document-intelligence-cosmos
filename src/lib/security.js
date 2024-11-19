const {
    DefaultAzureCredential,
    getBearerTokenProvider,
} = require("@azure/identity");

const azureOpenAiScope = "https://cognitiveservices.azure.com/.default";

let credentials;

function getCredentials() {
    // Use the current user identity to authenticate.
    // No secrets needed, it uses `az login` or `azd auth login` locally,
    // and managed identity when deployed on Azure.
    credentials ||= new DefaultAzureCredential();
    return credentials;
}

function getAzureOpenAiTokenProvider() {
    return getBearerTokenProvider(getCredentials(), azureOpenAiScope);
}

module.exports = {
    getCredentials,
    getAzureOpenAiTokenProvider,
};
