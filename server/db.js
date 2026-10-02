import dns from "node:dns";
import { GridFSBucket, MongoClient } from "mongodb";

let client;
let database;
let productImageBucket;

export async function getDb() {
  if (database) return database;

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured. Add it to .env.");
  }

  const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB_NAME || "ecobazaarx");
  return database;
}

export async function getProductImageBucket() {
  const databaseConnection = await getDb();
  if (!productImageBucket) {
    productImageBucket = new GridFSBucket(databaseConnection, { bucketName: "productImages" });
  }
  return productImageBucket;
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
  productImageBucket = undefined;
}