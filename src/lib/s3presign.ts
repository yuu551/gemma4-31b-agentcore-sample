import { fetchAuthSession } from "aws-amplify/auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import outputs from "../../amplify_outputs.json";

const REGION = outputs.custom?.aws_region ?? "us-east-1";

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith("s3://")) return null;
  const parts = uri.slice(5).split("/");
  const bucket = parts[0];
  const key = parts.slice(1).join("/");
  return bucket && key ? { bucket, key } : null;
}

export async function getPresignedUrl(s3Uri: string): Promise<string> {
  const parsed = parseS3Uri(s3Uri);
  if (!parsed) throw new Error(`Invalid S3 URI: ${s3Uri}`);

  const session = await fetchAuthSession();
  const client = new S3Client({ region: REGION, credentials: session.credentials });
  const command = new GetObjectCommand({
    Bucket: parsed.bucket,
    Key: parsed.key,
    ResponseContentType: "text/plain; charset=utf-8",
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

export function replaceS3Links(
  markdown: string,
  urlMap: Map<string, string>,
): string {
  return markdown.replace(
    /\[([^\]]+)\]\((s3:\/\/[^)]+)\)/g,
    (_match, label, s3Uri) => {
      const presigned = urlMap.get(s3Uri);
      return presigned ? `[${label}](${presigned})` : `[${label}](${s3Uri})`;
    },
  );
}

export function extractS3Uris(markdown: string): string[] {
  const uris: string[] = [];
  const regex = /\((s3:\/\/[^)]+)\)/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    uris.push(match[1]);
  }
  return [...new Set(uris)];
}
