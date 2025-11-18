import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

import {
  KMSClient,
  SignCommand
} from "@aws-sdk/client-kms";

import dotenv from "dotenv";
dotenv.config();

const region = process.env.AWS_REGION;

export const secretsClient = new SecretsManagerClient({ region });
export const kmsClient = new KMSClient({ region });


// --------------------------------
// Fetch HD seed from Secrets Manager
// --------------------------------
export async function fetchSeed() {
  const cmd = new GetSecretValueCommand({
    SecretId: process.env.SEED_SECRET_ARN
  });

  const resp = await secretsClient.send(cmd);

  if (resp.SecretString) return resp.SecretString;
  if (resp.SecretBinary)
    return Buffer.from(resp.SecretBinary).toString("utf8");

  throw new Error("Seed secret missing");
}


// --------------------------------
// Sign digest using AWS KMS master key
// (Used only for withdrawals)
// --------------------------------
export async function kmsSign(digestBuffer) {
  const cmd = new SignCommand({
    KeyId: process.env.KMS_KEY_ID,
    Message: digestBuffer,
    MessageType: "DIGEST",
    SigningAlgorithm: "ECDSA_SHA_256"
  });

  const resp = await kmsClient.send(cmd);
  return Buffer.from(resp.Signature);
}
