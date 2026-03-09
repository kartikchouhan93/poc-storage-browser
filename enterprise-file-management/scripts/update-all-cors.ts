import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { PutBucketCorsCommand } from "@aws-sdk/client-s3";
import prisma from "../lib/prisma";
import { getS3Client } from "../lib/s3";

async function main() {
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) || [];
  const origins = allowedOrigins.length > 0 ? allowedOrigins : ["*"];

  console.log(`Setting CORS origins to: ${origins.join(", ")}`);

  const buckets = await prisma.bucket.findMany({
    include: { awsAccount: true },
  });

  for (const bucket of buckets) {
    if (!bucket.awsAccount || bucket.awsAccount.status !== "CONNECTED") {
      console.log(`Skipping ${bucket.name} - no valid AWS account`);
      continue;
    }

    try {
      const s3 = await getS3Client(null, bucket.region, bucket.awsAccount);

      const corsParams = {
        Bucket: bucket.name,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["PUT", "POST", "DELETE", "GET", "HEAD"],
              AllowedOrigins: origins,
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      };

      await s3.send(new PutBucketCorsCommand(corsParams));
      console.log(`Successfully updated CORS for ${bucket.name}`);
    } catch (err) {
      console.error(`Failed to update CORS for ${bucket.name}:`, err);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
